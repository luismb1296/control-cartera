import { sb, ctx, q, aPesos } from '../db.js';
import { esc, money, fdate, pill, toast, RAMOS, FORMAS, SITUACION, SEGUIMIENTO } from '../ui.js';
import { formPoliza } from './formas.js';
import { refrescar } from '../app.js';

export async function vistaPolizas(main, _p, vigente) {
  const polizas = await q(sb.from('v_polizas').select('*').order('fin_vigencia'));
  if (!vigente()) return;

  main.innerHTML = `
  <header class="head"><h1>Pólizas</h1>
    <div class="filters"><button class="btn" type="button" id="csv">Exportar a Excel (CSV)</button>
    <button class="btn primary" type="button" id="nueva">+ Nueva póliza</button></div></header>
  <div class="filters">
    <label for="bq" class="sr">Buscar</label><input id="bq" class="search" type="search" placeholder="Cliente o número de póliza">
    <label for="fs" class="sr">Situación</label><select id="fs">
      <option value="activas">Vigentes y por renovar</option><option value="por_renovar">Por renovar (30 días)</option>
      <option value="vencida">Vencidas sin renovar</option><option value="renovada">Renovadas</option>
      <option value="cancelada">Canceladas</option><option value="">Todas</option></select>
    <label for="fr" class="sr">Ramo</label><select id="fr"><option value="">Todos los ramos</option>${Object.entries(RAMOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label for="fa" class="sr">Aseguradora</label><select id="fa"><option value="">Todas las aseguradoras</option>${ctx.aseguradoras.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select>
    <label for="fg" class="sr">Agente</label><select id="fg"><option value="">Todos los agentes</option>${ctx.perfiles.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select>
  </div>
  <div class="card" style="padding:8px 12px"><div class="tbl-wrap" id="tabla"></div></div>`;

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let lista = [];
  const pintar = () => {
    const t = norm(main.querySelector('#bq').value.trim());
    const fs = main.querySelector('#fs').value, fr = main.querySelector('#fr').value;
    const fa = main.querySelector('#fa').value, fg = main.querySelector('#fg').value;
    lista = polizas.filter(p =>
      (fs === '' || (fs === 'activas' ? ['vigente', 'por_renovar'].includes(p.situacion) : p.situacion === fs)) &&
      (!fr || p.ramo === fr) && (!fa || p.aseguradora_id === fa) && (!fg || p.agente_id === fg) &&
      (!t || norm(p.cliente_nombre).includes(t) || norm(p.numero_poliza).includes(t)));
    const agente = Object.fromEntries(ctx.perfiles.map(x => [x.id, x.nombre]));
    main.querySelector('#tabla').innerHTML = lista.length ? `<table>
      <thead><tr><th>Cliente</th><th>Póliza</th><th>Aseguradora</th><th>Ramo</th><th>Vigencia</th><th>Pago</th><th class="num">Prima total</th><th>Agente</th><th>Situación</th></tr></thead>
      <tbody>${lista.map(p => `<tr class="click" data-c="${p.cliente_id}">
        <td><a href="#/cliente/${p.cliente_id}">${esc(p.cliente_nombre)}</a></td><td>${esc(p.numero_poliza || 's/n')}</td>
        <td>${esc(p.aseguradora_nombre)}</td><td>${RAMOS[p.ramo]}</td><td>${fdate(p.inicio_vigencia)} – ${fdate(p.fin_vigencia)}</td>
        <td>${FORMAS[p.forma_pago]}</td><td class="num">${money(p.prima_total, p.moneda)}</td><td>${esc(agente[p.agente_id] || '—')}</td>
        <td>${p.situacion === 'por_renovar' ? `<span class="pill p-warn">${p.dias_para_vencer} días</span> ${pill(SEGUIMIENTO, p.seguimiento)}` : pill(SITUACION, p.situacion)}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">${lista.length} pólizas · prima total ${money(lista.map(aPesos).reduce((a, p) => a + Number(p.prima_total), 0))} en pesos</p>`
      : '<div class="empty">No hay pólizas con esos filtros.</div>';
  };
  pintar();
  main.querySelectorAll('#bq').forEach(i => i.oninput = pintar);
  main.querySelectorAll('select').forEach(s => s.onchange = pintar);
  main.querySelector('#tabla').onclick = e => { const tr = e.target.closest('tr[data-c]'); if (tr && e.target.tagName !== 'A') location.hash = '#/cliente/' + tr.dataset.c; };
  main.querySelector('#nueva').onclick = () => formPoliza({ modo: 'nueva', alGuardar: refrescar });
  main.querySelector('#csv').onclick = () => sb.demo ? toast('La exportación a Excel estará disponible en la versión publicada.') : exportarCSV(lista);
}

function exportarCSV(lista) {
  const cols = [['Cliente', 'cliente_nombre'], ['Póliza', 'numero_poliza'], ['Aseguradora', 'aseguradora_nombre'], ['Ramo', p => RAMOS[p.ramo]],
    ['Producto', 'producto'], ['Inicio', 'inicio_vigencia'], ['Fin', 'fin_vigencia'], ['Forma de pago', p => FORMAS[p.forma_pago]],
    ['Moneda', 'moneda'], ['Prima neta', 'prima_neta'], ['Prima total', 'prima_total'], ['% comisión', 'pct_comision'], ['Situación', p => SITUACION[p.situacion]?.[0]]];
  const val = (p, c) => typeof c === 'function' ? c(p) : p[c];
  const csv = [cols.map(c => c[0]), ...lista.map(p => cols.map(([, c]) => val(p, c)))]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `polizas-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}
