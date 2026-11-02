// Reporte mensual en PDF: producción, cobranza, comisiones, renovaciones, siniestros y tareas
import { sb, ctx, q, aPesos } from '../db.js';
import { cargarPdfLib, descargar, money, iso, MESES_LARGOS, RAMOS, TIPOS_TAREA, modal, toast } from '../ui.js';

export async function datosMes(anio, mes) {
  const ini = iso(new Date(anio, mes, 1)), fin = iso(new Date(anio, mes + 1, 0));
  const [polizas, pagados, vencidos, terminan, tramites, tareas] = await Promise.all([
    q(sb.from('v_polizas').select('*').gte('inicio_vigencia', ini).lte('inicio_vigencia', fin)),
    q(sb.from('v_recibos').select('*').eq('estatus', 'pagado').gte('fecha_pago', ini).lte('fecha_pago', fin)),
    q(sb.from('v_recibos').select('*').eq('situacion', 'vencido')),
    q(sb.from('v_polizas').select('*').gte('fin_vigencia', ini).lte('fin_vigencia', fin).neq('estatus', 'cancelada')),
    q(sb.from('tramites').select('*')),
    q(sb.from('tareas').select('*')),
  ]);
  const sum = (l, f) => l.reduce((a, x) => a + Number(f(x) || 0), 0);
  const mxn = polizas.map(aPesos);
  const enMes = d => d && d.slice(0, 10) >= ini && d.slice(0, 10) <= fin;
  return {
    ini, fin, titulo: `${MESES_LARGOS[mes]} ${anio}`,
    nuevas: mxn.filter(p => !p.poliza_anterior_id), renov: mxn.filter(p => p.poliza_anterior_id),
    porRamo: Object.keys(RAMOS).map(r => [RAMOS[r], sum(mxn.filter(p => p.ramo === r), p => p.prima_total), mxn.filter(p => p.ramo === r).length]).filter(x => x[2]),
    porAseg: [...new Set(mxn.map(p => p.aseguradora_nombre))].map(a => [a, sum(mxn.filter(p => p.aseguradora_nombre === a), p => p.prima_total)]).sort((a, b) => b[1] - a[1]),
    cobrado: sum(pagados, r => r.prima_total), nCobrado: pagados.length, vencidos, vencidoMonto: sum(vencidos, r => r.prima_total),
    comEsp: sum(pagados, r => r.comision_esperada), comRec: sum(pagados, r => r.comision_recibida),
    renovadas: terminan.filter(p => p.estatus === 'renovada'), perdidas: terminan.filter(p => p.estatus !== 'renovada' && (p.fin_vigencia < hoyStr() || p.seguimiento === 'no_renueva')),
    pendientesRen: terminan.filter(p => p.estatus === 'activa' && p.fin_vigencia >= hoyStr() && p.seguimiento !== 'no_renueva'),
    trAbiertos: tramites.filter(t => enMes(t.creado_en)), trPagados: tramites.filter(t => t.estatus === 'pagado' && enMes(t.actualizado_en)),
    tareasHechas: tareas.filter(t => t.estatus === 'listo' && enMes(t.completada_en)), tareasAbiertas: tareas.filter(t => t.estatus !== 'listo'),
    sum,
  };
}
const hoyStr = () => iso(new Date());

export async function pdfReporteMensual(anio, mes) {
  const d = await datosMes(anio, mes);
  const { PDFDocument, StandardFonts, rgb } = await cargarPdfLib();
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const gris = rgb(0.36, 0.4, 0.45), linea = rgb(0.85, 0.87, 0.9), acento = rgb(0.12, 0.31, 0.47);
  const L = t => String(t ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  let page, y;
  const nueva = () => { page = pdf.addPage([612, 792]); y = 740; page.drawText(L(`${ctx.agencia?.nombre || ''} · Reporte de ${d.titulo}`).replace('·', '-'), { x: 50, y: 770, size: 8, font: f, color: gris }); };
  const espacio = h => { if (y - h < 60) nueva(); };
  const titulo = t => { espacio(40); y -= 10; page.drawText(L(t), { x: 50, y, size: 13, font: fb, color: acento }); y -= 6; page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.8, color: linea }); y -= 18; };
  const kpis = items => { espacio(48); items.forEach(([k, v], i) => { const x = 50 + i * (512 / items.length); page.drawText(L(k).toUpperCase(), { x, y, size: 7, font: f, color: gris }); page.drawText(L(v), { x, y: y - 16, size: 14, font: fb }); }); y -= 40; };
  const filaT = (cols, anchos, opts = {}) => { espacio(16); let x = 50; cols.forEach((c, i) => { const t = L(c).slice(0, opts.corte?.[i] || 60); const fx = opts.num?.includes(i) ? x + anchos[i] - (opts.bold ? fb : f).widthOfTextAtSize(t, 9) : x; page.drawText(t, { x: fx, y, size: 9, font: opts.bold ? fb : f, color: opts.gris ? gris : undefined }); x += anchos[i]; }); y -= 15; };
  const texto = t => { espacio(16); page.drawText(L(t), { x: 50, y, size: 9, font: f, color: gris }); y -= 15; };

  nueva();
  page.drawText(L(`Reporte mensual · ${d.titulo}`).replace('·', '-'), { x: 50, y: 726, size: 20, font: fb }); y = 690;
  page.drawText(L(`Generado el ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`), { x: 50, y: 708, size: 9, font: f, color: gris });

  titulo('Producción');
  kpis([['Pólizas nuevas', String(d.nuevas.length)], ['Prima nueva', money(d.sum(d.nuevas, p => p.prima_total))], ['Renovaciones', String(d.renov.length)], ['Prima renovada', money(d.sum(d.renov, p => p.prima_total))]]);
  if (d.porAseg.length) { filaT(['Aseguradora', 'Prima emitida'], [380, 132], { bold: true, num: [1] }); d.porAseg.forEach(([a, v]) => filaT([a, money(v)], [380, 132], { num: [1] })); y -= 6; }
  if (d.porRamo.length) { filaT(['Ramo', 'Pólizas', 'Prima emitida'], [300, 80, 132], { bold: true, num: [1, 2] }); d.porRamo.forEach(([r, v, n]) => filaT([r, String(n), money(v)], [300, 80, 132], { num: [1, 2] })); }

  titulo('Cobranza y comisiones');
  kpis([['Cobrado en el mes', money(d.cobrado)], ['Recibos cobrados', String(d.nCobrado)], ['Vencido hoy', money(d.vencidoMonto)], ['Comisión recibida', money(d.comRec)]]);
  texto(`Comisión esperada de lo cobrado en el mes: ${money(d.comEsp)}. Pendiente de recibir: ${money(Math.max(0, d.comEsp - d.comRec))}.`);
  if (d.vencidos.length) { y -= 4; filaT(['Recibos vencidos', 'Póliza', 'Importe'], [260, 140, 112], { bold: true, num: [2] }); d.vencidos.slice(0, 15).forEach(r => filaT([r.cliente_nombre, r.numero_poliza || '', money(r.prima_total)], [260, 140, 112], { num: [2], corte: [42, 22] })); }

  titulo('Renovaciones del mes');
  const tasa = d.renovadas.length + d.perdidas.length ? Math.round(d.renovadas.length / (d.renovadas.length + d.perdidas.length) * 100) + '%' : '-';
  kpis([['Renovadas', String(d.renovadas.length)], ['No renovadas', String(d.perdidas.length)], ['Por resolver', String(d.pendientesRen.length)], ['Tasa de renovación', tasa]]);
  if (d.perdidas.length) { filaT(['No renovadas', 'Póliza', 'Motivo'], [190, 120, 202], { bold: true }); d.perdidas.forEach(p => filaT([p.cliente_nombre, p.numero_poliza || '', p.motivo_no_renovacion || 'Sin registrar'], [190, 120, 202], { corte: [30, 18, 36] })); }

  titulo('Siniestros y reembolsos');
  kpis([['Carpetas abiertas en el mes', String(d.trAbiertos.length)], ['Pagadas en el mes', String(d.trPagados.length)], ['Recuperado para clientes', money(d.sum(d.trPagados, t => t.monto_pagado))]]);

  titulo('Tablero de trabajo');
  kpis([['Tareas terminadas', String(d.tareasHechas.length)], ['Tareas abiertas', String(d.tareasAbiertas.length)], ['Atrasadas', String(d.tareasAbiertas.filter(t => t.fecha && t.fecha < hoyStr()).length)]]);
  const porPersona = ctx.perfiles.filter(p => p.rol !== 'cliente').map(p => [p.nombre, d.tareasHechas.filter(t => t.asignado_a === p.id).length, d.tareasAbiertas.filter(t => t.asignado_a === p.id).length]).filter(x => x[1] || x[2]);
  if (porPersona.length) { filaT(['Persona', 'Terminadas', 'Abiertas'], [300, 106, 106], { bold: true, num: [1, 2] }); porPersona.forEach(([n, a, b]) => filaT([n, String(a), String(b)], [300, 106, 106], { num: [1, 2] })); }
  const porTipo = Object.keys(TIPOS_TAREA).map(k => [TIPOS_TAREA[k], d.tareasHechas.filter(t => t.tipo === k).length]).filter(x => x[1]);
  if (porTipo.length) texto('Terminadas por tipo: ' + porTipo.map(([t, n]) => `${t} ${n}`).join(', ') + '.');
  return pdf.save();
}

export function dialogoReporte() {
  const h = new Date();
  const opciones = [...Array(12)].map((_, i) => { const d = new Date(h.getFullYear(), h.getMonth() - i, 1); return [`${d.getFullYear()}-${d.getMonth()}`, `${MESES_LARGOS[d.getMonth()]} ${d.getFullYear()}`]; });
  modal({
    titulo: 'Reporte mensual', boton: 'Generar PDF',
    cuerpo: `<div class="field"><label for="rMes">Mes</label><select id="rMes" name="mes">${opciones.map(([v, t], i) => `<option value="${v}"${i === 1 ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      <p class="muted small">Incluye producción, cobranza, comisiones, renovaciones, siniestros y tareas del mes.</p>`,
    onSubmit: async x => {
      const [a, m] = x.mes.split('-').map(Number);
      const bytes = await pdfReporteMensual(a, m);
      await descargar(`Reporte ${MESES_LARGOS[m]} ${a} - ${ctx.agencia?.nombre || 'agencia'}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
      toast('Reporte generado.');
    }
  });
}
