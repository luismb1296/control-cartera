// Renovaciones del mes: reporte para descargar en cada portal, comparación con el año anterior
// y análisis de opciones cuando la prima sube más de lo normal.
import { sb, ctx, q, recargarCatalogos, enPesos } from '../db.js';
import {
  esc, money, fdate, fdateShort, pill, modal, input, select, textarea, opts, optsList, toast, txt, num, hoyISO, iso, parseD, sum, waLink,
  descargar, primerNombre, RAMOS, FORMAS, CAMPOS_RAMO, MESES_LARGOS
} from '../ui.js';
import { formPoliza, subirArchivo, abrirArchivo } from './formas.js';
import { formTarea } from './tablero.js';
import { cargarSheetJS } from './importar.js';
import { leerPdf, extraerConIA, INSTRUCCION_RENOVACION, INSTRUCCION_COTIZACION } from '../ia.js';
import { refrescar } from '../app.js';
import { abrirComparativo } from './comparativo.js';

export const DECISIONES = { pendiente: ['Por decidir', 'p-gray'], igual: ['Se queda igual', 'p-blue'], ajuste: ['Se queda con ajustes', 'p-violet'], cambio: ['Cambia de aseguradora', 'p-warn'], no_renueva: ['No renueva', 'p-bad'] };
const TIPO_OPCION = { igual: 'Quedarse igual', ajuste: 'Ajustar coberturas', cambio: 'Cambiar de aseguradora' };
const umbral = () => Number(ctx.agencia?.renovaciones?.umbral ?? 15);
export const incremento = (ant, nueva) => ant && nueva && Number(ant.prima_total) > 0 && ant.moneda === nueva.moneda
  ? Math.round((Number(nueva.prima_total) - Number(ant.prima_total)) / Number(ant.prima_total) * 1000) / 10 : null;
export const pillIncremento = v => v == null ? '<span class="muted small">—</span>'
  : `<span class="pill ${v < 0 ? 'p-ok' : v > umbral() ? 'p-bad' : v > umbral() * 0.66 ? 'p-warn' : 'p-gray'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
const edadEn = (nac, fecha) => { const n = parseD(nac), f = parseD(fecha); if (!n || !f) return null; let e = f.getFullYear() - n.getFullYear(); if (f.getMonth() < n.getMonth() || (f.getMonth() === n.getMonth() && f.getDate() < n.getDate())) e--; return e; };
const montoDe = v => { const x = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(x) || !String(v ?? '').match(/\d/) ? null : x; };
const mesDeHash = () => { const m = new URLSearchParams(location.hash.split('?')[1] || '').get('m'); if (/^\d{4}-\d{2}$/.test(m || '')) return m; const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 1)).slice(0, 7); };
const sumarMes = (m, n) => { const [a, b] = m.split('-').map(Number); return iso(new Date(a, b - 1 + n, 1)).slice(0, 7); };
const nombreMes = m => { const [a, b] = m.split('-').map(Number); return `${MESES_LARGOS[b - 1]} ${a}`; };
let filtro = 'todas';

// ---------------------------------------------------------------- Datos del mes
async function datosMes(m) {
  const ini = m + '-01', fin = sumarMes(m, 1) + '-01';
  const polizas = (await q(sb.from('v_polizas').select('*').gte('fin_vigencia', ini).lt('fin_vigencia', fin).order('fin_vigencia')))
    .filter(p => ['activa', 'renovada'].includes(p.estatus));
  const ids = polizas.map(p => p.id), cids = [...new Set(polizas.map(p => p.cliente_id))];
  const [renov, analisis, asegurados, siniestros, clientes] = ids.length ? await Promise.all([
    q(sb.from('v_polizas').select('*').in('poliza_anterior_id', ids)),
    q(sb.from('renovacion_analisis').select('*').in('poliza_id', ids)),
    q(sb.from('asegurados').select('*').in('poliza_id', ids)),
    q(sb.from('siniestros').select('id,poliza_id,cliente_id,estatus,padecimiento,fecha_evento').in('cliente_id', cids)),
    q(sb.from('clientes').select('id,nombre,telefono,whatsapp,email,agente_id').in('id', cids)),
  ]) : [[], [], [], [], []];
  const cli = Object.fromEntries(clientes.map(c => [c.id, c]));
  const filas = polizas.map(p => {
    const r = renov.filter(x => x.poliza_anterior_id === p.id && x.estatus !== 'cancelada').sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)))[0] || null;
    return { p, r, inc: incremento(p, r), an: analisis.find(a => a.poliza_id === p.id) || null, cli: cli[p.cliente_id] || {},
      aseg: asegurados.filter(a => a.poliza_id === p.id && a.tipo !== 'beneficiario'), sin: siniestros.filter(s => s.poliza_id === p.id) };
  });
  return { filas };
}

// ---------------------------------------------------------------- Pantalla del mes
export async function vistaRenovaciones(main, _p, vigente) {
  const m = mesDeHash();
  const { filas } = await datosMes(m);
  if (!vigente()) return;
  const cargadas = filas.filter(f => f.r), alzas = cargadas.filter(f => f.inc != null && f.inc > umbral());
  const conInc = cargadas.filter(f => f.inc != null);
  const prom = conInc.length ? sum(conInc, f => f.r.prima_total) / sum(conInc, f => f.p.prima_total) * 100 - 100 : null;
  const admin = ctx.perfil.rol === 'admin';
  const visibles = filas.filter(f => filtro === 'todas' || (filtro === 'pendientes' && !f.r) || (filtro === 'cargadas' && f.r) || (filtro === 'alza' && f.inc != null && f.inc > umbral()));
  const porAseg = [...new Set(visibles.map(f => f.p.aseguradora_nombre))].sort();

  main.innerHTML = `
  <div class="head"><div><h1>Renovaciones</h1>
    <p class="muted" style="margin:4px 0 0">Pólizas cuya renovación inicia en el mes. Descárguelas del portal de cada aseguradora, cárguelas aquí y la app las compara con el año anterior.</p></div>
    <div class="filters"><button class="btn" type="button" id="rExcel"${filas.length ? '' : ' disabled'}>Descargar Excel</button></div></div>
  <div class="mesbar">
    <button class="btn sm" type="button" id="mPrev" aria-label="Mes anterior">‹</button>
    <h2 id="mTit">${esc(nombreMes(m))}</h2>
    <button class="btn sm" type="button" id="mNext" aria-label="Mes siguiente">›</button>
    <span class="muted small" style="margin-left:auto">Alertar si sube más de ${admin ? `<input type="number" id="rUmbral" value="${umbral()}" min="1" max="100" style="width:72px;min-height:34px;display:inline-block"> %` : `<b>${umbral()}%</b>`}</span>
  </div>
  <section class="kpis">
    <div class="card kpi"><div class="k">Pólizas que renuevan</div><div class="v">${filas.length}</div><div class="s">${money(sum(filas, f => enPesos(f.p.prima_total, f.p.moneda)))} de prima actual</div></div>
    <div class="card kpi"><div class="k">Renovaciones cargadas</div><div class="v">${cargadas.length} de ${filas.length}</div>
      <div class="meter"><div style="width:${filas.length ? cargadas.length / filas.length * 100 : 0}%"></div></div></div>
    <div class="card kpi"><div class="k">Incremento promedio</div><div class="v">${prom == null ? '—' : (prom > 0 ? '+' : '') + prom.toFixed(1) + '%'}</div><div class="s">De las renovaciones ya cargadas</div></div>
    <div class="card kpi${alzas.length ? ' bad' : ''}"><div class="k">Con alza fuerte</div><div class="v">${alzas.length}</div><div class="s">Subieron más de ${umbral()}%: conviene analizarlas</div></div>
  </section>
  <div class="chips" role="group" aria-label="Mostrar">${[['todas', 'Todas'], ['pendientes', 'Por cargar'], ['cargadas', 'Cargadas'], ['alza', `Alza fuerte (${alzas.length})`]]
    .map(([k, t]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${filtro === k}">${t}</button>`).join('')}</div>
  ${!filas.length ? `<div class="card empty">No hay pólizas que renueven en ${esc(nombreMes(m).toLowerCase())}.</div>` : !visibles.length ? '<div class="card empty">Nada que mostrar con este filtro.</div>' : ''}
  ${porAseg.map(a => {
    const fs = visibles.filter(f => f.p.aseguradora_nombre === a), faltan = fs.filter(f => !f.r).length;
    return `<section class="card"><div class="card-head"><h2>${esc(a)}</h2><span class="muted small">${fs.length} póliza${fs.length > 1 ? 's' : ''}${faltan ? ` · <b style="color:var(--warn)">${faltan} por cargar</b>` : ' · todas cargadas'}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th>Póliza</th><th>Renueva</th><th class="num">Prima actual</th><th class="num">Renovación</th><th>Cambio</th><th></th></tr></thead><tbody>
      ${fs.map(f => `<tr>
        <td><a href="#/cliente/${f.p.cliente_id}">${esc(f.p.cliente_nombre)}</a><div class="muted small">${esc(RAMOS[f.p.ramo])}${f.p.producto ? ' · ' + esc(f.p.producto) : ''}${f.sin.length ? ` · <span title="Siniestros registrados">${f.sin.length} siniestro${f.sin.length > 1 ? 's' : ''}</span>` : ''}</div></td>
        <td class="nw">${esc(f.p.numero_poliza || 's/n')}${f.r ? `<div class="muted small">nueva: ${esc(f.r.numero_poliza || 's/n')}</div>` : ''}</td>
        <td class="nw">${fdateShort(f.p.fin_vigencia)}</td>
        <td class="num">${money(f.p.prima_total, f.p.moneda)}</td>
        <td class="num">${f.r ? money(f.r.prima_total, f.r.moneda) : '<span class="pill p-warn">Por cargar</span>'}</td>
        <td>${pillIncremento(f.inc)}${f.an && f.an.decision !== 'pendiente' ? ' ' + pill(DECISIONES, f.an.decision) : ''}</td>
        <td class="nw" style="text-align:right">${f.r
          ? `<a class="btn sm${f.inc != null && f.inc > umbral() && !f.an?.resultado ? ' primary' : ''}" href="#/renovacion/${f.p.id}">${f.an?.resultado ? 'Ver análisis' : 'Analizar'}</a>`
          : `<button type="button" class="btn sm primary" data-cargar="${f.p.id}">Cargar renovación</button>`}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }).join('')}`;

  const ir = n => { location.hash = '#/renovaciones?m=' + sumarMes(m, n); };
  main.querySelector('#mPrev').onclick = () => ir(-1); main.querySelector('#mNext').onclick = () => ir(1);
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; refrescar(); });
  main.querySelectorAll('[data-cargar]').forEach(b => b.onclick = async () => {
    const p = await q(sb.from('polizas').select('*').eq('id', b.dataset.cargar).single());
    formPoliza({ poliza: p, modo: 'renovar', alGuardar: refrescar });
  });
  main.querySelector('#rExcel').onclick = () => excelMes(m, filas).catch(e => toast(e.message, true));
  const u = main.querySelector('#rUmbral');
  if (u) u.onchange = async () => {
    const v = Math.min(100, Math.max(1, Number(u.value) || 15));
    try { await q(sb.from('agencias').update({ renovaciones: { ...(ctx.agencia.renovaciones || {}), umbral: v } }).eq('id', ctx.agencia.id)); await recargarCatalogos(); toast(`Se alertará cuando una renovación suba más de ${v}%.`); refrescar(); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------------------------------------------------------------- Excel del mes (una hoja por aseguradora)
async function excelMes(m, filas) {
  const XLSX = await cargarSheetJS();
  const persona = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  const enc = ['Cliente', 'Póliza', 'Ramo', 'Producto', 'Renueva el', 'Forma de pago', 'Prima actual', 'Prima renovación', 'Incremento %', 'Estatus', 'Asegurados (edad al renovar)', 'Siniestros', 'Agente', 'Teléfono', 'Correo'];
  const fila = f => [f.p.cliente_nombre, f.p.numero_poliza || '', RAMOS[f.p.ramo], f.p.producto || '', parseD(f.p.fin_vigencia), FORMAS[f.p.forma_pago] || f.p.forma_pago,
    Number(f.p.prima_total), f.r ? Number(f.r.prima_total) : '', f.inc ?? '', f.r ? 'Cargada' : 'Por descargar',
    f.aseg.map(a => `${a.nombre}${a.fecha_nacimiento ? ` (${edadEn(a.fecha_nacimiento, f.p.fin_vigencia)})` : ''}`).join('; '),
    f.sin.length || '', persona[f.p.agente_id] || '', f.cli.whatsapp || f.cli.telefono || '', f.cli.email || ''];
  const hoja = lista => {
    const ws = XLSX.utils.aoa_to_sheet([enc, ...lista.map(fila)], { cellDates: true });
    ws['!cols'] = [30, 16, 14, 18, 12, 12, 13, 15, 12, 13, 38, 10, 14, 14, 26].map(w => ({ wch: w }));
    const rango = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 1; R <= rango.e.r; R++) {
      [4].forEach(C => { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c) c.z = 'dd/mm/yyyy'; });
      [6, 7].forEach(C => { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c && c.t === 'n') c.z = '$#,##0.00'; });
    }
    ws['!autofilter'] = { ref: ws['!ref'] };
    return ws;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja(filas), 'Todas');
  [...new Set(filas.map(f => f.p.aseguradora_nombre))].sort().forEach(a =>
    XLSX.utils.book_append_sheet(wb, hoja(filas.filter(f => f.p.aseguradora_nombre === a)), String(a).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31)));
  const datos = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await descargar(`Renovaciones ${nombreMes(m)} - ${ctx.agencia?.nombre || 'agencia'}.xlsx`, new Blob([datos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  toast('Excel generado.');
}

// ---------------------------------------------------------------- Después de cargar una renovación
export async function revisarRenovacion(anterior, nueva) {
  const inc = incremento(anterior, nueva), alta = inc != null && inc > umbral();
  modal({
    titulo: inc == null ? 'Renovación cargada' : `La renovación ${inc >= 0 ? 'subió' : 'bajó'} ${Math.abs(inc).toFixed(1)}%`, boton: 'Analizar ahora',
    cuerpo: `<p style="margin-top:0">${esc(anterior.numero_poliza || 'La póliza')} pasó de <b>${money(anterior.prima_total, anterior.moneda)}</b> a <b>${money(nueva.prima_total, nueva.moneda)}</b>${alta ? `, más que el ${umbral()}% que tiene configurado` : ''}.</p>
      <p class="muted small" style="margin-bottom:0">El análisis revisa edades, siniestros, antigüedad, endosos y coberturas, y le dice qué conviene: renovar igual, ajustar alguna cobertura o cotizar con otra aseguradora (y con cuál). Después, al subir las cotizaciones, arma el cuadro comparativo.</p>`,
    onSubmit: () => { setTimeout(() => { location.hash = '#/renovacion/' + anterior.id + '?auto'; }, 0); }
  });
}

// ---------------------------------------------------------------- Datos para el análisis
async function armarEntrada(polizaId) {
  const p = await q(sb.from('v_polizas').select('*').eq('id', polizaId).maybeSingle());
  if (!p) return null;
  const renovs = await q(sb.from('v_polizas').select('*').eq('poliza_anterior_id', p.id));
  const r = renovs.filter(x => x.estatus !== 'cancelada').sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)))[0] || null;
  // Historial: la cadena de pólizas anteriores
  const cadena = [p];
  for (let k = 0; k < 8 && cadena[cadena.length - 1].poliza_anterior_id; k++) {
    const x = await q(sb.from('v_polizas').select('*').eq('id', cadena[cadena.length - 1].poliza_anterior_id).maybeSingle()); if (!x) break; cadena.push(x);
  }
  const ids = cadena.map(x => x.id).concat(r ? [r.id] : []);
  const [c, asegurados, siniestros, analisis, docs, movs] = await Promise.all([
    q(sb.from('clientes').select('*').eq('id', p.cliente_id).maybeSingle()),
    q(sb.from('asegurados').select('*').eq('poliza_id', (r || p).id)),
    q(sb.from('siniestros').select('*').eq('cliente_id', p.cliente_id)),
    q(sb.from('renovacion_analisis').select('*').eq('poliza_id', p.id).maybeSingle()),
    q(sb.from('documentos').select('id,poliza_id,nombre_archivo,ruta').in('poliza_id', ids).eq('tipo', 'poliza')),
    q(sb.from('movimientos').select('id,tipo,descripcion,importe,estatus,aplicado_en,manejo_prima').eq('poliza_id', p.id)),
  ]);
  // Endosos con prima que ya están dentro de la prima de la póliza actual
  const endosos = movs.filter(m => m.aplicado_en && Number(m.importe || 0) !== 0 && m.manejo_prima !== 'ninguno' && ['emitido', 'entregado'].includes(m.estatus));
  const primaEndosos = sum(endosos, m => m.importe);
  const sinIds = siniestros.map(s => s.id);
  const tramites = sinIds.length ? await q(sb.from('tramites').select('siniestro_id,estatus,monto_reclamado,monto_pagado,tipo').in('siniestro_id', sinIds)) : [];
  // Promedio de incremento de la misma aseguradora y ramo en su cartera (últimos 12 meses)
  const hace12 = iso(new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate()));
  const recientes = await q(sb.from('v_polizas').select('id,poliza_anterior_id,prima_total,moneda,aseguradora_id,ramo,inicio_vigencia').eq('ramo', p.ramo).gte('inicio_vigencia', hace12).not('poliza_anterior_id', 'is', null));
  const prevs = recientes.length ? await q(sb.from('polizas').select('id,prima_total,moneda').in('id', recientes.map(x => x.poliza_anterior_id))) : [];
  const parejas = recientes.filter(x => x.id !== r?.id && !cadena.some(y => y.id === x.id)).map(x => ({ x, a: prevs.find(y => y.id === x.poliza_anterior_id) })).filter(z => z.a && incremento(z.a, z.x) != null);
  const prom = lista => lista.length ? Math.round((sum(lista, z => z.x.prima_total) / sum(lista, z => z.a.prima_total) * 100 - 100) * 10) / 10 : null;
  const mismaAseg = parejas.filter(z => z.x.aseguradora_id === p.aseguradora_id);
  const inicioRen = r?.inicio_vigencia || p.fin_vigencia;
  const conSuAseg = cadena.filter((x, i) => cadena.slice(0, i + 1).every(y => y.aseguradora_id === p.aseguradora_id));
  const desde = conSuAseg[conSuAseg.length - 1]?.inicio_vigencia;
  const anios = desde ? Math.max(0, Math.round((parseD(inicioRen) - parseD(desde)) / 3.15576e10 * 10) / 10) : null;
  const sinDatos = siniestros.filter(s => !s.poliza_id || ids.includes(s.poliza_id)).map(s => {
    const ts = tramites.filter(t => t.siniestro_id === s.id);
    return { padecimiento: s.padecimiento, afectado: s.afectado, fecha: s.fecha_evento, tipo: s.tipo_evento, abierto: s.estatus === 'abierto' || ts.some(t => !['pagado', 'rechazado', 'cerrado'].includes(t.estatus)),
      reclamado: sum(ts, t => t.monto_reclamado), pagado: sum(ts, t => t.monto_pagado) };
  });
  const otros = ctx.productos.filter(x => x.ramo === p.ramo && x.activo !== false && x.aseguradora_id !== p.aseguradora_id)
    .map(x => `${ctx.aseguradoras.find(a => a.id === x.aseguradora_id)?.nombre || ''} · ${x.nombre}`);
  const historial = [...cadena].reverse().map(x => ({ inicio: x.inicio_vigencia, aseguradora: x.aseguradora_nombre, producto: x.producto, prima: Number(x.prima_total), moneda: x.moneda }));
  if (r) historial.push({ inicio: r.inicio_vigencia, aseguradora: r.aseguradora_nombre, producto: r.producto, prima: Number(r.prima_total), moneda: r.moneda, renovacion: true });
  return {
    p, r, c, analisis, docs, cadena, inc: incremento(p, r), endosos, primaEndosos,
    primaOriginal: endosos.length ? Math.round((Number(p.prima_total) - primaEndosos) * 100) / 100 : null,
    personas: asegurados.filter(a => a.tipo !== 'beneficiario').map(a => ({ nombre: a.nombre, parentesco: a.parentesco, edad: edadEn(a.fecha_nacimiento, inicioRen), edadAntes: edadEn(a.fecha_nacimiento, p.inicio_vigencia) })),
    siniestros: sinDatos, historial, anios,
    promAseg: { valor: prom(mismaAseg), n: mismaAseg.length }, promRamo: { valor: prom(parejas), n: parejas.length }, otros,
    clienteDesde: c?.creado_en ? new Date(c.creado_en).getFullYear() : null,
  };
}

// Señales que se calculan sin IA (transparentes y siempre iguales)
function senales(e) {
  const s = [], u = umbral(), { p, r, inc } = e;
  if (inc != null) s.push([inc > u ? 'bad' : inc > u * 0.66 ? 'warn' : 'ok', `La prima ${inc >= 0 ? 'subió' : 'bajó'} ${Math.abs(inc).toFixed(1)}% (${inc >= 0 ? '+' : '−'}${money(Math.abs(r.prima_total - p.prima_total), r.moneda)}).`]);
  if (e.endosos?.length) {
    const ant = e.cadena[1], altas = e.endosos.filter(m => m.tipo === 'alta_asegurado' && Number(m.importe) > 0);
    const vsAnt = ant && ant.moneda === p.moneda && Number(ant.prima_total) > 0 ? Math.round((e.primaOriginal / Number(ant.prima_total) * 100 - 100) * 10) / 10 : null;
    s.push(['info', `De la prima actual (${money(p.prima_total, p.moneda)}), ${money(e.primaEndosos, p.moneda)} ${e.primaEndosos >= 0 ? 'vienen de' : 'se restaron por'} ${e.endosos.length} endoso${e.endosos.length > 1 ? 's' : ''}: ${e.endosos.map(m => `${m.descripcion || m.tipo} (${Number(m.importe) >= 0 ? '+' : '−'}${money(Math.abs(m.importe), p.moneda)})`).join('; ')}. Sin endosos, la póliza costaba ${money(e.primaOriginal, p.moneda)}${vsAnt != null ? `, ${vsAnt >= 0 ? `un ${Math.abs(vsAnt).toFixed(1)}% más que` : `${Math.abs(vsAnt).toFixed(1)}% menos que`} el año anterior: ese es el ajuste de tarifa; el resto lo explican los cambios a la póliza` : ''}.`]);
    if (altas.length && r) s.push(['warn', `${altas.length > 1 ? 'Las altas de asegurados se cobraron' : 'El alta de asegurado se cobró'} a prorrata durante la vigencia; en la renovación se cobra${altas.length > 1 ? 'n' : ''} por el año completo, así que parte del aumento no es incremento de tarifa.`]);
  }
  if (inc != null && e.promAseg.n) {
    const d = inc - e.promAseg.valor;
    s.push([d > 8 ? 'warn' : 'info', `${p.aseguradora_nombre} subió en promedio ${e.promAseg.valor}% en ${e.promAseg.n} ${e.promAseg.n > 1 ? 'renovaciones' : 'renovación'} de ${RAMOS[p.ramo].toLowerCase()} de su cartera este año. ${d > 8 ? 'Esta subió bastante más: es probable que pese la edad o la siniestralidad del asegurado, no solo el ajuste general.' : 'Esta va en línea con el promedio: parece un ajuste general de la aseguradora.'}`]);
  }
  if (e.personas.length && p.ramo === 'gmm') {
    const txtE = e.personas.map(x => `${primerNombre(x.nombre)} ${x.edad ?? '¿?'}${x.edad != null ? ' años' : ''}`).join(', ');
    s.push(['info', `Edades al renovar: ${txtE}.`]);
    const may = e.personas.filter(x => x.edad >= 60);
    if (may.length) s.push(['warn', `${may.map(x => primerNombre(x.nombre)).join(' y ')} ${may.length > 1 ? 'tienen' : 'tiene'} 60 años o más: muchas aseguradoras ponen edad máxima para aceptar asegurados nuevos en gastos médicos. Verifíquela antes de proponer un cambio.`]);
    const salto = e.personas.filter(x => x.edad != null && x.edadAntes != null && Math.floor(x.edad / 5) > Math.floor(x.edadAntes / 5));
    if (salto.length) s.push(['info', `${salto.map(x => `${primerNombre(x.nombre)} pasó a ${x.edad} años`).join(', ')}: cambio de rango de edad, que suele subir la tarifa.`]);
  }
  if (!e.siniestros.length) s.push(['ok', 'Sin siniestros registrados: es buen candidato para cotizar en otras aseguradoras.']);
  else {
    const ab = e.siniestros.filter(x => x.abierto);
    s.push([ab.length ? 'bad' : 'warn', `${e.siniestros.length} siniestro${e.siniestros.length > 1 ? 's' : ''} registrado${e.siniestros.length > 1 ? 's' : ''}: ${e.siniestros.map(x => `${x.padecimiento || 'sin descripción'}${x.pagado ? ` (pagado ${money(x.pagado)})` : ''}${x.abierto ? ' — abierto' : ''}`).join('; ')}. ${ab.length ? 'Con un siniestro abierto, cambiar de aseguradora lo dejaría como preexistencia, sin cobertura.' : 'En una aseguradora nueva ese padecimiento probablemente se excluya como preexistente.'}`]);
  }
  if (e.anios != null && e.anios >= 1) s.push(['info', `Antigüedad de ${e.anios} año${e.anios === 1 ? '' : 's'} con ${p.aseguradora_nombre}. Al cambiar se reinician los periodos de espera, salvo que la nueva aseguradora reconozca antigüedad.`]);
  const ded = montoDe(r?.datos_ramo?.deducible ?? p.datos_ramo?.deducible);
  if (p.ramo === 'gmm' && ded != null) s.push(['info', `Deducible de ${money(ded)}${(r?.datos_ramo?.coaseguro || p.datos_ramo?.coaseguro) ? ` y coaseguro de ${r?.datos_ramo?.coaseguro || p.datos_ramo?.coaseguro}` : ''}. Subir el deducible o el coaseguro es la forma más directa de bajar la prima sin cambiar de aseguradora.`]);
  if (p.ramo === 'auto') s.push(['info', 'En autos, cambiar el deducible de daños materiales (por ejemplo de 5% a 10%) o pasar de amplia a limitada en vehículos con más años baja la prima.']);
  return s;
}

// ---------------------------------------------------------------- Pantalla de análisis
export async function vistaAnalisis(main, polizaId, vigente) {
  const e = await armarEntrada(polizaId);
  if (!vigente()) return;
  if (!e) { main.innerHTML = '<div class="card"><h2>Póliza no encontrada</h2><a href="#/renovaciones">Volver a renovaciones</a></div>'; return; }
  const { p, r, c } = e, an = e.analisis || {}, res = an.resultado, cots = an.cotizaciones || [];
  const mesP = p.fin_vigencia.slice(0, 7);
  const camposR = CAMPOS_RAMO[p.ramo] || [];
  const fila = (etq, a, b) => { const dif = String(a ?? '') !== String(b ?? ''); return `<tr><td class="muted">${etq}</td><td>${esc(a ?? '—')}</td><td${dif && r ? ' style="font-weight:600"' : ''}>${r ? esc(b ?? '—') : '<span class="muted">Por cargar</span>'}${dif && r ? ' <span class="pill p-warn" style="margin-left:4px">cambió</span>' : ''}</td></tr>`; };
  const tipoSen = { bad: '!', warn: '!', ok: '✓', info: 'i' };
  const historialMax = Math.max(...e.historial.map(h => h.prima), 1);

  main.innerHTML = `
  <div class="muted"><a href="#/renovaciones?m=${mesP}">Renovaciones de ${esc(nombreMes(mesP).toLowerCase())}</a> / ${esc(p.cliente_nombre)}</div>
  <header class="card">
    <div class="head" style="align-items:flex-start">
      <div><h1 style="font-size:24px">Renovación de ${esc(p.cliente_nombre)}</h1>
        <div class="muted" style="margin-top:4px">${esc(RAMOS[p.ramo])} · ${esc(p.aseguradora_nombre)}${p.producto ? ' · ' + esc(p.producto) : ''} · póliza ${esc(p.numero_poliza || 's/n')} · renueva el ${fdate(p.fin_vigencia)}</div></div>
      <div class="filters">${an.decision ? pill(DECISIONES, an.decision) : ''}<a class="btn" href="#/cliente/${p.cliente_id}">Ficha del cliente</a>
        ${r ? '' : '<button class="btn primary" type="button" id="aCargar">Cargar renovación</button>'}</div>
    </div>
    ${r ? `<div class="salto">
      <div><div class="lbl">Año anterior</div><div class="cifra">${money(p.prima_total, p.moneda)}</div></div>
      <div class="flecha" aria-hidden="true">→</div>
      <div><div class="lbl">Renovación</div><div class="cifra">${money(r.prima_total, r.moneda)}</div></div>
      <div class="pct ${e.inc > umbral() ? 'bad' : e.inc > umbral() * 0.66 ? 'warn' : 'ok'}">${e.inc == null ? '—' : (e.inc > 0 ? '+' : '') + e.inc.toFixed(1) + '%'}<span>${e.inc == null ? '' : (e.inc >= 0 ? '+' : '−') + money(Math.abs(r.prima_total - p.prima_total), r.moneda)}</span></div>
    </div>` : '<p class="muted" style="margin:14px 0 0">Cargue la renovación para compararla con el año anterior.</p>'}
  </header>

  <section class="row">
    <div class="col" style="flex:3 1 560px">
      <div class="card"><h2 style="margin-bottom:12px">Qué hay que considerar</h2>
        <ul class="senales">${senales(e).map(([k, t]) => `<li class="s-${k}"><span class="ico" aria-hidden="true">${tipoSen[k]}</span><span>${esc(t)}</span></li>`).join('')}</ul></div>

      <div class="card" id="propuesta">
        <div class="card-head"><h2>1. Qué conviene hacer</h2>${r ? `<button class="btn ${res ? '' : 'primary'}" type="button" id="aIA">${res ? 'Volver a analizar' : 'Analizar renovación'}</button>` : ''}</div>
        ${res && (res.n_cotizaciones ?? 0) !== cots.length ? `<p class="small" role="status" style="margin:0 0 12px;padding:8px 12px;border-left:4px solid var(--warn);background:var(--warn-bg)">Hay cotizaciones que el análisis aún no considera. Use «Volver a analizar» para que diga cuál conviene.</p>` : ''}
        <div id="aRes">${res ? pintarResultado(res, an, cots) : `<p class="muted" style="margin:0">${r ? 'La app revisa la renovación, edades, siniestros, antigüedad, endosos y coberturas, y le dice qué opciones tiene: renovar igual, ajustar coberturas o cotizar con otra aseguradora (y con cuál). Cada opción trae su botón para subir la cotización.' : 'Disponible al cargar la renovación.'}</p>`}</div>
      </div>

      <div class="card"><div class="card-head"><h2>2. Cotizaciones</h2><div class="filters">
          <label class="btn sm${r ? '' : ' disabled'}" for="aVarias" style="cursor:pointer">Subir PDFs de cotizaciones</label><input type="file" id="aVarias" class="sr" accept="application/pdf,.pdf" multiple${r ? '' : ' disabled'}>
          <button class="btn sm" type="button" id="aCot"${r ? '' : ' disabled'}>Agregar a mano</button></div></div>
        <p id="aVarMsg" class="small" role="status" style="margin:0"></p>
        ${cots.length ? `<div class="list">${cots.map((k, i) => `<div class="li"><div><b>${esc(k.aseguradora)}</b>${k.plan ? ` · ${esc(k.plan)}` : ''} <span class="num">${k.prima_total ? money(k.prima_total) : ''}</span>
            ${k.opcion ? `<div class="muted small">Para la opción: ${esc(k.opcion)}</div>` : ''}</div>
            <span class="nw">${k.archivo_ruta ? `<button type="button" class="linkbtn small" data-verc="${i}">PDF</button> ` : ''}<button type="button" class="linkbtn small" data-edc="${i}">Editar</button> <button type="button" class="linkbtn small" data-delc="${i}">Quitar</button></span></div>`).join('')}</div>`
          : `<p class="muted small" style="margin:0">Suba una, dos o tres cotizaciones en PDF (puede seleccionarlas juntas): la app lee prima, deducible, coaseguro, suma y nivel hospitalario, y arma el cuadro comparativo de abajo.</p>`}
      </div>

    </div>

    <div class="col" style="flex:2 1 340px">
      <div class="card"><h2 style="margin-bottom:10px">Historial de primas</h2>
        <div class="hist">${e.historial.map((h, i) => { const prev = e.historial[i - 1], d = prev && prev.moneda === h.moneda ? Math.round((h.prima - prev.prima) / prev.prima * 1000) / 10 : null; return `
          <div class="hrow${h.renovacion ? ' nueva' : ''}"><span class="small">${h.inicio ? h.inicio.slice(0, 4) : ''}</span>
            <div class="hbar"><div style="width:${h.prima / historialMax * 100}%"></div></div>
            <span class="num small">${money(h.prima, h.moneda)}${d != null ? ` <span class="muted">${d > 0 ? '+' : ''}${d}%</span>` : ''}</span></div>`; }).join('')}</div>
        <p class="muted small" style="margin:10px 0 0">${e.anios ? `${e.anios} años con ${esc(p.aseguradora_nombre)}` : ''}${e.clienteDesde ? `${e.anios ? ' · ' : ''}cliente desde ${e.clienteDesde}` : ''}</p></div>

      <div class="card"><h2 style="margin-bottom:10px">Decisión</h2>
        <div class="form-grid">${select('Qué se decidió', 'decision', opts(Object.fromEntries(Object.entries(DECISIONES).map(([k, v]) => [k, v[0]])), an.decision || 'pendiente'), { wide: true })}
          ${textarea('Notas', 'notas', an.notas || '')}</div>
        <div class="filters" style="margin-top:12px"><button class="btn primary" type="button" id="aGuardar"${r ? '' : ' disabled'}>Guardar decisión</button></div></div>
    </div>
  </section>
  <section class="card" id="cuadro">
    <div class="card-head"><h2>3. Cuadro comparativo</h2>${r ? '<button class="btn sm primary" type="button" id="aCmp">PDF para el cliente</button>' : ''}</div>
    ${cuadro(e, cots, res)}
  </section>`;

  // ---- acciones
  const guardar = async cambios => {
    const fila0 = { poliza_id: p.id, renovacion_id: r?.id || null, incremento: e.inc, ...cambios };
    if (e.analisis) { await q(sb.from('renovacion_analisis').update(fila0).eq('id', e.analisis.id)); Object.assign(e.analisis, fila0); }
    else e.analisis = await q(sb.from('renovacion_analisis').insert(fila0).select().single());
  };
  main.querySelector('#aCargar')?.addEventListener('click', async () => {
    const pol = await q(sb.from('polizas').select('*').eq('id', p.id).single());
    formPoliza({ poliza: pol, modo: 'renovar', alGuardar: refrescar });
  });
  main.querySelector('#aGuardar').onclick = async () => {
    try { await guardar({ decision: main.querySelector('[name=decision]').value, notas: txt(main.querySelector('[name=notas]').value) }); toast('Decisión guardada.'); refrescar(); }
    catch (err) { toast(err.message, true); }
  };
  // Al agregar cotizaciones, el análisis se vuelve a correr solo para decir cuál conviene
  const conCots = async (nuevas, aviso) => { await guardar({ cotizaciones: nuevas }); toast(aviso); location.hash = '#/renovacion/' + p.id + '?auto'; refrescar(); };
  main.querySelector('#aCot').onclick = () => formCotizacion(async k => conCots([...cots, k], 'Cotización agregada. Actualizando el análisis…'), p.cliente_id, { opciones: res?.opciones });
  main.querySelector('#aVarias').onchange = async ev => {
    const files = [...ev.target.files]; if (!files.length) return; const msg = main.querySelector('#aVarMsg'); const nuevas = [];
    for (const [i, file] of files.entries()) {
      msg.style.color = ''; msg.textContent = `Leyendo cotización ${i + 1} de ${files.length}: ${file.name}…`;
      try { nuevas.push(await leerCotizacion(file, p.cliente_id, res?.opciones)); }
      catch (err) { msg.style.color = 'var(--bad)'; msg.textContent = `${file.name}: ${err.message}`; }
    }
    if (nuevas.length) await conCots([...cots, ...nuevas], `${nuevas.length} cotización${nuevas.length > 1 ? 'es' : ''} agregada${nuevas.length > 1 ? 's' : ''}. Revise los datos en el cuadro; el análisis se actualiza.`);
  };
  main.querySelectorAll('[data-edc]').forEach(b => b.onclick = () => { const i = Number(b.dataset.edc); formCotizacion(async k => conCots(cots.map((x, j) => j === i ? { ...x, ...k } : x), 'Cotización actualizada.'), p.cliente_id, { cot: cots[i], opciones: res?.opciones }); });
  main.querySelector('#aCmp')?.addEventListener('click', () => {
    const mejor = res?.comparacion?.mejor;
    abrirComparativo({ para: p.cliente_nombre, ramo: p.ramo, clienteId: p.cliente_id, opciones: [
      { etiqueta: `Renovación ${r.aseguradora_nombre}`, aseguradora: r.aseguradora_nombre, plan: r.producto, prima_total: Number(r.prima_total), deducible: r.datos_ramo?.deducible, coaseguro: r.datos_ramo?.coaseguro, suma_asegurada: r.datos_ramo?.suma_asegurada, actual: true, recomendada: mejor === 'renovacion' },
      ...cots.map((k, i) => ({ etiqueta: `${k.aseguradora}${k.plan ? ' ' + k.plan : ''}`, ...k, recomendada: mejor === i }))] });
  });
  main.querySelectorAll('[data-delc]').forEach(b => b.onclick = async () => { const n = cots.filter((_, i) => i !== Number(b.dataset.delc)); await guardar({ cotizaciones: n }); refrescar(); });
  main.querySelectorAll('[data-verc]').forEach(b => b.onclick = () => abrirArchivo(cots[Number(b.dataset.verc)].archivo_ruta));
  const bIA = main.querySelector('#aIA');
  if (bIA) bIA.onclick = async () => {
    const box = main.querySelector('#aRes'); bIA.disabled = true;
    box.innerHTML = '<div class="pensando"><span></span><span></span><span></span> Analizando edades, siniestros, coberturas y cotizaciones…</div>';
    try {
      const entrada = paraIA(e, cots);
      const x = await extraerConIA(INSTRUCCION_RENOVACION, { texto: JSON.stringify(entrada, null, 1) });
      if (!x || !Array.isArray(x.opciones)) throw new Error('La lectura automática no devolvió una propuesta. Intente de nuevo.');
      await guardar({ resultado: { ...x, n_cotizaciones: cots.length, generado_en: new Date().toISOString() }, entrada });
      history.replaceState(null, '', '#/renovacion/' + p.id);
      refrescar(); return;
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    bIA.disabled = false;
  };
  if (res) conectarResultado(main.querySelector('#aRes'), e, res, cots, p => formCotizacion(async k => conCots([...cots, k], 'Cotización agregada. Actualizando el análisis…'), e.p.cliente_id, p));
  // Recién cargada la renovación (o con cotizaciones nuevas), el análisis corre solo
  if (bIA && /[?&]auto\b/.test(location.hash) && (!res || (res.n_cotizaciones ?? 0) !== cots.length)) bIA.click();
  else if (/[?&]auto\b/.test(location.hash)) history.replaceState(null, '', '#/renovacion/' + p.id);
}

// Cuadro comparativo: año anterior, renovación y cada cotización, fila por fila
function cuadro(e, cots, res) {
  const { p, r } = e;
  if (!r) return '<p class="muted small" style="margin:0">Cargue la renovación para comparar.</p>';
  const camposR = (CAMPOS_RAMO[p.ramo] || []).filter(([k]) => !['deducible', 'coaseguro', 'suma_asegurada'].includes(k));
  const cols = [
    { tit: 'Año anterior', sub: p.numero_poliza || '', aseguradora: p.aseguradora_nombre, plan: p.producto, prima: Number(p.prima_total), moneda: p.moneda, dr: p.datos_ramo || {}, forma: FORMAS[p.forma_pago], tipo: 'anterior' },
    { tit: 'Renovación', sub: r.numero_poliza || '', aseguradora: r.aseguradora_nombre, plan: r.producto, prima: Number(r.prima_total), moneda: r.moneda, dr: r.datos_ramo || {}, forma: FORMAS[r.forma_pago], tipo: 'renovacion' },
    ...cots.map((k, i) => ({ tit: `Cotización ${i + 1}`, sub: k.opcion || '', aseguradora: k.aseguradora, plan: k.plan, prima: Number(k.prima_total) || null, moneda: r.moneda,
      dr: { deducible: k.deducible, coaseguro: k.coaseguro, suma_asegurada: k.suma_asegurada, nivel_hospitalario: k.nivel_hospitalario, tope_coaseguro: k.tope_coaseguro }, forma: k.forma_pago, notas: k.notas, tipo: 'cot', i })),
  ];
  const ofertas = cols.slice(1).filter(c => c.prima > 0), barata = ofertas.length > 1 ? Math.min(...ofertas.map(c => c.prima)) : null;
  const mejor = res && (res.n_cotizaciones ?? 0) === cots.length ? res.comparacion?.mejor : undefined;
  const esMejor = c => (mejor === 'renovacion' && c.tipo === 'renovacion') || (c.tipo === 'cot' && mejor === c.i);
  const dif = (a, b) => a && b ? Math.round((a - b) / b * 1000) / 10 : null;
  const pctPill = v => v == null ? '<span class="muted">—</span>' : `<span class="pill ${v < 0 ? 'p-ok' : v > 0 ? 'p-bad' : 'p-gray'}">${v > 0 ? '+' : ''}${v}%</span>`;
  const filaT = (lbl, f, resaltar = true) => { const vals = cols.map(f); const distintos = resaltar && new Set(vals.slice(1).map(v => String(v ?? ''))).size > 1;
    return `<tr><th scope="row">${lbl}</th>${vals.map((v, i) => `<td class="${esMejor(cols[i]) ? 'mejor' : ''}"${distintos && i > 0 ? ' style="font-weight:600"' : ''}>${v == null || v === '' ? '<span class="muted">—</span>' : v}</td>`).join('')}</tr>`; };
  return `<div class="tbl-wrap"><table class="cuadro">
    <thead><tr><th></th>${cols.map(c => `<th class="${esMejor(c) ? 'mejor' : ''}">${esc(c.tit)}${esMejor(c) ? ' <span class="pill p-ok">Recomendada</span>' : ''}<div class="muted small" style="font-weight:400">${esc(c.sub)}</div></th>`).join('')}</tr></thead>
    <tbody>
      ${filaT('Aseguradora', c => `<b>${esc(c.aseguradora || '')}</b>`)}
      ${filaT('Plan', c => esc(c.plan || ''))}
      ${filaT('Prima total anual', c => c.prima ? `<span class="num"${c.prima === barata && c.tipo !== 'anterior' ? ' style="color:var(--ok);font-weight:700"' : ''}>${money(c.prima, c.moneda)}</span>${c.prima === barata && c.tipo !== 'anterior' ? '<div class="small" style="color:var(--ok)">La más barata</div>' : ''}` : '', false)}
      ${filaT('vs. renovación', c => c.tipo === 'anterior' ? '' : c.tipo === 'renovacion' ? '<span class="muted small">base</span>' : `${pctPill(dif(c.prima, cols[1].prima))}${c.prima ? `<div class="small muted">${c.prima - cols[1].prima >= 0 ? '+' : '−'}${money(Math.abs(c.prima - cols[1].prima), c.moneda)}</div>` : ''}`, false)}
      ${filaT('vs. año anterior', c => c.tipo === 'anterior' ? '<span class="muted small">base</span>' : pctPill(cols[0].moneda === c.moneda ? dif(c.prima, cols[0].prima) : null), false)}
      ${filaT('Deducible', c => esc(c.dr.deducible || ''))}
      ${filaT('Coaseguro', c => esc([c.dr.coaseguro, c.dr.tope_coaseguro ? 'tope ' + c.dr.tope_coaseguro : ''].filter(Boolean).join(' · ')))}
      ${filaT('Suma asegurada', c => esc(c.dr.suma_asegurada || ''))}
      ${p.ramo === 'gmm' ? filaT('Nivel hospitalario', c => esc(c.dr.nivel_hospitalario || '')) : ''}
      ${camposR.map(([k, l]) => filaT(esc(l), c => esc(c.dr[k] || ''))).join('')}
      ${filaT('Forma de pago', c => esc(c.forma || ''))}
      ${cots.some(k => k.notas) ? filaT('Notas', c => `<span class="small">${esc(c.notas || '')}</span>`, false) : ''}
    </tbody></table></div>
    ${mejor !== undefined && res.comparacion?.explicacion ? `<p class="small" style="margin:12px 0 0"><b>Cuál conviene:</b> ${esc(res.comparacion.explicacion)}</p>` : ''}
    ${!cots.length ? '<p class="muted small" style="margin:10px 0 0">Al subir cotizaciones aparecen aquí como columnas, junto al año anterior y la renovación.</p>' : ''}`;
}

// Lo que se le manda a la IA: solo lo necesario, sin datos de contacto
function paraIA(e, cots) {
  const { p, r } = e;
  const pol = x => x && { aseguradora: x.aseguradora_nombre, producto: x.producto, ramo: RAMOS[x.ramo], inicio: x.inicio_vigencia, fin: x.fin_vigencia, forma_pago: x.forma_pago, moneda: x.moneda,
    prima_neta: Number(x.prima_neta), prima_total: Number(x.prima_total), coberturas: x.datos_ramo || {} };
  return {
    umbral_alerta_pct: umbral(), incremento_pct: e.inc, poliza_anterior: pol(p), renovacion: pol(r),
    asegurados: e.personas.map(x => ({ parentesco: x.parentesco, edad_al_renovar: x.edad })),
    siniestros: e.siniestros.map(s => ({ padecimiento: s.padecimiento, fecha: s.fecha, tipo: s.tipo, abierto: s.abierto, monto_pagado: s.pagado })),
    antiguedad_con_aseguradora_anios: e.anios, historial_primas: e.historial,
    endosos_en_la_vigencia: (e.endosos || []).map(m => ({ tipo: m.tipo, descripcion: m.descripcion, importe: Number(m.importe) })), prima_actual_sin_endosos: e.primaOriginal,
    promedio_incremento_misma_aseguradora: e.promAseg, promedio_incremento_ramo_cartera: e.promRamo,
    productos_en_catalogo_de_otras_aseguradoras: e.otros, cotizaciones_recibidas: cots.map(({ archivo_ruta, ...k }) => k),
  };
}

function pintarResultado(x, an, cots = []) {
  const op = [...(x.opciones || [])].sort((a, b) => (a.prioridad || 9) - (b.prioridad || 9));
  return `
    <p style="margin-top:0">${esc(x.resumen || '')}</p>
    ${x.causa_probable ? `<p class="small" style="margin:-4px 0 14px"><span class="muted">Causa probable del aumento:</span> <b>${esc(x.causa_probable)}</b></p>` : ''}
    <div class="opciones">${op.map((o, i) => `<article class="opcion${o.tipo === x.recomendacion && i === 0 ? ' recomendada' : ''}">
      <div class="op-h"><span class="op-tipo t-${esc(o.tipo)}">${esc(TIPO_OPCION[o.tipo] || o.tipo)}</span>${o.tipo === x.recomendacion && i === 0 ? '<span class="pill p-ok">Recomendada</span>' : ''}</div>
      <h3>${esc(o.titulo || '')}</h3><p class="small">${esc(o.descripcion || '')}</p>
      ${o.ventajas?.length ? `<div class="small"><b>A favor:</b><ul>${o.ventajas.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}
      ${o.riesgos?.length ? `<div class="small"><b>A considerar:</b><ul>${o.riesgos.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}
      ${o.que_cotizar ? `<p class="small cotizar"><b>Qué cotizar:</b> ${esc(o.que_cotizar)}</p>` : ''}
      ${o.efecto_prima ? `<p class="small muted" style="margin:6px 0 0">${esc(o.efecto_prima)}</p>` : ''}
      ${o.tipo !== 'igual' ? (() => { const ks = cots.filter(k => k.opcion === o.titulo); return ks.length ? `<p class="small" style="margin:6px 0 0;color:var(--ok)">✓ ${ks.length} cotización${ks.length > 1 ? 'es' : ''} subida${ks.length > 1 ? 's' : ''} para esta opción</p>` : ''; })() : ''}
      <div class="filters" style="margin-top:10px">${o.tipo !== 'igual' ? `<button type="button" class="btn sm primary" data-cotop="${i}">Subir cotización</button>` : ''}<button type="button" class="btn sm" data-tarea="${i}">Crear tarea</button></div>
    </article>`).join('')}</div>
    ${x.preguntas_al_cliente?.length ? `<div class="small" style="margin-top:14px"><b>Antes de decidir, pregunte al cliente:</b><ul>${x.preguntas_al_cliente.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}
    ${x.mensaje_cliente ? `<div style="margin-top:14px"><label for="aMsg" class="lbl">Mensaje para el cliente</label>
      <textarea id="aMsg" style="min-height:120px;margin-top:6px">${esc(x.mensaje_cliente)}</textarea>
      <div class="filters" style="margin-top:8px"><button type="button" class="btn sm" id="aWa">Enviar por WhatsApp</button><button type="button" class="btn sm" id="aCopiar">Copiar</button></div></div>` : ''}
    <p class="muted small" style="margin:14px 0 0">Sugerencia generada con IA a partir de los datos registrados${an?.resultado?.generado_en ? ` el ${fdate(an.resultado.generado_en.slice(0, 10))}` : ''}. Confirme condiciones, edades de aceptación y precios con cada aseguradora antes de proponerla.</p>`;
}

function conectarResultado(box, e, x, cots = [], abrirCot = null) {
  const op = [...(x.opciones || [])].sort((a, b) => (a.prioridad || 9) - (b.prioridad || 9));
  box.querySelectorAll('[data-cotop]').forEach(b => b.onclick = () => { const o = op[Number(b.dataset.cotop)];
    abrirCot?.({ opciones: x.opciones, opcion: o.titulo, cot: o.tipo === 'ajuste' ? { aseguradora: e.r?.aseguradora_nombre || e.p.aseguradora_nombre } : null }); });
  box.querySelectorAll('[data-tarea]').forEach(b => b.onclick = () => {
    const o = op[Number(b.dataset.tarea)];
    formTarea({ prefill: { titulo: `${o.tipo === 'igual' ? 'Confirmar renovación' : 'Cotizar'}: ${o.titulo} — ${e.p.cliente_nombre}`.slice(0, 160), tipo: o.tipo === 'igual' ? 'renovacion' : 'cotizacion', prioridad: 'alta',
      cliente_id: e.p.cliente_id, poliza_id: (e.r || e.p).id, asignado_a: e.c?.agente_id || ctx.perfil.id, fecha: hoyISO(),
      descripcion: [o.descripcion, o.que_cotizar ? 'Qué cotizar: ' + o.que_cotizar : ''].filter(Boolean).join('\n') }, alGuardar: () => toast('Tarea creada en el tablero.') });
  });
  const msg = () => box.querySelector('#aMsg')?.value || '';
  box.querySelector('#aWa')?.addEventListener('click', () => { const l = waLink(e.c?.whatsapp || e.c?.telefono, msg()); if (l) window.open(l, '_blank', 'noopener'); else toast('El cliente no tiene teléfono registrado.', true); });
  box.querySelector('#aCopiar')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(msg()); toast('Mensaje copiado.'); } catch { toast('No se pudo copiar; selecciónelo y cópielo a mano.', true); } });
}

// Cotización de otra aseguradora (manual o leída del PDF)
async function leerCotizacion(file, clienteId) {
  const x = await extraerConIA(INSTRUCCION_COTIZACION, await leerPdf(file, { maxPaginas: 6 }));
  if (!x?.aseguradora && !Number(x?.prima_total)) throw new Error('No encontré aseguradora ni prima en el PDF; agréguela a mano.');
  const k = { aseguradora: txt(x.aseguradora) || 'Sin nombre', plan: txt(x.plan), prima_total: Number(x.prima_total) || null, deducible: txt(x.deducible), coaseguro: txt(x.coaseguro), tope_coaseguro: txt(x.tope_coaseguro),
    suma_asegurada: txt(x.suma_asegurada), nivel_hospitalario: txt(x.nivel_hospitalario), forma_pago: txt(x.forma_pago), notas: txt(x.notas), agregada: hoyISO() };
  k.archivo_ruta = await subirArchivo(file, clienteId, 'cotizaciones');
  return k;
}
function formCotizacion(alGuardar, clienteId, { cot = null, opciones = null, opcion = null } = {}) {
  let archivo = null; const k0 = cot || {};
  const ops = (opciones || []).filter(o => o.tipo !== 'igual');
  modal({
    titulo: cot?.prima_total ? 'Editar cotización' : 'Agregar cotización', boton: cot?.prima_total ? 'Guardar' : 'Agregar',
    cuerpo: `<div class="pdf-box"><div><b>¿Tiene el PDF de la cotización?</b><div class="muted small">Súbalo y se llenan los datos.</div></div>
        <label class="btn sm primary" for="cPdf" style="cursor:pointer">Leer PDF</label><input type="file" id="cPdf" class="sr" accept="application/pdf,.pdf"></div>
      <p id="cPdfMsg" class="small" role="status" style="margin:0 0 12px"></p>
      <div class="form-grid">
        ${ops.length ? select('Opción del análisis', 'opcion', `<option value="">— Ninguna en particular —</option>${ops.map(o => `<option value="${esc(o.titulo)}"${o.titulo === (opcion || k0.opcion) ? ' selected' : ''}>${esc(o.titulo)}</option>`).join('')}`, { wide: true }) : ''}
        <div class="field"><label for="cAseg">Aseguradora *</label><input id="cAseg" name="aseguradora" list="cAsegL" required value="${esc(k0.aseguradora || '')}"><datalist id="cAsegL">${ctx.aseguradoras.map(a => `<option value="${esc(a.nombre)}">`).join('')}</datalist></div>
        ${input('Plan o producto', 'plan', { value: k0.plan || '' })}
        ${input('Prima total anual', 'prima_total', { type: 'number', req: true, value: k0.prima_total ?? '', attrs: 'step="0.01" min="0"' })}
        ${input('Deducible', 'deducible', { value: k0.deducible || '' })}
        ${input('Coaseguro', 'coaseguro', { value: k0.coaseguro || '' })}
        ${input('Tope de coaseguro', 'tope_coaseguro', { value: k0.tope_coaseguro || '' })}
        ${input('Suma asegurada', 'suma_asegurada', { value: k0.suma_asegurada || '' })}
        ${input('Nivel hospitalario', 'nivel_hospitalario', { value: k0.nivel_hospitalario || '' })}
        ${input('Forma de pago cotizada', 'forma_pago', { value: k0.forma_pago || '' })}
        ${textarea('Notas (exclusiones, periodos de espera, reconocimiento de antigüedad…)', 'notas', k0.notas || '')}
      </div>`,
    onOpen: f => {
      f.querySelector('#cPdf').onchange = async ev => {
        const file = ev.target.files[0]; if (!file) return; const msg = f.querySelector('#cPdfMsg');
        msg.style.color = ''; msg.textContent = 'Leyendo la cotización…';
        try {
          const x = await extraerConIA(INSTRUCCION_COTIZACION, await leerPdf(file, { maxPaginas: 6 }));
          ['aseguradora', 'plan', 'deducible', 'coaseguro', 'tope_coaseguro', 'suma_asegurada', 'nivel_hospitalario', 'forma_pago', 'notas'].forEach(k => { if (x?.[k] && f[k]) f[k].value = x[k]; });
          if (Number(x?.prima_total) > 0) f.prima_total.value = Number(x.prima_total);
          archivo = file; msg.style.color = 'var(--ok)'; msg.textContent = 'Datos leídos. Revíselos antes de agregar.';
        } catch (err) { msg.style.color = 'var(--bad)'; msg.textContent = err.message; }
      };
    },
    onSubmit: async d => {
      const k = { ...k0, aseguradora: txt(d.aseguradora), plan: txt(d.plan), prima_total: num(d.prima_total), deducible: txt(d.deducible), coaseguro: txt(d.coaseguro), tope_coaseguro: txt(d.tope_coaseguro),
        suma_asegurada: txt(d.suma_asegurada), nivel_hospitalario: txt(d.nivel_hospitalario), forma_pago: txt(d.forma_pago), notas: txt(d.notas), opcion: txt(d.opcion) || opcion || k0.opcion || null, agregada: k0.agregada || hoyISO() };
      if (!k.aseguradora || !k.prima_total) throw new Error('Escriba la aseguradora y la prima.');
      if (archivo) k.archivo_ruta = await subirArchivo(archivo, clienteId, 'cotizaciones');
      await alGuardar(k);
    }
  });
}
