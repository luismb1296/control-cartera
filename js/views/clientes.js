import { sb, ctx, q } from '../db.js';
import { esc, iniciales } from '../ui.js';
import { formCliente } from './formas.js';
import { abrirImportador } from './importar.js';
import { refrescar } from '../app.js';

export async function vistaClientes(main, _p, vigente) {
  const [clientes, polizas] = await Promise.all([
    q(sb.from('clientes').select('id,nombre,rfc,telefono,email,agente_id,activo,tipo_persona').order('nombre')),
    q(sb.from('polizas').select('cliente_id,numero_poliza,estatus')),
  ]);
  if (!vigente()) return;
  const cuenta = {}, numeros = {};
  polizas.forEach(p => {
    if (p.estatus === 'activa') cuenta[p.cliente_id] = (cuenta[p.cliente_id] || 0) + 1;
    (numeros[p.cliente_id] ||= []).push((p.numero_poliza || '').toLowerCase());
  });
  const agente = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  const inicial = decodeURIComponent(location.hash.split('?')[1] || '');

  main.innerHTML = `
  <header class="head"><h1>Clientes</h1>
    <div class="filters"><button class="btn" type="button" id="importar">Importar o migrar</button>
    <button class="btn primary" type="button" id="nuevo">+ Nuevo cliente</button></div></header>
  <div class="filters">
    <label for="bq" class="sr">Buscar</label>
    <input id="bq" class="search" type="search" placeholder="Nombre, RFC, teléfono o número de póliza" value="${esc(inicial)}">
    <label for="fa" class="sr">Agente</label>
    <select id="fa"><option value="">Todos los agentes</option>${ctx.perfiles.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select>
    <label class="small muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="fi" style="width:auto;min-height:0"> Incluir inactivos</label>
  </div>
  <div class="card" style="padding:8px 12px"><div class="tbl-wrap" id="tabla"></div></div>`;

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pintar = () => {
    const t = norm(main.querySelector('#bq').value.trim());
    const fa = main.querySelector('#fa').value;
    const fi = main.querySelector('#fi').checked;
    const lista = clientes.filter(c =>
      (fi || c.activo) && (!fa || c.agente_id === fa) &&
      (!t || norm(c.nombre).includes(t) || norm(c.rfc).includes(t) || String(c.telefono || '').includes(t) ||
        (numeros[c.id] || []).some(n => n.includes(t))));
    main.querySelector('#tabla').innerHTML = lista.length ? `<table>
      <thead><tr><th>Cliente</th><th>RFC</th><th>Teléfono</th><th>Correo</th><th>Agente</th><th class="num">Pólizas vigentes</th></tr></thead>
      <tbody>${lista.map(c => `<tr class="click" data-id="${c.id}">
        <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="background:var(--accent-bg);color:var(--accent)">${esc(iniciales(c.nombre))}</span>
          <a href="#/cliente/${c.id}">${esc(c.nombre)}</a>${c.activo ? '' : ' <span class="pill p-gray">Inactivo</span>'}</div></td>
        <td>${esc(c.rfc || '—')}</td><td>${esc(c.telefono || '—')}</td><td>${esc(c.email || '—')}</td>
        <td>${esc(agente[c.agente_id] || '—')}</td><td class="num">${cuenta[c.id] || 0}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">${lista.length} de ${clientes.length} clientes</p>`
      : `<div class="empty">${clientes.length ? 'No hay clientes que coincidan con la búsqueda.' : 'Aún no hay clientes. Registre el primero con “+ Nuevo cliente”.'}</div>`;
  };
  pintar();
  main.querySelector('#bq').oninput = pintar;
  main.querySelector('#fa').onchange = pintar;
  main.querySelector('#fi').onchange = pintar;
  main.querySelector('#tabla').onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (tr && e.target.tagName !== 'A') location.hash = '#/cliente/' + tr.dataset.id;
  };
  main.querySelector('#importar').onclick = () => abrirImportador(refrescar);
  main.querySelector('#nuevo').onclick = () => formCliente(null, c => { location.hash = '#/cliente/' + c.id; });
  if (inicial) main.querySelector('#bq').focus();
}
