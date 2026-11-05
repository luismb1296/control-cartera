import { sb, ctx, q, aPesos } from '../db.js';
import {
  esc, money, moneyShort, fdateShort, fdia, hoy, hoyISO, iso, addDays, addMonths, parseD, sum, pill,
  RAMOS, SEGUIMIENTO, MESES_LARGOS, proximoCumple, waLink, toast
, numRecibo } from '../ui.js';
import { formPoliza, formCliente, marcarNoRenueva } from './formas.js';
import { enviarMensaje } from './mensajes.js';
import { calcularPendientes } from './pendientes.js';
import { refrescar } from '../app.js';

const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export async function vistaInicio(main, _p, vigente) {
  const h = hoy();
  const iniMes = iso(new Date(h.getFullYear(), h.getMonth(), 1));
  const finMes = iso(new Date(h.getFullYear(), h.getMonth() + 1, 0));
  const hace6 = iso(new Date(h.getFullYear(), h.getMonth() - 5, 1));

  const [activas, vencidos, delMes, clientes, recientes] = await Promise.all([
    q(sb.from('v_polizas').select('id,cliente_id,cliente_nombre,aseguradora_nombre,ramo,numero_poliza,fin_vigencia,prima_total,moneda,situacion,dias_para_vencer,seguimiento').eq('estatus', 'activa')),
    q(sb.from('v_recibos').select('*').eq('situacion', 'vencido').order('fecha_limite')),
    q(sb.from('v_recibos').select('comision_esperada,comision_recibida,estatus').gte('inicio_periodo', iniMes).lte('inicio_periodo', finMes)),
    q(sb.from('clientes').select('id,nombre,fecha_nacimiento,whatsapp,telefono,email,tipo_persona').eq('activo', true)),
    q(sb.from('polizas').select('inicio_vigencia,prima_total,poliza_anterior_id,moneda').gte('inicio_vigencia', hace6).lte('inicio_vigencia', finMes)),
  ]);
  const pend = await calcularPendientes();
  if (!vigente()) return;

  const vigentes = activas.filter(p => p.dias_para_vencer >= 0);
  const mxn = vigentes.map(aPesos), otraMoneda = vigentes.filter(p => p.moneda !== 'MXN').length;
  const clientesConPoliza = new Set(vigentes.map(p => p.cliente_id)).size;
  const porRenovar = d => activas.filter(p => p.dias_para_vencer >= 0 && p.dias_para_vencer <= d && p.seguimiento !== 'no_renueva').sort((a, b) => a.dias_para_vencer - b.dias_para_vencer);
  const ren30 = porRenovar(30);
  const comEsp = sum(delMes.filter(r => r.estatus !== 'cancelado'), r => r.comision_esperada);
  const comRec = sum(delMes, r => r.comision_recibida);
  const pct = comEsp ? Math.min(100, Math.round(comRec / comEsp * 100)) : 0;

  // Cumpleaños en los próximos 7 días
  const lim = addDays(h, 7);
  const cumples = clientes.filter(c => c.tipo_persona === 'fisica' && c.fecha_nacimiento)
    .map(c => ({ ...c, prox: proximoCumple(c.fecha_nacimiento) }))
    .filter(c => c.prox <= lim).sort((a, b) => a.prox - b.prox);

  // Prima por ramo (MXN)
  const porRamo = Object.keys(RAMOS).map(r => [r, sum(mxn.filter(p => p.ramo === r), p => p.prima_total)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const maxRamo = porRamo[0]?.[1] || 1;

  // Ventas nuevas vs renovaciones, últimos 6 meses (número de pólizas)
  const meses = [...Array(6)].map((_, i) => addMonths(new Date(h.getFullYear(), h.getMonth(), 1), i - 5));
  const serie = meses.map(m => {
    const del = recientes.filter(p => { const d = parseD(p.inicio_vigencia); return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); });
    return { m, nuevas: del.filter(p => !p.poliza_anterior_id).length, renov: del.filter(p => p.poliza_anterior_id).length };
  });
  const maxSerie = Math.max(1, ...serie.map(s => s.nuevas + s.renov));

  const hora = new Date().getHours();
  const txtSaludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
  const fechaLarga = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  main.innerHTML = `
  <header class="head">
    <div><h1>${txtSaludo}, ${esc(ctx.perfil.nombre.split(' ')[0])}</h1>
      <p class="muted" style="margin:4px 0 0">${esc(fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1))}</p></div>
    <div class="filters">
      <form id="buscar" role="search" class="buscador"><label for="bq" class="sr">Buscar</label>
        <input id="bq" class="search" type="search" placeholder="Buscar cliente, póliza o RFC"><button class="btn" type="submit">Buscar</button></form>
      <button class="btn" id="nCliente" type="button">+ Cliente</button>
      <button class="btn primary" id="nPoliza" type="button">+ Nueva póliza</button>
    </div>
  </header>

  ${sb.demo ? `<div class="demo-banner"><span><b>Prototipo con datos de ejemplo.</b> Los clientes, pólizas y montos son ficticios; puede crear, editar y borrar con libertad.</span>
    <a href="#/config">Restablecer datos</a></div>` : ''}
  ${pend.total ? `<a class="card pend-banner" href="#/pendientes"><span><b>Tiene ${pend.total} pendientes para hoy</b>
    <span class="muted">· ${pend.grupos.filter(g => !g.secundario && g.items.length).map(g => `${g.items.length} ${g.titulo.toLowerCase()}`).join(' · ')}</span></span><span>Ver pendientes</span></a>` : ''}
  <section class="kpis" aria-label="Indicadores">
    <div class="card kpi"><div class="k">Pólizas vigentes</div><div class="v">${vigentes.length}</div><div class="s">de ${clientesConPoliza} clientes</div></div>
    <div class="card kpi"><div class="k">Prima anual en cartera</div><div class="v">${moneyShort(sum(mxn, p => p.prima_total))}</div><div class="s">En pesos, prima total${otraMoneda ? ` · incluye ${otraMoneda} en dólares o UDIS al tipo de cambio de hoy` : ''}</div></div>
    <div class="card kpi warn"><div class="k">Renovaciones · 30 días</div><div class="v">${ren30.length}</div><div class="s">${money(sum(ren30.map(aPesos), p => p.prima_total))} de prima</div></div>
    <div class="card kpi bad"><div class="k">Recibos vencidos</div><div class="v">${vencidos.length}</div><div class="s">${money(sum(vencidos, r => r.prima_total))} por cobrar</div></div>
    <div class="card kpi"><div class="k">Comisión de ${MESES_LARGOS[h.getMonth()].toLowerCase()}</div><div class="v">${moneyShort(comRec)}</div>
      <div class="meter"><div style="width:${pct}%"></div></div><div class="s">${pct}% de ${money(comEsp)} esperada</div></div>
  </section>

  <section class="row">
    <div class="card" style="flex:1 1 100%">
      <div class="card-head"><h2>Próximas renovaciones</h2>
        <div class="chips" role="group" aria-label="Periodo">
          ${[30, 60, 90].map(d => `<button type="button" class="chip" data-d="${d}" aria-pressed="${d === 30}">${d} días</button>`).join('')}
        </div></div>
      <div class="tbl-wrap" id="tRen"></div>
    </div>
    <div class="duo" style="flex:1 1 100%">
      <div class="card">
        <h2 style="margin-bottom:12px">Cobranza vencida</h2>
        ${vencidos.length ? `<div class="list">${vencidos.slice(0, 5).map(r => `
          <div class="li"><div><a href="#/cliente/${r.cliente_id}">${esc(r.cliente_nombre)}</a>
            <div class="muted small">Recibo ${numRecibo(r)} · ${esc(RAMOS[r.ramo])}</div></div>
            <div class="num"><div>${money(r.prima_total)}</div><div class="small" style="color:var(--bad)">${diasDesde(r.fecha_limite)} días</div></div></div>`).join('')}
        </div>` : '<div class="empty">Sin recibos vencidos.</div>'}
        <a href="#/cobranza" style="display:inline-block;margin-top:14px">Ir a cobranza</a>
      </div>
      <div class="card">
        <h2 style="margin-bottom:12px">Cumpleaños esta semana</h2>
        ${cumples.length ? `<div class="list">${cumples.map(c => {

          const esHoy = iso(c.prox) === hoyISO();
          return `<div class="li"><span>${esHoy ? '<b>Hoy</b>' : esc(fdia(iso(c.prox)))} · <a href="#/cliente/${c.id}">${esc(c.nombre)}</a></span>
            <button type="button" class="btn sm" data-fel="${c.id}">Felicitar</button></div>`;
        }).join('')}</div>` : '<div class="empty">Nadie cumple años esta semana.</div>'}
      </div>
    </div>
  </section>

  <section class="row">
    <div class="card" style="flex:1 1 360px">
      <h2 style="margin-bottom:16px">Prima por ramo</h2>
      ${porRamo.length ? `<div class="list">${porRamo.map(([r, v]) => `
        <div><div class="li"><span>${RAMOS[r]}</span><span class="num">${moneyShort(v)}</span></div>
        <div class="bar"><div style="width:${Math.max(2, v / maxRamo * 100)}%"></div></div></div>`).join('')}</div>` : '<div class="empty">Aún no hay pólizas.</div>'}
    </div>
    <div class="card" style="flex:1 1 360px">
      <h2 style="margin-bottom:16px">Ventas nuevas vs. renovaciones</h2>
      <div class="cols" role="img" aria-label="Pólizas por mes: ${serie.map(s => `${MES_CORTO[s.m.getMonth()]} ${s.nuevas} nuevas y ${s.renov} renovaciones`).join('; ')}">
        ${serie.map(s => `<div title="${MES_CORTO[s.m.getMonth()]}: ${s.nuevas} nuevas, ${s.renov} renovaciones">
          <div style="height:${s.nuevas / maxSerie * 100}%;background:color-mix(in srgb,var(--accent) 35%,var(--surface))"></div>
          <div style="height:${s.renov / maxSerie * 100}%;background:var(--accent)"></div></div>`).join('')}
      </div>
      <div class="cols-lbl">${serie.map(s => `<span>${MES_CORTO[s.m.getMonth()]}</span>`).join('')}</div>
      <div class="filters small muted" style="margin-top:12px;gap:18px">
        <span><span class="dot" style="background:var(--accent)"></span> Renovaciones</span>
        <span><span class="dot" style="background:color-mix(in srgb,var(--accent) 35%,var(--surface))"></span> Ventas nuevas</span>
      </div>
    </div>
  </section>`;

  // Tabla de renovaciones con selector de periodo
  const pintarTabla = d => {
    const lista = porRenovar(d);
    main.querySelector('#tRen').innerHTML = lista.length ? `<table>
      <thead><tr><th>Cliente</th><th>Póliza</th><th>Vence</th><th class="num">Prima</th><th>Seguimiento</th><th></th></tr></thead>
      <tbody>${lista.slice(0, 15).map(p => `<tr>
        <td><a href="#/cliente/${p.cliente_id}">${esc(p.cliente_nombre)}</a></td>
        <td><div class="nw">${esc(p.numero_poliza || 's/n')}</div><div class="muted small">${esc(p.aseguradora_nombre)} · ${RAMOS[p.ramo]}</div></td>
        <td class="nw">${fdateShort(p.fin_vigencia)}<div class="small"><b>${p.dias_para_vencer === 0 ? 'hoy' : p.dias_para_vencer + ' días'}</b></div></td>
        <td class="num">${money(p.prima_total, p.moneda)}</td>
        <td><label class="sr" for="s${p.id}">Seguimiento</label><select id="s${p.id}" data-seg="${p.id}" style="min-height:34px;width:auto;font-size:13px">
          ${Object.entries(SEGUIMIENTO).map(([k, [t]]) => `<option value="${k}"${k === p.seguimiento ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td class="nw"><button type="button" class="btn sm" data-avi="${p.id}">Avisar</button> <button type="button" class="btn sm" data-ren="${p.id}">Renovar</button></td></tr>`).join('')}</tbody></table>
      ${lista.length > 15 ? `<a href="#/polizas" style="display:inline-block;margin-top:12px">Ver las ${lista.length} renovaciones</a>` : ''}`
      : `<div class="empty">No hay renovaciones en los próximos ${d} días.</div>`;
  };
  pintarTabla(30);
  main.querySelectorAll('.chip[data-d]').forEach(b => b.onclick = () => {
    main.querySelectorAll('.chip[data-d]').forEach(x => x.setAttribute('aria-pressed', x === b));
    pintarTabla(Number(b.dataset.d));
  });
  main.querySelector('#tRen').addEventListener('change', async e => {
    const id = e.target.dataset.seg; if (!id) return;
    const p = activas.find(x => x.id === id);
    if (e.target.value === 'no_renueva') return marcarNoRenueva(p, refrescar, () => { e.target.value = p.seguimiento; });
    try { await q(sb.from('polizas').update({ seguimiento: e.target.value }).eq('id', id)); activas.find(p => p.id === id).seguimiento = e.target.value; toast('Seguimiento actualizado.'); }
    catch (err) { toast(err.message, true); }
  });
  main.querySelector('#tRen').addEventListener('click', async e => {
    if (e.target.dataset.avi) {
      const p = activas.find(x => x.id === e.target.dataset.avi), c = clientes.find(x => x.id === p.cliente_id) || {};
      return enviarMensaje('aviso_renovacion', { nombre: p.cliente_nombre, poliza: p.numero_poliza, aseguradora: p.aseguradora_nombre, ramo: RAMOS[p.ramo].toLowerCase(), fecha: fdateShort(p.fin_vigencia) },
        { telefono: c.whatsapp || c.telefono, email: c.email });
    }
    const id = e.target.dataset.ren; if (!id) return;
    const pol = await q(sb.from('polizas').select('*').eq('id', id).single());
    formPoliza({ poliza: pol, modo: 'renovar', alGuardar: refrescar });
  });

  main.querySelectorAll('[data-fel]').forEach(b => b.onclick = () => {
    const c = clientes.find(x => x.id === b.dataset.fel);
    enviarMensaje('felicitacion', { nombre: c.nombre }, { telefono: c.whatsapp || c.telefono, email: c.email });
  });
  main.querySelector('#buscar').onsubmit = e => { e.preventDefault(); location.hash = '#/clientes?' + encodeURIComponent(main.querySelector('#bq').value); };
  main.querySelector('#nCliente').onclick = () => formCliente(null, c => { location.hash = '#/cliente/' + c.id; });
  main.querySelector('#nPoliza').onclick = () => formPoliza({ modo: 'nueva', alGuardar: refrescar });
}

function diasDesde(f) { return Math.round((hoy() - parseD(f)) / 86400000); }
