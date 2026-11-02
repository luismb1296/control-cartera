// Comisiones: metas y liquidación por agente, y facturas de comisiones emitidas a las aseguradoras
import { sb, ctx, q, recargarCatalogos, enPesos } from '../db.js';
import { esc, money, fdate, fdateShort, pill, modal, input, select, textarea, optsList, toast, txt, num, iso, hoyISO, sum, descargar, MESES_LARGOS, RAMOS , numRecibo } from '../ui.js';
import { subirArchivo, abrirArchivo } from './formas.js';
import { leerCFDI } from './tramites.js';
import { cargarSheetJS, norm } from './importar.js';
import { refrescar } from '../app.js';

const EST_FAC = { emitida: ['Emitida', 'p-blue'], pagada: ['Pagada', 'p-ok'], cancelada: ['Cancelada', 'p-gray'] };
let pestana = 'agentes';
const mesHash = () => { const m = new URLSearchParams(location.hash.split('?')[1] || '').get('m'); return /^\d{4}-\d{2}$/.test(m || '') ? m : hoyISO().slice(0, 7); };
const sumarMes = (m, n) => { const [a, b] = m.split('-').map(Number); return iso(new Date(a, b - 1 + n, 1)).slice(0, 7); };
const nombreMes = m => { const [a, b] = m.split('-').map(Number); return `${MESES_LARGOS[b - 1]} ${a}`; };
const pct = (v, m) => m > 0 ? Math.min(100, Math.round(v / m * 100)) : 0;

async function datos(m) {
  const ini = m + '-01', fin = sumarMes(m, 1) + '-01';
  const [recibos, polizas, metas, pagos, facturas] = await Promise.all([
    q(sb.from('v_recibos').select('*').not('comision_recibida', 'is', null).gte('fecha_comision', ini).lt('fecha_comision', fin)),
    q(sb.from('v_polizas').select('id,agente_id,aseguradora_id,aseguradora_nombre,moneda,prima_total,poliza_anterior_id,inicio_vigencia,cliente_nombre,numero_poliza,ramo,estatus').gte('inicio_vigencia', sumarMes(m, -12) + '-01')),
    q(sb.from('metas').select('*').eq('periodo', m)),
    q(sb.from('pagos_agentes').select('*').eq('periodo', m)),
    q(sb.from('facturas_comision').select('*').eq('periodo', m).order('fecha')),
  ]);
  // Recibos de pólizas que no están en la consulta anterior (más viejas): se piden aparte para saber moneda y aseguradora
  const faltan = [...new Set(recibos.map(r => r.poliza_id).filter(id => !polizas.some(p => p.id === id)))];
  const extra = faltan.length ? await q(sb.from('v_polizas').select('id,agente_id,aseguradora_id,aseguradora_nombre,moneda,prima_total,poliza_anterior_id,inicio_vigencia,cliente_nombre,numero_poliza,ramo,estatus').in('id', faltan)) : [];
  const pol = Object.fromEntries([...polizas, ...extra].map(p => [p.id, p]));
  const recs = recibos.map(r => ({ ...r, pol: pol[r.poliza_id], comision_pesos: enPesos(r.comision_recibida, pol[r.poliza_id]?.moneda) ?? 0 }));
  const delMes = polizas.filter(p => p.inicio_vigencia >= ini && p.inicio_vigencia < fin && p.estatus !== 'cancelada');
  return { recs, delMes, metas, pagos, facturas };
}

export async function vistaComisiones(main, _p, vigente) {
  const m = mesHash();
  const d = await datos(m);
  if (!vigente()) return;
  const admin = ctx.perfil.rol === 'admin', gestion = ['admin', 'operaciones'].includes(ctx.perfil.rol);
  main.innerHTML = `
  <div class="head"><div><h1>Comisiones</h1><p class="muted" style="margin:4px 0 0">Metas y pago a cada agente con lo que la aseguradora sí pagó, y las facturas de comisiones de la agencia.</p></div></div>
  <div class="mesbar"><button class="btn sm" type="button" id="mPrev" aria-label="Mes anterior">‹</button><h2>${esc(nombreMes(m))}</h2><button class="btn sm" type="button" id="mNext" aria-label="Mes siguiente">›</button></div>
  ${gestion ? `<div class="tabs" role="tablist"><button type="button" role="tab" data-p="agentes" aria-selected="${pestana === 'agentes'}">Agentes</button><button type="button" role="tab" data-p="facturas" aria-selected="${pestana === 'facturas'}">Facturas a aseguradoras</button></div>` : ''}
  <div id="cPanel"></div>`;
  main.querySelector('#mPrev').onclick = () => { location.hash = '#/comisiones?m=' + sumarMes(m, -1); };
  main.querySelector('#mNext').onclick = () => { location.hash = '#/comisiones?m=' + sumarMes(m, 1); };
  main.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { pestana = b.dataset.p; refrescar(); });
  const panel = main.querySelector('#cPanel');
  if (pestana === 'facturas' && gestion) return panelFacturas(panel, d, m);
  panelAgentes(panel, d, m, admin);
}

// ---------------------------------------------------------------- Agentes
function panelAgentes(panel, d, m, admin) {
  const agentes = ctx.perfiles.filter(p => p.activo && (['admin', 'operaciones'].includes(ctx.perfil.rol) || p.id === ctx.perfil.id));
  const tarjeta = a => {
    const recs = d.recs.filter(r => r.agente_id === a.id), base = sum(recs, r => r.comision_pesos), porc = Number(a.pct_agente ?? 0), toca = Math.round(base * porc) / 100;
    const nuevas = d.delMes.filter(p => p.agente_id === a.id && !p.poliza_anterior_id), renov = d.delMes.filter(p => p.agente_id === a.id && p.poliza_anterior_id);
    const prima = sum(nuevas, p => enPesos(p.prima_total, p.moneda));
    const meta = d.metas.find(x => x.perfil_id === a.id) || {}, pago = d.pagos.find(x => x.perfil_id === a.id);
    return `<article class="card agente" data-ag="${a.id}">
      <div class="card-head"><div><h2>${esc(a.nombre)}</h2><div class="muted small">${esc({ admin: 'Administración', operaciones: 'Operaciones', agente: 'Agente' }[a.rol] || a.rol)}</div></div>
        ${pago ? `<span class="pill p-ok">Pagado ${fdateShort(pago.pagado_en)}</span>` : toca > 0 ? '<span class="pill p-warn">Por pagar</span>' : ''}</div>
      <div class="metas">
        <div><div class="filters" style="justify-content:space-between"><span class="small">Prima nueva</span><span class="small"><b>${money(prima)}</b>${meta.meta_prima ? ` de ${money(meta.meta_prima)}` : ''}</span></div>
          <div class="meter"><div style="width:${pct(prima, meta.meta_prima)}%"></div></div></div>
        <div><div class="filters" style="justify-content:space-between"><span class="small">Pólizas nuevas</span><span class="small"><b>${nuevas.length}</b>${meta.meta_polizas ? ` de ${meta.meta_polizas}` : ''} · ${renov.length} renovacion${renov.length === 1 ? '' : 'es'}</span></div>
          <div class="meter"><div style="width:${pct(nuevas.length, meta.meta_polizas)}%"></div></div></div>
      </div>
      <div class="liq">
        <div><div class="lbl">Comisión cobrada</div><div class="val">${money(base)}</div><div class="muted small">${recs.length} recibo${recs.length === 1 ? '' : 's'} de sus pólizas</div></div>
        <div><div class="lbl">Su porcentaje</div><div class="val nw">${admin ? `<input type="number" min="0" max="100" step="0.5" value="${porc}" data-pct="${a.id}" aria-label="Porcentaje de ${esc(a.nombre)}" style="width:76px;min-height:34px;display:inline-block"> %` : porc + '%'}</div></div>
        <div><div class="lbl">Le corresponde</div><div class="val cifra-ag">${money(toca)}</div></div>
      </div>
      <div class="filters" style="margin-top:12px">
        <button type="button" class="btn sm" data-det="${a.id}"${recs.length ? '' : ' disabled'}>Ver detalle</button>
        <button type="button" class="btn sm" data-xls="${a.id}"${recs.length ? '' : ' disabled'}>Descargar liquidación</button>
        ${admin ? `<button type="button" class="btn sm" data-meta="${a.id}">Metas del mes</button>${pago ? `<button type="button" class="linkbtn small" data-despagar="${pago.id}">Deshacer pago</button>` : toca > 0 ? `<button type="button" class="btn sm primary" data-pagar="${a.id}" data-monto="${toca}">Marcar pagado</button>` : ''}` : ''}
      </div></article>`;
  };
  const totBase = sum(d.recs, r => r.comision_pesos);
  panel.innerHTML = `${['admin', 'operaciones'].includes(ctx.perfil.rol) ? `<section class="kpis" style="margin-bottom:16px">
    <div class="card kpi"><div class="k">Comisión cobrada en el mes</div><div class="v">${money(totBase)}</div><div class="s">Toda la agencia, en pesos</div></div>
    <div class="card kpi"><div class="k">A pagar a agentes</div><div class="v">${money(sum(agentes, a => Math.round(sum(d.recs.filter(r => r.agente_id === a.id), r => r.comision_pesos) * Number(a.pct_agente ?? 0)) / 100))}</div><div class="s">Según el porcentaje de cada uno</div></div>
    <div class="card kpi"><div class="k">Prima nueva del mes</div><div class="v">${money(sum(d.delMes.filter(p => !p.poliza_anterior_id), p => enPesos(p.prima_total, p.moneda)))}</div><div class="s">${d.delMes.filter(p => !p.poliza_anterior_id).length} pólizas nuevas</div></div>
  </section>` : ''}
  <section class="agentes-grid">${agentes.map(tarjeta).join('') || '<div class="card empty">Sin agentes activos.</div>'}</section>
  <p class="muted small">La comisión se cuenta en el mes en que la aseguradora la pagó (fecha de comisión del recibo). Regístrela en Cobranza o con "Conciliar estado de cuenta" en Ventas.</p>`;

  panel.querySelectorAll('[data-pct]').forEach(i => i.onchange = async () => {
    try { await q(sb.from('perfiles').update({ pct_agente: Math.min(100, Math.max(0, Number(i.value) || 0)) }).eq('id', i.dataset.pct)); await recargarCatalogos(); toast('Porcentaje actualizado.'); refrescar(); }
    catch (e) { toast(e.message, true); }
  });
  panel.querySelectorAll('[data-det]').forEach(b => b.onclick = () => detalle(ctx.perfiles.find(p => p.id === b.dataset.det), d.recs.filter(r => r.agente_id === b.dataset.det), m));
  panel.querySelectorAll('[data-xls]').forEach(b => b.onclick = () => liquidacionExcel(ctx.perfiles.find(p => p.id === b.dataset.xls), d.recs.filter(r => r.agente_id === b.dataset.xls), m).catch(e => toast(e.message, true)));
  panel.querySelectorAll('[data-meta]').forEach(b => b.onclick = () => formMeta(ctx.perfiles.find(p => p.id === b.dataset.meta), d.metas.find(x => x.perfil_id === b.dataset.meta), m));
  panel.querySelectorAll('[data-pagar]').forEach(b => b.onclick = async () => {
    try { await q(sb.from('pagos_agentes').insert({ perfil_id: b.dataset.pagar, periodo: m, monto: Number(b.dataset.monto), pagado_en: hoyISO() })); toast('Pago registrado.'); refrescar(); }
    catch (e) { toast(e.message, true); }
  });
  panel.querySelectorAll('[data-despagar]').forEach(b => b.onclick = async () => { await q(sb.from('pagos_agentes').delete().eq('id', b.dataset.despagar)); refrescar(); });
}

function detalle(a, recs, m) {
  const porc = Number(a.pct_agente ?? 0);
  modal({ titulo: `Comisiones de ${a.nombre} · ${nombreMes(m)}`, boton: 'Cerrar',
    cuerpo: `<div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th>Póliza</th><th>Recibo</th><th>Pagada</th><th class="num">Comisión</th><th class="num">Le toca (${porc}%)</th></tr></thead><tbody>
      ${recs.map(r => `<tr><td>${esc(r.cliente_nombre)}</td><td class="nw">${esc(r.numero_poliza || '')}<div class="muted small">${esc(r.pol?.aseguradora_nombre || '')}</div></td><td>${numRecibo(r)}</td><td class="nw">${fdateShort(r.fecha_comision)}</td>
        <td class="num">${money(r.comision_pesos)}${r.pol?.moneda && r.pol.moneda !== 'MXN' ? `<div class="muted small">${r.comision_recibida} ${r.pol.moneda}</div>` : ''}</td><td class="num">${money(Math.round(r.comision_pesos * porc) / 100)}</td></tr>`).join('')}
      <tr><td colspan="4"><b>Total</b></td><td class="num"><b>${money(sum(recs, r => r.comision_pesos))}</b></td><td class="num"><b>${money(Math.round(sum(recs, r => r.comision_pesos) * porc) / 100)}</b></td></tr>
    </tbody></table></div>`, onSubmit: () => {} });
}

async function liquidacionExcel(a, recs, m) {
  const XLSX = await cargarSheetJS(), porc = Number(a.pct_agente ?? 0);
  const filas = [['Liquidación de comisiones', '', '', '', '', '', ''], [`${a.nombre} · ${nombreMes(m)} · ${ctx.agencia?.nombre || ''}`], [],
    ['Cliente', 'Aseguradora', 'Póliza', 'Recibo', 'Fecha de pago de comisión', 'Comisión (pesos)', `Le corresponde (${porc}%)`],
    ...recs.map(r => [r.cliente_nombre, r.pol?.aseguradora_nombre || '', r.numero_poliza || '', `${numRecibo(r)}`, r.fecha_comision, r.comision_pesos, Math.round(r.comision_pesos * porc) / 100]),
    [], ['Total', '', '', '', '', sum(recs, r => r.comision_pesos), Math.round(sum(recs, r => r.comision_pesos) * porc) / 100]];
  const ws = XLSX.utils.aoa_to_sheet(filas); ws['!cols'] = [30, 16, 16, 9, 18, 16, 18].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Liquidación');
  await descargar(`Liquidación ${a.nombre} ${nombreMes(m)}.xlsx`, new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

function formMeta(a, meta, m) {
  modal({ titulo: `Metas de ${a.nombre} · ${nombreMes(m)}`,
    cuerpo: `<div class="form-grid">${input('Prima nueva (pesos)', 'meta_prima', { type: 'number', value: meta?.meta_prima ?? '', attrs: 'min="0" step="1000"' })}${input('Pólizas nuevas', 'meta_polizas', { type: 'number', value: meta?.meta_polizas ?? '', attrs: 'min="0"' })}</div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="anio" style="width:auto;min-height:0"> Aplicar la misma meta a los meses que faltan del año</label>`,
    onSubmit: async d => {
      const [a0, b0] = m.split('-').map(Number), meses = d.anio ? Array.from({ length: 12 - b0 + 1 }, (_, i) => `${a0}-${String(b0 + i).padStart(2, '0')}`) : [m];
      const ya = await q(sb.from('metas').select('id,periodo').eq('perfil_id', a.id).in('periodo', meses));
      for (const p of meses) {
        const fila = { perfil_id: a.id, periodo: p, meta_prima: num(d.meta_prima), meta_polizas: num(d.meta_polizas) }, x = ya.find(z => z.periodo === p);
        if (x) await q(sb.from('metas').update(fila).eq('id', x.id)); else await q(sb.from('metas').insert(fila));
      }
      toast('Metas guardadas.'); refrescar();
    } });
}

// ---------------------------------------------------------------- Facturas de comisiones
function panelFacturas(panel, d, m) {
  const porAseg = Object.fromEntries(ctx.aseguradoras.map(a => [a.id, sum(d.recs.filter(r => r.pol?.aseguradora_id === a.id), r => r.comision_pesos)]));
  const asegs = ctx.aseguradoras.filter(a => porAseg[a.id] > 0 || d.facturas.some(f => f.aseguradora_id === a.id));
  panel.innerHTML = `
  <section class="card"><div class="card-head"><div><h2>Comisiones cobradas contra facturas</h2><p class="muted small" style="margin:4px 0 0">Lo que cada aseguradora pagó de comisión en el mes y lo que la agencia le facturó (subtotal antes de IVA).</p></div>
    <button type="button" class="btn primary" id="fNueva">Registrar factura</button></div>
    ${asegs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Aseguradora</th><th class="num">Comisión cobrada</th><th class="num">Facturado</th><th>Diferencia</th></tr></thead><tbody>
      ${asegs.map(a => { const fac = sum(d.facturas.filter(f => f.aseguradora_id === a.id && f.estatus !== 'cancelada'), f => f.subtotal), dif = Math.round((fac - porAseg[a.id]) * 100) / 100;
        return `<tr><td>${esc(a.nombre)}</td><td class="num">${money(porAseg[a.id])}</td><td class="num">${money(fac)}</td><td>${Math.abs(dif) <= 1 ? '<span class="pill p-ok">Cuadra</span>' : fac === 0 ? '<span class="pill p-warn">Sin factura</span>' : `<span class="pill p-bad">${dif > 0 ? '+' : ''}${money(dif)}</span>`}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted">No hay comisiones cobradas ni facturas en este mes.</p>'}
  </section>
  <section class="card"><h2 style="margin-bottom:10px">Facturas del mes (${d.facturas.length})</h2>
    ${d.facturas.length ? `<div class="tbl-wrap"><table><thead><tr><th>Aseguradora</th><th>Folio</th><th>Fecha</th><th class="num">Subtotal</th><th class="num">IVA</th><th class="num">Retenciones</th><th class="num">Total</th><th>Estatus</th><th></th></tr></thead><tbody>
      ${d.facturas.map(f => `<tr><td>${esc(ctx.aseguradoras.find(a => a.id === f.aseguradora_id)?.nombre || '—')}</td><td class="nw">${esc(f.folio || '—')}<div class="muted small">${esc((f.uuid_fiscal || '').slice(0, 8))}</div></td>
        <td class="nw">${fdateShort(f.fecha)}</td><td class="num">${money(f.subtotal)}</td><td class="num">${money(f.iva)}</td><td class="num">${f.retenciones ? '−' + money(f.retenciones) : '—'}</td><td class="num"><b>${money(f.total)}</b></td>
        <td>${pill(EST_FAC, f.estatus)}${f.fecha_pago ? `<div class="muted small">${fdateShort(f.fecha_pago)}</div>` : ''}</td>
        <td class="nw">${f.estatus === 'emitida' ? `<button type="button" class="btn sm" data-fpag="${f.id}">Marcar pagada</button>` : ''}${f.xml_ruta ? ` <button type="button" class="linkbtn small" data-fver="${esc(f.xml_ruta)}">XML</button>` : ''}${f.pdf_ruta ? ` <button type="button" class="linkbtn small" data-fver="${esc(f.pdf_ruta)}">PDF</button>` : ''}
          ${f.estatus !== 'cancelada' ? ` <button type="button" class="linkbtn small" data-fcan="${f.id}">Cancelar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Registre las facturas (CFDI) que la agencia emitió a cada aseguradora por sus comisiones. Suba el XML y se llenan solas.</p>'}
  </section>`;
  panel.querySelector('#fNueva').onclick = () => formFacturaComision(m);
  panel.querySelectorAll('[data-fpag]').forEach(b => b.onclick = async () => { await q(sb.from('facturas_comision').update({ estatus: 'pagada', fecha_pago: hoyISO() }).eq('id', b.dataset.fpag)); toast('Factura marcada como pagada.'); refrescar(); });
  panel.querySelectorAll('[data-fcan]').forEach(b => b.onclick = async () => { await q(sb.from('facturas_comision').update({ estatus: 'cancelada' }).eq('id', b.dataset.fcan)); refrescar(); });
  panel.querySelectorAll('[data-fver]').forEach(b => b.onclick = () => abrirArchivo(b.dataset.fver));
}

function formFacturaComision(m) {
  let xml = null, pdfF = null;
  modal({ titulo: 'Registrar factura de comisiones', boton: 'Registrar',
    cuerpo: `<div class="pdf-box"><div><b>Suba el XML de la factura</b><div class="muted small">Se leen folio, fecha, importes y la aseguradora.</div></div>
        <label class="btn sm primary" for="fcXml" style="cursor:pointer">Subir XML</label><input type="file" id="fcXml" class="sr" accept=".xml"></div>
      <p id="fcMsg" class="small" role="status" style="margin:0 0 12px"></p>
      <div class="form-grid">
        ${select('Aseguradora', 'aseguradora_id', '<option value="">Seleccione…</option>' + optsList(ctx.aseguradoras, ''), { req: true })}
        ${input('Folio', 'folio')}${input('Fecha', 'fecha', { type: 'date', value: hoyISO() })}${input('Periodo de las comisiones', 'periodo', { type: 'month', value: m })}
        ${input('Subtotal', 'subtotal', { type: 'number', req: true, attrs: 'step="0.01" min="0"' })}${input('IVA', 'iva', { type: 'number', attrs: 'step="0.01" min="0"' })}
        ${input('Retenciones', 'retenciones', { type: 'number', attrs: 'step="0.01" min="0"' })}${input('Total', 'total', { type: 'number', req: true, attrs: 'step="0.01" min="0"' })}
        ${input('Folio fiscal (UUID)', 'uuid_fiscal', { wide: true })}
        <div class="field wide"><label for="fcPdf">PDF de la factura (opcional)</label><input type="file" id="fcPdf" accept=".pdf"></div>
      </div>`,
    onOpen: f => {
      f.querySelector('#fcPdf').onchange = e => { pdfF = e.target.files[0] || null; };
      f.querySelector('#fcXml').onchange = async e => {
        const file = e.target.files[0]; if (!file) return; const msg = f.querySelector('#fcMsg');
        try {
          const x = leerCFDI(await file.text()); xml = file;
          const pon = (k, v) => { if (v != null && f[k]) f[k].value = v; };
          pon('folio', x.serie_folio); pon('fecha', x.fecha); pon('subtotal', x.subtotal); pon('iva', x.iva); pon('total', x.total); pon('uuid_fiscal', x.uuid_fiscal);
          if (x.subtotal != null && x.total != null) pon('retenciones', Math.max(0, Math.round((x.subtotal + (x.iva || 0) - x.total) * 100) / 100));
          const rec = norm(x.receptor_nombre || ''), a = ctx.aseguradoras.find(z => rec.includes(norm(z.nombre)) || norm(z.nombre).split(' ').every(w => rec.includes(w)));
          if (a) f.aseguradora_id.value = a.id;
          msg.style.color = 'var(--ok)'; msg.textContent = `Factura leída${a ? ` · receptor: ${x.receptor_nombre}` : `. No reconocí la aseguradora "${x.receptor_nombre || ''}"; elíjala.`}`;
        } catch (err) { msg.style.color = 'var(--bad)'; msg.textContent = err.message; }
      };
    },
    onSubmit: async d => {
      if (!d.aseguradora_id) throw new Error('Elija la aseguradora.');
      const fila = { aseguradora_id: d.aseguradora_id, folio: txt(d.folio), fecha: txt(d.fecha), periodo: d.periodo || m, subtotal: num(d.subtotal) ?? 0, iva: num(d.iva) ?? 0,
        retenciones: num(d.retenciones) ?? 0, total: num(d.total) ?? 0, uuid_fiscal: txt(d.uuid_fiscal)?.toUpperCase() ?? null, estatus: 'emitida' };
      if (fila.uuid_fiscal) { const ya = await q(sb.from('facturas_comision').select('id').eq('uuid_fiscal', fila.uuid_fiscal)); if (ya.length) throw new Error('Esa factura ya está registrada.'); }
      if (xml) fila.xml_ruta = await subirArchivo(xml, 'agencia', 'facturas-comision');
      if (pdfF) fila.pdf_ruta = await subirArchivo(pdfF, 'agencia', 'facturas-comision');
      await q(sb.from('facturas_comision').insert(fila));
      toast('Factura registrada.'); refrescar();
    } });
}
