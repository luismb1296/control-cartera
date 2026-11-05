// Endosos: cambios al contrato de la póliza.
// Guardan qué cambia, siguen su avance con la aseguradora, piden sus requisitos,
// llevan la prima a cobranza y comisiones y, al emitirse, actualizan la póliza.
import { sb, ctx, q } from '../db.js';
import {
  esc, money, fdate, pill, modal, input, select, textarea, opts, optsList, toast, num, txt, hoyISO, diasDesde, confirmar, parseD, descargar, edad,
  RAMOS, FORMAS, CONDUCTOS, CAMPOS_RAMO, DOCS, TIPOS_MOV, EST_MOV, FLUJO_MOV, MOV_ABIERTO, REQ_MOV, numRecibo
} from '../ui.js';
import { subirArchivo, abrirArchivo } from './formas.js';
import { enviarMensaje } from './mensajes.js';
import { formTarea } from './tablero.js';
import { firmadoDe } from './firma.js';
import { nuevoDoc, limpio, envolver, firma } from './pdfs.js';
import { leerPdf, extraerConIA, INSTRUCCION_ENDOSO } from '../ia.js';
import { refrescar } from '../app.js';
import { cartasDePoliza } from './cartas.js';
import { abrirCondiciones, edadMaxima } from './condiciones.js';

// ---------------------------------------------------------------- Reglas
export const endosoAtrasado = m => MOV_ABIERTO.includes(m.estatus) && diasDesde(m.actualizado_en || m.creado_en) > (m.dias_alerta ?? 10);
const tieneCambios = m => Object.keys(m.cambios || {}).length > 0 || (Number(m.importe || 0) !== 0 && m.manejo_prima !== 'ninguno');
export const endosoPorAplicar = m => ['emitido', 'entregado'].includes(m.estatus) && !m.aplicado_en && tieneCambios(m);
const MANEJO = {
  recibo: 'Recibo aparte por el importe del endoso',
  repartir: 'Repartir en los recibos pendientes',
  devolucion: 'Devolución al cliente (recibo en negativo)',
  ninguno: 'No cambia la prima',
};
const PARENTESCOS = ['titular', 'cónyuge', 'hijo', 'hija', 'padre', 'madre', 'hermano', 'hermana', 'otro'];
const etiquetaCampo = (ramo, k) => (CAMPOS_RAMO[ramo] || []).find(([c]) => c === k)?.[1] || (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');
const dmy = s => { const d = parseD(s); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : ''; };
const domicilioTxt = d => d ? [d.calle, d.colonia ? 'Col. ' + d.colonia : '', d.codigo_postal ? 'C.P. ' + d.codigo_postal : '', d.ciudad, d.estado].filter(Boolean).join(', ') || '—' : '—';
const titulo = m => `${TIPOS_MOV[m.tipo] || 'Endoso'}${m.folio_endoso ? ' · ' + m.folio_endoso : ''}`;
const quien = id => ctx.perfiles.find(p => p.id === id)?.nombre || '';

// Prima a prorrata: la parte del cambio que corresponde a los días que le quedan a la vigencia
export function prorrata(primaAnual, efecto, poliza) {
  const ini = parseD(poliza.inicio_vigencia), fin = parseD(poliza.fin_vigencia), ef = parseD(efecto) || ini;
  const total = Math.round((fin - ini) / 864e5), resto = Math.max(0, Math.round((fin - ef) / 864e5));
  return { total, resto, importe: total ? Math.round(primaAnual * resto / total * 100) / 100 : 0 };
}

// Qué cambia: [campo, antes, después]. Antes de aplicar se compara contra la póliza actual;
// después de aplicar, contra cómo estaba la póliza al momento de aplicarlo.
export function diferencias(m, p, asegurados, cliente) {
  const c = m.cambios || {}, a = m.aplicado_en && m.antes && !m.antes.historico ? m.antes : null;
  const base = a || { datos_ramo: p.datos_ramo || {}, forma_pago: p.forma_pago, conducto_cobro: p.conducto_cobro, prima_total: p.prima_total,
    domicilio: { calle: cliente?.calle, colonia: cliente?.colonia, codigo_postal: cliente?.codigo_postal, ciudad: cliente?.ciudad, estado: cliente?.estado } };
  const filas = [];
  (c.asegurados_alta || []).forEach(x => filas.push(['Alta de asegurado', '—', `${x.nombre}${x.parentesco ? ` (${x.parentesco})` : ''}${x.fecha_nacimiento ? ', nac. ' + dmy(x.fecha_nacimiento) : ''}`]));
  const previos = a ? a.asegurados_baja || [] : asegurados;
  (c.asegurados_baja || []).forEach(id => { const x = previos.find(y => String(y.id) === String(id)); filas.push(['Baja de asegurado', x ? `${x.nombre}${x.parentesco ? ` (${x.parentesco})` : ''}` : 'Asegurado', '—']); });
  if (c.beneficiarios) {
    const ant = (a ? (a.asegurados_baja || []) : asegurados).filter(x => x.tipo === 'beneficiario');
    const t = l => l.map(x => `${x.nombre}${x.porcentaje != null && x.porcentaje !== '' ? ` ${Number(x.porcentaje)}%` : ''}`).join('; ') || '—';
    filas.push(['Beneficiarios', t(ant), t(c.beneficiarios)]);
  }
  Object.entries(c.datos_ramo || {}).forEach(([k, v]) => filas.push([etiquetaCampo(p.ramo, k), base.datos_ramo?.[k] || '—', v || '—']));
  if (c.forma_pago) filas.push(['Forma de pago', FORMAS[base.forma_pago] || '—', FORMAS[c.forma_pago]]);
  if (c.conducto_cobro) filas.push(['Conducto de cobro', CONDUCTOS[base.conducto_cobro] || '—', CONDUCTOS[c.conducto_cobro]]);
  if (c.domicilio) filas.push(['Domicilio', domicilioTxt(base.domicilio), domicilioTxt({ ...base.domicilio, ...Object.fromEntries(Object.entries(c.domicilio).filter(([, v]) => v)) })]);
  const imp = Number(m.importe || 0);
  if (imp && m.manejo_prima !== 'ninguno') filas.push(['Prima total de la póliza', money(base.prima_total, p.moneda), money(Number(base.prima_total) + imp, p.moneda)]);
  return filas;
}

// ---------------------------------------------------------------- Lista
export async function vistaEndosos(main, _p, vigente) {
  const [movs, polizas] = await Promise.all([
    q(sb.from('movimientos').select('*').order('creado_en', { ascending: false })),
    q(sb.from('v_polizas').select('id,numero_poliza,cliente_id,cliente_nombre,aseguradora_nombre,ramo,estatus,moneda,pct_comision,agente_id')),
  ]);
  if (!vigente()) return;
  const pol = Object.fromEntries(polizas.map(p => [p.id, p]));
  const anio = hoyISO().slice(0, 4);
  const abiertos = movs.filter(m => MOV_ABIERTO.includes(m.estatus)), atrasados = movs.filter(endosoAtrasado), porAplicar = movs.filter(endosoPorAplicar);
  const delAnio = movs.filter(m => ['emitido', 'entregado'].includes(m.estatus) && String(m.fecha_emision || m.fecha_efecto || m.creado_en).slice(0, 4) === anio);
  const primaAnio = delAnio.reduce((a, m) => a + Number(m.importe || 0), 0);
  const delPortal = movs.filter(m => m.solicitado_por_cliente && m.estatus === 'solicitado');
  let filtro = sessionStorage.getItem('cc-endosos-filtro') || (atrasados.length || porAplicar.length || delPortal.length ? 'atencion' : 'abiertos'), texto = '', tipo = '';
  const FILTROS = { atencion: 'Requieren atención', abiertos: 'En proceso', emitidos: 'Emitidos', rechazados: 'Rechazados', todos: 'Todos' };
  const pasa = m => ({
    atencion: endosoAtrasado(m) || endosoPorAplicar(m) || (m.solicitado_por_cliente && m.estatus === 'solicitado'),
    abiertos: MOV_ABIERTO.includes(m.estatus), emitidos: ['emitido', 'entregado'].includes(m.estatus), rechazados: m.estatus === 'rechazado', todos: true,
  })[filtro];

  main.innerHTML = `
  <header class="head"><div><h1>Endosos</h1>
    <p class="muted" style="margin:4px 0 0">Cambios al contrato de las pólizas: qué cambia, en qué va con la aseguradora y cómo afecta la prima.</p></div>
    <button type="button" class="btn primary" id="eNuevo">+ Nuevo endoso</button></header>
  <section class="kpis">
    <div class="kpi"><div class="k">En proceso</div><div class="v">${abiertos.length}</div><div class="muted small">Solicitados, enviados o en revisión</div></div>
    <div class="kpi"><div class="k">Sin movimiento</div><div class="v" style="${atrasados.length ? 'color:var(--bad)' : ''}">${atrasados.length}</div><div class="muted small">Pasaron su plazo de seguimiento</div></div>
    <div class="kpi"><div class="k">Emitidos por aplicar</div><div class="v" style="${porAplicar.length ? 'color:var(--warn)' : ''}">${porAplicar.length}</div><div class="muted small">La póliza aún no refleja el cambio</div></div>
    <div class="kpi"><div class="k">Prima de endosos ${anio}</div><div class="v">${money(primaAnio)}</div><div class="muted small">${delAnio.length} emitido${delAnio.length === 1 ? '' : 's'} este año</div></div>
  </section>
  ${delPortal.length ? `<div class="card" style="border-left:4px solid var(--accent)"><b>${delPortal.length} solicitud${delPortal.length === 1 ? '' : 'es'} de clientes desde el portal</b>
    <div class="muted small">Revíselas, complete los requisitos y envíelas a la aseguradora.</div></div>` : ''}
  <div class="card">
    <div class="filters" style="margin-bottom:14px">
      <div class="chips" role="group" aria-label="Filtrar endosos">${Object.entries(FILTROS).map(([k, v]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${k === filtro}">${v}</button>`).join('')}</div>
      <label class="sr" for="eTipo">Tipo</label><select id="eTipo" style="width:auto"><option value="">Todos los tipos</option>${opts(TIPOS_MOV, '')}</select>
      <label class="sr" for="eBus">Buscar</label><input id="eBus" type="search" placeholder="Buscar cliente, póliza o folio" style="max-width:260px">
    </div>
    <div id="eTabla"></div>
  </div>`;

  const pintar = () => {
    const t = texto.toLowerCase();
    const lista = movs.filter(m => pasa(m) && (!tipo || m.tipo === tipo) && (!t || [pol[m.poliza_id]?.cliente_nombre, pol[m.poliza_id]?.numero_poliza, m.folio_endoso, m.descripcion].some(x => String(x || '').toLowerCase().includes(t))));
    main.querySelector('#eTabla').innerHTML = lista.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Cliente y póliza</th><th>Movimiento</th><th>Estatus</th><th class="num">Prima</th><th>Último movimiento</th></tr></thead>
      <tbody>${lista.map(m => { const p = pol[m.poliza_id] || {}, d = diasDesde(m.actualizado_en || m.creado_en);
        return `<tr data-ir="${m.id}" style="cursor:pointer">
        <td><div><a href="#/endoso/${m.id}">${esc(p.cliente_nombre || '—')}</a></div><div class="muted small">${esc(p.aseguradora_nombre || '')} · ${esc(p.numero_poliza || 's/n')}</div></td>
        <td><div>${esc(TIPOS_MOV[m.tipo] || m.tipo)}${m.solicitado_por_cliente ? ' <span class="pill p-blue" style="font-size:11px">Portal</span>' : ''}</div><div class="muted small">${esc(m.descripcion || '')}</div></td>
        <td>${pill(EST_MOV, m.estatus)}${endosoAtrasado(m) ? '<div class="small" style="color:var(--bad);margin-top:3px">Sin movimiento</div>' : ''}${endosoPorAplicar(m) ? '<div class="small" style="color:var(--warn);margin-top:3px">Falta aplicar a la póliza</div>' : ''}</td>
        <td class="num">${m.importe != null ? money(m.importe, p.moneda) : '—'}</td>
        <td class="nw">${d === 0 ? 'Hoy' : `Hace ${d} día${d === 1 ? '' : 's'}`}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<div class="empty">No hay endosos con este filtro.</div>';
  };
  pintar();
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    filtro = b.dataset.f; try { sessionStorage.setItem('cc-endosos-filtro', filtro); } catch (e) { }
    main.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', x === b)); pintar();
  });
  main.querySelector('#eTipo').onchange = e => { tipo = e.target.value; pintar(); };
  main.querySelector('#eBus').oninput = e => { texto = e.target.value; pintar(); };
  main.querySelector('#eTabla').addEventListener('click', e => { const tr = e.target.closest('[data-ir]'); if (tr && !e.target.closest('a')) location.hash = '#/endoso/' + tr.dataset.ir; });
  main.querySelector('#eNuevo').onclick = () => elegirPoliza(polizas.filter(p => p.estatus === 'activa'));
}

// Primero se elige la póliza; después, el formulario del endoso
function elegirPoliza(polizas) {
  modal({
    titulo: 'Nuevo endoso', boton: 'Continuar',
    cuerpo: `<div class="form-grid">${select('Póliza', 'poliza_id', '<option value="">— Elija la póliza —</option>' +
      optsList([...polizas].sort((a, b) => String(a.cliente_nombre).localeCompare(String(b.cliente_nombre), 'es')), '', p => `${p.cliente_nombre} · ${p.aseguradora_nombre} · ${p.numero_poliza || 's/n'} (${RAMOS[p.ramo]})`), { req: true, wide: true })}</div>`,
    onSubmit: async d => { setTimeout(() => formEndoso({ polizaId: d.poliza_id, alGuardar: m => { location.hash = '#/endoso/' + m.id; } }), 0); },
  });
}

// ---------------------------------------------------------------- Formulario (alta y edición)
export async function formEndoso({ polizaId, mov = null, alGuardar }) {
  const pid = mov?.poliza_id || polizaId;
  const [p, aseg] = await Promise.all([q(sb.from('v_polizas').select('*').eq('id', pid).single()), q(sb.from('asegurados').select('*').eq('poliza_id', pid))]);
  const cliente = await q(sb.from('clientes').select('*').eq('id', p.cliente_id).single());
  const m = mov || { tipo: 'alta_asegurado', estatus: 'solicitado', fecha_efecto: hoyISO(), manejo_prima: 'recibo', cambios: {}, dias_alerta: 10, responsable_id: ctx.perfil.id };
  let cambios = JSON.parse(JSON.stringify(m.cambios || {})), pdfIA = null;
  const bloqueado = !!m.aplicado_en;
  const campos = [...new Set([...(CAMPOS_RAMO[p.ramo] || []).map(([k]) => k), ...Object.keys(p.datos_ramo || {}), ...Object.keys(cambios.datos_ramo || {})])];

  const fila = (k, i, x) => {
    if (k === 'alta') return `<div class="form-grid" data-fila="alta" style="grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:6px">
      ${input('Nombre completo', `alta_nombre_${i}`, { value: x.nombre || '' })}
      ${select('Parentesco', `alta_par_${i}`, PARENTESCOS.map(v => `<option${v === x.parentesco ? ' selected' : ''}>${v}</option>`).join(''))}
      ${input('Nacimiento', `alta_nac_${i}`, { type: 'date', value: x.fecha_nacimiento || '' })}
      <button type="button" class="x" aria-label="Quitar" data-quitar style="min-width:36px;min-height:36px">×</button></div>`;
    return `<div class="form-grid" data-fila="ben" style="grid-template-columns:2fr 1fr 90px auto;gap:8px;align-items:end;margin-bottom:6px">
      ${input('Beneficiario', `ben_nombre_${i}`, { value: x.nombre || '' })}
      ${select('Parentesco', `ben_par_${i}`, PARENTESCOS.map(v => `<option${v === x.parentesco ? ' selected' : ''}>${v}</option>`).join(''))}
      ${input('%', `ben_pct_${i}`, { type: 'number', value: x.porcentaje ?? '', attrs: 'min="0" max="100" step="0.01"' })}
      <button type="button" class="x" aria-label="Quitar" data-quitar style="min-width:36px;min-height:36px">×</button></div>`;
  };
  const seccion = tp => {
    const c = cambios;
    if (tp === 'alta_asegurado') return `<div id="filasAlta">${(c.asegurados_alta?.length ? c.asegurados_alta : [{}]).map((x, i) => fila('alta', i, x)).join('')}</div>
      <button type="button" class="linkbtn small" data-mas="alta">+ Agregar otra persona</button>`;
    if (tp === 'baja_asegurado') { const lista = aseg.filter(a => a.tipo === 'asegurado');
      return lista.length ? lista.map(a => `<label class="small" style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><input type="checkbox" name="baja_${a.id}" ${(c.asegurados_baja || []).map(String).includes(String(a.id)) ? 'checked' : ''} style="width:auto;min-height:0">
        ${esc(a.nombre)}${a.parentesco ? ` <span class="muted">(${esc(a.parentesco)})</span>` : ''}</label>`).join('') : '<p class="muted small">La póliza no tiene asegurados registrados.</p>'; }
    if (tp === 'cambio_beneficiarios') { const actuales = c.beneficiarios || aseg.filter(a => a.tipo === 'beneficiario').map(a => ({ nombre: a.nombre, parentesco: a.parentesco, porcentaje: a.porcentaje }));
      return `<p class="muted small" style="margin-top:0">Escriba cómo deben quedar los beneficiarios (la lista completa). Los porcentajes deben sumar 100%.</p>
        <div id="filasBen">${(actuales.length ? actuales : [{}]).map((x, i) => fila('ben', i, x)).join('')}</div>
        <button type="button" class="linkbtn small" data-mas="ben">+ Agregar beneficiario</button>`; }
    if (['cambio_vehiculo', 'cambio_cobertura', 'cambio_suma', 'correccion_datos'].includes(tp)) return `<p class="muted small" style="margin-top:0">Escriba solo lo que cambia; lo que deje igual no se modifica.</p>
      <div class="form-grid">${campos.map(k => input(`${etiquetaCampo(p.ramo, k)}${p.datos_ramo?.[k] ? ` (hoy: ${p.datos_ramo[k]})` : ''}`, 'dr_' + k, { value: c.datos_ramo?.[k] ?? '' })).join('')}
      ${input('Otro dato (nombre)', 'dr_nuevo_k', { attrs: 'placeholder="Ej. Número de motor"' })}${input('Valor', 'dr_nuevo_v')}</div>`;
    if (tp === 'cambio_forma_pago') return `<div class="form-grid">${select(`Nueva forma de pago (hoy: ${FORMAS[p.forma_pago]})`, 'nueva_forma', opts(FORMAS, c.forma_pago || (p.forma_pago === 'mensual' ? 'contado' : 'mensual')))}</div>
      <p class="muted small">Al aplicarlo, los recibos pendientes se vuelven a dividir con la nueva forma de pago; los pagados no cambian.</p>`;
    if (tp === 'cambio_conducto') return `<div class="form-grid">${select(`Nuevo conducto de cobro (hoy: ${CONDUCTOS[p.conducto_cobro] || '—'})`, 'nuevo_conducto', opts(CONDUCTOS, c.conducto_cobro || (p.conducto_cobro === 'tarjeta' ? 'domiciliado' : 'tarjeta')))}</div>`;
    if (tp === 'cambio_domicilio') { const d = c.domicilio || {};
      return `<p class="muted small" style="margin-top:0">Se actualiza también el domicilio en la ficha del cliente.</p><div class="form-grid">
        ${input('Calle y número', 'dom_calle', { value: d.calle ?? cliente.calle ?? '', wide: true })}${input('Colonia', 'dom_colonia', { value: d.colonia ?? cliente.colonia ?? '' })}
        ${input('Código postal', 'dom_cp', { value: d.codigo_postal ?? cliente.codigo_postal ?? '' })}${input('Ciudad', 'dom_ciudad', { value: d.ciudad ?? cliente.ciudad ?? '' })}${input('Estado', 'dom_estado', { value: d.estado ?? cliente.estado ?? '' })}</div>`; }
    return '<p class="muted small" style="margin:0">Describa el cambio arriba. Este tipo no modifica datos de la póliza en la app.</p>';
  };

  const dlg = modal({
    titulo: mov ? 'Editar endoso' : `Nuevo endoso · ${p.numero_poliza || 's/n'}`, boton: mov ? 'Guardar cambios' : 'Registrar endoso',
    cuerpo: `
      <p class="muted" style="margin-top:0">${esc(p.cliente_nombre)} · ${esc(p.aseguradora_nombre)} · ${esc(RAMOS[p.ramo])} · vigencia ${fdate(p.inicio_vigencia)} al ${fdate(p.fin_vigencia)}</p>
      ${bloqueado ? '<p class="small" style="color:var(--warn)">Este endoso ya se aplicó a la póliza. Para cambiar lo que modifica, primero use «Deshacer» en la página del endoso.</p>' : `
      <div class="card" style="margin:0 0 16px;padding:12px 14px;background:var(--surface-2,transparent)">
        <div class="li"><div><b>¿Ya tiene el PDF del endoso?</b><div class="muted small">Se lee con IA para llenar folio, fecha, prima y cambios, y se guarda en el endoso.</div></div>
        <label class="btn sm" for="ePdf" style="cursor:pointer;white-space:nowrap">Leer PDF</label><input type="file" id="ePdf" class="sr" accept="application/pdf,.pdf"></div>
        <div id="eIA" class="small" style="margin-top:6px"></div></div>`}
      <div class="form-grid">
        ${select('Tipo de endoso', 'tipo', opts(TIPOS_MOV, m.tipo), { req: true, attrs: bloqueado ? 'disabled' : '' })}
        ${input('Fecha en que surte efecto', 'fecha_efecto', { type: 'date', value: m.fecha_efecto || '' })}
        ${input('Descripción', 'descripcion', { wide: true, value: m.descripcion || '', req: true, attrs: 'placeholder="Ej. Alta de hija recién nacida, cambio de placas…"' })}
        ${input('Folio del endoso (de la aseguradora)', 'folio_endoso', { value: m.folio_endoso || '' })}
        ${mov ? '' : select('Estatus', 'estatus', opts(Object.fromEntries(Object.entries(EST_MOV).map(([k, [v]]) => [k, v])), m.estatus))}
        ${select('Responsable', 'responsable_id', '<option value="">— Sin asignar —</option>' + optsList(ctx.perfiles.filter(x => x.activo && x.rol !== 'cliente'), m.responsable_id))}
        ${input('Avisar si pasa sin movimiento (días)', 'dias_alerta', { type: 'number', value: m.dias_alerta ?? 10, attrs: 'min="1" max="90"' })}
      </div>
      <h3 style="margin:18px 0 8px;font-size:15px">Qué cambia en la póliza</h3>
      <fieldset id="eCambios" style="border:0;padding:0;margin:0" ${bloqueado ? 'disabled' : ''}>${seccion(m.tipo)}</fieldset>
      <h3 style="margin:18px 0 8px;font-size:15px">Prima del endoso</h3>
      <fieldset style="border:0;padding:0;margin:0" ${bloqueado ? 'disabled' : ''}>
      <div class="form-grid">
        ${input('Prima total del endoso (+ cobro / − devolución)', 'importe', { type: 'number', value: m.importe ?? '', attrs: 'step="0.01"' })}
        ${input('Prima neta (opcional, para la comisión)', 'prima_neta', { type: 'number', value: m.prima_neta ?? '', attrs: 'step="0.01"' })}
        ${select('Cómo se cobra', 'manejo_prima', opts(MANEJO, m.manejo_prima || 'recibo'), { wide: true })}
      </div>
      <details style="margin-top:8px"><summary class="small" style="cursor:pointer">Calcular a prorrata</summary>
        <div class="form-grid" style="margin-top:8px;align-items:end">${input('Prima anual del cambio', 'pr_anual', { type: 'number', attrs: 'step="0.01" placeholder="Ej. 6,500"' })}
          <div class="field"><button type="button" class="btn sm" id="prCalc">Calcular</button></div></div>
        <p class="muted small" id="prRes" style="margin-bottom:0">Toma los días que faltan de la vigencia desde la fecha en que surte efecto.</p></details>
      <p class="muted small" id="eCom" style="margin-bottom:0"></p>
      </fieldset>`,
    onOpen: f => {
      if (!bloqueado) f.tipo.onchange = () => { cambios = {}; f.querySelector('#eCambios').innerHTML = seccion(f.tipo.value); };
      const comision = () => {
        const imp = num(f.importe.value), neta = num(f.prima_neta.value) ?? (imp != null ? Math.round(imp / 1.16 * 100) / 100 : null);
        f.querySelector('#eCom').textContent = imp ? `Comisión estimada: ${money(neta * Number(p.pct_comision || 0) / 100, p.moneda)} (${Number(p.pct_comision || 0)}% sobre prima neta ${money(neta, p.moneda)}${num(f.prima_neta.value) == null ? ', calculada sin IVA' : ''}).` : '';
        if (imp < 0 && f.manejo_prima.value !== 'devolucion') f.manejo_prima.value = 'devolucion';
        if (imp > 0 && f.manejo_prima.value === 'devolucion') f.manejo_prima.value = 'recibo';
      };
      f.importe.oninput = comision; f.prima_neta.oninput = comision; comision();
      f.querySelector('#prCalc').onclick = () => {
        const anual = num(f.pr_anual.value); if (!anual) { f.querySelector('#prRes').textContent = 'Escriba la prima anual del cambio.'; return; }
        const r = prorrata(anual, f.fecha_efecto.value, p);
        f.importe.value = r.importe; comision();
        f.querySelector('#prRes').textContent = `${money(anual)} × ${r.resto} de ${r.total} días = ${money(r.importe)}. Se puso como prima del endoso.`;
      };
      f.addEventListener('click', e => {
        const b = e.target;
        if (b.dataset.mas) { leerCambios(f); const k = b.dataset.mas === 'alta' ? 'asegurados_alta' : 'beneficiarios'; cambios[k] = [...(cambios[k] || (k === 'beneficiarios' ? aseg.filter(a => a.tipo === 'beneficiario') : [])), {}]; f.querySelector('#eCambios').innerHTML = seccion(f.tipo.value); }
        if (b.hasAttribute('data-quitar')) { b.closest('[data-fila]').remove(); }
      });
      f.querySelector('#ePdf')?.addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        const out = f.querySelector('#eIA'); out.style.color = ''; out.textContent = 'Leyendo el endoso…';
        try {
          const x = await extraerConIA(INSTRUCCION_ENDOSO, await leerPdf(file));
          pdfIA = file;
          const avisos = aplicarLectura(f, x, p, aseg, v => { cambios = v; f.querySelector('#eCambios').innerHTML = seccion(f.tipo.value); }, cambios);
          comision();
          out.innerHTML = `<span style="color:var(--ok)">Listo: se llenaron los datos. Revíselos antes de guardar.</span>${avisos.length ? '<br>' + avisos.map(esc).join('<br>') : ''}`;
        } catch (err) { out.style.color = 'var(--bad)'; out.textContent = err.message; }
      });
    },
    onSubmit: async (d, f) => {
      const fila0 = { fecha_efecto: txt(d.fecha_efecto), descripcion: txt(d.descripcion), folio_endoso: txt(d.folio_endoso), responsable_id: d.responsable_id || null, dias_alerta: Number(d.dias_alerta) || 10 };
      if (!bloqueado) {
        leerCambios(f);
        if (d.tipo === 'cambio_beneficiarios' && cambios.beneficiarios?.length) {
          const s = cambios.beneficiarios.reduce((a, x) => a + Number(x.porcentaje || 0), 0);
          if (Math.abs(s - 100) > 0.01) throw new Error(`Los porcentajes de los beneficiarios suman ${s}%; deben sumar 100%.`);
        }
        if (d.tipo === 'alta_asegurado' && !(cambios.asegurados_alta || []).length) throw new Error('Escriba el nombre de la persona que se da de alta.');
        Object.assign(fila0, { tipo: d.tipo, cambios, importe: num(d.importe), prima_neta: num(d.prima_neta), manejo_prima: num(d.importe) ? d.manejo_prima : 'ninguno' });
        if (fila0.manejo_prima === 'devolucion' && fila0.importe > 0) fila0.importe = -fila0.importe;
      }
      let r;
      if (mov) r = await q(sb.from('movimientos').update(fila0).eq('id', mov.id).select().single());
      else r = await q(sb.from('movimientos').insert({ ...fila0, poliza_id: p.id, estatus: d.estatus }).select().single());
      if (pdfIA) {
        const ruta = await subirArchivo(pdfIA, p.cliente_id, 'endosos');
        await q(sb.from('documentos').insert({ cliente_id: p.cliente_id, poliza_id: p.id, movimiento_id: r.id, tipo: 'endoso', nombre_archivo: pdfIA.name, ruta }));
      }
      toast(mov ? 'Endoso actualizado.' : 'Endoso registrado.');
      alGuardar?.(r);
    },
  });

  // Lee del formulario lo que cambia según el tipo
  function leerCambios(f) {
    const tp = f.tipo.value, val = n => f.querySelector(`[name="${n}"]`)?.value?.trim() ?? '';
    const c = {};
    if (tp === 'alta_asegurado') c.asegurados_alta = [...f.querySelectorAll('[data-fila="alta"]')].map(row => { const i = row.querySelector('input').name.split('_').pop();
      return { nombre: val('alta_nombre_' + i), parentesco: val('alta_par_' + i), fecha_nacimiento: val('alta_nac_' + i) || null }; }).filter(x => x.nombre);
    if (tp === 'baja_asegurado') c.asegurados_baja = aseg.filter(a => f.querySelector(`[name="baja_${a.id}"]`)?.checked).map(a => a.id);
    if (tp === 'cambio_beneficiarios') c.beneficiarios = [...f.querySelectorAll('[data-fila="ben"]')].map(row => { const i = row.querySelector('input').name.split('_').pop();
      return { nombre: val('ben_nombre_' + i), parentesco: val('ben_par_' + i), porcentaje: num(val('ben_pct_' + i)) }; }).filter(x => x.nombre);
    if (['cambio_vehiculo', 'cambio_cobertura', 'cambio_suma', 'correccion_datos'].includes(tp)) {
      const dr = {}; campos.forEach(k => { const v = val('dr_' + k); if (v && v !== String(p.datos_ramo?.[k] ?? '')) dr[k] = v; });
      const nk = val('dr_nuevo_k'), nv = val('dr_nuevo_v');
      if (nk && nv) dr[nk.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = nv;
      if (Object.keys(dr).length) c.datos_ramo = dr;
    }
    if (tp === 'cambio_forma_pago') c.forma_pago = val('nueva_forma');
    if (tp === 'cambio_conducto') c.conducto_cobro = val('nuevo_conducto');
    if (tp === 'cambio_domicilio') {
      const d = { calle: val('dom_calle'), colonia: val('dom_colonia'), codigo_postal: val('dom_cp'), ciudad: val('dom_ciudad'), estado: val('dom_estado') };
      if (['calle', 'colonia', 'codigo_postal', 'ciudad', 'estado'].some(k => d[k] !== String(cliente[k] ?? ''))) c.domicilio = d;
    }
    if (f.querySelector('#eCambios').children.length) cambios = c;
    return c;
  }
  return dlg;
}

// Llena el formulario con lo que leyó la IA del PDF del endoso
function aplicarLectura(f, x, p, aseg, ponerCambios, cambios0) {
  const avisos = [];
  const nrm = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (x.numero_poliza && p.numero_poliza && nrm(x.numero_poliza) !== nrm(p.numero_poliza) && !nrm(x.numero_poliza).includes(nrm(p.numero_poliza)))
    avisos.push(`Ojo: el PDF dice póliza ${x.numero_poliza} y este endoso es de la ${p.numero_poliza}.`);
  if (x.tipo && TIPOS_MOV[x.tipo]) f.tipo.value = x.tipo;
  if (x.fecha_efecto && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha_efecto)) f.fecha_efecto.value = x.fecha_efecto;
  if (x.descripcion) f.descripcion.value = String(x.descripcion).slice(0, 200);
  if (x.folio_endoso) f.folio_endoso.value = x.folio_endoso;
  if (x.importe != null && !isNaN(Number(x.importe))) f.importe.value = Number(x.importe);
  if (x.prima_neta != null && !isNaN(Number(x.prima_neta))) f.prima_neta.value = Number(x.prima_neta);
  if (f.estatus && (x.folio_endoso || x.importe != null)) f.estatus.value = 'emitido';
  const c = {};
  if (Array.isArray(x.asegurados_alta) && x.asegurados_alta.length) c.asegurados_alta = x.asegurados_alta.filter(a => a?.nombre).map(a => ({ nombre: a.nombre, parentesco: a.parentesco || 'otro', fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(a.fecha_nacimiento || '') ? a.fecha_nacimiento : null }));
  if (Array.isArray(x.asegurados_baja) && x.asegurados_baja.length) {
    const n = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    c.asegurados_baja = aseg.filter(a => x.asegurados_baja.some(b => n(b) && (n(a.nombre) === n(b) || n(a.nombre).startsWith(n(b)) || n(b).startsWith(n(a.nombre))))).map(a => a.id);
    if (c.asegurados_baja.length < x.asegurados_baja.length) avisos.push('No se encontró en la póliza a todas las personas que se dan de baja; márquelas a mano.');
  }
  if (x.datos_ramo && typeof x.datos_ramo === 'object') { const dr = Object.fromEntries(Object.entries(x.datos_ramo).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])); if (Object.keys(dr).length) c.datos_ramo = dr; }
  if (x.forma_pago && FORMAS[x.forma_pago]) c.forma_pago = x.forma_pago;
  if (x.conducto_cobro && CONDUCTOS[x.conducto_cobro]) c.conducto_cobro = x.conducto_cobro;
  if (Array.isArray(x.beneficiarios) && x.beneficiarios.length) c.beneficiarios = x.beneficiarios.filter(b => b?.nombre).map(b => ({ nombre: b.nombre, parentesco: b.parentesco || 'otro', porcentaje: b.porcentaje ?? null }));
  ponerCambios(Object.keys(c).length ? c : cambios0);
  return avisos;
}

// ---------------------------------------------------------------- Página del endoso
export async function vistaEndoso(main, id, vigente) {
  const m = await q(sb.from('movimientos').select('*').eq('id', id).maybeSingle());
  if (!vigente()) return;
  if (!m) { main.innerHTML = '<div class="card"><h2>Endoso no encontrado</h2><a href="#/endosos">Volver a endosos</a></div>'; return; }
  const [p, aseg, eventos, recibos, tareas] = await Promise.all([
    q(sb.from('v_polizas').select('*').eq('id', m.poliza_id).single()),
    q(sb.from('asegurados').select('*').eq('poliza_id', m.poliza_id)),
    q(sb.from('movimiento_eventos').select('*').eq('movimiento_id', id).order('creado_en', { ascending: false })),
    q(sb.from('recibos').select('*').eq('poliza_id', m.poliza_id).order('numero')),
    q(sb.from('tareas').select('id,titulo,estatus,asignado_a,origen,movimiento_id').eq('hecha', false)),
  ]);
  const [c, docsCli] = await Promise.all([q(sb.from('clientes').select('*').eq('id', p.cliente_id).single()), q(sb.from('documentos').select('*').eq('cliente_id', p.cliente_id).order('creado_en', { ascending: false }))]);
  if (!vigente()) return;
  const docs = docsCli.filter(d => d.movimiento_id === id);
  const tarea = tareas.find(t => t.movimiento_id === id || t.origen === 'endoso:' + id);
  const difs = diferencias(m, p, aseg, c);
  const imp = Number(m.importe || 0), neta = m.prima_neta != null ? Number(m.prima_neta) : Math.round(imp / 1.16 * 100) / 100;
  const reciboEndoso = recibos.find(r => r.movimiento_id === id);
  const idx = FLUJO_MOV.indexOf(m.estatus), siguiente = m.estatus === 'rechazado' ? null : FLUJO_MOV[idx + 1];
  const BOTON_SIG = { enviado: 'Marcar como enviado a la aseguradora', en_revision: 'Marcar en revisión', emitido: 'Marcar como emitido', entregado: 'Marcar como entregado al cliente' };
  const req = (REQ_MOV[m.tipo] || []).filter(([t]) => !(t === 'cuestionario_medico' && p.ramo !== 'gmm')).map(([tipo, etq]) => {
    const propio = docs.find(d => d.tipo === tipo), general = ['ine', 'comprobante_domicilio', 'estado_cuenta'].includes(tipo) && docsCli.find(d => d.tipo === tipo && !d.movimiento_id);
    return { tipo, etq, hay: !!(propio || general), deCliente: !propio && !!general, firmado: tipo === 'solicitud_endoso' && docs.some(d => d.tipo === tipo && (d.firma_de || firmadoDe(d, docs))) };
  });
  const faltan = req.filter(r => !r.hay).length;
  const atraso = endosoAtrasado(m), porAplicar = endosoPorAplicar(m);
  // Alta de asegurado: edad máxima de aceptación según condiciones generales
  const emax = m.tipo === 'alta_asegurado' ? await edadMaxima(p) : null;
  const pasados = emax ? (m.cambios?.asegurados_alta || []).filter(x => x.fecha_nacimiento && edad(x.fecha_nacimiento) > emax.anios) : [];
  if (!vigente()) return;
  const dias = diasDesde(m.actualizado_en || m.creado_en);
  const estadoFirma = d => {
    if (d.firma_de) return '<span class="pill p-ok">Firmado por el cliente</span>';
    if (firmadoDe(d, docs)) return '<span class="pill p-ok">Firmado</span>';
    if (d.firma_solicitada) return `<span class="pill p-warn">Esperando firma del cliente</span> <button type="button" class="linkbtn small" data-cfirma="${d.id}">Cancelar</button>`;
    return /\.pdf$/i.test(d.nombre_archivo) && d.tipo === 'solicitud_endoso' ? `<button type="button" class="linkbtn small" data-pfirma="${d.id}">Pedir firma al cliente</button>` : '';
  };

  main.innerHTML = `
  <div class="muted"><a href="#/endosos">Endosos</a> / <a href="#/cliente/${c.id}">${esc(c.nombre)}</a></div>
  <header class="card">
    <div class="head" style="align-items:flex-start">
      <div><div class="chips" style="align-items:center"><h1 style="font-size:22px">${esc(titulo(m))}</h1>${pill(EST_MOV, m.estatus)}
        ${m.solicitado_por_cliente ? '<span class="pill p-blue">Pedido desde el portal</span>' : ''}${m.aplicado_en ? '<span class="pill p-ok">Aplicado a la póliza</span>' : ''}</div>
        <div class="muted" style="margin-top:4px">${esc(m.descripcion || '')}</div>
        <div class="muted small" style="margin-top:4px">${esc(p.aseguradora_nombre)} · póliza ${esc(p.numero_poliza || 's/n')} · ${esc(RAMOS[p.ramo])}${m.fecha_efecto ? ' · surte efecto el ' + fdate(m.fecha_efecto) : ''}</div></div>
      <div class="filters"><button type="button" class="btn" id="mEdit">Editar</button><button type="button" class="btn" id="mCG">Condiciones generales</button><button type="button" class="btn" id="mMsg">Avisar al cliente</button>
        ${tarea ? `<button type="button" class="btn" id="mTarea">Ver en tablero</button>` : `<button type="button" class="btn" id="mTab">Pasar al tablero</button>`}</div>
    </div>
    <ol class="pasos" aria-label="Avance del endoso">${FLUJO_MOV.map((e, i) => `<li class="${m.estatus === 'rechazado' ? (i === 0 ? 'hecho' : '') : i < idx ? 'hecho' : i === idx ? 'actual' : ''}">
      <span class="punto" aria-hidden="true">${i < idx && m.estatus !== 'rechazado' ? '✓' : i + 1}</span><span>${esc(EST_MOV[e][0])}</span>
      <span class="muted small">${e === 'enviado' && m.fecha_envio ? fdate(m.fecha_envio) : e === 'emitido' && m.fecha_emision ? fdate(m.fecha_emision) : e === 'entregado' && m.fecha_entrega ? fdate(m.fecha_entrega) : e === 'solicitado' ? fdate(String(m.creado_en).slice(0, 10)) : ''}</span></li>`).join('')}</ol>
    <div class="filters" style="margin-top:12px">
      ${siguiente ? `<button type="button" class="btn primary" data-estatus="${siguiente}">${BOTON_SIG[siguiente]}</button>` : ''}
      ${MOV_ABIERTO.includes(m.estatus) ? '<button type="button" class="btn" data-estatus="rechazado">La aseguradora lo rechazó</button>' : ''}
      ${m.estatus === 'rechazado' ? '<button type="button" class="btn" data-estatus="solicitado">Reabrir</button>' : ''}
      <span class="muted small">Responsable: ${esc(quien(m.responsable_id) || 'sin asignar')} · último movimiento ${dias === 0 ? 'hoy' : `hace ${dias} día${dias === 1 ? '' : 's'}`}</span>
    </div>
    ${atraso ? `<p class="small" style="color:var(--bad);margin-bottom:0">Lleva ${dias} días sin movimiento (el plazo es de ${m.dias_alerta ?? 10}): dé seguimiento con la aseguradora.</p>` : ''}
    ${pasados.length ? `<p class="small" role="alert" style="color:var(--bad);margin-bottom:0"><b>Edad máxima:</b> ${pasados.map(x => `${esc(x.nombre)} tiene ${edad(x.fecha_nacimiento)} años`).join(', ')}; según las condiciones generales (${esc(emax.cg)}${emax.pagina ? ', p. ' + emax.pagina : ''}) se aceptan asegurados nuevos hasta ${emax.anios} años. Es probable que la aseguradora no acepte el alta.</p>` : ''}
  </header>

  <section class="row">
    <div class="col" style="flex:2 1 600px">
      <div class="card">
        <div class="card-head"><h2>Qué cambia en la póliza</h2>
          ${porAplicar ? '<button type="button" class="btn primary" id="mAplicar">Aplicar a la póliza</button>' : ''}
          ${m.aplicado_en && !m.antes?.historico ? '<button type="button" class="btn" id="mDeshacer">Deshacer</button>' : ''}</div>
        ${difs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Dato</th><th>Antes</th><th>Después</th></tr></thead>
          <tbody>${difs.map(([k, a, b]) => `<tr><td>${esc(k)}</td><td class="muted">${esc(a)}</td><td><b>${esc(b)}</b></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">Este endoso no tiene cambios capturados. Use «Editar» para indicar qué cambia, o déjelo así si solo es un registro.</div>'}
        <p class="small muted" style="margin-bottom:0">${m.aplicado_en ? (m.antes?.historico ? 'Este endoso ya estaba incluido en la póliza cuando se registró.' : `Se aplicó el ${fdate(String(m.aplicado_en).slice(0, 10))}. La póliza, sus asegurados y su cobranza ya reflejan el cambio.`)
          : porAplicar ? '<span style="color:var(--warn)">La aseguradora ya lo emitió: aplíquelo para que la póliza, los asegurados y la cobranza queden al día.</span>'
          : ['emitido', 'entregado'].includes(m.estatus) ? 'No hay cambios por aplicar.' : 'Se podrá aplicar a la póliza cuando la aseguradora lo emita.'}</p>
      </div>
      <div class="card">
        <h2 style="margin-bottom:10px">Prima, cobranza y comisión</h2>
        ${imp ? `<div class="grid-info">
          <div><div class="lbl">${imp < 0 ? 'Devolución' : 'Prima del endoso'}</div><div class="val">${money(Math.abs(imp), p.moneda)}</div></div>
          <div><div class="lbl">Prima neta</div><div class="val">${money(Math.abs(neta), p.moneda)}${m.prima_neta == null ? ' <span class="muted small">(sin IVA, estimada)</span>' : ''}</div></div>
          <div><div class="lbl">Comisión ${imp < 0 ? 'que se descuenta' : 'esperada'}</div><div class="val">${money(Math.abs(neta * Number(p.pct_comision || 0) / 100), p.moneda)}</div></div>
          <div><div class="lbl">Cómo se cobra</div><div class="val">${esc(MANEJO[m.manejo_prima] || '—')}</div></div></div>
          ${reciboEndoso ? `<p class="small" style="margin-bottom:0">Recibo ${esc(numRecibo(reciboEndoso))}: ${money(reciboEndoso.prima_total, p.moneda)} · ${reciboEndoso.estatus === 'pagado' ? `pagado el ${fdate(reciboEndoso.fecha_pago)}` : `fecha límite ${fdate(reciboEndoso.fecha_limite)}`} · <a href="#/cobranza">Ver en cobranza</a></p>`
            : m.aplicado_en && m.antes?.repartido ? '<p class="small" style="margin-bottom:0">El importe se repartió en los recibos pendientes de la póliza. <a href="#/cobranza">Ver en cobranza</a></p>'
            : !m.aplicado_en ? '<p class="muted small" style="margin-bottom:0">El recibo se genera al aplicar el endoso a la póliza.</p>' : ''}`
          : '<p class="muted" style="margin:0">Este endoso no cambia la prima.</p>'}
      </div>
    </div>
    <aside class="col" style="flex:1 1 320px">
      <div class="card">
        <h2 style="margin-bottom:6px">Requisitos</h2>
        <p class="small" style="margin:0 0 12px;color:${faltan ? 'var(--warn)' : 'var(--ok)'}">${faltan ? `Falta${faltan > 1 ? 'n' : ''} ${faltan} documento${faltan > 1 ? 's' : ''}` : 'Completo para enviar a la aseguradora'}</p>
        <div class="list">${req.map(r => `<div class="li" style="align-items:flex-start"><div style="display:flex;gap:8px">
            <span aria-hidden="true" style="font-weight:700;color:${r.hay ? 'var(--ok)' : 'var(--warn)'}">${r.hay ? '✓' : '!'}</span>
            <span>${esc(r.etq)}${r.deCliente ? '<div class="muted small">En el expediente del cliente</div>' : ''}${r.tipo === 'solicitud_endoso' && r.hay && !r.firmado ? '<div class="muted small">Sin firma del cliente</div>' : ''}</span></div>
          <span class="nw">${r.tipo === 'solicitud_endoso' ? '<button type="button" class="linkbtn small" id="mSol">Generar</button><button type="button" id="mSolGen" hidden></button> · ' : ''}<label class="linkbtn small" for="rq-${r.tipo}" style="cursor:pointer">${r.hay ? 'Agregar' : 'Subir'}</label><input type="file" id="rq-${r.tipo}" data-doctipo="${r.tipo}" class="sr" accept=".pdf,image/*"></span></div>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Documentos <span class="muted">(${docs.length})</span></h2>
          <label class="btn sm" for="dUp" style="cursor:pointer">Subir</label><input type="file" id="dUp" data-doctipo="endoso" class="sr" accept=".pdf,image/*"></div>
        <p class="muted small" style="margin-top:0">Suba aquí el endoso emitido por la aseguradora: el cliente lo podrá descargar desde su portal.</p>
        <div class="list">${docs.map(d => `<div class="li"><div style="min-width:0"><button type="button" class="linkbtn" data-abrir="${esc(d.ruta)}" style="text-align:left">${esc(d.nombre_archivo)}</button>
          <div class="muted small">${esc(DOCS[d.tipo] || d.tipo)} · ${fdate(String(d.creado_en).slice(0, 10))}</div><div style="margin-top:4px">${estadoFirma(d)}</div></div>
          <button type="button" class="x" style="font-size:18px;min-width:32px;min-height:32px" aria-label="Quitar ${esc(d.nombre_archivo)}" data-ddel="${d.id}">×</button></div>`).join('') || '<div class="empty">Sin documentos.</div>'}</div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:10px">Seguimiento</h2>
        <div style="display:flex;gap:8px;margin-bottom:12px"><label for="mNota" class="sr">Nota</label><input id="mNota" placeholder="Ej. La aseguradora pide el cuestionario"><button type="button" class="btn" id="mNotaAdd">Agregar</button></div>
        <div class="list">${eventos.map(e => `<div><div class="muted small">${fdate(String(e.creado_en).slice(0, 10))}${quien(e.autor_id) ? ' · ' + esc(quien(e.autor_id)) : e.texto.includes('portal') ? ' · Cliente' : ''}${e.estatus && e.texto === 'Cambio de estatus' ? ' · ' + esc(EST_MOV[e.estatus]?.[0] || e.estatus) : ''}</div><div>${esc(e.texto)}</div></div>`).join('') || '<div class="empty">Sin movimientos.</div>'}</div>
      </div>
    </aside>
  </section>`;

  const recargar = () => refrescar();
  main.addEventListener('change', async e => {
    const el = e.target;
    if (!el.dataset.doctipo) return;
    const file = el.files[0]; if (!file) return;
    try {
      const ruta = await subirArchivo(file, p.cliente_id, 'endosos');
      await q(sb.from('documentos').insert({ cliente_id: p.cliente_id, poliza_id: p.id, movimiento_id: id, tipo: el.dataset.doctipo, nombre_archivo: file.name, ruta }));
      await q(sb.from('movimiento_eventos').insert({ movimiento_id: id, texto: `Documento agregado: ${DOCS[el.dataset.doctipo] || 'otro'} (${file.name})` }));
      toast('Documento guardado en el endoso.'); recargar();
    } catch (err) { toast(err.message, true); }
  });
  main.addEventListener('click', async e => {
    const b = e.target.closest('button,[data-abrir]'); if (!b) return;
    const d = b.dataset;
    try {
      if (d.abrir) return abrirArchivo(d.abrir);
      if (b.id === 'mEdit') return formEndoso({ mov: m, alGuardar: recargar });
      if (b.id === 'mCG') return abrirCondiciones({ poliza: p });
      if (d.estatus) {
        if (d.estatus === 'emitido' && !m.folio_endoso) {
          return modal({ titulo: 'Endoso emitido', boton: 'Guardar',
            cuerpo: `<p class="muted" style="margin-top:0">Capture el folio que asignó la aseguradora (si lo tiene).</p><div class="form-grid">${input('Folio del endoso', 'folio')}${input('Fecha de emisión', 'fecha', { type: 'date', value: hoyISO() })}</div>`,
            onSubmit: async x => { await q(sb.from('movimientos').update({ estatus: 'emitido', folio_endoso: txt(x.folio), fecha_emision: x.fecha || hoyISO() }).eq('id', id)); toast(endosoPorAplicar({ ...m, estatus: 'emitido' }) ? 'Emitido. Ahora aplíquelo a la póliza.' : 'Endoso emitido.'); recargar(); } });
        }
        await q(sb.from('movimientos').update({ estatus: d.estatus }).eq('id', id));
        toast(d.estatus === 'emitido' && porAplicar ? 'Emitido. Ahora aplíquelo a la póliza.' : 'Estatus actualizado.'); return recargar();
      }
      if (b.id === 'mAplicar') {
        if (!(await confirmar('Aplicar a la póliza', `Se actualizará la póliza ${p.numero_poliza || ''} con ${difs.length} cambio${difs.length === 1 ? '' : 's'}${imp && m.manejo_prima !== 'ninguno' ? ` y la prima se ${m.manejo_prima === 'repartir' ? 'repartirá en los recibos pendientes' : imp < 0 ? 'devolverá en un recibo negativo' : 'cobrará en un recibo aparte'}` : ''}. Se puede deshacer mientras no se pague.`, 'Aplicar'))) return;
        const { error } = await sb.rpc('aplicar_endoso', { p_mov: id }); if (error) throw new Error(error.message);
        toast('Listo: la póliza ya refleja el endoso.'); return recargar();
      }
      if (b.id === 'mDeshacer') {
        if (!(await confirmar('Deshacer cambios', 'La póliza, sus asegurados y su cobranza regresarán a como estaban antes de aplicar este endoso.', 'Deshacer'))) return;
        const { error } = await sb.rpc('deshacer_endoso', { p_mov: id }); if (error) throw new Error(error.message);
        toast('Se deshicieron los cambios.'); return recargar();
      }
      if (b.id === 'mMsg') return enviarMensaje(['emitido', 'entregado'].includes(m.estatus) ? 'endoso_emitido' : 'estatus_tramite', {
        nombre: c.nombre, poliza: p.numero_poliza, aseguradora: p.aseguradora_nombre, movimiento: m.descripcion || TIPOS_MOV[m.tipo].toLowerCase(),
        importe_texto: imp > 0 ? `El ajuste de prima es de ${money(imp, p.moneda)}.` : imp < 0 ? `Le corresponde una devolución de ${money(-imp, p.moneda)}.` : 'Este cambio no modifica su prima.',
        tramite: 'endoso (' + TIPOS_MOV[m.tipo].toLowerCase() + ')', folio: m.folio_endoso || 'en trámite', estatus: EST_MOV[m.estatus][0].toLowerCase(),
      }, { telefono: c.whatsapp || c.telefono, email: c.email });
      if (b.id === 'mTab') return formTarea({ prefill: { titulo: `Endoso: ${TIPOS_MOV[m.tipo].toLowerCase()} de ${c.nombre}`, tipo: 'endoso', prioridad: atraso ? 'alta' : 'media', fecha: hoyISO(),
        asignado_a: m.responsable_id || p.agente_id || ctx.perfil.id, cliente_id: c.id, poliza_id: p.id, movimiento_id: id, origen: 'endoso:' + id,
        descripcion: `${m.descripcion || ''}\nSe cierra sola cuando el endoso se entrega al cliente o la aseguradora lo rechaza.`.trim() }, alGuardar: () => { toast('Listo, ya está en el tablero.'); recargar(); } });
      if (b.id === 'mTarea') { const { verTarea } = await import('./tablero.js'); return verTarea(tarea.id, recargar); }
      if (b.id === 'mNotaAdd') { const v = main.querySelector('#mNota').value.trim(); if (!v) return; await q(sb.from('movimiento_eventos').insert({ movimiento_id: id, texto: v })); await q(sb.from('movimientos').update({ actualizado_en: new Date().toISOString() }).eq('id', id)); return recargar(); }
      if (b.id === 'mSol') return cartasDePoliza({ poliza: p, mov: m, uso: m.tipo, alTerminar: recargar,
        extra: [{ etiqueta: 'Solicitud de endoso (formato general)', nota: 'Carta con el «dice / debe decir» del endoso, lista para firma', accion: () => main.querySelector('#mSolGen').click() }] });
      if (b.id === 'mSolGen') {
        b.disabled = true;
        const bytes = await pdfSolicitudEndoso(m, p, c, aseg, difs);
        const nombre = `Solicitud de endoso - ${p.numero_poliza || 'poliza'} - ${c.nombre}.pdf`.replace(/[\\/:*?"<>|]+/g, '');
        const ruta = await subirArchivo(new File([bytes], nombre, { type: 'application/pdf' }), p.cliente_id, 'endosos');
        await q(sb.from('documentos').insert({ cliente_id: p.cliente_id, poliza_id: p.id, movimiento_id: id, tipo: 'solicitud_endoso', nombre_archivo: nombre, ruta }));
        await q(sb.from('movimiento_eventos').insert({ movimiento_id: id, texto: 'Solicitud de endoso generada' }));
        const ok = await descargar(nombre, new Blob([bytes], { type: 'application/pdf' }));
        toast(ok ? 'Solicitud generada. Puede pedir la firma al cliente desde Documentos.' : 'Solicitud guardada en Documentos.'); return recargar();
      }
      if (d.pfirma) {
        await q(sb.from('documentos').update({ firma_solicitada: true }).eq('id', d.pfirma));
        const acceso = ctx.accesosPortal.some(a => a.cliente_id === c.id && a.activo);
        toast(acceso ? 'Listo. El cliente lo verá en su portal para firmarlo.' : 'Firma solicitada, pero el cliente aún no tiene acceso al portal: dele acceso desde su ficha.', !acceso);
        return recargar();
      }
      if (d.cfirma) { await q(sb.from('documentos').update({ firma_solicitada: false }).eq('id', d.cfirma)); return recargar(); }
      if (d.ddel) {
        const doc = docs.find(x => x.id === d.ddel);
        if (!(await confirmar('Quitar documento', `Se borrará "${doc.nombre_archivo}".`, 'Borrar'))) return;
        await sb.storage.from('documentos').remove([doc.ruta]); await q(sb.from('documentos').delete().eq('id', doc.id)); return recargar();
      }
    } catch (err) { toast(err.message, true); b.disabled = false; }
  });
  main.addEventListener('keydown', e => { if (e.target.id === 'mNota' && e.key === 'Enter') { e.preventDefault(); main.querySelector('#mNotaAdd').click(); } });
}

// ---------------------------------------------------------------- Solicitud de endoso (PDF para firmar)
export async function pdfSolicitudEndoso(m, p, c, aseg, difs) {
  const d = await nuevoDoc(), { pdf, f, fb, gris, linea } = d;
  const page = pdf.addPage([612, 792]);
  page.drawText(limpio(ctx.agencia?.nombre || ''), { x: 50, y: 752, size: 10, font: fb, color: gris });
  page.drawText('Solicitud de endoso', { x: 50, y: 726, size: 16, font: fb });
  page.drawLine({ start: { x: 50, y: 716 }, end: { x: 562, y: 716 }, thickness: 1, color: linea });
  const datos = [['Contratante', c.nombre], ['RFC', c.rfc || '—'], ['Aseguradora', p.aseguradora_nombre], ['Póliza', p.numero_poliza || 's/n'],
    ['Ramo / producto', `${RAMOS[p.ramo]}${p.producto ? ' · ' + p.producto : ''}`], ['Vigencia', `${dmy(p.inicio_vigencia)} al ${dmy(p.fin_vigencia)}`],
    ['Tipo de movimiento', TIPOS_MOV[m.tipo]], ['Fecha en que surte efecto', m.fecha_efecto ? dmy(m.fecha_efecto) : 'A partir de su emisión']];
  let y = 696;
  datos.forEach(([k, v], i) => {
    const x = i % 2 ? 310 : 50; if (i % 2 === 0 && i) y -= 26;
    page.drawText(limpio(k).toUpperCase(), { x, y: y + 9, size: 7, font: f, color: gris });
    page.drawText(limpio(v || '—').slice(0, 58), { x, y: y - 2, size: 10, font: f });
  });
  y -= 36;
  const parrafo = (t, size = 10, font = f) => { envolver(t, font, size, 512).forEach(l => { page.drawText(l, { x: 50, y, size, font }); y -= size + 5; }); y -= 6; };
  const ciudad = [c.ciudad || 'Mérida', c.estado || 'Yucatán'].join(', '), hoyD = new Date();
  parrafo(`${ciudad}, a ${hoyD.getDate()} de ${hoyD.toLocaleString('es-MX', { month: 'long' })} de ${hoyD.getFullYear()}`);
  parrafo(`${p.aseguradora_nombre}\nPresente`, 10, fb);
  parrafo(`Por medio de la presente, como contratante de la póliza ${p.numero_poliza || ''}, solicito el siguiente movimiento: ${m.descripcion || TIPOS_MOV[m.tipo]}.`);
  if (difs.length) {
    parrafo('Detalle del cambio solicitado:', 10, fb);
    page.drawText('DATO', { x: 50, y, size: 7, font: fb, color: gris }); page.drawText('DICE', { x: 210, y, size: 7, font: fb, color: gris }); page.drawText('DEBE DECIR', { x: 390, y, size: 7, font: fb, color: gris }); y -= 14;
    difs.forEach(([k, a, b]) => {
      const la = envolver(a, f, 9, 170), lb = envolver(b, fb, 9, 170), n = Math.max(la.length, lb.length, 1);
      page.drawText(limpio(k).slice(0, 32), { x: 50, y, size: 9, font: f });
      la.forEach((l, i) => page.drawText(l, { x: 210, y: y - i * 12, size: 9, font: f, color: gris }));
      lb.forEach((l, i) => page.drawText(l, { x: 390, y: y - i * 12, size: 9, font: fb }));
      y -= n * 12 + 4; page.drawLine({ start: { x: 50, y: y + 2 }, end: { x: 562, y: y + 2 }, thickness: 0.4, color: linea }); y -= 8;
    });
    y -= 4;
  }
  parrafo('Declaro que la información proporcionada es verdadera y autorizo los ajustes de prima que, en su caso, resulten de este movimiento.');
  y = Math.max(140, y - 60);
  // La firma del portal se coloca sobre esta línea
  page.drawLine({ start: { x: 50, y }, end: { x: 270, y }, thickness: 0.8, color: gris });
  page.drawText(limpio(c.nombre), { x: 50, y: y - 13, size: 9, font: f }); page.drawText('Nombre y firma del contratante', { x: 50, y: y - 25, size: 8, font: f, color: gris });
  const ag = ctx.perfiles.find(x => x.id === (p.agente_id || c.agente_id));
  firma(d, page, y, `${ag?.nombre || ''} - ${ctx.agencia?.nombre || ''}`);
  try { const form = pdf.getForm(); const fl = form.createTextField('firma'); fl.addToPage(page, { x: 50, y: y + 2, width: 220, height: 46, borderWidth: 0 }); } catch (e) { /* sin campo de firma */ }
  return pdf.save();
}
