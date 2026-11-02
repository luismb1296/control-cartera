// Cartas y formatos de póliza: cancelación, baja de asegurado, solicitud de endoso…
// Pueden ser el PDF de la aseguradora (con sus campos) o una carta libre que la app arma.
import { sb, ctx, q } from '../db.js';
import { esc, modal, input, select, textarea, toast, txt, hoyISO, descargar, RAMOS, USOS_POLIZA, TIPOS_MOV, DOCS } from '../ui.js';
import { subirArchivo } from './formas.js';
import { datosPoliza, pdfCartaLibre, llenarFormato, llenarTexto } from './pdfs.js';
import { avisoCancelacion } from './condiciones.js';

// Formatos que aplican a una póliza: de su aseguradora (o generales), de su ramo (o de todos) y del uso pedido
export function formatosPara(formatos, p, uso = null) {
  return formatos.filter(f => f.activo !== false && f.ambito === 'poliza' && (!f.aseguradora_id || f.aseguradora_id === p.aseguradora_id)
    && (!(f.ramos || []).length || f.ramos.includes(p.ramo)) && (!uso || (f.usos || []).includes(uso)))
    .sort((a, b) => (b.aseguradora_id ? 1 : 0) - (a.aseguradora_id ? 1 : 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Abre la lista de cartas y formatos de la póliza.
 * poliza: fila de v_polizas · mov: endoso (opcional) · uso: filtra por uso (ej. el tipo del endoso)
 * extra: [{ etiqueta, nota, accion }] opciones adicionales (ej. la solicitud general de la app)
 */
export async function cartasDePoliza({ poliza, mov = null, uso = null, extra = [], recibo = null, alTerminar }) {
  const todos = await q(sb.from('formatos').select('*').eq('ambito', 'poliza').eq('activo', true));
  const lista = formatosPara(todos, poliza, uso);
  const grupos = {};
  lista.forEach(f => (f.usos?.length ? f.usos : ['carta_libre']).filter(u => !uso || u === uso).forEach(u => (grupos[u] ||= []).push(f)));
  const dlg = modal({
    titulo: mov ? `Formatos para el endoso · ${poliza.numero_poliza || 's/n'}` : `Cartas y formatos · ${poliza.numero_poliza || 's/n'}`,
    cuerpo: `<p class="muted" style="margin-top:0">${esc(poliza.cliente_nombre || '')} · ${esc(poliza.aseguradora_nombre || '')} · ${esc(RAMOS[poliza.ramo] || '')}. Se llenan con los datos de la póliza${mov ? ' y del endoso' : ''}, se guardan en el expediente y se descargan en PDF.</p>
      <div class="list">
        ${extra.map((x, i) => `<div class="li"><div><b>${esc(x.etiqueta)}</b><div class="muted small">${esc(x.nota || '')}</div></div><button type="button" class="btn sm" data-extra="${i}">Generar</button></div>`).join('')}
        ${Object.entries(grupos).map(([u, fs]) => fs.map(f => `<div class="li"><div><b>${esc(f.nombre)}</b><div class="muted small">${esc(USOS_POLIZA[u] || u)} · ${f.modo === 'texto' ? 'Carta libre' : 'Formato PDF'}${f.aseguradora_id ? ' de ' + esc(ctx.aseguradoras.find(a => a.id === f.aseguradora_id)?.nombre || '') : ' general'}</div></div>
          <button type="button" class="btn sm primary" data-fmt="${f.id}">Generar</button></div>`).join('')).join('')}
      </div>
      ${!lista.length ? `<div class="empty" style="margin-top:8px">Aún no hay ${uso ? `formatos de «${esc(USOS_POLIZA[uso] || uso)}»` : 'cartas ni formatos'} para ${esc(poliza.aseguradora_nombre || 'esta aseguradora')}.</div>` : ''}
      <p class="muted small" style="margin-bottom:0">Las cartas y formatos se agregan en Configuración → Formatos y cartas: puede subir el PDF de la aseguradora o escribir una carta libre.</p>`,
  });
  dlg.querySelectorAll('[data-extra]').forEach(b => b.onclick = () => { dlg.close(); extra[Number(b.dataset.extra)].accion(); });
  dlg.querySelectorAll('[data-fmt]').forEach(b => b.onclick = () => { dlg.close(); generar(lista.find(f => f.id === b.dataset.fmt), poliza, mov, alTerminar, recibo); });
}

// Pide los datos que no están en la póliza (persona, motivo, fecha) y genera el documento
async function generar(f, poliza, mov, alTerminar, recibo = null) {
  const difs = mov ? await import('./endosos.js').then(async m => {
    const [p, aseg, c] = await Promise.all([q(sb.from('v_polizas').select('*').eq('id', poliza.id).single()), q(sb.from('asegurados').select('*').eq('poliza_id', poliza.id)), q(sb.from('clientes').select('*').eq('id', poliza.cliente_id).single())]);
    return m.diferencias(mov, p, aseg, c);
  }) : [];
  const asegurados = (await q(sb.from('asegurados').select('*').eq('poliza_id', poliza.id))).filter(a => a.tipo !== 'beneficiario');
  const baja = (mov?.cambios?.asegurados_baja || [])[0];
  const usaPersona = /\{afectado/.test(f.texto || '') || Object.values(f.mapeo || {}).some(x => /^afectado|cliente_fecha_nacimiento|cliente_edad/.test(x)) || (f.usos || []).some(u => /asegurado/.test(u));
  const usaMotivo = /\{motivo\}/.test(f.texto || '') || Object.values(f.mapeo || {}).includes('motivo');
  const acceso = ctx.accesosPortal.some(a => a.cliente_id === poliza.cliente_id && a.activo);
  const pen = (f.usos || []).includes('cancelacion') ? await avisoCancelacion(poliza) : null;
  const datos = async x => (await datosPoliza({ polizaId: poliza.id, mov, difs, afectadoId: x.afectado || null, motivo: txt(x.motivo) || '', fechaEfecto: x.fecha_efecto, reciboId: recibo?.id || null })).v;
  let editado = false;
  modal({
    titulo: f.nombre, boton: 'Generar PDF',
    cuerpo: `${pen ? `<div class="small" role="alert" style="margin:0 0 14px;padding:10px 12px;border-left:4px solid var(--warn);background:var(--surface-2)"><b>Según las condiciones generales${pen.pagina ? ` (p. ${pen.pagina})` : ''}:</b> ${esc(pen.texto)}. Coméntelo con el cliente antes de enviar la cancelación.</div>` : ''}<div class="form-grid">
      ${usaPersona && asegurados.length ? select('Asegurado', 'afectado', `<option value="">${esc(poliza.cliente_nombre || 'Contratante')} (contratante)</option>` + asegurados.map(a => `<option value="${a.id}"${a.id === baja ? ' selected' : ''}>${esc(a.nombre)}${a.parentesco ? ` (${esc(a.parentesco)})` : ''}</option>`).join('')) : ''}
      ${input('Fecha en que surte efecto', 'fecha_efecto', { type: 'date', value: mov?.fecha_efecto || hoyISO() })}
      ${usaMotivo ? input('Motivo', 'motivo', { wide: true, attrs: 'placeholder="Ej. Venta del vehículo"' }) : ''}
      ${f.modo === 'texto' ? `<div class="field wide"><label for="cTx">Texto de la carta (puede ajustarlo antes de generar)</label><textarea id="cTx" name="texto" style="min-height:260px;font-size:13px"></textarea>
        <div class="muted small" style="margin-top:4px">Lo que aparece como ________ no tiene dato en la app: escríbalo aquí o se queda la línea para llenarlo a mano.</div></div>` : `<p class="muted small wide" style="margin:0">Se llena el PDF de la aseguradora con los datos de la póliza${mov ? ' y del endoso' : ''}.</p>`}
      <label class="small wide" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="firma"${acceso ? ' checked' : ''} style="width:auto;min-height:0">
        Pedir al cliente que lo firme desde su portal${acceso ? '' : ' (el cliente aún no tiene acceso al portal)'}</label>
    </div>`,
    onOpen: async form => {
      const tx = form.querySelector('#cTx'); if (!tx) return;
      const pintar = async () => { if (editado) return; const v = await datos(Object.fromEntries(new FormData(form).entries())); tx.value = llenarTexto(f.texto, v); };
      tx.oninput = () => { editado = true; };
      form.addEventListener('change', e => { if (e.target !== tx) pintar(); });
      form.querySelector('[name=motivo]')?.addEventListener('input', () => pintar());
      await pintar();
    },
    onSubmit: async x => {
      const v = await datos(x);
      const bytes = f.modo === 'texto' ? await pdfCartaLibre(x.texto || llenarTexto(f.texto, v), v) : await llenarFormato(f, v);
      const nombre = `${f.nombre} - ${poliza.numero_poliza || 'poliza'} - ${poliza.cliente_nombre || ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+-\s+\.pdf$/, '.pdf');
      const ruta = await subirArchivo(new File([bytes], nombre, { type: 'application/pdf' }), poliza.cliente_id, mov ? 'endosos' : 'cartas');
      await q(sb.from('documentos').insert({ cliente_id: poliza.cliente_id, poliza_id: poliza.id, movimiento_id: mov?.id || null, tipo: mov ? 'solicitud_endoso' : 'carta',
        nombre_archivo: nombre, ruta, firma_solicitada: !!x.firma }));
      if (mov) await q(sb.from('movimiento_eventos').insert({ movimiento_id: mov.id, texto: `Formato generado: ${f.nombre}` }));
      const ok = await descargar(nombre, new Blob([bytes], { type: 'application/pdf' }));
      toast(x.firma ? (acceso ? 'Listo. Se descargó y el cliente lo verá en su portal para firmarlo.' : 'Listo. Para que lo firme en línea, dele acceso al portal desde su ficha.') : ok ? 'Listo. Se descargó y quedó en los documentos del cliente.' : 'Guardado en los documentos del cliente.', x.firma && !acceso);
      alTerminar?.();
    },
  });
}

// Texto de ejemplo para una carta libre nueva
export const CARTA_EJEMPLO = `{aseguradora_nombre}
Presente

Por medio de la presente, yo, {contratante_nombre}, en mi carácter de contratante de la póliza {poliza_numero}, solicito …

Sin otro particular, agradezco su atención.`;
export const nombreUso = u => USOS_POLIZA[u] || TIPOS_MOV[u] || DOCS[u] || u;
