import { sb, ctx, q } from '../db.js';
import { esc, money, fdate, pill, hoy, iso, addDays, parseD, sum, waLink, RAMOS, SIT_RECIBO, CONDUCTOS, toast , numRecibo, diasDescubierto } from '../ui.js';
import { cartasDePoliza } from './cartas.js';
import { formPago, abrirArchivo } from './formas.js';
import { enviarMensaje } from './mensajes.js';
import { refrescar } from '../app.js';

export async function vistaCobranza(main, _p, vigente) {
  const h = hoy();
  const desde = iso(new Date(h.getFullYear(), h.getMonth() - 1, 1));
  const [pendientes, pagados, conductos, clientes] = await Promise.all([
    q(sb.from('v_recibos').select('*').eq('estatus', 'pendiente').order('fecha_limite')),
    q(sb.from('v_recibos').select('*').eq('estatus', 'pagado').gte('fecha_pago', desde).order('fecha_pago', { ascending: false })),
    q(sb.from('polizas').select('id,conducto_cobro,aseguradora_id')),
    q(sb.from('clientes').select('id,telefono,whatsapp,email')),
  ]);
  if (!vigente()) return;
  const cond = Object.fromEntries(conductos.map(p => [p.id, p]));
  const cliMap = Object.fromEntries(clientes.map(c => [c.id, c]));
  const aseg = Object.fromEntries(ctx.aseguradoras.map(a => [a.id, a.nombre]));
  const en30 = iso(addDays(h, 30));
  const vencidos = pendientes.filter(r => r.situacion === 'vencido');
  const proximos = pendientes.filter(r => r.situacion !== 'vencido' && r.fecha_limite <= en30);
  const mesActual = pagados.filter(r => parseD(r.fecha_pago).getMonth() === h.getMonth());

  main.innerHTML = `
  <header class="head"><h1>Cobranza</h1></header>
  <section class="kpis">
    <div class="card kpi bad"><div class="k">Vencidos</div><div class="v">${vencidos.length}</div><div class="s">${money(sum(vencidos, r => r.prima_total))}</div></div>
    <div class="card kpi warn"><div class="k">Por vencer · 30 días</div><div class="v">${proximos.length}</div><div class="s">${money(sum(proximos, r => r.prima_total))}</div></div>
    <div class="card kpi"><div class="k">Cobrado este mes</div><div class="v">${mesActual.length}</div><div class="s">${money(sum(mesActual, r => r.prima_total))}</div></div>
  </section>
  <div class="filters">
    <div class="chips" role="group" aria-label="Mostrar">
      <button type="button" class="chip" data-f="vencidos" aria-pressed="true">Vencidos</button>
      <button type="button" class="chip" data-f="proximos" aria-pressed="false">Próximos 30 días</button>
      <button type="button" class="chip" data-f="todos" aria-pressed="false">Todos los pendientes</button>
      <button type="button" class="chip" data-f="pagados" aria-pressed="false">Pagados recientes</button>
    </div>
    <label for="fc" class="sr">Conducto</label>
    <select id="fc"><option value="">Todos los conductos</option>${Object.entries(CONDUCTOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
  </div>
  <div class="card" style="padding:8px 12px"><div class="tbl-wrap" id="tabla"></div></div>`;

  let filtro = 'vencidos';
  const pintar = () => {
    const fc = main.querySelector('#fc').value;
    let lista = { vencidos, proximos, todos: pendientes, pagados }[filtro];
    if (fc) lista = lista.filter(r => cond[r.poliza_id]?.conducto_cobro === fc);
    main.querySelector('#tabla').innerHTML = lista.length ? `<table>
      <thead><tr><th>Cliente</th><th>Póliza</th><th>Recibo</th><th>${filtro === 'pagados' ? 'Pagado' : 'Fecha límite'}</th><th class="num">Importe</th><th>Conducto</th><th>Estatus</th><th></th></tr></thead>
      <tbody>${lista.map(r => {
        const dias = Math.round((h - parseD(r.fecha_limite)) / 86400000);
        return `<tr><td><a href="#/cliente/${r.cliente_id}">${esc(r.cliente_nombre)}</a></td>
          <td>${esc(r.numero_poliza || 's/n')} · ${RAMOS[r.ramo]} · ${esc(aseg[cond[r.poliza_id]?.aseguradora_id] || '')}</td>
          <td>${numRecibo(r)}</td>
          <td>${filtro === 'pagados' ? fdate(r.fecha_pago) : fdate(r.fecha_limite) + (dias > 0 ? ` · <b style="color:var(--bad)">${dias} días</b>` : '')}
            ${r.descubierto_desde ? `<div class="small" style="color:var(--warn)">Pagado tarde: sin cobertura del ${fdate(r.descubierto_desde)} al ${fdate(r.descubierto_hasta)}</div>` : ''}
            ${r.estatus === 'pendiente' && dias > 0 && Number(r.prima_total) > 0 ? `<div class="small" style="color:var(--bad)">Sin cobertura desde el ${fdate(iso(addDays(parseD(r.fecha_limite), 1)))}: requiere rehabilitación</div>` : ''}</td>
          <td class="num">${money(r.prima_total)}</td><td>${esc(CONDUCTOS[cond[r.poliza_id]?.conducto_cobro] || '')}</td><td>${pill(SIT_RECIBO, r.situacion)}</td>
          <td style="display:flex;gap:6px">${r.estatus === 'pendiente' ? (Number(r.prima_total) < 0 ? `<button type="button" class="btn sm" data-pagar="${r.id}">Devolución hecha</button>` : `<button type="button" class="btn sm" data-pagar="${r.id}">Marcar pagado</button><button type="button" class="btn sm" data-rec="${r.id}">Recordar</button>`) : ''}
            ${r.comprobante_ruta ? `<button type="button" class="linkbtn small" data-abrir="${esc(r.comprobante_ruta)}">Comprobante</button>` : ''}
            ${(r.estatus === 'pendiente' && dias > 0 && Number(r.prima_total) > 0) || r.descubierto_desde ? `<button type="button" class="linkbtn small" data-rehab="${r.id}">Rehabilitación</button>` : ''}
            ${r.estatus === 'pagado' ? `<button type="button" class="linkbtn small" data-deshacer="${r.id}">Deshacer</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>`
      : '<div class="empty">No hay recibos en esta vista.</div>';
  };
  pintar();
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    filtro = b.dataset.f; main.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', x === b)); pintar();
  });
  main.querySelector('#fc').onchange = pintar;
  main.querySelector('#tabla').onclick = async e => {
    const d = e.target.dataset;
    try {
      if (d.pagar) formPago(pendientes.find(r => r.id === d.pagar), refrescar);
      else if (d.rec) {
        const r = pendientes.find(x => x.id === d.rec), c = cliMap[r.cliente_id] || {};
        enviarMensaje('recordatorio_pago', { nombre: r.cliente_nombre, recibo: `${numRecibo(r)}`, poliza: r.numero_poliza, aseguradora: aseg[cond[r.poliza_id]?.aseguradora_id],
          monto: money(r.prima_total), fecha: fdate(r.fecha_limite), ramo: RAMOS[r.ramo].toLowerCase() }, { telefono: c.whatsapp || c.telefono, email: c.email });
      }
      else if (d.abrir) abrirArchivo(d.abrir);
      else if (d.rehab) {
        const r = [...pendientes, ...pagados].find(x => x.id === d.rehab);
        const p = await q(sb.from('v_polizas').select('*').eq('id', r.poliza_id).single());
        cartasDePoliza({ poliza: p, uso: 'rehabilitacion', recibo: r, alTerminar: refrescar });
      }
      else if (d.deshacer) { await q(sb.from('recibos').update({ estatus: 'pendiente', fecha_pago: null }).eq('id', d.deshacer)); toast('Pago revertido.'); refrescar(); }
    } catch (err) { toast(err.message, true); }
  };
}
