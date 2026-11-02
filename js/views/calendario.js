import { sb, ctx, q } from '../db.js';
import { esc, iso, hoy, hoyISO, addDays, parseD, fdia, MESES_LARGOS, modal, input, select, textarea, optsList, toast, txt } from '../ui.js';

const TIPOS = {
  renovacion: ['Renovaciones', 'var(--warn)', 'var(--warn-bg)'],
  pago: ['Pagos', 'var(--accent)', 'var(--accent-bg)'],
  inicio_vigencia: ['Inicios de vigencia', 'var(--ok)', 'var(--ok-bg)'],
  cumpleanos: ['Cumpleaños', 'var(--violet)', 'var(--violet-bg)'],
  tarea: ['Tareas', 'var(--gray)', 'var(--gray-bg)'],
  prospecto: ['Prospectos', 'var(--orange-ink)', 'var(--orange-bg)'],
};
let mes = null;                       // mes visible (primer día)
const apagados = new Set();           // tipos ocultos

export async function vistaCalendario(main, _p, vigente) {
  const h = hoy();
  if (!mes) mes = new Date(h.getFullYear(), h.getMonth(), 1);
  // Cuadrícula de lunes a domingo
  const inicio = addDays(mes, -((mes.getDay() + 6) % 7));
  const finMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
  const fin = addDays(finMes, 6 - ((finMes.getDay() + 6) % 7));
  const finLista = addDays(h, 7);

  const [eventos, tareas] = await Promise.all([
    q(sb.from('v_calendario').select('*').gte('fecha', iso(inicio < h ? inicio : h)).lte('fecha', iso(fin > finLista ? fin : finLista)).order('fecha')),
    q(sb.from('tareas').select('*').eq('hecha', false).lte('fecha', iso(addDays(hoy(), 14))).order('fecha')),
  ]);
  if (!vigente()) return;
  // Clientes inactivos no generan eventos de cumpleaños; los filtra la vista
  const porDia = {};
  eventos.forEach(e => (porDia[e.fecha] ||= []).push(e));

  const dias = [];
  for (let d = new Date(inicio); d <= fin; d = addDays(d, 1)) dias.push(new Date(d));

  main.innerHTML = `
  <header class="head">
    <div class="filters">
      <button type="button" class="btn" id="prev" aria-label="Mes anterior">‹</button>
      <h1 style="min-width:220px;text-align:center">${MESES_LARGOS[mes.getMonth()]} ${mes.getFullYear()}</h1>
      <button type="button" class="btn" id="next" aria-label="Mes siguiente">›</button>
      <button type="button" class="btn" id="hoy">Hoy</button>
    </div>
    <button type="button" class="btn primary" id="nTarea">+ Tarea</button>
  </header>
  <div class="chips" role="group" aria-label="Filtrar por tipo">
    ${Object.entries(TIPOS).map(([k, [t, fg]]) => `<button type="button" class="chip" data-t="${k}" aria-pressed="${!apagados.has(k)}"><span class="dot" style="background:${fg}"></span>${t}</button>`).join('')}
  </div>
  <section class="row">
    <div class="card" style="flex:3 1 640px;padding:0;overflow-x:auto">
      <div class="cal">
        <div class="cal-h">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div>${d}</div>`).join('')}</div>
        <div class="cal-g">${dias.map(d => {
          const k = iso(d);
          const evs = (porDia[k] || []).filter(e => !apagados.has(e.tipo));
          const cls = ['cal-d', d.getMonth() !== mes.getMonth() ? 'out' : '', k === hoyISO() ? 'today' : ''].join(' ');
          return `<div class="${cls}"><span class="n">${d.getDate()}</span>
            ${evs.slice(0, 4).map(e => evento(e)).join('')}
            ${evs.length > 4 ? `<div class="muted small" style="margin-top:4px">+${evs.length - 4} más</div>` : ''}</div>`;
        }).join('')}</div>
      </div>
    </div>
    <aside class="col" style="flex:1 1 280px">
      <div class="card">
        <h2 style="margin-bottom:14px">Próximos 7 días</h2>
        <div class="list">${eventos.filter(e => e.fecha >= hoyISO() && e.fecha <= iso(finLista) && !apagados.has(e.tipo)).map(e => `
          <div style="display:flex;gap:10px"><span class="dot" style="background:${TIPOS[e.tipo][1]};margin-top:5px"></span>
            <div><div class="muted small">${e.fecha === hoyISO() ? 'Hoy' : esc(fdia(e.fecha))}</div>
            <div>${e.cliente_id ? `<a href="#/cliente/${e.cliente_id}">${esc(e.titulo)}</a>` : esc(e.titulo)}</div></div></div>`).join('') || '<div class="empty">Nada en los próximos 7 días.</div>'}</div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:14px">Tareas pendientes</h2>
        <div class="list">${tareas.map(t => `
          <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" data-hecha="${t.id}" style="width:20px;min-height:20px;margin-top:2px">
            <span><span class="small ${t.fecha < hoyISO() ? '' : 'muted'}" style="${t.fecha < hoyISO() ? 'color:var(--bad)' : ''}">${t.fecha === hoyISO() ? 'Hoy' : esc(fdia(t.fecha))}</span><br>${esc(t.titulo)}</span>
          </label>`).join('') || '<div class="empty">Sin tareas pendientes.</div>'}</div>
      </div>
      <p class="muted small">Los inicios de vigencia, renovaciones, pagos y cumpleaños se agregan solos a partir de las pólizas y los clientes.</p>
    </aside>
  </section>`;

  const ir = n => { mes = new Date(mes.getFullYear(), mes.getMonth() + n, 1); vistaCalendario(main, null, vigente); };
  main.querySelector('#prev').onclick = () => ir(-1);
  main.querySelector('#next').onclick = () => ir(1);
  main.querySelector('#hoy').onclick = () => { mes = null; vistaCalendario(main, null, vigente); };
  main.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const t = b.dataset.t; apagados.has(t) ? apagados.delete(t) : apagados.add(t); vistaCalendario(main, null, vigente);
  });
  main.querySelectorAll('[data-hecha]').forEach(cb => cb.onchange = async () => {
    try { await q(sb.from('tareas').update({ hecha: true }).eq('id', cb.dataset.hecha)); toast('Tarea completada.'); vistaCalendario(main, null, vigente); }
    catch (e) { toast(e.message, true); cb.checked = false; }
  });
  main.querySelector('#nTarea').onclick = async () => {
    const clientes = await q(sb.from('clientes').select('id,nombre').eq('activo', true).order('nombre'));
    modal({
      titulo: 'Nueva tarea',
      cuerpo: `<div class="form-grid">
        ${input('¿Qué hay que hacer?', 'titulo', { req: true, wide: true })}
        ${input('Fecha', 'fecha', { type: 'date', value: hoyISO(), req: true })}
        ${select('Asignada a', 'asignado_a', optsList(ctx.perfiles.filter(p => p.activo), ctx.perfil.id))}
        ${select('Cliente (opcional)', 'cliente_id', '<option value="">— Ninguno —</option>' + optsList(clientes, ''), { wide: true })}
        ${textarea('Detalle', 'descripcion')}
      </div>`,
      onSubmit: async d => {
        await q(sb.from('tareas').insert({ titulo: txt(d.titulo), fecha: d.fecha, asignado_a: d.asignado_a, cliente_id: d.cliente_id || null, descripcion: txt(d.descripcion) }));
        toast('Tarea agregada.'); vistaCalendario(main, null, vigente);
      }
    });
  };
}

function evento(e) {
  const [, fg, bg] = TIPOS[e.tipo] || TIPOS.tarea;
  const st = `background:${bg};color:${fg}`;
  return e.cliente_id
    ? `<a class="ev" style="${st}" href="#/cliente/${e.cliente_id}" title="${esc(e.titulo)}">${esc(e.titulo)}</a>`
    : `<span class="ev" style="${st}" title="${esc(e.titulo)}">${esc(e.titulo)}</span>`;
}
