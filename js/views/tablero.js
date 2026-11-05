// Tablero de trabajo (estilo Monday): tableros y grupos propios, columnas personalizadas,
// tareas ligadas a clientes, pólizas, trámites y endosos, y archivo de tareas cerradas.
import { sb, ctx, q, puedeAdministrar } from '../db.js';
import {
  esc, fdate, fdia, hoyISO, iso, addDays, hoy, modal, input, select, textarea, opts, optsList, toast, txt, diasDesde, iniciales, confirmar, pill, descargar,
  RAMOS, TIPOS_TAREA, EST_TAREA, PRIORIDADES, TAREA_A_TRAMITE, TIPOS_MOV, EST_MOV, CIERRE_TAREA, tareaAbierta
} from '../ui.js';
import { formPoliza, subirArchivo, abrirArchivo } from './formas.js';
import { verTramite, crearCarpeta } from './tramites.js';
import { leerArchivo, norm, cargarSheetJS } from './importar.js';
import { refrescar } from '../app.js';

const ICO_COM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const ICO_CLIP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:-2px"><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>';

// Colores de grupos y etiquetas (los de Monday)
export const COLORES = { '#00875A': 'Verde', '#037F4C': 'Verde oscuro', '#9CD326': 'Lima', '#579BFC': 'Azul', '#66CCFF': 'Celeste', '#5559DF': 'Índigo', '#401694': 'Morado oscuro',
  '#A25DDC': 'Morado', '#FF5AC4': 'Rosa', '#D83A52': 'Rojo', '#FF7575': 'Salmón', '#FDAB3D': 'Naranja', '#FFCB00': 'Amarillo', '#7F5347': 'Café', '#9AA0A8': 'Gris', '#333333': 'Negro' };
const tinta = c => { const n = parseInt(String(c || '').slice(1), 16); if (isNaN(n)) return '#fff'; const r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1F242B' : '#FFFFFF'; };
// Columnas fijas (se pueden renombrar, mover u ocultar) y tipos de columna personalizada
const FIJAS = { cliente: 'Cliente / póliza', tipo: 'Tipo', aseguradora: 'Aseguradora', responsable: 'Responsable', prioridad: 'Prioridad', fecha: 'Fecha', estatus: 'Estado', actualizado: 'Última actualización' };
const OCULTAS_INICIO = ['tipo'];
export const TIPOS_COLUMNA = { texto: 'Texto', numero: 'Número', moneda: 'Importe ($)', fecha: 'Fecha', estado: 'Etiquetas de estado (con colores)', persona: 'Persona', casilla: 'Casilla (sí / no)', enlace: 'Enlace o liga' };
const PLANTILLAS = {
  blanco: ['En blanco (un grupo)', [['Tareas', '#579BFC', null]]],
  etapas: ['Por etapas', [['Por hacer', '#9AA0A8', null], ['En proceso', '#FDAB3D', null], ['Esperando a la aseguradora', '#579BFC', null], ['Listo para entregar', '#00875A', null]]],
  semana: ['Por semana', [['Esta semana', '#D83A52', null], ['Próxima semana', '#FDAB3D', null], ['Más adelante', '#579BFC', null]]],
  tipos: ['Por tipo de trámite (como el general)', [['Emisión', '#00875A', 'emision'], ['Renovación', '#5559DF', 'renovacion'], ['Reembolso', '#FDAB3D', 'reembolso'], ['Programación', '#D83A52', 'programacion'], ['Endoso', '#579BFC', 'endoso'], ['Otros', '#9AA0A8', 'otro']]],
};
const nuevoId = () => 'c' + Math.random().toString(36).slice(2, 8);
// Lista completa de columnas de un tablero (agrega las fijas que falten, ocultas)
export function columnasDe(b) {
  const lista = (Array.isArray(b?.columnas) && b.columnas.length ? b.columnas : Object.keys(FIJAS).filter(k => !OCULTAS_INICIO.includes(k)).map(id => ({ id }))).map(c => ({ ...c }));
  Object.keys(FIJAS).forEach(k => { if (!lista.some(c => c.id === k)) lista.push({ id: k, oculta: true }); });
  return lista.map(c => ({ ...c, fija: !!FIJAS[c.id], nombre: c.nombre || FIJAS[c.id] || 'Columna' }));
}
const limpiarCols = cols => cols.map(({ fija, ...c }) => { const x = { ...c }; if (fija && x.nombre === FIJAS[x.id]) delete x.nombre; if (!x.oculta) delete x.oculta; return x; });

// Filtros que se conservan al navegar
const F = { q: '', persona: '', tipo: '', estatus: '', agrupar: 'grupo', cerrados: new Set(), tablero: null,
  a: { q: '', persona: '', resultado: '', tablero: '', desde: '', hasta: '' } };

// Comentarios de otras personas posteriores a la última vez que abrí la tarea
export function sinLeer(comentarios, lecturas) {
  const visto = Object.fromEntries(lecturas.map(l => [l.tarea_id, l.visto_en])), r = {};
  comentarios.forEach(c => { if (c.autor_id && c.autor_id !== ctx.perfil.id && (!visto[c.tarea_id] || c.creado_en > visto[c.tarea_id])) r[c.tarea_id] = (r[c.tarea_id] || 0) + 1; });
  return r;
}
export async function marcarLeida(tareaId) {
  try {
    const ya = await q(sb.from('tarea_lecturas').select('tarea_id').eq('tarea_id', tareaId).eq('perfil_id', ctx.perfil.id));
    if (ya.length) await q(sb.from('tarea_lecturas').update({ visto_en: new Date().toISOString() }).eq('tarea_id', tareaId).eq('perfil_id', ctx.perfil.id));
    else await q(sb.from('tarea_lecturas').insert({ tarea_id: tareaId, perfil_id: ctx.perfil.id }));
  } catch (e) { /* no es crítico */ }
}

const hace = f => { const d = diasDesde(f); return d <= 0 ? 'Hoy' : d === 1 ? 'Ayer' : d < 7 ? `Hace ${d} días` : d < 30 ? `Hace ${Math.floor(d / 7)} semana${d >= 14 ? 's' : ''}` : `Hace ${Math.floor(d / 30)} mes${d >= 60 ? 'es' : ''}`; };
const fechaHora = f => f ? new Date(f).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// Tableros y grupos (si aún no se corre el ajuste 19 de la base, devuelve null)
export async function cargarTableros() {
  try {
    const [tableros, grupos] = await Promise.all([
      q(sb.from('tableros').select('*').order('orden').order('creado_en')),
      q(sb.from('tablero_grupos').select('*').order('orden').order('creado_en')),
    ]);
    return { tableros, grupos };
  } catch (e) { return null; }
}
// Grupo donde cae una tarea de cierto tipo en un tablero
export const grupoPara = (grupos, tableroId, tipo) => grupos.filter(g => g.tablero_id === tableroId).sort((a, b) => ((b.tipo === tipo) - (a.tipo === tipo)) || a.orden - b.orden)[0] || null;

const leerHash = () => new URLSearchParams(location.hash.split('?')[1] || '');

export async function vistaTablero(main, _p, vigente) {
  const tb = await cargarTableros();
  if (!vigente()) return;
  if (!tb) { main.innerHTML = `<header class="head"><h1>Tablero de trabajo</h1></header><div class="card"><h2>Falta actualizar la base de datos</h2>
    <p>Para usar tableros propios y el archivo de tareas, corra el archivo <b>19_tableros_comisiones.sql</b> en Supabase → SQL Editor y recargue la página.</p></div>`; return; }
  const h0 = leerHash();
  if (h0.get('t')) F.tablero = h0.get('t');
  return h0.has('archivo') ? vistaArchivo(main, tb, vigente) : vistaBoard(main, tb, vigente);
}

// ---------------------------------------------------------------- Pestañas de tableros
function barraTableros(tb, actual, nArchivo) {
  return `<nav class="tb-tabs" aria-label="Tableros">
    ${tb.tableros.map(b => `<a href="#/tablero?t=${b.id}" class="tb-tab"${actual === b.id ? ' aria-current="page"' : ''}>${esc(b.nombre)}${b.predeterminado ? ' <span class="muted small" title="Tablero principal: aquí llegan las tareas automáticas">★</span>' : ''}</a>`).join('')}
    <button type="button" class="tb-tab nuevo" id="tbNuevo">+ Nuevo tablero</button>
    <a href="#/tablero?archivo" class="tb-tab archivo"${actual === 'archivo' ? ' aria-current="page"' : ''}>Archivo${nArchivo != null ? ` (${nArchivo})` : ''}</a>
  </nav>`;
}
function conectarBarra(main, tb) {
  main.querySelector('#tbNuevo').onclick = () => formTablero(tb, null);
}

// ---------------------------------------------------------------- Tablero
async function vistaBoard(main, tb, vigente) {
  const principal = tb.tableros.find(b => b.predeterminado) || tb.tableros[0];
  let board = tb.tableros.find(b => b.id === F.tablero) || principal;
  if (!board) {
    main.innerHTML = `<header class="head"><h1>Tablero de trabajo</h1></header>${barraTableros(tb, null)}<div class="card empty">Aún no hay tableros. Cree el primero con «+ Nuevo tablero».</div>`;
    return conectarBarra(main, tb);
  }
  F.tablero = board.id;
  const [todas, comentarios, docs, clientes, polizas, lecturas, cerradas] = await Promise.all([
    q(sb.from('tareas').select('*').eq('hecha', false).order('creado_en')),
    q(sb.from('tarea_comentarios').select('tarea_id,autor_id,creado_en')),
    q(sb.from('documentos').select('tarea_id').not('tarea_id', 'is', null)),
    q(sb.from('clientes').select('id,nombre')),
    q(sb.from('v_polizas').select('id,numero_poliza,aseguradora_nombre,ramo')),
    q(sb.from('tarea_lecturas').select('tarea_id,visto_en')),
    q(sb.from('tareas').select('id').eq('hecha', true)),
  ]);
  if (!vigente()) return;
  const tareas = todas.filter(t => (t.tablero_id || principal.id) === board.id);
  const grupos = tb.grupos.filter(g => g.tablero_id === board.id);
  const cols = columnasDe(board), vis = cols.filter(c => !c.oculta);
  const nCom = {}, nDoc = {}, nuevos = sinLeer(comentarios, lecturas);
  comentarios.forEach(c => { nCom[c.tarea_id] = (nCom[c.tarea_id] || 0) + 1; });
  docs.forEach(d => { if (d.tarea_id) nDoc[d.tarea_id] = (nDoc[d.tarea_id] || 0) + 1; });
  const cli = Object.fromEntries(clientes.map(c => [c.id, c.nombre]));
  const pol = Object.fromEntries(polizas.map(p => [p.id, p]));
  const aseg = Object.fromEntries(ctx.aseguradoras.map(a => [a.id, a.nombre]));
  const persona = Object.fromEntries(ctx.perfiles.map(p => [p.id, p]));
  const h = hoyISO();
  const puedeBorrar = ctx.perfil.rol === 'admin' || board.creado_por === ctx.perfil.id;

  main.innerHTML = `
  <header class="head"><div><h1>Tablero de trabajo</h1>
    <p class="muted" style="margin:4px 0 0">${tareas.length} tareas abiertas en este tablero · ${tareas.filter(t => t.fecha && t.fecha < h).length} atrasadas · ${tareas.filter(t => t.estatus === 'detenido').length} detenidas</p></div>
    <div class="filters"><button class="btn" type="button" id="impMonday">Importar de Monday</button>
    <button class="btn primary" type="button" id="nueva">+ Nueva tarea</button></div></header>
  ${barraTableros(tb, board.id, cerradas.length)}
  <div class="tb-head">
    <div><h2>${esc(board.nombre)}</h2>${board.descripcion ? `<p class="muted small" style="margin:2px 0 0">${esc(board.descripcion)}</p>` : ''}</div>
    <div class="filters"><button type="button" class="btn sm" id="tbCols">Columnas</button><button type="button" class="btn sm" id="tbEdit">Editar tablero</button></div>
  </div>
  <div class="filters">
    <label for="bq" class="sr">Buscar</label><input id="bq" class="search" type="search" placeholder="Buscar tarea o cliente" value="${esc(F.q)}">
    <label for="fp" class="sr">Persona</label><select id="fp" style="width:auto"><option value="">Todas las personas</option>${optsList(ctx.perfiles, F.persona)}</select>
    <label for="ft" class="sr">Tipo</label><select id="ft" style="width:auto"><option value="">Todos los tipos</option>${opts(TIPOS_TAREA, F.tipo)}</select>
    <label for="fe" class="sr">Estado</label><select id="fe" style="width:auto"><option value="">Todos los estados</option>${opts({ no_iniciado: EST_TAREA.no_iniciado, en_proceso: EST_TAREA.en_proceso, detenido: EST_TAREA.detenido }, F.estatus)}</select>
    <label for="fg">Agrupar por</label><select id="fg" style="width:auto">${opts({ grupo: 'Grupos del tablero', estatus: 'Estado', asignado_a: 'Responsable', aseguradora_id: 'Aseguradora', fecha: 'Fecha', tipo: 'Tipo', ninguno: 'Sin agrupar' }, F.agrupar)}</select>
  </div>
  <div class="col" id="grupos"></div>
  ${F.agrupar === 'grupo' ? '<div><button type="button" class="btn" id="gNuevo">+ Agregar grupo</button></div>' : ''}
  <p class="muted small" style="margin:0">Las tareas que se marcan como <b>Listo</b> o se cancelan con la <b>×</b> pasan al <a href="#/tablero?archivo">Archivo</a>, donde se pueden consultar y reabrir.${F.agrupar === 'grupo' ? ' Puede arrastrar una tarea de un grupo a otro.' : ''}</p>`;

  const grupoDe = t => {
    if (F.agrupar === 'grupo') return grupos.some(g => g.id === t.grupo_id) ? t.grupo_id : 'sin';
    if (F.agrupar === 'fecha') return !t.fecha ? 'sin' : t.fecha < h ? 'atrasada' : t.fecha === h ? 'hoy' : t.fecha <= iso(addDays(hoy(), 7)) ? 'semana' : 'despues';
    if (F.agrupar === 'ninguno') return 'todas';
    return t[F.agrupar] || 'sin';
  };
  const nombreGrupo = k => ({
    grupo: () => grupos.find(g => g.id === k)?.nombre || 'Sin grupo',
    tipo: () => TIPOS_TAREA[k] || 'Sin tipo', estatus: () => EST_TAREA[k], asignado_a: () => persona[k]?.nombre || 'Sin responsable',
    aseguradora_id: () => aseg[k] || 'Sin aseguradora', ninguno: () => 'Todas las tareas',
    fecha: () => ({ atrasada: 'Atrasadas', hoy: 'Hoy', semana: 'Próximos 7 días', despues: 'Más adelante', sin: 'Sin fecha' })[k],
  })[F.agrupar]();
  const ordenGrupos = () => ({
    grupo: [...grupos.map(g => g.id), 'sin'],
    tipo: Object.keys(TIPOS_TAREA), estatus: ['no_iniciado', 'en_proceso', 'detenido'], asignado_a: [...ctx.perfiles.map(p => p.id), 'sin'],
    aseguradora_id: [...ctx.aseguradoras.map(a => a.id), 'sin'], fecha: ['atrasada', 'hoy', 'semana', 'despues', 'sin'], ninguno: ['todas'],
  })[F.agrupar];
  const colorGrupo = k => F.agrupar === 'grupo' ? (grupos.find(g => g.id === k)?.color || '#9AA0A8') : ({ emision: '#00875A', renovacion: '#5559DF', reembolso: '#FDAB3D', programacion: '#D83A52', siniestro: '#401694', endoso: '#579BFC',
    en_proceso: '#FDAB3D', detenido: '#D83A52', no_iniciado: '#9AA0A8', atrasada: '#D83A52', hoy: '#FDAB3D' })[k] || 'var(--accent)';

  // Celda de una columna
  const celda = (c, t) => {
    const p = pol[t.poliza_id], tarde = t.fecha && t.fecha < h, v = (t.valores || {})[c.id];
    switch (c.id) {
      case 'cliente': return `<td style="min-width:170px">${t.cliente_id ? `<a href="#/cliente/${t.cliente_id}">${esc(cli[t.cliente_id] || '')}</a>` : '<span class="muted small">Sin cliente</span>'}
        ${p ? `<div class="muted small">${esc(p.numero_poliza || 's/n')}</div>` : ''}</td>`;
      case 'tipo': return `<td style="width:140px"><label class="sr" for="ti${t.id}">Tipo</label><select id="ti${t.id}" class="cell-in" data-campo="tipo">${opts(TIPOS_TAREA, t.tipo)}</select></td>`;
      case 'aseguradora': return `<td class="nw" style="text-align:center">${t.aseguradora_id ? `<span class="tag">${esc(aseg[t.aseguradora_id] || '')}</span>` : ''}</td>`;
      case 'responsable': return `<td style="width:150px"><label class="sr" for="r${t.id}">Responsable</label><select id="r${t.id}" class="cell-in" data-campo="asignado_a">${optsList(ctx.perfiles.filter(x => x.rol !== 'cliente' && (x.activo || x.id === t.asignado_a)), t.asignado_a, x => x.nombre)}</select></td>`;
      case 'prioridad': return `<td style="width:118px"><label class="sr" for="p${t.id}">Prioridad</label><select id="p${t.id}" class="mcell pr-${t.prioridad}" data-campo="prioridad">${opts(PRIORIDADES, t.prioridad)}</select></td>`;
      case 'fecha': return `<td style="width:150px"><label class="sr" for="f${t.id}">Fecha</label><input id="f${t.id}" type="date" class="cell-in" data-campo="fecha" value="${esc(t.fecha || '')}" style="${tarde ? 'color:var(--bad);font-weight:600' : ''}"></td>`;
      case 'estatus': return `<td style="width:132px"><label class="sr" for="e${t.id}">Estado</label><select id="e${t.id}" class="mcell st-${t.estatus}" data-campo="estatus">${opts(EST_TAREA, t.estatus)}</select></td>`;
      case 'actualizado': { const resp = persona[t.asignado_a]; return `<td class="nw small" style="width:160px"><span class="avatar" style="width:24px;height:24px;font-size:10px;display:inline-flex;vertical-align:middle;margin-right:6px">${esc(iniciales(resp?.nombre))}</span>${hace(t.actualizado_en)}</td>`; }
    }
    const lbl = `<label class="sr" for="v${c.id}${t.id}">${esc(c.nombre)}</label>`, id = `v${c.id}${t.id}`;
    switch (c.tipo) {
      case 'numero': case 'moneda': return `<td style="width:130px">${lbl}<input id="${id}" type="number" step="${c.tipo === 'moneda' ? '0.01' : 'any'}" class="cell-in num" data-val="${c.id}" value="${esc(v ?? '')}"${c.tipo === 'moneda' ? ' placeholder="$"' : ''}></td>`;
      case 'fecha': return `<td style="width:150px">${lbl}<input id="${id}" type="date" class="cell-in" data-val="${c.id}" value="${esc(v || '')}"></td>`;
      case 'estado': { const o = (c.opciones || []).find(x => x.t === v); return `<td style="width:140px">${lbl}<select id="${id}" class="mcell" data-val="${c.id}" style="${o ? `background:${o.c};color:${tinta(o.c)}` : 'background:var(--surface-2);color:var(--muted)'}"><option value="">—</option>${(c.opciones || []).map(x => `<option value="${esc(x.t)}"${x.t === v ? ' selected' : ''}>${esc(x.t)}</option>`).join('')}</select></td>`; }
      case 'persona': return `<td style="width:150px">${lbl}<select id="${id}" class="cell-in" data-val="${c.id}"><option value="">—</option>${optsList(ctx.perfiles.filter(x => x.rol !== 'cliente'), v)}</select></td>`;
      case 'casilla': return `<td style="width:90px;text-align:center">${lbl}<input id="${id}" type="checkbox" data-val="${c.id}"${v ? ' checked' : ''} style="width:18px;min-height:18px"></td>`;
      case 'enlace': return `<td style="min-width:170px"><div style="display:flex;gap:4px;align-items:center">${lbl}<input id="${id}" type="url" class="cell-in" data-val="${c.id}" value="${esc(v || '')}" placeholder="https://…">${v && /^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener" class="small" aria-label="Abrir enlace">Abrir</a>` : ''}</div></td>`;
      default: return `<td style="min-width:160px">${lbl}<input id="${id}" class="cell-in" data-val="${c.id}" value="${esc(v || '')}"></td>`;
    }
  };

  const fila = t => `<tr data-id="${t.id}"${F.agrupar === 'grupo' ? ' draggable="true"' : ''}>
      <td style="min-width:260px"><div class="titulo">${F.agrupar === 'grupo' ? '<span class="asa" aria-hidden="true" title="Arrastre para mover a otro grupo">⋮⋮</span>' : ''}<button type="button" class="tt" data-abrir="${t.id}">${esc(t.titulo)}</button>
        <span class="nw" style="display:flex;gap:6px;align-items:center">${nDoc[t.id] ? `<span class="small muted" title="Archivos">${ICO_CLIP}${nDoc[t.id]}</span>` : ''}
        <button type="button" class="upd${nCom[t.id] ? ' on' : ''}${nuevos[t.id] ? ' nuevo' : ''}" data-abrir="${t.id}" aria-label="Actualizaciones de ${esc(t.titulo)}${nuevos[t.id] ? ` (${nuevos[t.id]} sin leer)` : ''}">${ICO_COM}${nCom[t.id] || ''}</button><button type="button" class="x-row" data-x="${t.id}" aria-label="Cancelar o borrar «${esc(t.titulo)}»" title="Cancelar o borrar">×</button></span></div>
        ${t.origen && !t.creado_por ? '<span class="auto-tag" title="La creó la app a partir de un pendiente">Automática</span>' : ''}</td>
      ${vis.map(c => celda(c, t)).join('')}
      <td class="x-cell"></td>
    </tr>`;

  const pintar = () => {
    const tq = norm(F.q);
    const lista0 = tareas.filter(t => (!F.persona || t.asignado_a === F.persona) && (!F.tipo || t.tipo === F.tipo) && (!F.estatus || t.estatus === F.estatus)
      && (!tq || norm(t.titulo).includes(tq) || norm(cli[t.cliente_id]).includes(tq)));
    const porG = {};
    lista0.forEach(t => (porG[grupoDe(t)] ||= []).push(t));
    const filtrando = F.q || F.persona || F.tipo || F.estatus;
    const orden = ordenGrupos().filter(k => porG[k]?.length || (F.agrupar === 'grupo' && k !== 'sin' && !filtrando));
    main.querySelector('#grupos').innerHTML = orden.map(k => {
      const lista = (porG[k] || []).sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));
      const cerrado = F.cerrados.has(F.agrupar + k), esG = F.agrupar === 'grupo' && k !== 'sin';
      return `<section class="board-group" data-gid="${esc(k)}" style="border-left-color:${colorGrupo(k)}">
        <header><button type="button" data-toggle="${esc(k)}" aria-expanded="${!cerrado}" aria-label="${cerrado ? 'Mostrar' : 'Ocultar'} ${esc(nombreGrupo(k))}">${cerrado ? '▸' : '▾'}</button>
          ${esG ? `<button type="button" class="g-nombre" data-gedit="${k}" style="color:${colorGrupo(k)}" title="Editar grupo">${esc(nombreGrupo(k))}</button>` : `<b style="font-size:14.5px">${esc(nombreGrupo(k))}</b>`}
          <span class="muted small">${lista.length} tarea${lista.length === 1 ? '' : 's'}</span>
          ${esG ? `<button type="button" class="btn sm ghost g-menu" data-gedit="${k}" aria-label="Editar grupo ${esc(nombreGrupo(k))}">Editar</button>` : ''}</header>
        ${cerrado ? '' : `<div class="tbl-wrap"><table class="board">
          <thead><tr><th>Tarea</th>${vis.map(c => `<th><button type="button" class="th-btn" data-col="${esc(c.id)}" title="Editar columna">${esc(c.nombre)}</button></th>`).join('')}
            <th class="x-cell"><button type="button" class="th-btn add" data-addcol aria-label="Agregar columna" title="Agregar columna">+</button></th></tr></thead>
          <tbody>${lista.map(fila).join('')}
            <tr class="addrow"><td colspan="${vis.length + 2}"><label class="sr" for="add${esc(k)}">Agregar tarea</label><input id="add${esc(k)}" data-add="${esc(k)}" placeholder="+ Agregar tarea (escriba y presione Enter)"></td></tr>
          </tbody></table></div>`}
      </section>`;
    }).join('') || `<div class="card empty">${filtrando ? 'No hay tareas con estos filtros.' : 'Este tablero no tiene grupos. Agregue uno para empezar.'}</div>`;
  };
  pintar();

  // Filtros
  const filtro = (id, k, ev = 'onchange') => { main.querySelector(id)[ev] = e => { F[k] = e.target.value; pintar(); }; };
  filtro('#bq', 'q', 'oninput'); filtro('#fp', 'persona'); filtro('#ft', 'tipo'); filtro('#fe', 'estatus');
  main.querySelector('#fg').onchange = e => { F.agrupar = e.target.value; refrescar(); };
  conectarBarra(main, tb);
  main.querySelector('#tbEdit').onclick = () => formTablero(tb, board, puedeBorrar);
  main.querySelector('#tbCols').onclick = () => formColumnas(board);
  main.querySelector('#gNuevo')?.addEventListener('click', () => formGrupo(board, grupos, null));

  const g = main.querySelector('#grupos');
  const guardarTarea = async (t, cambios, aviso) => {
    try {
      const r = await q(sb.from('tareas').update(cambios).eq('id', t.id).select().single());
      Object.assign(t, r);
      if (!tareaAbierta(t)) { tareas.splice(tareas.indexOf(t), 1); toast(aviso || 'Tarea terminada. Quedó en el Archivo.'); }
      pintar();
    } catch (err) { toast(err.message, true); pintar(); }
  };
  // Edición directa en la tabla
  g.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const t = tareas.find(x => x.id === tr.dataset.id); if (!t) return;
    const campo = e.target.dataset.campo, col = e.target.dataset.val;
    if (campo) return guardarTarea(t, { [campo]: e.target.value || null });
    if (col) {
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value.trim() || null);
      return guardarTarea(t, { valores: { ...(t.valores || {}), [col]: v } });
    }
  });
  g.addEventListener('click', e => {
    const b = e.target.closest('[data-abrir],[data-toggle],[data-x],[data-gedit],[data-col],[data-addcol]'); if (!b) return;
    if (b.dataset.abrir) verTarea(b.dataset.abrir, refrescar);
    else if (b.dataset.toggle != null) { const k = F.agrupar + b.dataset.toggle; F.cerrados.has(k) ? F.cerrados.delete(k) : F.cerrados.add(k); pintar(); }
    else if (b.dataset.x) cerrarTarea(tareas.find(t => t.id === b.dataset.x), refrescar);
    else if (b.dataset.gedit) formGrupo(board, grupos, grupos.find(x => x.id === b.dataset.gedit));
    else if (b.dataset.col) formColumna(board, b.dataset.col);
    else if (b.hasAttribute('data-addcol')) formColumna(board, null);
  });
  // Arrastrar una tarea a otro grupo
  let arrastrada = null;
  g.addEventListener('dragstart', e => { const tr = e.target.closest?.('tr[data-id]'); if (!tr) return; arrastrada = tr.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', arrastrada); tr.classList.add('arrastrando'); });
  g.addEventListener('dragend', e => { e.target.closest?.('tr')?.classList.remove('arrastrando'); g.querySelectorAll('.soltar').forEach(x => x.classList.remove('soltar')); });
  g.addEventListener('dragover', e => { const s = e.target.closest('section[data-gid]'); if (!s || !arrastrada || s.dataset.gid === 'sin') return; e.preventDefault(); g.querySelectorAll('.soltar').forEach(x => x !== s && x.classList.remove('soltar')); s.classList.add('soltar'); });
  g.addEventListener('drop', e => {
    const s = e.target.closest('section[data-gid]'); if (!s || !arrastrada) return; e.preventDefault();
    const t = tareas.find(x => x.id === arrastrada); arrastrada = null; s.classList.remove('soltar');
    if (t && t.grupo_id !== s.dataset.gid) guardarTarea(t, { grupo_id: s.dataset.gid }).then(() => toast(`Movida a «${grupos.find(x => x.id === t.grupo_id)?.nombre || ''}».`));
  });
  // Alta rápida dentro del grupo
  g.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !e.target.dataset.add) return;
    const titulo = e.target.value.trim(); if (!titulo) return;
    const k = e.target.dataset.add, fila0 = { titulo, asignado_a: F.persona || ctx.perfil.id, tablero_id: board.id };
    if (F.agrupar === 'grupo' && k !== 'sin') { fila0.grupo_id = k; const gr = grupos.find(x => x.id === k); if (gr?.tipo) fila0.tipo = gr.tipo; }
    if (F.agrupar === 'tipo' && k !== 'sin') fila0.tipo = k;
    if (F.agrupar === 'estatus') fila0.estatus = k;
    if (F.agrupar === 'asignado_a' && k !== 'sin') fila0.asignado_a = k;
    if (F.agrupar === 'aseguradora_id' && k !== 'sin') fila0.aseguradora_id = k;
    if (F.agrupar === 'fecha') fila0.fecha = k === 'hoy' ? h : k === 'atrasada' ? iso(addDays(hoy(), -1)) : k === 'semana' ? iso(addDays(hoy(), 3)) : k === 'despues' ? iso(addDays(hoy(), 14)) : null;
    if (!fila0.tipo) fila0.tipo = adivinarTipo(titulo);
    if (!fila0.grupo_id) fila0.grupo_id = grupoPara(grupos, board.id, fila0.tipo)?.id || null;
    try {
      const r = await q(sb.from('tareas').insert(fila0).select().single());
      tareas.push(r); pintar(); main.querySelector(`[data-add="${CSS.escape(k)}"]`)?.focus();
      toast('Tarea agregada. Ábrala para ligar cliente y póliza.');
    } catch (err) { toast(err.message, true); }
  });
  main.querySelector('#nueva').onclick = () => formTarea({ prefill: { tablero_id: board.id }, alGuardar: t => { refrescar(); verTarea(t.id, refrescar); } });
  main.querySelector('#impMonday').onclick = () => importarMonday(refrescar, board.id);
}

// ---------------------------------------------------------------- Cancelar o borrar una tarea (la ×)
export function cerrarTarea(t, alCambiar) {
  if (!t) return;
  modal({
    titulo: '¿Qué pasó con esta tarea?', boton: 'Aplicar',
    cuerpo: `<p style="margin-top:0"><b>${esc(t.titulo)}</b></p>
      <div class="opc-cierre">
        <label><input type="radio" name="accion" value="cancelar" checked> <span><b>Cancelarla: no se hizo</b><span class="muted small">El cliente se arrepintió, ya no aplica, se duplicó con otra… Sale del tablero y queda en el Archivo con el motivo.</span></span></label>
        <label><input type="radio" name="accion" value="listo"> <span><b>Ya se terminó</b><span class="muted small">Igual que marcarla como «Listo».</span></span></label>
        <label><input type="radio" name="accion" value="borrar"> <span><b>Borrarla definitivamente</b><span class="muted small">Solo si se capturó por error: se borra con sus actualizaciones y no queda registro.${t.tramite_id || t.movimiento_id ? ' El trámite o endoso ligado se conserva.' : ''}</span></span></label>
      </div>
      <div class="field" id="cMot" style="margin-top:12px"><label for="cMotI">Motivo o nota (opcional)</label><input id="cMotI" name="motivo" placeholder="Ej. El cliente decidió no hacer el cambio"></div>`,
    onOpen: f => { const vis = () => { f.querySelector('#cMot').hidden = f.accion.value === 'borrar'; }; f.querySelectorAll('[name=accion]').forEach(r => r.onchange = vis); },
    onSubmit: async d => {
      if (d.accion === 'borrar') {
        await q(sb.from('tareas').delete().eq('id', t.id)); toast('Tarea borrada.');
      } else {
        const motivo = txt(d.motivo);
        await q(sb.from('tareas').update({ estatus: d.accion === 'cancelar' ? 'cancelado' : 'listo' }).eq('id', t.id));
        if (motivo) await q(sb.from('tareas').update({ motivo_cierre: motivo }).eq('id', t.id));
        await q(sb.from('tarea_comentarios').insert({ tarea_id: t.id, texto: `${d.accion === 'cancelar' ? 'Tarea cancelada (no se hizo)' : 'Tarea terminada'}${motivo ? ': ' + motivo : '.'}` }));
        toast(d.accion === 'cancelar' ? 'Tarea cancelada. Quedó en el Archivo.' : 'Tarea terminada. Quedó en el Archivo.');
      }
      alCambiar?.();
    }
  });
}

// ---------------------------------------------------------------- Editar tablero, grupos y columnas
function formTablero(tb, board, puedeBorrar = false) {
  const otros = tb.tableros.filter(b => b.id !== board?.id);
  modal({
    titulo: board ? 'Editar tablero' : 'Nuevo tablero', boton: board ? 'Guardar' : 'Crear tablero',
    cuerpo: `<div class="form-grid">
      ${input('Nombre del tablero', 'nombre', { value: board?.nombre || '', req: true, wide: true, attrs: 'placeholder="Ej. Cotizaciones de Ángel, Trámites de AXA…" maxlength="60"' })}
      ${input('Descripción (opcional)', 'descripcion', { value: board?.descripcion || '', wide: true })}
      ${board ? '' : select('Empezar con', 'plantilla', `${Object.entries(PLANTILLAS).map(([k, [n]]) => `<option value="${k}">${esc(n)}</option>`).join('')}
        ${tb.tableros.map(b => `<option value="copia:${b.id}">Copiar grupos y columnas de «${esc(b.nombre)}»</option>`).join('')}`, { wide: true })}
    </div>
    ${board ? `<div class="filters" style="margin-top:14px">
      ${!board.predeterminado && ['admin', 'operaciones'].includes(ctx.perfil.rol) ? '<button type="button" class="btn sm" id="tbPrin">Hacer tablero principal</button>' : ''}
      ${puedeBorrar && otros.length ? '<button type="button" class="btn sm danger" id="tbDel">Borrar tablero</button>' : ''}</div>
      <p class="muted small" style="margin-bottom:0">${board.predeterminado ? '★ Es el tablero principal: aquí llegan las tareas automáticas (renovaciones, cobranza) y las que se crean desde otras pantallas.' : 'Las tareas automáticas llegan al tablero principal (★).'}${!puedeBorrar ? ' Solo quien creó el tablero o un administrador puede borrarlo.' : ''}</p>` : ''}`,
    onOpen: f => {
      f.querySelector('#tbPrin')?.addEventListener('click', async () => {
        const { error } = await sb.rpc('tablero_predeterminado', { p_tablero: board.id });
        if (error) return toast(error.message, true);
        document.getElementById('modal').close(); toast('Ahora es el tablero principal.'); refrescar();
      });
      f.querySelector('#tbDel')?.addEventListener('click', () => borrarTablero(board, otros));
    },
    onSubmit: async d => {
      const fila0 = { nombre: txt(d.nombre), descripcion: txt(d.descripcion) };
      if (board) { await q(sb.from('tableros').update(fila0).eq('id', board.id)); toast('Tablero actualizado.'); return refrescar(); }
      let base = PLANTILLAS[d.plantilla]?.[1], columnas;
      if (String(d.plantilla).startsWith('copia:')) {
        const src = tb.tableros.find(b => b.id === d.plantilla.slice(6));
        base = tb.grupos.filter(x => x.tablero_id === src?.id).map(x => [x.nombre, x.color, x.tipo]); columnas = src?.columnas;
      }
      const nuevo = await q(sb.from('tableros').insert({ ...fila0, orden: tb.tableros.length + 1, ...(columnas ? { columnas } : {}) }).select().single());
      const gs = (base?.length ? base : PLANTILLAS.blanco[1]).map(([nombre, color, tipo], i) => ({ tablero_id: nuevo.id, nombre, color, tipo, orden: i + 1 }));
      await q(sb.from('tablero_grupos').insert(gs));
      F.tablero = nuevo.id; F.agrupar = 'grupo';
      toast('Tablero creado.'); location.hash = '#/tablero?t=' + nuevo.id;
    }
  });
}
function borrarTablero(board, otros) {
  modal({
    titulo: `Borrar el tablero «${board.nombre}»`, boton: 'Borrar tablero', peligro: true,
    cuerpo: `<p style="margin-top:0">Las tareas de este tablero (abiertas y del archivo) no se borran: pasan al tablero que elija, cada una al grupo de su tipo.</p>
      ${select('Pasar las tareas a', 'destino', optsList(otros, (otros.find(b => b.predeterminado) || otros[0])?.id), { wide: true })}`,
    onSubmit: async d => {
      const { data, error } = await sb.rpc('borrar_tablero', { p_tablero: board.id, p_destino: d.destino });
      if (error) throw new Error(error.message);
      F.tablero = d.destino; toast(`Tablero borrado. ${data || 0} tareas pasaron al otro tablero.`); location.hash = '#/tablero?t=' + d.destino;
    }
  });
}
function formGrupo(board, grupos, gr) {
  const otros = grupos.filter(x => x.id !== gr?.id), i = gr ? grupos.indexOf(gr) : -1;
  const color = gr?.color || Object.keys(COLORES)[grupos.length % 16];
  modal({
    titulo: gr ? 'Editar grupo' : 'Nuevo grupo', boton: gr ? 'Guardar' : 'Agregar grupo',
    cuerpo: `<div class="form-grid">
      ${input('Nombre del grupo', 'nombre', { value: gr?.nombre || '', req: true, wide: true, attrs: 'maxlength="60" placeholder="Ej. Esperando documentos"' })}
      <fieldset class="field wide colores"><legend>Color</legend>${Object.entries(COLORES).map(([c, n]) => `<label title="${n}"><input type="radio" name="color" value="${c}"${c === color ? ' checked' : ''}><span style="background:${c}"></span><span class="sr">${n}</span></label>`).join('')}</fieldset>
      ${select('Tipo de las tareas nuevas en este grupo', 'tipo', `<option value="">— Se detecta por el nombre de la tarea —</option>${opts(TIPOS_TAREA, gr?.tipo || '')}`, { wide: true })}
    </div>
    <p class="muted small">El tipo decide qué botones ofrece la tarea (abrir expediente de reembolso, registrar endoso, capturar la póliza emitida…).</p>
    ${gr ? `<div class="filters"><button type="button" class="btn sm" id="gUp"${i <= 0 ? ' disabled' : ''}>Subir</button><button type="button" class="btn sm" id="gDown"${i >= grupos.length - 1 ? ' disabled' : ''}>Bajar</button>
      ${otros.length ? '<button type="button" class="btn sm danger" id="gDel">Borrar grupo</button>' : ''}</div>` : ''}`,
    onOpen: f => {
      const mover = async dir => {
        const lista = [...grupos]; const j = i + dir; [lista[i], lista[j]] = [lista[j], lista[i]];
        try { for (const [k, x] of lista.entries()) if (x.orden !== k + 1) await q(sb.from('tablero_grupos').update({ orden: k + 1 }).eq('id', x.id)); }
        catch (e) { return toast(e.message, true); }
        document.getElementById('modal').close(); refrescar();
      };
      f.querySelector('#gUp')?.addEventListener('click', () => mover(-1));
      f.querySelector('#gDown')?.addEventListener('click', () => mover(1));
      f.querySelector('#gDel')?.addEventListener('click', () => modal({
        titulo: `Borrar el grupo «${gr.nombre}»`, boton: 'Borrar grupo', peligro: true,
        cuerpo: `<p style="margin-top:0">Sus tareas no se borran: pasan al grupo que elija.</p>${select('Pasar las tareas a', 'destino', optsList(otros, otros[0]?.id), { wide: true })}`,
        onSubmit: async d => { const { error } = await sb.rpc('borrar_grupo', { p_grupo: gr.id, p_destino: d.destino }); if (error) throw new Error(error.message); toast('Grupo borrado.'); refrescar(); }
      }));
    },
    onSubmit: async d => {
      const fila0 = { nombre: txt(d.nombre), color: d.color || color, tipo: d.tipo || null };
      if (gr) await q(sb.from('tablero_grupos').update(fila0).eq('id', gr.id));
      else await q(sb.from('tablero_grupos').insert({ ...fila0, tablero_id: board.id, orden: grupos.length + 1 }));
      toast(gr ? 'Grupo actualizado.' : 'Grupo agregado.'); refrescar();
    }
  });
}
const guardarColumnas = async (board, cols) => { await q(sb.from('tableros').update({ columnas: limpiarCols(cols) }).eq('id', board.id)); };
// Una columna: crear o editar (nombre, tipo, etiquetas, mover, ocultar, borrar)
function formColumna(board, colId) {
  const cols = columnasDe(board), c = colId ? cols.find(x => x.id === colId) : null, visibles = cols.filter(x => !x.oculta);
  const iv = c ? visibles.findIndex(x => x.id === c.id) : -1;
  const etiquetas = c?.opciones?.length ? c.opciones : [{ t: 'Pendiente', c: '#FDAB3D' }, { t: 'Enviado', c: '#579BFC' }, { t: 'Hecho', c: '#00875A' }];
  const filaEt = (x, k) => `<div class="et-fila" data-k="${k}"><label class="sr" for="et${k}">Etiqueta ${k + 1}</label><input id="et${k}" data-et value="${esc(x.t)}" maxlength="30">
    <label class="sr" for="ec${k}">Color</label><select id="ec${k}" data-ec style="width:auto">${Object.entries(COLORES).map(([cc, n]) => `<option value="${cc}"${cc === x.c ? ' selected' : ''}>${n}</option>`).join('')}</select>
    <span class="et-mues" style="background:${x.c}"></span><button type="button" class="linkbtn small" data-qet>Quitar</button></div>`;
  modal({
    titulo: c ? `Columna «${c.nombre}»` : 'Nueva columna', boton: c ? 'Guardar' : 'Agregar columna',
    cuerpo: `<div class="form-grid">
      ${input('Nombre de la columna', 'nombre', { value: c?.nombre || '', req: true, wide: true, attrs: 'maxlength="40" placeholder="Ej. Monto reclamado, Folio de la aseguradora…"' })}
      ${c?.fija ? `<p class="muted small wide" style="margin:0">Columna de la app${c.id === 'estatus' ? ': «Listo» manda la tarea al Archivo' : ''}. Puede renombrarla, moverla u ocultarla.</p>`
        : select('Tipo de dato', 'tipo', opts(TIPOS_COLUMNA, c?.tipo || 'texto'), { wide: true, attrs: c ? 'disabled' : '' })}
      <div class="field wide" id="etBox"${(c?.tipo || 'texto') === 'estado' && !c?.fija ? '' : ' hidden'}><span class="lbl">Etiquetas</span>
        <div id="etLista">${etiquetas.map(filaEt).join('')}</div><button type="button" class="btn sm" id="etAdd" style="margin-top:6px">+ Etiqueta</button></div>
    </div>
    ${c ? `<div class="filters" style="margin-top:14px"><button type="button" class="btn sm" id="cIzq"${iv <= 0 ? ' disabled' : ''}>← Mover a la izquierda</button><button type="button" class="btn sm" id="cDer"${iv < 0 || iv >= visibles.length - 1 ? ' disabled' : ''}>Mover a la derecha →</button>
      <button type="button" class="btn sm" id="cOcu">Ocultar</button>${c.fija ? '' : '<button type="button" class="btn sm danger" id="cDel">Borrar columna</button>'}</div>` : ''}`,
    onOpen: f => {
      const box = f.querySelector('#etBox'), lista = f.querySelector('#etLista');
      f.tipo?.addEventListener('change', () => { box.hidden = f.tipo.value !== 'estado'; });
      f.querySelector('#etAdd').onclick = () => { const k = lista.children.length; lista.insertAdjacentHTML('beforeend', filaEt({ t: '', c: Object.keys(COLORES)[k % 16] }, k)); lista.lastElementChild.querySelector('[data-et]').focus(); };
      lista.addEventListener('click', e => { if (e.target.dataset.qet != null) e.target.closest('.et-fila').remove(); });
      lista.addEventListener('change', e => { if (e.target.dataset.ec != null) e.target.closest('.et-fila').querySelector('.et-mues').style.background = e.target.value; });
      const cerrar = () => { document.getElementById('modal').close(); refrescar(); };
      const mover = async dir => { const a = cols.indexOf(c), b = cols.indexOf(visibles[iv + dir]); [cols[a], cols[b]] = [cols[b], cols[a]]; try { await guardarColumnas(board, cols); cerrar(); } catch (e) { toast(e.message, true); } };
      f.querySelector('#cIzq')?.addEventListener('click', () => mover(-1));
      f.querySelector('#cDer')?.addEventListener('click', () => mover(1));
      f.querySelector('#cOcu')?.addEventListener('click', async () => { c.oculta = true; try { await guardarColumnas(board, cols); toast('Columna oculta. Puede volver a mostrarla en «Columnas».'); cerrar(); } catch (e) { toast(e.message, true); } });
      f.querySelector('#cDel')?.addEventListener('click', async () => {
        document.getElementById('modal').close();
        if (!(await confirmar('Borrar columna', `Se borra la columna «${c.nombre}» de este tablero. Los datos capturados en ella dejan de mostrarse.`, 'Borrar'))) return formColumna(board, colId);
        try { await guardarColumnas(board, cols.filter(x => x.id !== c.id)); toast('Columna borrada.'); refrescar(); } catch (e) { toast(e.message, true); }
      });
    },
    onSubmit: async (d, f) => {
      const nombre = txt(d.nombre), tipo = c?.tipo || d.tipo || 'texto';
      const opciones = tipo === 'estado' ? [...f.querySelectorAll('.et-fila')].map(x => ({ t: x.querySelector('[data-et]').value.trim(), c: x.querySelector('[data-ec]').value })).filter(x => x.t) : undefined;
      if (tipo === 'estado' && !c?.fija && !opciones.length) throw new Error('Agregue al menos una etiqueta.');
      if (c) Object.assign(c, { nombre, ...(opciones ? { opciones } : {}) });
      else { const i = cols.findIndex(x => x.id === 'actualizado'); cols.splice(i < 0 ? cols.length : i, 0, { id: nuevoId(), nombre, tipo, ...(opciones ? { opciones } : {}) }); }
      await guardarColumnas(board, cols);
      toast(c ? 'Columna actualizada.' : 'Columna agregada.'); refrescar();
    }
  });
}
// Todas las columnas: mostrar u ocultar
function formColumnas(board) {
  const cols = columnasDe(board);
  modal({
    titulo: 'Columnas del tablero', boton: 'Guardar',
    cuerpo: `<p class="muted small" style="margin-top:0">Marque las que quiere ver. Para renombrar, mover o borrar una columna, haga clic en su título dentro del tablero.</p>
      <div class="list">${cols.map((c, i) => `<label class="li" style="justify-content:flex-start;gap:10px;cursor:pointer"><input type="checkbox" name="v${i}"${c.oculta ? '' : ' checked'} style="width:auto;min-height:0">
        <span>${esc(c.nombre)} <span class="muted small">${c.fija ? '· de la app' : '· ' + esc(TIPOS_COLUMNA[c.tipo] || 'Texto')}</span></span></label>`).join('')}</div>
      <div style="margin-top:12px"><button type="button" class="btn sm" id="cNueva">+ Nueva columna</button></div>`,
    onOpen: f => { f.querySelector('#cNueva').onclick = () => formColumna(board, null); },
    onSubmit: async d => {
      cols.forEach((c, i) => { c.oculta = !d['v' + i]; });
      await guardarColumnas(board, cols); toast('Columnas actualizadas.'); refrescar();
    }
  });
}

// ---------------------------------------------------------------- Archivo de tareas cerradas
async function vistaArchivo(main, tb, vigente) {
  const A = F.a;
  let consulta = sb.from('tareas').select('*').eq('hecha', true).order('completada_en', { ascending: false });
  if (A.desde) consulta = consulta.gte('completada_en', A.desde);
  if (A.hasta) consulta = consulta.lt('completada_en', iso(addDays(new Date(A.hasta + 'T12:00:00'), 1)));
  const [tareas, clientes, polizas] = await Promise.all([
    q(consulta.limit(1000)),
    q(sb.from('clientes').select('id,nombre')),
    q(sb.from('v_polizas').select('id,numero_poliza,aseguradora_nombre')),
  ]);
  if (!vigente()) return;
  const cli = Object.fromEntries(clientes.map(c => [c.id, c.nombre])), pol = Object.fromEntries(polizas.map(p => [p.id, p]));
  const quien = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  const tab = Object.fromEntries(tb.tableros.map(b => [b.id, b.nombre])), gru = Object.fromEntries(tb.grupos.map(g => [g.id, g]));

  main.innerHTML = `
  <header class="head"><div><h1>Tablero de trabajo</h1>
    <p class="muted" style="margin:4px 0 0">Archivo: tareas terminadas y canceladas, con quién las cerró y cuándo. Sirve para revisar qué pasó con un trámite o un cliente.</p></div>
    <div class="filters"><button class="btn" type="button" id="aExcel">Descargar Excel</button></div></header>
  ${barraTableros(tb, 'archivo', tareas.length)}
  <div class="filters">
    <label for="aq" class="sr">Buscar</label><input id="aq" class="search" type="search" placeholder="Buscar tarea, cliente o motivo" value="${esc(A.q)}">
    <label for="ap" class="sr">Persona</label><select id="ap" style="width:auto"><option value="">Todas las personas</option>${optsList(ctx.perfiles.filter(p => p.rol !== 'cliente'), A.persona)}</select>
    <label for="ar" class="sr">Resultado</label><select id="ar" style="width:auto"><option value="">Terminadas y canceladas</option>${opts({ listo: 'Solo terminadas', cancelado: 'Solo canceladas' }, A.resultado)}</select>
    <label for="at" class="sr">Tablero</label><select id="at" style="width:auto"><option value="">Todos los tableros</option>${optsList(tb.tableros, A.tablero)}</select>
    <label for="ad">Cerradas del</label><input id="ad" type="date" value="${esc(A.desde)}" style="width:auto">
    <label for="ah">al</label><input id="ah" type="date" value="${esc(A.hasta)}" style="width:auto">
  </div>
  <div id="aRes"></div>`;

  let visibles = [];
  const pintar = () => {
    const tq = norm(A.q);
    visibles = tareas.filter(t => (!A.persona || t.asignado_a === A.persona || t.cerrada_por === A.persona) && (!A.resultado || t.estatus === A.resultado)
      && (!A.tablero || t.tablero_id === A.tablero) && (!tq || norm(t.titulo).includes(tq) || norm(cli[t.cliente_id]).includes(tq) || norm(t.motivo_cierre).includes(tq) || norm(pol[t.poliza_id]?.numero_poliza).includes(tq)));
    const nL = visibles.filter(t => t.estatus === 'listo').length;
    main.querySelector('#aRes').innerHTML = `<p class="small" style="margin:0 0 8px"><b>${visibles.length}</b> tareas · ${nL} terminadas · ${visibles.length - nL} canceladas${tareas.length >= 1000 ? ' <span class="muted">(se muestran las 1,000 más recientes: use las fechas para ver otras)</span>' : ''}</p>
      ${visibles.length ? `<div class="card" style="padding:4px 0"><div class="tbl-wrap"><table>
        <thead><tr><th style="padding-left:20px">Tarea</th><th>Cliente / póliza</th><th>Tablero · grupo</th><th>Responsable</th><th>Resultado</th><th>Cerrada</th><th>Motivo o nota</th><th></th></tr></thead>
        <tbody>${visibles.slice(0, 300).map(t => `<tr>
          <td style="padding-left:20px;min-width:220px"><button type="button" class="linkbtn" data-abrir="${t.id}" style="text-align:left">${esc(t.titulo)}</button><div class="muted small">${esc(TIPOS_TAREA[t.tipo] || '')}</div></td>
          <td>${t.cliente_id ? `<a href="#/cliente/${t.cliente_id}">${esc(cli[t.cliente_id] || '')}</a>` : '<span class="muted small">—</span>'}${pol[t.poliza_id] ? `<div class="muted small">${esc(pol[t.poliza_id].numero_poliza || 's/n')}</div>` : ''}</td>
          <td class="small">${esc(tab[t.tablero_id] || '—')}${gru[t.grupo_id] ? `<div class="muted">${esc(gru[t.grupo_id].nombre)}</div>` : ''}</td>
          <td class="small">${esc(quien[t.asignado_a] || '—')}</td>
          <td>${pill(CIERRE_TAREA, t.estatus)}</td>
          <td class="small nw">${fechaHora(t.completada_en)}${t.cerrada_por ? `<div class="muted">por ${esc(quien[t.cerrada_por] || '')}</div>` : ''}</td>
          <td class="small" style="max-width:260px">${esc(t.motivo_cierre || '')}</td>
          <td><button type="button" class="btn sm" data-reabrir="${t.id}">Reabrir</button></td></tr>`).join('')}</tbody></table></div></div>
        ${visibles.length > 300 ? `<p class="muted small">Se muestran 300 de ${visibles.length}. Use la búsqueda o las fechas, o descargue el Excel con todas.</p>` : ''}`
      : '<div class="card empty">No hay tareas cerradas con estos filtros.</div>'}`;
  };
  pintar();
  const f = (id, k, ev = 'onchange', recargar = false) => { main.querySelector(id)[ev] = e => { A[k] = e.target.value; recargar ? refrescar() : pintar(); }; };
  f('#aq', 'q', 'oninput'); f('#ap', 'persona'); f('#ar', 'resultado'); f('#at', 'tablero'); f('#ad', 'desde', 'onchange', true); f('#ah', 'hasta', 'onchange', true);
  conectarBarra(main, tb);
  main.querySelector('#aRes').addEventListener('click', async e => {
    const a = e.target.closest('[data-abrir]'); if (a) return verTarea(a.dataset.abrir, refrescar);
    const r = e.target.closest('[data-reabrir]'); if (!r) return;
    try {
      await q(sb.from('tareas').update({ estatus: 'en_proceso' }).eq('id', r.dataset.reabrir));
      await q(sb.from('tarea_comentarios').insert({ tarea_id: r.dataset.reabrir, texto: 'Tarea reabierta desde el archivo.' }));
      toast('Tarea reabierta: regresó al tablero.'); refrescar();
    } catch (err) { toast(err.message, true); }
  });
  main.querySelector('#aExcel').onclick = async () => {
    try {
      const XLSX = await cargarSheetJS();
      const filas = [['Tarea', 'Tipo', 'Cliente', 'Póliza', 'Tablero', 'Grupo', 'Responsable', 'Resultado', 'Cerrada el', 'Cerrada por', 'Motivo o nota', 'Creada el', 'Descripción'],
        ...visibles.map(t => [t.titulo, TIPOS_TAREA[t.tipo] || '', cli[t.cliente_id] || '', pol[t.poliza_id]?.numero_poliza || '', tab[t.tablero_id] || '', gru[t.grupo_id]?.nombre || '', quien[t.asignado_a] || '',
          CIERRE_TAREA[t.estatus]?.[0] || t.estatus, t.completada_en ? new Date(t.completada_en) : '', quien[t.cerrada_por] || '', t.motivo_cierre || '', t.creado_en ? new Date(t.creado_en) : '', t.descripcion || ''])];
      const ws = XLSX.utils.aoa_to_sheet(filas, { cellDates: true });
      ws['!cols'] = [40, 14, 28, 16, 18, 18, 14, 12, 18, 14, 40, 18, 40].map(w => ({ wch: w }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Archivo de tareas');
      await descargar(`Archivo de tareas - ${ctx.agencia?.nombre || 'agencia'}.xlsx`, new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      toast('Excel generado.');
    } catch (err) { toast(err.message, true); }
  };
}

export function adivinarTipo(titulo) {
  const t = norm(titulo);
  if (/reembolso/.test(t)) return 'reembolso';
  if (/programacion|cirugia|programar/.test(t)) return 'programacion';
  if (/siniestro|choque|colision|robo/.test(t)) return 'siniestro';
  if (/endoso|alta de|baja de|cambio de/.test(t)) return 'endoso';
  if (/renovacion|renovar/.test(t)) return 'renovacion';
  if (/emision|emitir|nueva poliza/.test(t)) return 'emision';
  if (/cancelacion|cancelar/.test(t)) return 'cancelacion';
  if (/cobr|pago|recibo/.test(t)) return 'cobranza';
  if (/cotiza/.test(t)) return 'cotizacion';
  return 'otro';
}

// ---------------------------------------------------------------- Nueva / editar
export async function formTarea({ tarea, prefill = {}, alGuardar }) {
  const t = tarea || { tipo: 'reembolso', estatus: 'no_iniciado', prioridad: 'media', asignado_a: ctx.perfil.id, fecha: hoyISO(), ...prefill };
  const clientes = await q(sb.from('clientes').select('id,nombre').eq('activo', true).order('nombre'));
  const polizasDe = async cid => cid ? q(sb.from('v_polizas').select('id,numero_poliza,aseguradora_nombre,ramo,estatus').eq('cliente_id', cid).order('fin_vigencia', { ascending: false })) : [];
  const polOpts = (ps, sel) => '<option value="">— Sin póliza —</option>' + ps.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.numero_poliza || 's/n')} · ${esc(p.aseguradora_nombre)} · ${esc(RAMOS[p.ramo])}${p.estatus !== 'activa' ? ` (${p.estatus})` : ''}</option>`).join('');
  const iniciales0 = await polizasDe(t.cliente_id);
  const tb = await cargarTableros();
  const principal = tb?.tableros.find(b => b.predeterminado) || tb?.tableros[0];
  const tabSel = t.tablero_id || principal?.id;
  let grupoSel = t.grupo_id || (tb && tabSel ? grupoPara(tb.grupos, tabSel, t.tipo)?.id : null), grupoTocado = !!t.grupo_id;
  const optsGrupos = () => tb ? tb.tableros.map(b => `<optgroup label="${esc(b.nombre)}">${tb.grupos.filter(g => g.tablero_id === b.id).map(g => `<option value="${g.id}"${g.id === grupoSel ? ' selected' : ''}>${esc(g.nombre)}</option>`).join('')}</optgroup>`).join('') : '';
  modal({
    titulo: tarea ? 'Editar tarea' : 'Nueva tarea',
    cuerpo: `<div class="form-grid">
      ${input('Tarea', 'titulo', { value: t.titulo, req: true, wide: true, attrs: 'placeholder="Ej. Reembolso consulta de Maureen Riley"' })}
      ${select('Tipo', 'tipo', opts(TIPOS_TAREA, t.tipo), { req: true })}
      ${select('Responsable', 'asignado_a', optsList(ctx.perfiles.filter(p => p.activo || p.id === t.asignado_a), t.asignado_a))}
      ${select('Prioridad', 'prioridad', opts(PRIORIDADES, t.prioridad))}
      ${select('Estado', 'estatus', opts(EST_TAREA, t.estatus))}
      ${input('Fecha límite', 'fecha', { type: 'date', value: t.fecha })}
      ${input('Hora', 'hora', { type: 'time', value: t.hora ? String(t.hora).slice(0, 5) : '' })}
      ${select('Cliente', 'cliente_id', '<option value="">— Sin cliente —</option>' + optsList(clientes, t.cliente_id), { wide: true, attrs: 'data-cli' })}
      ${select('Póliza', 'poliza_id', polOpts(iniciales0, t.poliza_id), { wide: true, attrs: 'data-pol' })}
      ${tb?.grupos.length ? select('Tablero y grupo', 'grupo_id', optsGrupos(), { wide: true }) : ''}
      ${textarea('Descripción', 'descripcion', t.descripcion)}
      ${tarea ? '' : `<label class="small wide" id="ligaTr" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="crear_tramite" checked style="width:auto;min-height:0">
        Abrir también el expediente en Siniestros y reembolsos (carpeta con facturas, requisitos y formatos)</label>
      <label class="small wide" id="ligaMv" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="crear_endoso" checked style="width:auto;min-height:0">
        Registrar también el endoso en la póliza</label>`}
    </div>`,
    onOpen: f => {
      const vis = () => {
        const tp = f.tipo.value;
        f.querySelector('#ligaTr')?.toggleAttribute('hidden', !(TAREA_A_TRAMITE[tp] && f.cliente_id.value) || !!t.tramite_id);
        f.querySelector('#ligaMv')?.toggleAttribute('hidden', !(tp === 'endoso' && f.poliza_id.value) || !!t.movimiento_id);
      };
      f.cliente_id.onchange = async () => { f.poliza_id.innerHTML = polOpts(await polizasDe(f.cliente_id.value), ''); vis(); };
      // El grupo sigue al tipo mientras no se elija a mano
      const seguirTipo = () => { if (grupoTocado || !f.grupo_id || !tb) return; const tab = tb.grupos.find(g => g.id === f.grupo_id.value)?.tablero_id || tabSel; const gr = grupoPara(tb.grupos, tab, f.tipo.value); if (gr) f.grupo_id.value = gr.id; };
      if (f.grupo_id) f.grupo_id.onchange = () => { grupoTocado = true; };
      f.tipo.onchange = () => { vis(); seguirTipo(); }; f.poliza_id.onchange = vis;
      f.titulo.oninput = () => { if (!tarea) f.tipo.value = adivinarTipo(f.titulo.value) === 'otro' ? f.tipo.value : adivinarTipo(f.titulo.value); vis(); seguirTipo(); };
      vis();
    },
    onSubmit: async d => {
      const fila = { titulo: txt(d.titulo), tipo: d.tipo, asignado_a: d.asignado_a, prioridad: d.prioridad, estatus: d.estatus,
        fecha: txt(d.fecha), hora: txt(d.hora), cliente_id: d.cliente_id || null, poliza_id: d.poliza_id || null, descripcion: txt(d.descripcion) };
      if (d.grupo_id) fila.grupo_id = d.grupo_id;
      if (tarea && fila.poliza_id !== tarea.poliza_id) fila.aseguradora_id = null; // se recalcula con la póliza
      let r;
      if (tarea) r = await q(sb.from('tareas').update(fila).eq('id', tarea.id).select().single());
      else {
        if (t.origen) {   // viene de un pendiente: que no quede repetida
          const ya = await q(sb.from('tareas').select('id').eq('origen', t.origen).eq('hecha', false));
          if (ya.length) throw new Error('Este pendiente ya está en el tablero.');
          fila.origen = t.origen;
        }
        if (t.tramite_id) fila.tramite_id = t.tramite_id;
        else if (d.crear_tramite && TAREA_A_TRAMITE[d.tipo] && fila.cliente_id) {
          let tipoTr = TAREA_A_TRAMITE[d.tipo];
          if (d.tipo === 'siniestro' && fila.poliza_id) {
            const p = await q(sb.from('polizas').select('ramo').eq('id', fila.poliza_id).single());
            tipoTr = p.ramo === 'auto' ? 'siniestro_auto' : p.ramo === 'vida' ? 'siniestro_vida' : 'siniestro_danos';
          }
          const tr = await crearCarpeta({ cliente_id: fila.cliente_id, poliza_id: fila.poliza_id, tipo: tipoTr, descripcion: fila.titulo, responsable_id: fila.asignado_a });
          fila.tramite_id = tr.id;
        }
        if (t.movimiento_id) fila.movimiento_id = t.movimiento_id;
        else if (d.crear_endoso && d.tipo === 'endoso' && fila.poliza_id) {
          const mv = await q(sb.from('movimientos').insert({ poliza_id: fila.poliza_id, tipo: 'otro', descripcion: fila.titulo, fecha_efecto: fila.fecha, responsable_id: fila.asignado_a }).select().single());
          fila.movimiento_id = mv.id;
        }
        r = await q(sb.from('tareas').insert(fila).select().single());
      }
      toast(tarea ? 'Tarea actualizada.' : 'Tarea creada.');
      alGuardar?.(r);
    }
  });
}

// ---------------------------------------------------------------- Detalle con actualizaciones
export async function verTarea(id, alCambiar) {
  const t = await q(sb.from('tareas').select('*').eq('id', id).single());
  marcarLeida(id);
  const [coms, docs, c, p, tr, mv, tb] = await Promise.all([
    q(sb.from('tarea_comentarios').select('*').eq('tarea_id', id).order('creado_en', { ascending: false })),
    q(sb.from('documentos').select('*').eq('tarea_id', id).order('creado_en', { ascending: false })),
    t.cliente_id ? q(sb.from('clientes').select('id,nombre').eq('id', t.cliente_id).maybeSingle()) : null,
    t.poliza_id ? q(sb.from('v_polizas').select('*').eq('id', t.poliza_id).maybeSingle()) : null,
    t.tramite_id ? q(sb.from('tramites').select('*').eq('id', t.tramite_id).maybeSingle()) : null,
    t.movimiento_id ? q(sb.from('movimientos').select('*').eq('id', t.movimiento_id).maybeSingle()) : null,
    cargarTableros(),
  ]);
  const abierta = tareaAbierta(t), gr = tb?.grupos.find(g => g.id === t.grupo_id), tab = tb?.tableros.find(b => b.id === t.tablero_id);
  const quien = Object.fromEntries(ctx.perfiles.map(x => [x.id, x.nombre]));
  const accionLiga = () => {
    if (tr) return `<button type="button" class="btn sm" id="vTr">Ir al expediente${tr.folio ? ' (' + esc(tr.folio) + ')' : ''}</button>`;
    if (TAREA_A_TRAMITE[t.tipo] && t.cliente_id) return `<button type="button" class="btn sm" id="cTr">Abrir expediente del siniestro</button>`;
    if (t.tipo === 'emision' && t.cliente_id && !t.poliza_id) return `<button type="button" class="btn sm primary" id="emitir">Capturar la póliza emitida</button>`;
    if (t.tipo === 'renovacion' && p && p.estatus === 'activa') return `<button type="button" class="btn sm primary" id="renovar">Registrar la renovación</button>`;
    if (t.tipo === 'endoso' && p && !mv) return `<button type="button" class="btn sm" id="cMv">Registrar endoso en la póliza</button>`;
    return '';
  };
  const dlg = modal({
    titulo: t.titulo,
    cuerpo: `
      ${abierta ? '' : `<div class="small" role="status" style="margin:0 0 14px;padding:10px 12px;border-left:4px solid ${t.estatus === 'cancelado' ? 'var(--muted)' : 'var(--ok)'};background:var(--surface-2)">
        <b>${t.estatus === 'cancelado' ? 'Cancelada: no se hizo' : 'Terminada'}</b> el ${fechaHora(t.completada_en)}${t.cerrada_por ? ` por ${esc(quien[t.cerrada_por] || '')}` : ''}.${t.motivo_cierre ? ` Motivo: ${esc(t.motivo_cierre)}` : ''} Está en el Archivo.</div>`}
      <div class="chips" style="align-items:center;margin-bottom:14px">
        <span class="mcell st-${t.estatus}" style="width:auto;display:inline-flex;align-items:center;padding:0 12px">${EST_TAREA[t.estatus] || CIERRE_TAREA[t.estatus]?.[0] || t.estatus}</span>
        <span class="mcell pr-${t.prioridad}" style="width:auto;display:inline-flex;align-items:center;padding:0 12px">${PRIORIDADES[t.prioridad]}</span>
        <span class="tag">${esc(TIPOS_TAREA[t.tipo])}</span>
        ${tab ? `<span class="muted small">${esc(tab.nombre)}${gr ? ` · <span style="color:${gr.color}">●</span> ${esc(gr.nombre)}` : ''}</span>` : ''}
      </div>
      <div class="grid-info">
        <div><div class="lbl">Responsable</div><div class="val">${esc(quien[t.asignado_a] || '—')}</div></div>
        <div><div class="lbl">Fecha límite</div><div class="val">${t.fecha ? fdate(t.fecha) + (t.hora ? ' · ' + String(t.hora).slice(0, 5) : '') : '—'}</div></div>
        <div><div class="lbl">Cliente</div><div class="val">${c ? `<a href="#/cliente/${c.id}" data-close>${esc(c.nombre)}</a>` : '—'}</div></div>
        <div><div class="lbl">Póliza</div><div class="val">${p ? `${esc(p.numero_poliza || 's/n')} · ${esc(p.aseguradora_nombre)}` : '—'}</div></div>
        ${tr ? `<div><div class="lbl">Trámite</div><div class="val">${esc(tr.folio || 'Sin folio')} · ${esc(tr.estatus.replace('_', ' '))}</div></div>` : ''}
        ${mv ? `<div><div class="lbl">Endoso</div><div class="val"><a href="#/endoso/${mv.id}" data-cerrar-modal>${esc(TIPOS_MOV[mv.tipo])}</a> · ${esc(EST_MOV[mv.estatus]?.[0] || mv.estatus)}</div></div>` : ''}
        <div><div class="lbl">Creada por</div><div class="val">${esc(quien[t.creado_por] || '—')} · ${fdate(t.creado_en.slice(0, 10))}</div></div>
      </div>
      ${t.descripcion ? `<p style="white-space:pre-line">${esc(t.descripcion)}</p>` : ''}
      <div class="filters" style="margin:16px 0">
        <button type="button" class="btn sm" id="tEd">Editar</button>${accionLiga()}
        <label class="btn sm" for="tAr" style="cursor:pointer">Adjuntar archivo</label><input type="file" id="tAr" class="sr">
        ${abierta ? '<button type="button" class="btn sm" id="tX">Cancelar o borrar</button>' : '<button type="button" class="btn sm primary" id="tReab">Reabrir</button><button type="button" class="btn sm danger" id="tDel">Borrar</button>'}
      </div>
      ${docs.length ? `<h3 style="font-size:15px;margin:0 0 8px">Archivos</h3><div class="list" style="margin-bottom:16px">${docs.map(x =>
        `<div class="li"><button type="button" class="linkbtn" data-file="${esc(x.ruta)}">${esc(x.nombre_archivo)}</button><span class="muted small">${fdate(x.creado_en.slice(0, 10))}</span></div>`).join('')}</div>` : ''}
      <h3 style="font-size:15px;margin:0 0 8px">Actualizaciones</h3>
      <div style="display:flex;gap:8px;margin-bottom:12px"><label for="tCom" class="sr">Escribir actualización</label>
        <input id="tCom" placeholder="Escriba una actualización y presione Enter"><button type="button" class="btn" id="tAdd">Publicar</button></div>
      <div class="feed">${coms.map(x => `<div class="msg"><div class="muted small">${esc(quien[x.autor_id] || '')} · ${new Date(x.creado_en).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div style="white-space:pre-line;margin-top:2px">${esc(x.texto)}</div></div>`).join('') || '<div class="empty">Sin actualizaciones todavía.</div>'}</div>`
  });
  const f = dlg.querySelector('.modal-b');
  const reabrir = () => { dlg.close(); alCambiar?.(); verTarea(id, alCambiar); };
  const err = e => toast(e.message, true);
  f.querySelector('#tCom').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); f.querySelector('#tAdd').click(); } };
  f.querySelector('#tAdd').onclick = async () => {
    const v = f.querySelector('#tCom').value.trim(); if (!v) return;
    try { await q(sb.from('tarea_comentarios').insert({ tarea_id: id, texto: v })); reabrir(); } catch (e) { err(e); }
  };
  f.querySelector('#tEd').onclick = () => { dlg.close(); formTarea({ tarea: t, alGuardar: () => { alCambiar?.(); verTarea(id, alCambiar); } }); };
  f.querySelector('#tX')?.addEventListener('click', () => { dlg.close(); cerrarTarea(t, alCambiar); });
  f.querySelector('#tReab')?.addEventListener('click', async () => {
    try { await q(sb.from('tareas').update({ estatus: 'en_proceso' }).eq('id', id)); await q(sb.from('tarea_comentarios').insert({ tarea_id: id, texto: 'Tarea reabierta.' })); toast('Tarea reabierta: regresó al tablero.'); reabrir(); }
    catch (e) { err(e); }
  });
  if (f.querySelector('#tDel')) f.querySelector('#tDel').onclick = async () => {
    dlg.close();
    if (!(await confirmar('Borrar tarea', `Se borrará "${t.titulo}" con sus actualizaciones. El trámite o endoso ligado se conserva.`, 'Borrar'))) return verTarea(id, alCambiar);
    try { await q(sb.from('tareas').delete().eq('id', id)); toast('Tarea borrada.'); alCambiar?.(); } catch (e) { err(e); }
  };
  f.querySelector('#tAr').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const ruta = await subirArchivo(file, t.cliente_id || 'tareas', 'tareas');
      await q(sb.from('documentos').insert({ cliente_id: t.cliente_id, poliza_id: t.poliza_id, tramite_id: t.tramite_id, tarea_id: id, tipo: 'otro', nombre_archivo: file.name, ruta }));
      toast('Archivo adjunto.'); reabrir();
    } catch (e2) { err(e2); }
  };
  f.querySelectorAll('[data-file]').forEach(b => b.onclick = () => abrirArchivo(b.dataset.file));
  f.querySelector('#vTr')?.addEventListener('click', () => { dlg.close(); verTramite(tr.id, alCambiar); });
  f.querySelector('#cTr')?.addEventListener('click', async () => {
    try {
      const nuevo = await crearCarpeta({ cliente_id: t.cliente_id, poliza_id: t.poliza_id, tipo: TAREA_A_TRAMITE[t.tipo], descripcion: t.titulo, responsable_id: t.asignado_a });
      await q(sb.from('tareas').update({ tramite_id: nuevo.id }).eq('id', id)); toast('Trámite registrado y ligado.'); reabrir();
    } catch (e) { err(e); }
  });
  f.querySelector('#cMv')?.addEventListener('click', async () => {
    try {
      const nuevo = await q(sb.from('movimientos').insert({ poliza_id: t.poliza_id, tipo: 'otro', descripcion: t.titulo, fecha_efecto: t.fecha }).select().single());
      await q(sb.from('tareas').update({ movimiento_id: nuevo.id }).eq('id', id)); toast('Endoso registrado en la póliza.'); reabrir();
    } catch (e) { err(e); }
  });
  f.querySelector('#emitir')?.addEventListener('click', () => {
    dlg.close();
    formPoliza({ clienteId: t.cliente_id, modo: 'nueva', alGuardar: async nueva => {
      await q(sb.from('tareas').update({ poliza_id: nueva.id, estatus: 'listo' }).eq('id', id));
      await q(sb.from('tarea_comentarios').insert({ tarea_id: id, texto: `Póliza ${nueva.numero_poliza || ''} capturada; tarea terminada.` }));
      alCambiar?.(); verTarea(id, alCambiar);
    } });
  });
  f.querySelector('#renovar')?.addEventListener('click', async () => {
    dlg.close();
    const original = await q(sb.from('polizas').select('*').eq('id', t.poliza_id).single());
    formPoliza({ poliza: original, modo: 'renovar', alGuardar: async nueva => {
      await q(sb.from('tareas').update({ poliza_id: nueva.id, estatus: 'listo' }).eq('id', id));
      await q(sb.from('tarea_comentarios').insert({ tarea_id: id, texto: `Renovación registrada: póliza ${nueva.numero_poliza || ''}.` }));
      alCambiar?.(); verTarea(id, alCambiar);
    } });
  });
  // Los enlaces al cliente cierran el detalle
  f.querySelectorAll('a[data-close]').forEach(a => a.addEventListener('click', () => dlg.close()));
}

// ---------------------------------------------------------------- Importar desde Monday
export async function importarMonday(alTerminar, tableroId = null) {
  const tb = await cargarTableros();
  const [clientes, polizas] = await Promise.all([
    q(sb.from('clientes').select('id,nombre')),
    q(sb.from('v_polizas').select('id,cliente_id,aseguradora_id,aseguradora_nombre,estatus')),
  ]);
  let filas = [];
  const COLS = { titulo: ['name', 'nombre', 'tarea', 'elemento', 'item'], aseguradora: ['aseguradora'], responsable: ['responsable', 'persona', 'person', 'owner'],
    descripcion: ['descripcion', 'description'], prioridad: ['prioridad', 'priority'], fecha: ['fecha', 'date', 'fecha limite'], estado: ['estado', 'status'] };
  const mapEstado = v => { const t = norm(v); return /procesad|list|hech|done|termin|complet/.test(t) ? 'listo' : /deten|stuck|bloque/.test(t) ? 'detenido' : /proceso|working|curso/.test(t) ? 'en_proceso' : 'no_iniciado'; };
  const mapPri = v => { const t = norm(v); return /urgent|critic/.test(t) ? 'urgente' : /alta|high/.test(t) ? 'alta' : /baja|low/.test(t) ? 'baja' : 'media'; };
  const buscarCliente = titulo => {
    const t = norm(titulo);
    let mejor = null;
    clientes.forEach(c => {
      const partes = norm(c.nombre).split(' ').filter(x => x.length > 2);
      const coinciden = partes.filter(x => t.includes(x)).length;
      if (coinciden >= Math.min(2, partes.length) && (!mejor || coinciden > mejor.n)) mejor = { c, n: coinciden };
    });
    return mejor?.c || null;
  };
  const buscarPersona = v => { const t = norm(v); if (!t) return null; return ctx.perfiles.find(p => norm(p.nombre) === t || t.includes(norm(p.nombre)) || norm(iniciales(p.nombre)) === t) || null; };
  const leerFecha = v => { if (!v) return null; if (v instanceof Date) return iso(v); const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };

  modal({
    titulo: 'Importar tareas desde Monday', boton: 'Importar',
    cuerpo: `<p style="margin-top:0">En Monday abra el tablero, menú <b>⋯</b> del tablero → <b>Exportar tablero a Excel</b>. Suba aquí ese archivo (o guárdelo como CSV).</p>
      <p class="muted small">Leo las columnas Tarea/Nombre, Aseguradora, Responsable, Descripción, Prioridad, Fecha y Estado. El tipo (reembolso, programación, endoso…) se detecta por el nombre de la tarea, y el cliente se liga cuando su nombre aparece en la tarea.</p>
      <div class="field"><label for="mF">Archivo</label><input id="mF" type="file" accept=".xlsx,.xls,.csv"></div>
      <div id="mPrev" style="margin-top:14px"></div>`,
    onOpen: f => {
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      f.querySelector('#mF').onchange = async e => {
        const prev = f.querySelector('#mPrev'); prev.innerHTML = '<p class="muted">Leyendo…</p>'; btn.disabled = true;
        try {
          const crudas = await leerArchivo(e.target.files[0]);
          const iEnc = crudas.findIndex(r => r.some(x => COLS.titulo.includes(norm(x))));
          if (iEnc < 0) throw new Error('No encontré la columna con el nombre de la tarea ("Name", "Nombre" o "Tarea").');
          const enc = crudas[iEnc].map(norm), idx = {};
          Object.entries(COLS).forEach(([k, al]) => { const i = enc.findIndex(x => al.includes(x)); if (i >= 0) idx[k] = i; });
          const v = (r, k) => idx[k] != null ? r[idx[k]] : '';
          filas = crudas.slice(iEnc + 1)
            .filter(r => String(v(r, 'titulo') || '').trim() && r.filter(x => String(x).trim()).length > 1 && !COLS.titulo.includes(norm(v(r, 'titulo'))))
            .map(r => {
              const titulo = String(v(r, 'titulo')).trim(), cliente = buscarCliente(titulo);
              const asegTxt = String(v(r, 'aseguradora') || '').trim();
              const aseg = ctx.aseguradoras.find(a => norm(a.nombre) === norm(asegTxt) || norm(a.nombre).replace(/\s/g, '') === norm(asegTxt).replace(/\s/g, ''));
              const polizasCli = cliente ? polizas.filter(p => p.cliente_id === cliente.id && (!aseg || p.aseguradora_id === aseg.id)) : [];
              const poliza = polizasCli.find(p => p.estatus === 'activa') || polizasCli[0];
              return { titulo, tipo: adivinarTipo(titulo), cliente, poliza, aseg, asegTxt, resp: buscarPersona(v(r, 'responsable')),
                descripcion: String(v(r, 'descripcion') || '').trim() || null, prioridad: mapPri(v(r, 'prioridad')), estatus: mapEstado(v(r, 'estado')), fecha: leerFecha(v(r, 'fecha')) };
            });
          if (!filas.length) throw new Error('El archivo no tiene tareas.');
          prev.innerHTML = `<div class="chips"><span class="pill p-ok">${filas.length} tareas</span><span class="pill p-blue">${filas.filter(x => x.cliente).length} ligadas a un cliente</span>
            ${filas.some(x => !x.cliente) ? `<span class="pill p-warn">${filas.filter(x => !x.cliente).length} sin cliente (podrá ligarlas después)</span>` : ''}</div>
            <div class="tbl-wrap" style="margin-top:12px;max-height:320px;overflow:auto"><table><thead><tr><th>Tarea</th><th>Tipo</th><th>Cliente detectado</th><th>Aseguradora</th><th>Estado</th></tr></thead>
            <tbody>${filas.map(x => `<tr><td>${esc(x.titulo)}</td><td>${esc(TIPOS_TAREA[x.tipo])}</td><td>${x.cliente ? esc(x.cliente.nombre) : '<span class="muted">—</span>'}</td>
              <td>${x.aseg ? esc(x.aseg.nombre) : x.asegTxt ? `<span class="muted">${esc(x.asegTxt)} (no está en el catálogo)</span>` : '—'}</td>
              <td><span class="mcell st-${x.estatus}" style="display:inline-block;width:auto;padding:4px 10px">${EST_TAREA[x.estatus]}</span></td></tr>`).join('')}</tbody></table></div>`;
          btn.disabled = false;
        } catch (e2) { prev.innerHTML = `<p class="error">${esc(e2.message)}</p>`; }
      };
    },
    onSubmit: async () => {
      let n = 0;
      for (const x of filas) {
        await q(sb.from('tareas').insert({ titulo: x.titulo, tipo: x.tipo, estatus: x.estatus, prioridad: x.prioridad, fecha: x.fecha,
          descripcion: [x.descripcion, x.aseg || !x.asegTxt ? null : 'Aseguradora en Monday: ' + x.asegTxt].filter(Boolean).join('\n') || null,
          ...(tb && tableroId ? { grupo_id: grupoPara(tb.grupos, tableroId, x.tipo)?.id || null } : {}),
          asignado_a: x.resp?.id || ctx.perfil.id, cliente_id: x.cliente?.id || null, poliza_id: x.poliza?.id || null, aseguradora_id: x.aseg?.id || null }));
        n++;
      }
      toast(`${n} tareas importadas.`); alTerminar?.();
    }
  });
}
