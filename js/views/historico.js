// Histórico de renovaciones de una póliza: todas sus vigencias en orden, cada una con sus
// endosos, recibos, documentos y siniestros (lo de cada año se queda en su propia póliza).
import { sb, q } from '../db.js';
import { esc, money, fdate, pill, parseD, hoyISO, RAMOS, FORMAS, CAMPOS_RAMO, DOCS, TIPOS_MOV, EST_MOV, numRecibo, periodosDescubiertos } from '../ui.js';
import { abrirArchivo } from './formas.js';

// Una póliza ya renovada sigue en vigor hasta que termina su vigencia
const enVigor = p => p.inicio_vigencia <= hoyISO() && p.fin_vigencia >= hoyISO();
const ESTATUS = p => p.estatus === 'cancelada' ? ['Cancelada', 'p-bad']
  : p.estatus === 'renovada' ? (enVigor(p) ? ['Vigente · ya renovada', 'p-ok'] : ['Renovada', 'p-blue'])
  : p.fin_vigencia < hoyISO() ? ['Vencida', 'p-warn'] : p.inicio_vigencia > hoyISO() ? ['Por iniciar', 'p-gray'] : ['Vigente', 'p-ok'];

// Todas las pólizas ligadas por renovación (hacia atrás y hacia adelante) dentro de las del cliente
export function cadenaDe(id, polizas) {
  const porId = Object.fromEntries(polizas.map(p => [p.id, p]));
  const vistos = new Set(), pend = [id];
  while (pend.length) {
    const x = pend.pop(); if (!x || vistos.has(x) || !porId[x]) continue; vistos.add(x);
    pend.push(porId[x].poliza_anterior_id);
    polizas.filter(p => p.poliza_anterior_id === x).forEach(p => pend.push(p.id));
  }
  return [...vistos].map(k => porId[k]).sort((a, b) => String(b.inicio_vigencia).localeCompare(String(a.inicio_vigencia)) || String(b.creado_en).localeCompare(String(a.creado_en)));
}

export async function vistaHistorico(main, id, vigente) {
  const p0 = await q(sb.from('v_polizas').select('*').eq('id', id).maybeSingle());
  if (!vigente()) return;
  if (!p0) { main.innerHTML = '<div class="card"><h2>Póliza no encontrada</h2><a href="#/clientes">Volver a clientes</a></div>'; return; }
  const todas = await q(sb.from('v_polizas').select('*').eq('cliente_id', p0.cliente_id));
  const cadena = cadenaDe(id, todas), ids = cadena.map(p => p.id);
  const [movs, recibos, docs, siniestros] = await Promise.all([
    q(sb.from('movimientos').select('*').in('poliza_id', ids).order('creado_en', { ascending: false })),
    q(sb.from('recibos').select('*').in('poliza_id', ids).order('numero')),
    q(sb.from('documentos').select('id,poliza_id,tipo,nombre_archivo,ruta,creado_en,tramite_id,movimiento_id').in('poliza_id', ids)),
    q(sb.from('siniestros').select('id,poliza_id,padecimiento,fecha_evento,estatus,afectado').in('poliza_id', ids)),
  ]);
  if (!vigente()) return;
  const abierta = new URLSearchParams(location.hash.split('?')[1] || '').get('ver') || id;
  const hoy = hoyISO();
  const avance = p => { const i = parseD(p.inicio_vigencia), f = parseD(p.fin_vigencia), h = parseD(hoy); return Math.max(0, Math.min(1, (h - i) / (f - i || 1))); };
  const cambio = (p, i) => { const a = cadena[i + 1]; if (!a || a.moneda !== p.moneda || !Number(a.prima_total)) return ''; const pct = (Number(p.prima_total) / Number(a.prima_total) - 1) * 100;
    return `<div class="small" style="color:${pct > 0.05 ? 'var(--warn)' : pct < -0.05 ? 'var(--ok)' : 'var(--muted)'}">${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}% vs. año anterior</div>`; };

  const detalle = p => {
    const ms = movs.filter(m => m.poliza_id === p.id), rs = recibos.filter(r => r.poliza_id === p.id), ds = docs.filter(d => d.poliza_id === p.id && !d.tramite_id), ss = siniestros.filter(s => s.poliza_id === p.id);
    const pagados = rs.filter(r => r.estatus === 'pagado').length, pend = rs.filter(r => r.estatus === 'pendiente'), desc = periodosDescubiertos(rs);
    const dr = p.datos_ramo || {}, campos = (CAMPOS_RAMO[p.ramo] || []).filter(([k]) => dr[k]);
    return `<div class="grid-info" style="padding:4px 0 14px">
        <div><div class="lbl">Prima total</div><div class="val">${money(p.prima_total, p.moneda)}</div></div>
        <div><div class="lbl">Forma de pago</div><div class="val">${esc(FORMAS[p.forma_pago] || p.forma_pago)}</div></div>
        <div><div class="lbl">Recibos</div><div class="val">${pagados} de ${rs.filter(r => !r.movimiento_id).length} pagados${pend.length ? ` · <span style="color:var(--warn)">${pend.length} pendiente${pend.length > 1 ? 's' : ''}</span>` : ''}</div></div>
        ${campos.map(([k, l]) => `<div><div class="lbl">${esc(l)}</div><div class="val">${esc(dr[k])}</div></div>`).join('')}
      </div>
      ${desc.length ? `<p class="small" style="margin:0 0 12px;color:var(--warn)">Periodo al descubierto: ${desc.map(x => `${fdate(x.desde)} al ${fdate(x.hasta)}`).join('; ')}.</p>` : ''}
      <div class="duo">
        <div><div class="lbl" style="margin-bottom:6px">Endosos de esta vigencia (${ms.length})</div>
          ${ms.length ? `<div class="list">${ms.map(m => `<a class="li" href="#/endoso/${m.id}" style="padding:0"><span><b>${esc(TIPOS_MOV[m.tipo] || m.tipo)}</b>${m.folio_endoso ? ` <span class="muted small">${esc(m.folio_endoso)}</span>` : ''}
              <div class="muted small">${esc(m.descripcion || '')}</div></span><span style="text-align:right">${pill(EST_MOV, m.estatus)}${m.importe ? `<div class="small num">${money(m.importe, p.moneda)}</div>` : ''}</span></a>`).join('')}</div>`
            : '<div class="muted small">Sin endosos.</div>'}</div>
        <div><div class="lbl" style="margin-bottom:6px">Documentos (${ds.length})</div>
          ${ds.length ? `<div class="list">${ds.map(d => `<div class="li"><button type="button" class="linkbtn" data-abrir="${esc(d.ruta)}" style="text-align:left">${esc(d.nombre_archivo)}</button><span class="muted small nw">${esc(DOCS[d.tipo] || d.tipo)}</span></div>`).join('')}</div>`
            : '<div class="muted small">Sin documentos de esta vigencia.</div>'}
          ${ss.length ? `<div class="lbl" style="margin:14px 0 6px">Siniestros (${ss.length})</div><div class="list">${ss.map(s => `<a class="li" href="#/siniestro/${s.id}" style="padding:0"><span>${esc(s.padecimiento || 'Siniestro')}<div class="muted small">${fdate(s.fecha_evento)}${s.afectado ? ' · ' + esc(s.afectado) : ''}</div></span>${s.estatus === 'abierto' ? '<span class="pill p-blue">Abierto</span>' : '<span class="pill p-gray">Cerrado</span>'}</a>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="filters" style="margin-top:14px"><a class="btn sm" href="#/cliente/${p.cliente_id}">Ir a la ficha del cliente</a>${p.estatus === 'activa' ? `<a class="btn sm" href="#/renovacion/${p.id}">Análisis de renovación</a>` : ''}</div>`;
  };

  main.innerHTML = `
  <div class="muted"><a href="#/clientes">Clientes</a> / <a href="#/cliente/${p0.cliente_id}">${esc(p0.cliente_nombre)}</a></div>
  <header class="head"><div><h1>Histórico de renovaciones <span class="muted" style="font-weight:500">(${cadena.length})</span></h1>
    <p class="muted" style="margin:4px 0 0">${esc(RAMOS[p0.ramo])} · ${esc(p0.cliente_nombre)}. Cada vigencia es una póliza con sus propios endosos, recibos y documentos.</p></div></header>
  <div class="card" style="padding:4px 0">
    <div class="tbl-wrap"><table class="historico">
      <thead><tr><th style="padding-left:20px">Número de póliza</th><th>Aseguradora</th><th>Vigencia</th><th class="num">Prima</th><th>Estatus</th><th class="num">Endosos</th><th></th></tr></thead>
      <tbody>${cadena.map((p, i) => { const [et, cl] = ESTATUS(p), act = enVigor(p) && p.estatus !== 'cancelada', n = movs.filter(m => m.poliza_id === p.id).length, abre = p.id === abierta;
        return `<tr data-fila="${p.id}" class="click"${p.id === id ? ' style="background:var(--surface-2)"' : ''}>
          <td style="padding-left:20px"><b>${esc(p.numero_poliza || 's/n')}</b></td>
          <td>${esc(p.aseguradora_nombre)}<div class="muted small">${esc(p.producto || RAMOS[p.ramo])}</div></td>
          <td class="nw">${fdate(p.inicio_vigencia)} al ${fdate(p.fin_vigencia)}
            <div class="meter" style="margin-top:6px;width:150px"><div style="width:${act ? Math.round(avance(p) * 100) : 100}%;${act ? '' : 'background:var(--control)'}"></div></div>
            ${act ? `<div class="muted small">Faltan ${Math.max(0, Math.round((parseD(p.fin_vigencia) - parseD(hoy)) / 864e5))} días</div>` : ''}</td>
          <td class="num">${money(p.prima_total, p.moneda)}${cambio(p, i)}</td>
          <td><span class="pill ${cl}">${et}</span></td>
          <td class="num">${n || '—'}</td>
          <td class="num"><button type="button" class="x" data-ver="${p.id}" aria-expanded="${abre}" aria-label="Ver detalle de ${esc(p.numero_poliza || 'la póliza')}">${abre ? '▴' : '▾'}</button></td></tr>
        <tr data-det="${p.id}"${abre ? '' : ' hidden'}><td colspan="7" style="padding:4px 20px 18px;background:var(--surface-2)">${detalle(p)}</td></tr>`; }).join('')}</tbody></table></div>
  </div>
  ${cadena.length === 1 ? '<p class="muted small">Esta póliza aún no tiene renovaciones registradas. Al renovarla (botón «Renovar» de la póliza), la nueva vigencia aparece aquí arriba y esta queda como renovada.</p>' : ''}`;

  const alternar = pid => {
    const det = main.querySelector(`[data-det="${pid}"]`), b = main.querySelector(`[data-ver="${pid}"]`);
    det.hidden = !det.hidden; b.setAttribute('aria-expanded', String(!det.hidden)); b.textContent = det.hidden ? '▾' : '▴';
    history.replaceState(null, '', `#/historico/${id}${det.hidden ? '' : '?ver=' + pid}`);
  };
  main.addEventListener('click', e => {
    const a = e.target.closest('[data-abrir]'); if (a) return abrirArchivo(a.dataset.abrir);
    if (e.target.closest('a')) return;
    const fila = e.target.closest('[data-fila]'); if (fila) alternar(fila.dataset.fila);
  });
}
