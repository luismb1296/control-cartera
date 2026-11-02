// Tablero de trabajo (estilo Monday): tareas ligadas a clientes, pólizas, trámites y endosos
import { sb, ctx, q, puedeAdministrar } from '../db.js';
import {
  esc, fdate, fdia, hoyISO, iso, addDays, hoy, modal, input, select, textarea, opts, optsList, toast, txt, diasDesde, iniciales, confirmar,
  RAMOS, TIPOS_TAREA, EST_TAREA, PRIORIDADES, TAREA_A_TRAMITE, TIPOS_MOV
} from '../ui.js';
import { formPoliza, subirArchivo, abrirArchivo } from './formas.js';
import { verTramite, crearCarpeta } from './tramites.js';
import { leerArchivo, norm } from './importar.js';
import { refrescar } from '../app.js';

const ICO_COM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const ICO_CLIP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:-2px"><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>';

// Filtros que se conservan al navegar
const F = { q: '', persona: '', tipo: '', estatus: '', agrupar: 'tipo', terminadas: false, cerrados: new Set() };

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

export async function vistaTablero(main, _p, vigente) {
  const [tareas, comentarios, docs, clientes, polizas, lecturas] = await Promise.all([
    q(sb.from('tareas').select('*').order('creado_en')),
    q(sb.from('tarea_comentarios').select('tarea_id,autor_id,creado_en')),
    q(sb.from('documentos').select('tarea_id').not('tarea_id', 'is', null)),
    q(sb.from('clientes').select('id,nombre')),
    q(sb.from('v_polizas').select('id,numero_poliza,aseguradora_nombre,ramo')),
    q(sb.from('tarea_lecturas').select('tarea_id,visto_en')),
  ]);
  if (!vigente()) return;
  const nCom = {}, nDoc = {}, nuevos = sinLeer(comentarios, lecturas);
  comentarios.forEach(c => { nCom[c.tarea_id] = (nCom[c.tarea_id] || 0) + 1; });
  docs.forEach(d => { if (d.tarea_id) nDoc[d.tarea_id] = (nDoc[d.tarea_id] || 0) + 1; });
  const cli = Object.fromEntries(clientes.map(c => [c.id, c.nombre]));
  const pol = Object.fromEntries(polizas.map(p => [p.id, p]));
  const aseg = Object.fromEntries(ctx.aseguradoras.map(a => [a.id, a.nombre]));
  const persona = Object.fromEntries(ctx.perfiles.map(p => [p.id, p]));
  const h = hoyISO();
  const abiertas = tareas.filter(t => t.estatus !== 'listo');

  main.innerHTML = `
  <header class="head"><div><h1>Tablero de trabajo</h1>
    <p class="muted" style="margin:4px 0 0">${abiertas.length} tareas abiertas · ${abiertas.filter(t => t.fecha && t.fecha < h).length} atrasadas · ${abiertas.filter(t => t.estatus === 'detenido').length} detenidas</p></div>
    <div class="filters"><button class="btn" type="button" id="impMonday">Importar de Monday</button>
    <button class="btn primary" type="button" id="nueva">+ Nueva tarea</button></div></header>
  <div class="filters">
    <label for="bq" class="sr">Buscar</label><input id="bq" class="search" type="search" placeholder="Buscar tarea o cliente" value="${esc(F.q)}">
    <label for="fp" class="sr">Persona</label><select id="fp" style="width:auto"><option value="">Todas las personas</option>${optsList(ctx.perfiles, F.persona)}</select>
    <label for="ft" class="sr">Tipo</label><select id="ft" style="width:auto"><option value="">Todos los tipos</option>${opts(TIPOS_TAREA, F.tipo)}</select>
    <label for="fe" class="sr">Estado</label><select id="fe" style="width:auto"><option value="">Todos los estados</option>${opts(EST_TAREA, F.estatus)}</select>
    <label for="fg">Agrupar por</label><select id="fg" style="width:auto">${opts({ tipo: 'Tipo', estatus: 'Estado', asignado_a: 'Responsable', aseguradora_id: 'Aseguradora', fecha: 'Fecha', ninguno: 'Sin agrupar' }, F.agrupar)}</select>
    <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fl" ${F.terminadas ? 'checked' : ''} style="width:auto;min-height:0"> Mostrar terminadas</label>
  </div>
  <div class="col" id="grupos"></div>`;

  const grupoDe = t => {
    if (F.agrupar === 'fecha') return !t.fecha ? 'sin' : t.fecha < h ? 'atrasada' : t.fecha === h ? 'hoy' : t.fecha <= iso(addDays(hoy(), 7)) ? 'semana' : 'despues';
    if (F.agrupar === 'ninguno') return 'todas';
    return t[F.agrupar] || 'sin';
  };
  const nombreGrupo = k => ({
    tipo: () => TIPOS_TAREA[k] || 'Sin tipo', estatus: () => EST_TAREA[k], asignado_a: () => persona[k]?.nombre || 'Sin responsable',
    aseguradora_id: () => aseg[k] || 'Sin aseguradora', ninguno: () => 'Todas las tareas',
    fecha: () => ({ atrasada: 'Atrasadas', hoy: 'Hoy', semana: 'Próximos 7 días', despues: 'Más adelante', sin: 'Sin fecha' })[k],
  })[F.agrupar]();
  const ordenGrupos = () => ({
    tipo: Object.keys(TIPOS_TAREA), estatus: Object.keys(EST_TAREA), asignado_a: [...ctx.perfiles.map(p => p.id), 'sin'],
    aseguradora_id: [...ctx.aseguradoras.map(a => a.id), 'sin'], fecha: ['atrasada', 'hoy', 'semana', 'despues', 'sin'], ninguno: ['todas'],
  })[F.agrupar];

  const fila = t => {
    const p = pol[t.poliza_id], resp = persona[t.asignado_a], tarde = t.estatus !== 'listo' && t.fecha && t.fecha < h;
    return `<tr data-id="${t.id}">
      <td style="min-width:260px"><div class="titulo"><button type="button" class="tt" data-abrir="${t.id}">${esc(t.titulo)}</button>
        <span class="nw" style="display:flex;gap:6px;align-items:center">${nDoc[t.id] ? `<span class="small muted" title="Archivos">${ICO_CLIP}${nDoc[t.id]}</span>` : ''}
        <button type="button" class="upd${nCom[t.id] ? ' on' : ''}${nuevos[t.id] ? ' nuevo' : ''}" data-abrir="${t.id}" aria-label="Actualizaciones de ${esc(t.titulo)}${nuevos[t.id] ? ` (${nuevos[t.id]} sin leer)` : ''}">${ICO_COM}${nCom[t.id] || ''}</button></span></div>
        ${t.origen && !t.creado_por ? '<span class="auto-tag" title="La creó la app a partir de un pendiente">Automática</span>' : ''}</td>
      <td style="min-width:170px">${t.cliente_id ? `<a href="#/cliente/${t.cliente_id}">${esc(cli[t.cliente_id] || '')}</a>` : '<span class="muted small">Sin cliente</span>'}
        ${p ? `<div class="muted small">${esc(p.numero_poliza || 's/n')}</div>` : ''}</td>
      <td class="nw" style="text-align:center">${t.aseguradora_id ? `<span class="tag">${esc(aseg[t.aseguradora_id] || '')}</span>` : ''}</td>
      <td style="width:150px"><label class="sr" for="r${t.id}">Responsable</label><select id="r${t.id}" class="cell-in" data-campo="asignado_a">${optsList(ctx.perfiles.filter(x => x.activo || x.id === t.asignado_a), t.asignado_a, x => x.nombre)}</select></td>
      <td style="width:118px"><label class="sr" for="p${t.id}">Prioridad</label><select id="p${t.id}" class="mcell pr-${t.prioridad}" data-campo="prioridad">${opts(PRIORIDADES, t.prioridad)}</select></td>
      <td style="width:150px"><label class="sr" for="f${t.id}">Fecha</label><input id="f${t.id}" type="date" class="cell-in" data-campo="fecha" value="${esc(t.fecha || '')}" style="${tarde ? 'color:var(--bad);font-weight:600' : ''}"></td>
      <td style="width:132px"><label class="sr" for="e${t.id}">Estado</label><select id="e${t.id}" class="mcell st-${t.estatus}" data-campo="estatus">${opts(EST_TAREA, t.estatus)}</select></td>
      <td class="nw small" style="width:160px"><span class="avatar" style="width:24px;height:24px;font-size:10px;display:inline-flex;vertical-align:middle;margin-right:6px">${esc(iniciales(resp?.nombre))}</span>${hace(t.actualizado_en)}</td>
    </tr>`;
  };

  const pintar = () => {
    const tq = norm(F.q);
    const vis = tareas.filter(t => (F.terminadas || t.estatus !== 'listo' || F.estatus === 'listo') && (!F.persona || t.asignado_a === F.persona)
      && (!F.tipo || t.tipo === F.tipo) && (!F.estatus || t.estatus === F.estatus)
      && (!tq || norm(t.titulo).includes(tq) || norm(cli[t.cliente_id]).includes(tq)));
    const grupos = {};
    vis.forEach(t => (grupos[grupoDe(t)] ||= []).push(t));
    const orden = ordenGrupos().filter(k => grupos[k]?.length || (F.agrupar === 'tipo' && ['emision', 'renovacion', 'reembolso', 'programacion', 'endoso'].includes(k)));
    main.querySelector('#grupos').innerHTML = orden.map(k => {
      const lista = (grupos[k] || []).sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));
      const cerrado = F.cerrados.has(F.agrupar + k);
      return `<section class="board-group" style="border-left-color:${colorGrupo(k)}">
        <header><button type="button" data-toggle="${esc(k)}" aria-expanded="${!cerrado}">${cerrado ? '▸' : '▾'} ${esc(nombreGrupo(k))}</button><span class="muted small">${lista.length} tareas</span></header>
        ${cerrado ? '' : `<div class="tbl-wrap"><table class="board">
          <thead><tr><th>Tarea</th><th>Cliente / póliza</th><th>Aseguradora</th><th>Responsable</th><th>Prioridad</th><th>Fecha</th><th>Estado</th><th>Última actualización</th></tr></thead>
          <tbody>${lista.map(fila).join('')}
            <tr class="addrow"><td colspan="8"><label class="sr" for="add${esc(k)}">Agregar tarea</label><input id="add${esc(k)}" data-add="${esc(k)}" placeholder="+ Agregar tarea (escriba y presione Enter)"></td></tr>
          </tbody></table></div>`}
      </section>`;
    }).join('') || '<div class="card empty">No hay tareas con estos filtros.</div>';
  };
  const colorGrupo = k => ({ emision: '#00875A', renovacion: '#5559DF', reembolso: '#FDAB3D', programacion: '#D83A52', siniestro: '#401694', endoso: '#579BFC',
    listo: '#00875A', en_proceso: '#FDAB3D', detenido: '#D83A52', no_iniciado: '#9AA0A8', atrasada: '#D83A52', hoy: '#FDAB3D' })[k] || 'var(--accent)';
  pintar();

  // Filtros
  const filtro = (id, k, ev = 'onchange') => { main.querySelector(id)[ev] = e => { F[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; pintar(); }; };
  filtro('#bq', 'q', 'oninput'); filtro('#fp', 'persona'); filtro('#ft', 'tipo'); filtro('#fe', 'estatus'); filtro('#fg', 'agrupar'); filtro('#fl', 'terminadas');

  const g = main.querySelector('#grupos');
  // Edición directa en la tabla
  g.addEventListener('change', async e => {
    const campo = e.target.dataset.campo; if (!campo) return;
    const id = e.target.closest('tr').dataset.id, t = tareas.find(x => x.id === id);
    const valor = e.target.value || null;
    try {
      const r = await q(sb.from('tareas').update({ [campo]: valor }).eq('id', id).select().single());
      Object.assign(t, r);
      if (campo === 'estatus' && valor === 'listo') toast('Tarea terminada.');
      pintar();
    } catch (err) { toast(err.message, true); pintar(); }
  });
  g.addEventListener('click', e => {
    const b = e.target.closest('[data-abrir],[data-toggle]'); if (!b) return;
    if (b.dataset.abrir) verTarea(b.dataset.abrir, refrescar);
    if (b.dataset.toggle != null) { const k = F.agrupar + b.dataset.toggle; F.cerrados.has(k) ? F.cerrados.delete(k) : F.cerrados.add(k); pintar(); }
  });
  // Alta rápida dentro del grupo
  g.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !e.target.dataset.add) return;
    const titulo = e.target.value.trim(); if (!titulo) return;
    const k = e.target.dataset.add, fila = { titulo, asignado_a: F.persona || ctx.perfil.id };
    if (F.agrupar === 'tipo' && k !== 'sin') fila.tipo = k;
    if (F.agrupar === 'estatus') fila.estatus = k;
    if (F.agrupar === 'asignado_a' && k !== 'sin') fila.asignado_a = k;
    if (F.agrupar === 'aseguradora_id' && k !== 'sin') fila.aseguradora_id = k;
    if (F.agrupar === 'fecha') fila.fecha = k === 'hoy' ? h : k === 'atrasada' ? iso(addDays(hoy(), -1)) : k === 'semana' ? iso(addDays(hoy(), 3)) : k === 'despues' ? iso(addDays(hoy(), 14)) : null;
    if (!fila.tipo) fila.tipo = adivinarTipo(titulo);
    try {
      const r = await q(sb.from('tareas').insert(fila).select().single());
      tareas.push(r); pintar(); main.querySelector(`[data-add="${CSS.escape(k)}"]`)?.focus();
      toast('Tarea agregada. Ábrala para ligar cliente y póliza.');
    } catch (err) { toast(err.message, true); }
  });
  main.querySelector('#nueva').onclick = () => formTarea({ alGuardar: t => verTarea(t.id, refrescar) });
  main.querySelector('#impMonday').onclick = () => importarMonday(refrescar);
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
      f.tipo.onchange = vis; f.poliza_id.onchange = vis;
      f.titulo.oninput = () => { if (!tarea) f.tipo.value = adivinarTipo(f.titulo.value) === 'otro' ? f.tipo.value : adivinarTipo(f.titulo.value); vis(); };
      vis();
    },
    onSubmit: async d => {
      const fila = { titulo: txt(d.titulo), tipo: d.tipo, asignado_a: d.asignado_a, prioridad: d.prioridad, estatus: d.estatus,
        fecha: txt(d.fecha), hora: txt(d.hora), cliente_id: d.cliente_id || null, poliza_id: d.poliza_id || null, descripcion: txt(d.descripcion) };
      if (tarea && fila.poliza_id !== tarea.poliza_id) fila.aseguradora_id = null; // se recalcula con la póliza
      let r;
      if (tarea) r = await q(sb.from('tareas').update(fila).eq('id', tarea.id).select().single());
      else {
        if (t.origen) {   // viene de un pendiente: que no quede repetida
          const ya = await q(sb.from('tareas').select('id').eq('origen', t.origen).neq('estatus', 'listo'));
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
  const [coms, docs, c, p, tr, mv] = await Promise.all([
    q(sb.from('tarea_comentarios').select('*').eq('tarea_id', id).order('creado_en', { ascending: false })),
    q(sb.from('documentos').select('*').eq('tarea_id', id).order('creado_en', { ascending: false })),
    t.cliente_id ? q(sb.from('clientes').select('id,nombre').eq('id', t.cliente_id).maybeSingle()) : null,
    t.poliza_id ? q(sb.from('v_polizas').select('*').eq('id', t.poliza_id).maybeSingle()) : null,
    t.tramite_id ? q(sb.from('tramites').select('*').eq('id', t.tramite_id).maybeSingle()) : null,
    t.movimiento_id ? q(sb.from('movimientos').select('*').eq('id', t.movimiento_id).maybeSingle()) : null,
  ]);
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
      <div class="chips" style="align-items:center;margin-bottom:14px">
        <span class="mcell st-${t.estatus}" style="width:auto;display:inline-flex;align-items:center;padding:0 12px">${EST_TAREA[t.estatus]}</span>
        <span class="mcell pr-${t.prioridad}" style="width:auto;display:inline-flex;align-items:center;padding:0 12px">${PRIORIDADES[t.prioridad]}</span>
        <span class="tag">${esc(TIPOS_TAREA[t.tipo])}</span>
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
        <button type="button" class="btn sm danger" id="tDel">Borrar</button>
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
  f.querySelector('#tDel').onclick = async () => {
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
export async function importarMonday(alTerminar) {
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
          asignado_a: x.resp?.id || ctx.perfil.id, cliente_id: x.cliente?.id || null, poliza_id: x.poliza?.id || null, aseguradora_id: x.aseg?.id || null }));
        n++;
      }
      toast(`${n} tareas importadas.`); alTerminar?.();
    }
  });
}
