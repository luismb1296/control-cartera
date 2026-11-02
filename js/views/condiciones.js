// Condiciones generales: biblioteca por producto, ficha resumen, revisión de periodos de espera
// y preguntas que se responden citando la página del documento.
import { sb, ctx, q } from '../db.js';
import { esc, modal, input, select, opts, optsList, toast, txt, num, fdate, parseD, iso, addMonths, hoyISO, edad, RAMOS, confirmar } from '../ui.js';
import { subirArchivo, abrirArchivo } from './formas.js';
import { leerPdfCompleto, paginasRelacionadas, conPaginas, extraerConIA, INSTRUCCION_CONDICIONES, INSTRUCCION_PREGUNTA_CG } from '../ia.js';

const SIN = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const CAMPOS = 'id,aseguradora_id,producto_id,ramo,nombre,version,vigente_desde,archivo_ruta,paginas,ficha,ficha_revisada,activo,creado_en';
export const cargarCondiciones = () => q(sb.from('condiciones_generales').select(CAMPOS).eq('activo', true));

// Las condiciones que aplican a una póliza: las de su producto (o las generales del ramo) vigentes al iniciar la póliza
export function cgDePoliza(p, lista) {
  if (!p) return null;
  const mismas = lista.filter(c => c.activo !== false && c.aseguradora_id === p.aseguradora_id && c.ramo === p.ramo);
  const exactas = mismas.filter(c => c.producto_id && c.producto_id === p.producto_id);
  const generales = mismas.filter(c => !c.producto_id);
  const pool = exactas.length ? exactas : generales.length ? generales : (!p.producto_id ? mismas : []);
  const orden = [...pool].sort((a, b) => String(b.vigente_desde || '').localeCompare(String(a.vigente_desde || '')));
  return orden.find(c => !c.vigente_desde || c.vigente_desde <= p.inicio_vigencia) || orden[orden.length - 1] || null;
}
const nombreCG = c => `${c.nombre}${c.version ? ' · ' + c.version : ''}`;

// ---------------------------------------------------------------- Antigüedad y periodos de espera
const mesesEntre = (a, b) => { const x = parseD(a), y = parseD(b); if (!x || !y) return null; let m = (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth(); if (y.getDate() < x.getDate()) m--; return Math.max(0, m); };
const nombreBase = s => SIN(s).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

// Desde cuándo está asegurada una persona con esta aseguradora (renovaciones continuas, endoso de alta o dato capturado)
export async function antiguedadDe(p, nombre) {
  let inicio = p.inicio_vigencia, actual = p; const ids = [p.id];
  for (let k = 0; k < 10 && actual.poliza_anterior_id; k++) {
    const a = await q(sb.from('polizas').select('id,aseguradora_id,inicio_vigencia,poliza_anterior_id').eq('id', actual.poliza_anterior_id).maybeSingle());
    if (!a || a.aseguradora_id !== p.aseguradora_id) break;
    inicio = a.inicio_vigencia; actual = a; ids.push(a.id);
  }
  const aseg = await q(sb.from('asegurados').select('*').eq('poliza_id', p.id));
  const n = nombreBase(nombre);
  const persona = n ? aseg.find(a => nombreBase(a.nombre) === n) || aseg.find(a => nombreBase(a.nombre).startsWith(n) || n.startsWith(nombreBase(a.nombre))) : null;
  if (persona?.asegurado_desde) return { fecha: persona.asegurado_desde, fuente: 'fecha capturada en la póliza', persona };
  const movs = await q(sb.from('movimientos').select('poliza_id,tipo,fecha_efecto,cambios,aplicado_en').in('poliza_id', ids));
  const alta = movs.find(m => m.tipo === 'alta_asegurado' && m.aplicado_en && (m.cambios?.asegurados_alta || []).some(x => nombreBase(x.nombre) === nombreBase(persona?.nombre || nombre)));
  if (alta?.fecha_efecto) return { fecha: alta.fecha_efecto, fuente: 'endoso de alta', persona };
  return { fecha: inicio, fuente: ids.length > 1 ? 'inicio con esta aseguradora (renovaciones continuas)' : 'inicio de la póliza', persona };
}

const GENERICAS = new Set(['enfermedad', 'enfermedades', 'padecimiento', 'padecimientos', 'cirugia', 'cirugias', 'tratamiento', 'tratamientos', 'cualquier', 'aguda', 'agudo', 'cronica', 'cronico', 'otros', 'otras', 'derecha', 'izquierda', 'lesion', 'lesiones', 'programacion', 'estudios', 'consulta']);
const raices = s => SIN(s).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 4 && !GENERICAS.has(w)).map(w => w.slice(0, 5));

// Periodos de espera de la ficha que aplican a un padecimiento, con la fecha desde la que estaría cubierto
export function revisarEspera(ficha, { padecimiento, tipoEvento, fechaEvento, desde }) {
  const lista = ficha?.periodos_espera || [];
  const r = raices(padecimiento);
  let aplica = lista.filter(e => !e.general && raices(e.padecimiento).some(t => r.includes(t)));
  if (!aplica.length && tipoEvento !== 'accidente') aplica = lista.filter(e => e.general);
  return aplica.map(e => {
    const cubre = desde && e.meses != null ? iso(addMonths(parseD(desde), Number(e.meses))) : null;
    return { ...e, cubreDesde: cubre, cumple: cubre ? (fechaEvento || hoyISO()) >= cubre : null };
  });
}

// ---------------------------------------------------------------- Ventana de condiciones (ficha + preguntas)
/**
 * poliza: fila de v_polizas · caso: { afectado, padecimiento, fecha_evento, tipo_evento } (opcional)
 * pregunta: pregunta sugerida para dejar escrita
 */
export async function abrirCondiciones({ poliza, caso = null, pregunta = '' }) {
  const lista = await cargarCondiciones();
  const cg = cgDePoliza(poliza, lista);
  const gestion = ['admin', 'operaciones'].includes(ctx.perfil?.rol);
  if (!cg) {
    modal({ titulo: 'Condiciones generales', cuerpo: `<p style="margin-top:0">Aún no hay condiciones generales cargadas para <b>${esc(poliza.aseguradora_nombre)} · ${esc(poliza.producto || RAMOS[poliza.ramo])}</b>.</p>
      <p class="muted small" style="margin-bottom:0">${gestion ? 'Súbalas en Configuración → Condiciones generales: la app arma la ficha (periodos de espera, cancelación, exclusiones…) y desde ahí se pueden hacer preguntas.' : 'Pida a operaciones que las cargue en Configuración → Condiciones generales.'}</p>` });
    return;
  }
  const f = cg.ficha || {};
  let revision = '', ant = null;
  if (caso) {
    ant = await antiguedadDe(poliza, caso.afectado);
    const esp = revisarEspera(f, { padecimiento: caso.padecimiento, tipoEvento: caso.tipo_evento, fechaEvento: caso.fecha_evento, desde: ant.fecha });
    revision = bloqueEspera(esp, ant, caso);
  }
  const lineaP = x => x?.pagina ? ` <span class="muted small">(p. ${x.pagina})</span>` : '';
  const dlg = modal({
    titulo: 'Condiciones generales',
    cuerpo: `
      <div class="li" style="align-items:flex-start;margin-bottom:12px"><div><b>${esc(nombreCG(cg))}</b>
        <div class="muted small">${esc(poliza.aseguradora_nombre)} · ${esc(poliza.producto || RAMOS[poliza.ramo])} · póliza ${esc(poliza.numero_poliza || 's/n')}${cg.paginas ? ` · ${cg.paginas} páginas` : ''}</div>
        <div style="margin-top:4px">${cg.ficha_revisada ? '<span class="pill p-ok">Ficha revisada por la agencia</span>' : '<span class="pill p-warn">Ficha sin revisar: confirme en el PDF</span>'}</div></div>
        ${cg.archivo_ruta ? '<button type="button" class="btn sm" id="cgPdf">Ver PDF</button>' : ''}</div>
      ${revision}
      <div class="card" style="margin:0 0 14px;padding:12px 14px">
        <label for="cgQ"><b>Pregunte a las condiciones generales</b></label>
        <div class="muted small" style="margin:2px 0 8px">La respuesta sale solo del documento, con la página y el fragmento exacto. Si no lo menciona, se lo dice.</div>
        <textarea id="cgQ" style="min-height:70px" placeholder="Ej. ¿Qué pasa si el cliente cancela la póliza a mitad de la vigencia?">${esc(pregunta)}</textarea>
        <div class="chips" style="margin-top:8px">${sugerencias(poliza, caso).map(s => `<button type="button" class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <div class="filters" style="margin-top:10px"><button type="button" class="btn primary" id="cgPreguntar">Preguntar</button></div>
        <div id="cgResp" class="list" style="margin-top:12px"></div>
      </div>
      <details${caso ? '' : ' open'}><summary><b>Ficha resumen</b></summary><div style="margin-top:10px">
        ${(f.periodos_espera || []).length ? `<div class="lbl">Periodos de espera</div><div class="tbl-wrap" style="margin:6px 0 12px"><table><thead><tr><th>Padecimiento</th><th class="num">Meses</th><th class="num">Pág.</th></tr></thead>
          <tbody>${f.periodos_espera.map(e => `<tr><td>${esc(e.padecimiento)}${e.general ? ' <span class="muted small">(general)</span>' : ''}</td><td class="num">${e.meses ?? '—'}</td><td class="num">${e.pagina ?? ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${f.cancelacion?.penalizacion ? `<p class="small"><b>Cancelación:</b> ${esc(f.cancelacion.penalizacion)}${lineaP(f.cancelacion)}</p>` : ''}
        ${f.edad_maxima?.texto || f.edad_maxima?.anios ? `<p class="small"><b>Edad máxima:</b> ${esc(f.edad_maxima.texto || f.edad_maxima.anios + ' años')}${lineaP(f.edad_maxima)}</p>` : ''}
        ${f.reembolsos?.plazo ? `<p class="small"><b>Reembolsos:</b> ${esc(f.reembolsos.plazo)}${lineaP(f.reembolsos)}</p>` : ''}
        ${f.preexistencias?.texto ? `<p class="small"><b>Preexistencias:</b> ${esc(f.preexistencias.texto)}${lineaP(f.preexistencias)}</p>` : ''}
        ${(f.exclusiones || []).length ? `<div class="lbl">Exclusiones principales</div><ul class="small" style="margin:6px 0 12px">${f.exclusiones.slice(0, 12).map(x => `<li>${esc(x.texto)}${lineaP(x)}</li>`).join('')}</ul>` : ''}
        ${(f.otros || []).length ? `<div class="lbl">Otros temas</div><ul class="small" style="margin:6px 0 0">${f.otros.map(x => `<li><b>${esc(x.tema)}:</b> ${esc(x.texto)}${lineaP(x)}</li>`).join('')}</ul>` : ''}
      </div></details>
      <p class="muted small" style="margin-bottom:0">Es una ayuda para revisar el caso; la decisión final es de la aseguradora.</p>`,
  });
  dlg.querySelector('#cgPdf')?.addEventListener('click', () => abrirArchivo(cg.archivo_ruta));
  const tx = dlg.querySelector('#cgQ'), out = dlg.querySelector('#cgResp');
  dlg.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => { tx.value = b.dataset.sug; tx.focus(); });
  let paginas = null;
  dlg.querySelector('#cgPreguntar').onclick = async () => {
    const pq = tx.value.trim(); if (!pq) { tx.focus(); return; }
    const b = dlg.querySelector('#cgPreguntar'); b.disabled = true;
    const caja = document.createElement('div'); caja.innerHTML = `<div><b>${esc(pq)}</b></div><div class="pensando"><span></span><span></span><span></span> Buscando en las condiciones…</div>`; out.prepend(caja);
    try {
      paginas ||= (await q(sb.from('condiciones_generales').select('texto').eq('id', cg.id).single())).texto || [];
      const r = await preguntar(cg, paginas, pq, poliza, caso, ant);
      caja.innerHTML = `<div><b>${esc(pq)}</b></div><div style="margin-top:4px;white-space:pre-line">${esc(r.respuesta || '')}</div>
        ${(r.citas || []).map(c => `<blockquote class="small" style="margin:8px 0 0;padding:6px 10px;border-left:3px solid var(--accent);background:var(--surface-2)">«${esc(c.texto)}» <span class="muted">— p. ${esc(c.pagina)}</span>
          <button type="button" class="linkbtn small" data-pag="${esc(c.pagina)}">Ver página</button><div data-texto-pag hidden style="white-space:pre-line;margin-top:6px"></div></blockquote>`).join('')}
        ${r.encontrado === false ? '<div class="small" style="color:var(--warn);margin-top:4px">No viene en las páginas revisadas: confírmelo con la aseguradora.</div>' : ''}`;
      caja.querySelectorAll('[data-pag]').forEach(x => x.onclick = () => { const box = x.nextElementSibling, pg = paginas.find(p => String(p.pagina) === x.dataset.pag); box.textContent = pg?.texto || 'Página no disponible.'; box.hidden = !box.hidden; });
    } catch (e) { caja.innerHTML = `<div><b>${esc(pq)}</b></div><p class="error">${esc(e.message)}</p>`; }
    b.disabled = false;
  };
  tx.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) dlg.querySelector('#cgPreguntar').click(); });
  return dlg;
}

function sugerencias(p, caso) {
  const s = [];
  if (caso?.padecimiento) s.push(`¿${caso.padecimiento} tiene periodo de espera o alguna exclusión?`);
  if (p.ramo === 'gmm') s.push('¿Cuál es el plazo para presentar un reembolso?', '¿Cubre maternidad y desde cuándo?');
  s.push('¿Qué pasa si se cancela la póliza antes de terminar la vigencia?');
  if (p.ramo === 'auto') s.push('¿Qué deducible aplica en robo total?');
  return s.slice(0, 4);
}

// Datos del caso sin nombres ni contacto: solo lo que se necesita para aplicar las condiciones
async function preguntar(cg, paginas, pregunta, p, caso, ant) {
  const rel = paginasRelacionadas(paginas, `${pregunta} ${caso?.padecimiento || ''}`);
  const datos = {
    producto: `${p.aseguradora_nombre} · ${p.producto || RAMOS[p.ramo]}`, inicio_poliza: p.inicio_vigencia, fin_poliza: p.fin_vigencia,
    ...(caso ? { padecimiento: caso.padecimiento, tipo_evento: caso.tipo_evento, fecha_evento: caso.fecha_evento } : {}),
    ...(ant ? { asegurado_desde: ant.fecha, antiguedad_meses: mesesEntre(ant.fecha, caso?.fecha_evento || hoyISO()), parentesco: ant.persona?.parentesco || null,
      edad: ant.persona?.fecha_nacimiento ? edad(ant.persona.fecha_nacimiento) : null } : {}),
  };
  const texto = `PREGUNTA: ${pregunta}\n\nDATOS DEL CASO: ${JSON.stringify(datos)}\n\nFICHA RESUMEN (ya revisada): ${JSON.stringify(cg.ficha || {})}\n\nPÁGINAS DE LAS CONDICIONES GENERALES:\n${rel.length ? conPaginas(rel) : '(no se encontraron páginas relacionadas)'}`;
  return extraerConIA(INSTRUCCION_PREGUNTA_CG, { texto });
}

// Resultado de la revisión de periodos de espera para un caso
export function bloqueEspera(esp, ant, caso) {
  if (!esp.length) return `<div class="small" style="margin:0 0 14px;padding:8px 12px;border-left:4px solid var(--line);background:var(--surface-2)">La ficha no tiene un periodo de espera para «${esc(caso.padecimiento || 'este caso')}». Pregunte abajo para revisar exclusiones o preexistencias.
    <div class="muted">Asegurado desde ${fdate(ant.fecha)} (${esc(ant.fuente)}).</div></div>`;
  const malo = esp.some(e => e.cumple === false);
  return `<div class="small" role="${malo ? 'alert' : 'status'}" style="margin:0 0 14px;padding:10px 12px;border-left:4px solid var(--${malo ? 'bad' : 'ok'});background:var(--surface-2)">
    ${esp.map(e => `<div style="margin-bottom:4px"><b style="color:var(--${e.cumple === false ? 'bad' : 'ok'})">${e.cumple === false ? 'No ha cumplido el periodo de espera' : 'Periodo de espera cumplido'}:</b>
      ${esc(e.padecimiento)}, ${e.meses} mes${Number(e.meses) === 1 ? '' : 'es'}${e.pagina ? ` (p. ${e.pagina})` : ''}. ${e.cumple === false ? `Estaría cubierto a partir del <b>${fdate(e.cubreDesde)}</b>.` : `Cubierto desde el ${fdate(e.cubreDesde)}.`}</div>`).join('')}
    <div class="muted">Asegurado desde ${fdate(ant.fecha)} (${esc(ant.fuente)}). ${malo ? 'La aseguradora probablemente lo rechace; confírmelo antes de ingresar el trámite.' : ''}</div></div>`;
}

// ---------------------------------------------------------------- Configuración: biblioteca
export function tablaCondiciones(lista, gestion) {
  const aseg = id => ctx.aseguradoras.find(a => a.id === id)?.nombre || '';
  const prod = id => ctx.productos.find(p => p.id === id)?.nombre;
  return `<p class="muted" style="margin-top:0">Suba las condiciones generales de cada producto (PDF digital, no escaneado). La IA arma una ficha con los periodos de espera, la cancelación, las exclusiones y otros temas, cada uno con su página. Revísela una vez; después la app avisa en los siniestros, cancelaciones y altas, y responde preguntas citando la página.</p>
    ${gestion ? '<div class="filters" style="margin-bottom:16px"><button type="button" class="btn primary" id="nCG">+ Subir condiciones generales</button></div>' : ''}
    <div class="card" style="padding:8px 12px">${lista.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Condiciones</th><th>Aseguradora y producto</th><th>Vigentes desde</th><th>Ficha</th><th></th></tr></thead>
      <tbody>${lista.map(c => `<tr${c.activo ? '' : ' style="opacity:.6"'}><td><b>${esc(nombreCG(c))}</b><div class="muted small">${c.paginas ? c.paginas + ' páginas' : ''}${c.archivo_ruta ? '' : ' · sin PDF guardado'}</div></td>
        <td>${esc(aseg(c.aseguradora_id))} · ${esc(prod(c.producto_id) || 'Todos los productos de ' + (RAMOS[c.ramo] || '').toLowerCase())}</td>
        <td class="nw">${c.vigente_desde ? fdate(c.vigente_desde) : '—'}</td>
        <td>${Object.keys(c.ficha || {}).length ? (c.ficha_revisada ? '<span class="pill p-ok">Revisada</span>' : '<span class="pill p-warn">Por revisar</span>') : '<span class="pill p-gray">Sin ficha</span>'}</td>
        <td class="nw">${gestion ? `<button type="button" class="linkbtn small" data-cgficha="${c.id}">Revisar ficha</button> · <button type="button" class="linkbtn small" data-cgrehacer="${c.id}">Rehacer con IA</button> · <button type="button" class="linkbtn small" data-cgact="${c.id}">${c.activo ? 'Desactivar' : 'Activar'}</button>` : ''}
          ${c.archivo_ruta ? ` · <button type="button" class="linkbtn small" data-cgpdf="${esc(c.archivo_ruta)}">PDF</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Aún no hay condiciones generales.</div>'}</div>`;
}

export async function accionCondiciones(el, lista, alTerminar) {
  const d = el.dataset;
  if (el.id === 'nCG') return formCondiciones(alTerminar);
  if (d.cgpdf) return abrirArchivo(d.cgpdf);
  if (d.cgficha) return editarFicha(lista.find(c => c.id === d.cgficha), alTerminar);
  if (d.cgact) { const c = lista.find(x => x.id === d.cgact); await q(sb.from('condiciones_generales').update({ activo: !c.activo }).eq('id', c.id)); return alTerminar?.(); }
  if (d.cgrehacer) {
    const c = lista.find(x => x.id === d.cgrehacer);
    if (!(await confirmar('Rehacer la ficha', 'La IA volverá a leer las condiciones y reemplazará la ficha actual (incluidas sus correcciones).', 'Rehacer'))) return;
    toast('Leyendo las condiciones generales…');
    const { texto } = await q(sb.from('condiciones_generales').select('texto').eq('id', c.id).single());
    const ficha = await fichaConIA(texto);
    await q(sb.from('condiciones_generales').update({ ficha, ficha_revisada: false }).eq('id', c.id));
    toast('Ficha nueva lista. Revísela.'); return editarFicha({ ...c, ficha, ficha_revisada: false }, alTerminar);
  }
}

// Solo las páginas que hablan de los temas de la ficha (para no mandar el documento completo)
const TEMAS_FICHA = 'periodo de espera carencia antigüedad preexistente exclusiones no cubre edad máxima aceptación cancelación rescisión terminación anticipada prima no devengada reembolso plazo reclamación deducible coaseguro maternidad';
async function fichaConIA(paginas) {
  const total = paginas.reduce((a, p) => a + p.texto.length, 0);
  const sel = total <= 50000 ? paginas : paginasRelacionadas(paginas, TEMAS_FICHA, 14, 50000);
  return extraerConIA(INSTRUCCION_CONDICIONES, { texto: conPaginas(sel) });
}

function formCondiciones(alTerminar) {
  const asegs = ctx.aseguradoras.filter(a => a.activa !== false);
  let paginas = null, archivo = null;
  modal({
    titulo: 'Subir condiciones generales', boton: 'Guardar y armar ficha',
    cuerpo: `<div class="form-grid">
      ${select('Aseguradora', 'aseguradora_id', optsList(asegs, asegs[0]?.id), { req: true })}
      ${select('Ramo', 'ramo', opts(RAMOS, 'gmm'), { req: true })}
      ${select('Producto', 'producto_id', '', { wide: true })}
      ${input('Nombre', 'nombre', { req: true, wide: true, attrs: 'placeholder="Ej. Condiciones generales Flex Plus"' })}
      ${input('Versión o registro', 'version', { attrs: 'placeholder="Ej. 2026 · CNSF-S0012-0034-2025"' })}
      ${input('Aplican a pólizas que inician desde', 'vigente_desde', { type: 'date' })}
      <div class="field wide"><label for="cgFile">PDF de las condiciones *</label><input id="cgFile" type="file" accept="application/pdf,.pdf"></div>
    </div>
    <p class="muted small" id="cgEstado" style="margin-bottom:0">Al guardar, la app lee todas las páginas y la IA arma la ficha. Puede tardar un par de minutos en documentos largos.</p>`,
    onOpen: f => {
      const prods = () => { f.producto_id.innerHTML = '<option value="">Todos los productos del ramo</option>' + ctx.productos.filter(p => p.aseguradora_id === f.aseguradora_id.value && p.ramo === f.ramo.value).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join(''); };
      f.aseguradora_id.onchange = prods; f.ramo.onchange = prods; prods();
      f.producto_id.onchange = () => { if (!f.nombre.value && f.producto_id.value) f.nombre.value = 'Condiciones generales ' + f.producto_id.selectedOptions[0].text; };
      f.querySelector('#cgFile').onchange = async e => {
        archivo = e.target.files[0]; paginas = null; if (!archivo) return;
        const est = f.querySelector('#cgEstado'); est.style.color = '';
        if (!f.nombre.value) f.nombre.value = archivo.name.replace(/\.pdf$/i, '');
        try { paginas = await leerPdfCompleto(archivo, (i, n) => { est.textContent = `Leyendo página ${i} de ${n}…`; }); est.textContent = `Listo: ${paginas.length} páginas leídas.`; }
        catch (err) { est.style.color = 'var(--bad)'; est.textContent = err.message; }
      };
    },
    onSubmit: async (x, f) => {
      if (!archivo) throw new Error('Seleccione el PDF de las condiciones generales.');
      if (!paginas) throw new Error('El PDF aún se está leyendo o no se pudo leer.');
      const est = f.querySelector('#cgEstado'); est.textContent = 'Guardando el PDF…';
      let ruta = null;
      try { ruta = await subirArchivo(archivo, 'condiciones'); } catch (e) { toast('El PDF no se guardó (' + e.message + '); el texto sí, para la ficha y las preguntas.', true); }
      est.textContent = 'La IA está armando la ficha…';
      let ficha = {};
      try { ficha = await fichaConIA(paginas); } catch (e) { toast('Se guardaron las condiciones, pero la ficha no se pudo armar: ' + e.message + '. Use «Rehacer con IA».', true); }
      const c = await q(sb.from('condiciones_generales').insert({ aseguradora_id: x.aseguradora_id, ramo: x.ramo, producto_id: x.producto_id || null, nombre: x.nombre.trim(), version: txt(x.version),
        vigente_desde: x.vigente_desde || null, archivo_ruta: ruta, paginas: paginas.length, texto: paginas, ficha }).select(CAMPOS).single());
      toast('Condiciones guardadas. Revise la ficha.');
      setTimeout(() => editarFicha(c, alTerminar), 0);
      return true;
    },
  });
}

// La agencia revisa y corrige lo que armó la IA
function editarFicha(c, alTerminar) {
  const f = JSON.parse(JSON.stringify(c.ficha || {}));
  const filaEsp = (e, i) => `<tr data-esp><td><label class="sr" for="ep${i}">Padecimiento</label><input id="ep${i}" data-k="padecimiento" value="${esc(e.padecimiento || '')}"></td>
    <td style="width:90px"><label class="sr" for="em${i}">Meses</label><input id="em${i}" data-k="meses" type="number" min="0" value="${e.meses ?? ''}"></td>
    <td style="width:70px;text-align:center"><label class="sr" for="eg${i}">General</label><input id="eg${i}" data-k="general" type="checkbox"${e.general ? ' checked' : ''} style="width:auto;min-height:0"></td>
    <td style="width:80px"><label class="sr" for="eq${i}">Página</label><input id="eq${i}" data-k="pagina" type="number" min="1" value="${e.pagina ?? ''}"></td>
    <td style="width:40px"><button type="button" class="x" aria-label="Quitar" data-quitar>×</button></td></tr>`;
  modal({
    titulo: `Ficha · ${nombreCG(c)}`, boton: 'Guardar ficha',
    cuerpo: `<p class="muted small" style="margin-top:0">Compare con el PDF y corrija lo necesario. Estos datos se usan para avisar en siniestros, cancelaciones y altas.</p>
      <div class="lbl">Periodos de espera</div>
      <div class="tbl-wrap" style="margin:6px 0"><table><thead><tr><th>Padecimiento</th><th>Meses</th><th>General</th><th>Página</th><th></th></tr></thead>
        <tbody id="fEsp">${(f.periodos_espera || []).map(filaEsp).join('')}</tbody></table></div>
      <button type="button" class="linkbtn small" id="fEspMas">+ Agregar periodo de espera</button>
      <p class="muted small">«General» es el periodo que aplica a cualquier enfermedad que no tenga uno propio (no a accidentes).</p>
      <div class="form-grid" style="margin-top:12px">
        ${input('Cancelación: qué pasa (una línea)', 'canc', { wide: true, value: f.cancelacion?.penalizacion || '', attrs: 'placeholder="Ej. Penalización del 50% de la prima no devengada"' })}
        ${input('Página (cancelación)', 'canc_p', { type: 'number', value: f.cancelacion?.pagina ?? '' })}
        ${input('Edad máxima de aceptación (años)', 'edad', { type: 'number', value: f.edad_maxima?.anios ?? '' })}
        ${input('Página (edad)', 'edad_p', { type: 'number', value: f.edad_maxima?.pagina ?? '' })}
        ${input('Plazo para reembolsos', 'reemb', { value: f.reembolsos?.plazo || '' })}
        ${input('Página (reembolsos)', 'reemb_p', { type: 'number', value: f.reembolsos?.pagina ?? '' })}
        ${input('Preexistencias', 'pre', { wide: true, value: f.preexistencias?.texto || '' })}
      </div>
      <div class="field wide" style="margin-top:12px"><label for="fExcl">Exclusiones principales (una por renglón; al final «| página»)</label>
        <textarea id="fExcl" name="excl" style="min-height:120px">${esc((f.exclusiones || []).map(x => `${x.texto}${x.pagina ? ' | ' + x.pagina : ''}`).join('\n'))}</textarea></div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="revisada"${c.ficha_revisada ? ' checked' : ''} style="width:auto;min-height:0"> Revisé la ficha contra el PDF</label>`,
    onOpen: form => {
      let n = 1000;
      form.querySelector('#fEspMas').onclick = () => form.querySelector('#fEsp').insertAdjacentHTML('beforeend', filaEsp({}, n++));
      form.addEventListener('click', e => { if (e.target.hasAttribute('data-quitar')) e.target.closest('tr').remove(); });
    },
    onSubmit: async (x, form) => {
      f.periodos_espera = [...form.querySelectorAll('[data-esp]')].map(tr => { const v = k => tr.querySelector(`[data-k=${k}]`);
        return { padecimiento: v('padecimiento').value.trim(), meses: num(v('meses').value), general: v('general').checked, pagina: num(v('pagina').value),
          texto: (c.ficha?.periodos_espera || []).find(e => e.padecimiento === v('padecimiento').value.trim())?.texto || null }; }).filter(e => e.padecimiento);
      f.cancelacion = { ...(f.cancelacion || {}), penalizacion: txt(x.canc), pagina: num(x.canc_p) };
      f.edad_maxima = { ...(f.edad_maxima || {}), anios: num(x.edad), pagina: num(x.edad_p), texto: f.edad_maxima?.texto || (num(x.edad) ? `${num(x.edad)} años` : null) };
      f.reembolsos = { ...(f.reembolsos || {}), plazo: txt(x.reemb), pagina: num(x.reemb_p) };
      f.preexistencias = { ...(f.preexistencias || {}), texto: txt(x.pre) };
      f.exclusiones = String(x.excl || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(.*?)\s*\|\s*(\d+)\s*$/); return m ? { texto: m[1], pagina: Number(m[2]) } : { texto: l, pagina: null }; });
      await q(sb.from('condiciones_generales').update({ ficha: f, ficha_revisada: !!x.revisada, revisada_por: x.revisada ? ctx.perfil.id : null }).eq('id', c.id));
      toast('Ficha guardada.'); alTerminar?.();
    },
  });
}

// Aviso de cancelación según las condiciones de la póliza (texto o null)
export async function avisoCancelacion(poliza) {
  try { const cg = cgDePoliza(poliza, await cargarCondiciones()); const x = cg?.ficha?.cancelacion; return x?.penalizacion ? { texto: x.penalizacion, pagina: x.pagina, cg: nombreCG(cg) } : null; }
  catch (e) { return null; }
}
// Edad máxima de aceptación según las condiciones (años o null)
export async function edadMaxima(poliza) {
  try { const cg = cgDePoliza(poliza, await cargarCondiciones()); const x = cg?.ficha?.edad_maxima; return x?.anios ? { anios: Number(x.anios), pagina: x.pagina, cg: nombreCG(cg) } : null; }
  catch (e) { return null; }
}
