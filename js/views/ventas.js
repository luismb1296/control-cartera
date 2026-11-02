import { sb, ctx, q, aPesos, enPesos } from '../db.js';
import { esc, money, fdate, parseD, sum, hoy, hoyISO, modal, input, num, toast, RAMOS, MESES_LARGOS , numRecibo } from '../ui.js';
import { refrescar } from '../app.js';
import { marcarNoRenueva } from './formas.js';
import { conciliarEstadoCuenta } from './conciliar.js';
import { dialogoReporte } from './reporte.js';

let anio = null;

export async function vistaVentas(main, _p, vigente) {
  const h = hoy();
  if (!anio) anio = h.getFullYear();
  const ini = `${anio}-01-01`, fin = `${anio}-12-31`;
  const iniAnt = `${anio - 1}-01-01`, finAnt = `${anio - 1}-12-31`;
  const [polizas, pagados, vigentes, anteriores, terminan, movs, monedas] = await Promise.all([
    q(sb.from('v_polizas').select('id,ramo,aseguradora_nombre,agente_id,inicio_vigencia,prima_neta,prima_total,moneda,poliza_anterior_id').gte('inicio_vigencia', ini).lte('inicio_vigencia', fin)),
    q(sb.from('v_recibos').select('*').eq('estatus', 'pagado').gte('fecha_pago', ini).lte('fecha_pago', fin).order('fecha_pago')),
    q(sb.from('v_polizas').select('aseguradora_id,aseguradora_nombre,prima_total,moneda,dias_para_vencer').eq('estatus', 'activa').gte('dias_para_vencer', 0)),
    q(sb.from('v_polizas').select('aseguradora_id,prima_total,moneda').gte('inicio_vigencia', iniAnt).lte('inicio_vigencia', finAnt)),
    q(sb.from('v_polizas').select('*').gte('fin_vigencia', ini).lte('fin_vigencia', fin).neq('estatus', 'cancelada')),
    q(sb.from('movimientos').select('id,poliza_id,importe,estatus,fecha_emision,fecha_efecto,creado_en').in('estatus', ['emitido', 'entregado'])),
    q(sb.from('v_polizas').select('id,moneda')),
  ]);
  if (!vigente()) return;

  const mxn = polizas.map(aPesos);
  const nuevas = mxn.filter(p => !p.poliza_anterior_id), renov = mxn.filter(p => p.poliza_anterior_id);
  const porConciliar = pagados.filter(r => r.comision_recibida == null && Number(r.comision_esperada) > 0);
  const agente = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  const mesDe = f => parseD(f).getMonth();
  // Endosos emitidos en el año (por fecha de emisión): cobros adicionales y devoluciones, en pesos
  const monedaDe = Object.fromEntries(monedas.map(p => [p.id, p.moneda]));
  const fechaEnd = m => String(m.fecha_emision || m.fecha_efecto || m.creado_en).slice(0, 10);
  const endosos = movs.filter(m => Number(m.importe || 0) !== 0 && fechaEnd(m) >= ini && fechaEnd(m) <= fin).map(m => ({ ...m, pesos: enPesos(m.importe, monedaDe[m.poliza_id] || 'MXN') }));

  const filas = MESES_LARGOS.map((m, i) => {
    const n = nuevas.filter(p => mesDe(p.inicio_vigencia) === i), r = renov.filter(p => mesDe(p.inicio_vigencia) === i);
    const pg = pagados.filter(x => mesDe(x.fecha_pago) === i);
    return { m, nN: n.length, pN: sum(n, p => p.prima_total), nR: r.length, pR: sum(r, p => p.prima_total),
      endosos: sum(endosos.filter(x => mesDe(fechaEnd(x)) === i), x => x.pesos), cobrado: sum(pg, x => x.prima_total), comE: sum(pg, x => x.comision_esperada), comR: sum(pg, x => x.comision_recibida) };
  });
  const tot = k => sum(filas, f => f[k]);
  const agrupar = (lista, clave) => {
    const g = {}; lista.forEach(p => { const k = clave(p); (g[k] ||= { n: 0, prima: 0 }); g[k].n++; g[k].prima += Number(p.prima_total); });
    return Object.entries(g).sort((a, b) => b[1].prima - a[1].prima);
  };

  main.innerHTML = `
  <header class="head">
    <div class="filters"><h1>Ventas e ingresos</h1>
      <label for="anio" class="sr">Año</label>
      <select id="anio" style="width:auto">${[h.getFullYear() + 1, h.getFullYear(), h.getFullYear() - 1, h.getFullYear() - 2].map(a => `<option${a === anio ? ' selected' : ''}>${a}</option>`).join('')}</select></div>
    <div class="filters"><button class="btn" type="button" id="conciliar">Conciliar estado de cuenta</button><button class="btn primary" type="button" id="reporte">Reporte mensual (PDF)</button></div>
  </header>
  <section class="kpis">
    <div class="card kpi"><div class="k">Ventas nuevas</div><div class="v">${nuevas.length}</div><div class="s">${money(sum(nuevas, p => p.prima_total))} de prima</div></div>
    <div class="card kpi"><div class="k">Renovaciones</div><div class="v">${renov.length}</div><div class="s">${money(sum(renov, p => p.prima_total))} de prima</div></div>
    <div class="card kpi"><div class="k">Endosos con prima</div><div class="v">${endosos.length}</div><div class="s">${money(sum(endosos, x => x.pesos))} neto${endosos.some(x => x.pesos < 0) ? ` (${money(sum(endosos.filter(x => x.pesos < 0), x => -x.pesos))} en devoluciones)` : ''}</div></div>
    <div class="card kpi"><div class="k">Prima cobrada</div><div class="v">${money(tot('cobrado'))}</div><div class="s">recibos pagados en ${anio}</div></div>
    <div class="card kpi"><div class="k">Comisión recibida</div><div class="v">${money(tot('comR'))}</div><div class="s">de ${money(tot('comE'))} esperada</div></div>
  </section>

  <div class="card"><h2 style="margin-bottom:8px">Resumen por mes</h2><div class="tbl-wrap"><table>
    <thead><tr><th>Mes</th><th class="num">Nuevas</th><th class="num">Prima nuevas</th><th class="num">Renovaciones</th><th class="num">Prima renovaciones</th><th class="num">Prima endosos</th><th class="num">Prima cobrada</th><th class="num">Comisión esperada</th><th class="num">Comisión recibida</th></tr></thead>
    <tbody>${filas.map(f => `<tr><td>${f.m}</td><td class="num">${f.nN}</td><td class="num">${money(f.pN)}</td><td class="num">${f.nR}</td><td class="num">${money(f.pR)}</td><td class="num">${money(f.endosos)}</td>
      <td class="num">${money(f.cobrado)}</td><td class="num">${money(f.comE)}</td><td class="num">${money(f.comR)}</td></tr>`).join('')}
      <tr style="font-weight:600"><td>Total</td><td class="num">${tot('nN')}</td><td class="num">${money(tot('pN'))}</td><td class="num">${tot('nR')}</td><td class="num">${money(tot('pR'))}</td><td class="num">${money(tot('endosos'))}</td>
      <td class="num">${money(tot('cobrado'))}</td><td class="num">${money(tot('comE'))}</td><td class="num">${money(tot('comR'))}</td></tr></tbody></table></div>
    <p class="muted small">Ventas y renovaciones se cuentan por fecha de inicio de vigencia; los endosos, por fecha de emisión (las devoluciones restan). Todo en pesos. Cobranza y comisiones, por fecha de pago del recibo.</p></div>

  <section class="row">
    ${[['Por aseguradora', agrupar(mxn, p => p.aseguradora_nombre)], ['Por ramo', agrupar(mxn, p => RAMOS[p.ramo])], ['Por agente', agrupar(mxn, p => agente[p.agente_id] || '—')]].map(([t, g]) => `
      <div class="card" style="flex:1 1 280px"><h2 style="margin-bottom:12px">${t}</h2>
        ${g.length ? `<div class="list">${g.map(([k, v]) => `<div class="li"><span>${esc(k)} <span class="muted small">(${v.n})</span></span><span class="num">${money(v.prima)}</span></div>`).join('')}</div>` : '<div class="empty">Sin pólizas en este año.</div>'}
      </div>`).join('')}
  </section>

  ${seccionAseguradoras(vigentes, polizas, anteriores, anio)}
  ${seccionRenovacion(terminan, anio)}

  <div class="card"><div class="card-head"><h2>Comisiones por conciliar</h2><span class="muted small">Recibos pagados cuya comisión aún no se registra. Use "Conciliar estado de cuenta" para registrarlas de golpe.</span></div>
    ${porConciliar.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Cliente</th><th>Póliza</th><th>Recibo</th><th>Pagado</th><th class="num">Comisión esperada</th><th></th></tr></thead>
      <tbody>${porConciliar.map(r => `<tr><td><a href="#/cliente/${r.cliente_id}">${esc(r.cliente_nombre)}</a></td><td>${esc(r.numero_poliza || 's/n')} · ${RAMOS[r.ramo]}</td>
        <td>${numRecibo(r)}</td><td>${fdate(r.fecha_pago)}</td><td class="num">${money(r.comision_esperada)}</td>
        <td><button type="button" class="btn sm" data-com="${r.id}">Registrar</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Todas las comisiones de recibos pagados están registradas.</div>'}
  </div>`;

  main.querySelectorAll('[data-motivo]').forEach(b => b.onclick = () => marcarNoRenueva(terminan.find(p => p.id === b.dataset.motivo), refrescar));
  main.querySelector('#conciliar').onclick = () => conciliarEstadoCuenta(refrescar);
  main.querySelector('#reporte').onclick = () => dialogoReporte();
  main.querySelector('#anio').onchange = e => { anio = Number(e.target.value); vistaVentas(main, null, vigente); };
  main.querySelectorAll('[data-com]').forEach(b => b.onclick = () => {
    const r = porConciliar.find(x => x.id === b.dataset.com);
    modal({
      titulo: 'Registrar comisión recibida',
      cuerpo: `<p class="muted" style="margin-top:0">${esc(r.cliente_nombre)} · recibo ${numRecibo(r)}</p><div class="form-grid">
        ${input('Comisión recibida', 'monto', { type: 'number', value: r.comision_esperada, req: true, attrs: 'step="0.01" min="0"' })}
        ${input('Fecha en que se recibió', 'fecha', { type: 'date', value: hoyISO(), req: true })}</div>`,
      onSubmit: async d => {
        await q(sb.from('recibos').update({ comision_recibida: num(d.monto), fecha_comision: d.fecha }).eq('id', r.id));
        toast('Comisión registrada.'); refrescar();
      }
    });
  });
}

// Cartera por aseguradora: vigente hoy y producción del año contra el anterior
function seccionAseguradoras(vigentes, delAnio, anteriores, anio) {
  const filas = ctx.aseguradoras.map(a => {
    const v = vigentes.filter(p => p.aseguradora_id === a.id).map(aPesos);
    const act = delAnio.filter(p => p.aseguradora_nombre === a.nombre).map(aPesos).reduce((x, p) => x + Number(p.prima_total), 0);
    const ant = anteriores.filter(p => p.aseguradora_id === a.id).map(aPesos).reduce((x, p) => x + Number(p.prima_total), 0);
    return { nombre: a.nombre, n: v.length, prima: v.reduce((x, p) => x + Number(p.prima_total), 0), act, ant };
  }).filter(f => f.n || f.act || f.ant).sort((x, y) => y.prima - x.prima);
  const total = filas.reduce((x, f) => x + f.prima, 0) || 1;
  return `<div class="card"><div class="card-head"><h2>Cartera por aseguradora</h2><span class="muted small">Pesos. Producción = pólizas que iniciaron vigencia en el año</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Aseguradora</th><th class="num">Pólizas vigentes</th><th class="num">Prima vigente</th><th style="width:22%">Participación</th>
      <th class="num">Producción ${anio}</th><th class="num">Producción ${anio - 1}</th><th class="num">Crecimiento</th></tr></thead>
    <tbody>${filas.map(f => {
      const crec = f.ant ? Math.round((f.act - f.ant) / f.ant * 100) : null;
      return `<tr><td>${esc(f.nombre)}</td><td class="num">${f.n}</td><td class="num">${money(f.prima)}</td>
        <td><div class="bar" style="margin:0"><div style="width:${Math.max(1, f.prima / total * 100)}%"></div></div><span class="muted small">${Math.round(f.prima / total * 100)}%</span></td>
        <td class="num">${money(f.act)}</td><td class="num">${money(f.ant)}</td>
        <td class="num" style="color:${crec == null ? 'var(--muted)' : crec >= 0 ? 'var(--ok)' : 'var(--bad)'}">${crec == null ? '—' : (crec > 0 ? '+' : '') + crec + '%'}</td></tr>`;
    }).join('')}</tbody></table></div></div>`;
}

// Tasa de renovación: de las pólizas que terminaron en el año, cuántas se renovaron
function seccionRenovacion(terminan, anio) {
  const h = hoyISO();
  const yaTerminaron = terminan.filter(p => p.fin_vigencia < h || p.estatus === 'renovada' || p.seguimiento === 'no_renueva');
  const renovadas = yaTerminaron.filter(p => p.estatus === 'renovada');
  const perdidas = yaTerminaron.filter(p => p.estatus !== 'renovada');
  const pendientes = terminan.filter(p => !yaTerminaron.includes(p));
  const tasa = yaTerminaron.length ? Math.round(renovadas.length / yaTerminaron.length * 100) : null;
  return `<div class="card"><div class="card-head"><h2>Renovación de cartera ${anio}</h2><span class="muted small">Pólizas cuyo fin de vigencia cae en ${anio}</span></div>
    <div class="kpis" style="margin-bottom:16px">
      <div class="kpi"><div class="k">Tasa de renovación</div><div class="v">${tasa == null ? '—' : tasa + '%'}</div><div class="s">${renovadas.length} de ${yaTerminaron.length} que ya terminaron</div></div>
      <div class="kpi"><div class="k">No renovadas</div><div class="v" style="color:var(--bad)">${perdidas.length}</div><div class="s">${money(perdidas.map(aPesos).reduce((x, p) => x + Number(p.prima_total), 0))} de prima perdida</div></div>
      <div class="kpi"><div class="k">Por terminar en el año</div><div class="v">${pendientes.length}</div><div class="s">aún pueden renovarse</div></div>
    </div>
    ${perdidas.length ? `<h3 style="font-size:15px;margin:0 0 8px">Pólizas no renovadas</h3><div class="tbl-wrap"><table>
      <thead><tr><th>Cliente</th><th>Póliza</th><th>Terminó</th><th class="num">Prima</th><th>Motivo</th></tr></thead>
      <tbody>${perdidas.map(p => `<tr><td><a href="#/cliente/${p.cliente_id}">${esc(p.cliente_nombre)}</a></td><td>${esc(p.numero_poliza || 's/n')}<div class="muted small">${esc(p.aseguradora_nombre)} · ${esc(RAMOS[p.ramo])}</div></td>
        <td class="nw">${fdate(p.fin_vigencia)}</td><td class="num">${money(p.prima_total, p.moneda)}</td>
        <td>${p.motivo_no_renovacion ? esc(p.motivo_no_renovacion) : `<span class="muted">Sin registrar</span> <button type="button" class="linkbtn small" data-motivo="${p.id}">Registrar motivo</button>`}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}
