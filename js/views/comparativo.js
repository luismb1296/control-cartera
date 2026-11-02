// Comparativo de cotizaciones para el cliente: varias opciones lado a lado, en PDF con la marca de la agencia
import { sb, ctx, q } from '../db.js';
import { esc, money, modal, toast, num, txt, hoyISO, cargarPdfLib, descargar, RAMOS } from '../ui.js';
import { leerPdf, extraerConIA, INSTRUCCION_COTIZACION } from '../ia.js';
import { subirArchivo } from './formas.js';
import { paletaDe, variables } from '../tema.js';

const CAMPOS = [['aseguradora', 'Aseguradora'], ['plan', 'Plan'], ['prima_total', 'Prima anual'], ['deducible', 'Deducible'], ['coaseguro', 'Coaseguro'], ['suma_asegurada', 'Suma asegurada'], ['notas', 'Notas']];

// opciones: [{ etiqueta, aseguradora, plan, prima_total, deducible, coaseguro, suma_asegurada, notas, actual }]
export function abrirComparativo({ para, ramo, opciones = [], clienteId = null, alGuardar }) {
  let lista = opciones.map(o => ({ ...o })), recomendada = Math.max(0, lista.findIndex(o => o.recomendada));
  if (!lista.some(o => o.recomendada) && lista.length > 1) { const baratas = lista.map((o, i) => [Number(o.prima_total) || Infinity, i]).sort((a, b) => a[0] - b[0]); recomendada = baratas[0][1]; }
  const dlg = modal({
    titulo: 'Comparativo para el cliente', boton: 'Generar PDF',
    cuerpo: `<p style="margin-top:0">Para <b>${esc(para || '')}</b>${ramo ? ` · ${esc(RAMOS[ramo] || ramo)}` : ''}. Revise los datos de cada opción; el PDF sale con el logo y los colores de la agencia.</p>
      <div id="cmpTabla"></div>
      <div class="filters" style="margin:10px 0 14px"><button type="button" class="btn sm" id="cmpAdd">+ Opción a mano</button>
        <label class="btn sm" for="cmpPdf" style="cursor:pointer">+ Opción desde PDF</label><input type="file" id="cmpPdf" class="sr" accept="application/pdf,.pdf"><span id="cmpMsg" class="small muted" role="status"></span></div>
      <div class="field"><label for="cmpNota">Comentario para el cliente (aparece en el PDF)</label><textarea id="cmpNota" style="min-height:70px">Le comparto las opciones que revisamos para usted. La opción marcada es la que le recomendamos; con gusto le explico las diferencias.</textarea></div>`,
    onOpen: f => {
      const caja = f.querySelector('#cmpTabla');
      const pintar = () => {
        caja.innerHTML = lista.length ? `<div class="tbl-wrap"><table class="cmp-edit"><thead><tr><th></th>${lista.map((o, i) => `<th><label class="small" style="display:flex;gap:6px;align-items:center;font-weight:600">
            <input type="radio" name="cmpRec" value="${i}" ${i === recomendada ? 'checked' : ''} style="width:auto;min-height:0"> Recomendar</label>
            <button type="button" class="linkbtn small" data-quitar="${i}">Quitar</button></th>`).join('')}</tr></thead><tbody>
          <tr><td class="muted small">Nombre de la opción</td>${lista.map((o, i) => `<td><input data-i="${i}" data-k="etiqueta" value="${esc(o.etiqueta || `Opción ${i + 1}`)}" aria-label="Nombre de la opción ${i + 1}"></td>`).join('')}</tr>
          ${CAMPOS.map(([k, l]) => `<tr><td class="muted small">${l}</td>${lista.map((o, i) => `<td><input data-i="${i}" data-k="${k}" value="${esc(o[k] ?? '')}"${k === 'prima_total' ? ' type="number" step="0.01" min="0"' : ''} aria-label="${l} de la opción ${i + 1}"></td>`).join('')}</tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Agregue al menos dos opciones para comparar.</p>';
        f.querySelector('[type=submit]').disabled = lista.length < 1;
      };
      caja.addEventListener('input', e => { const d = e.target.dataset; if (d.k) lista[Number(d.i)][d.k] = d.k === 'prima_total' ? num(e.target.value) : e.target.value; });
      caja.addEventListener('change', e => { if (e.target.name === 'cmpRec') recomendada = Number(e.target.value); });
      caja.addEventListener('click', e => { const i = e.target.dataset.quitar; if (i != null) { lista.splice(Number(i), 1); recomendada = Math.min(recomendada, Math.max(0, lista.length - 1)); pintar(); } });
      f.querySelector('#cmpAdd').onclick = () => { if (lista.length >= 5) return toast('Máximo 5 opciones por comparativo.', true); lista.push({ etiqueta: `Opción ${lista.length + 1}` }); pintar(); };
      f.querySelector('#cmpPdf').onchange = async e => {
        const file = e.target.files[0]; if (!file) return; const msg = f.querySelector('#cmpMsg');
        if (lista.length >= 5) return toast('Máximo 5 opciones por comparativo.', true);
        msg.textContent = 'Leyendo la cotización…';
        try { const x = await extraerConIA(INSTRUCCION_COTIZACION, await leerPdf(file, { maxPaginas: 6 })); lista.push({ ...x, etiqueta: x?.aseguradora || `Opción ${lista.length + 1}`, prima_total: Number(x?.prima_total) || null }); msg.textContent = 'Opción agregada.'; pintar(); }
        catch (err) { msg.textContent = err.message; }
        e.target.value = '';
      };
      pintar();
    },
    onSubmit: async (_d, f) => {
      if (!lista.length) throw new Error('Agregue al menos una opción.');
      lista.forEach((o, i) => { o.recomendada = i === recomendada; });
      const bytes = await pdfComparativo({ para, ramo, opciones: lista, nota: f.querySelector('#cmpNota').value.trim() });
      const nombre = `Comparativo ${RAMOS[ramo] || ''} - ${para || 'cliente'}.pdf`.replace(/\s+/g, ' ');
      const blob = new Blob([bytes], { type: 'application/pdf' });
      await descargar(nombre, blob);
      if (clienteId) {
        try {
          const ruta = await subirArchivo(new File([blob], nombre, { type: 'application/pdf' }), clienteId, 'comparativos');
          await q(sb.from('documentos').insert({ cliente_id: clienteId, tipo: 'otro', nombre_archivo: nombre, ruta }));
        } catch (e) { /* el PDF ya se descargó */ }
      }
      toast(clienteId ? 'Comparativo generado y guardado en los documentos del cliente.' : 'Comparativo generado.');
      alGuardar?.(lista);
    }
  });
  return dlg;
}

const hexRgb = (L, h) => { const n = parseInt(h.slice(1), 16); return L.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

export async function pdfComparativo({ para, ramo, opciones, nota }) {
  const L = await cargarPdfLib();
  const pdf = await L.PDFDocument.create();
  const f = await pdf.embedFont(L.StandardFonts.Helvetica), fb = await pdf.embedFont(L.StandardFonts.HelveticaBold);
  const T = s => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim();
  const v = variables(paletaDe(ctx.agencia)).claro;
  const acento = hexRgb(L, v['--accent']), suave = hexRgb(L, v['--accent-bg']), gris = L.rgb(0.38, 0.42, 0.46), linea = L.rgb(0.86, 0.88, 0.9), tinta = L.rgb(0.08, 0.12, 0.15);
  const page = pdf.addPage([792, 612]);   // carta horizontal
  const W = 792, M = 40;
  let y = 572;
  // Logo
  if (ctx.logoUrl) {
    try {
      const b = new Uint8Array(await (await fetch(ctx.logoUrl)).arrayBuffer());
      const img = b[0] === 0x89 ? await pdf.embedPng(b) : await pdf.embedJpg(b);
      const s = Math.min(130 / img.width, 42 / img.height);
      page.drawImage(img, { x: M, y: y - img.height * s + 6, width: img.width * s, height: img.height * s });
    } catch (e) { page.drawText(T(ctx.agencia?.nombre), { x: M, y, size: 14, font: fb, color: acento }); }
  } else page.drawText(T(ctx.agencia?.nombre), { x: M, y, size: 14, font: fb, color: acento });
  const fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  page.drawText(T(fecha), { x: W - M - f.widthOfTextAtSize(T(fecha), 9), y: y + 2, size: 9, font: f, color: gris });
  y -= 46;
  page.drawText(T(`Comparativo de opciones${ramo ? ' - ' + (RAMOS[ramo] || ramo) : ''}`), { x: M, y, size: 20, font: fb, color: tinta });
  y -= 18; page.drawText(T(`Preparado para ${para || ''}`), { x: M, y, size: 11, font: f, color: gris });
  y -= 22;
  // Tabla: primera columna etiquetas, luego una por opción
  const n = opciones.length, colL = 120, colW = (W - 2 * M - colL) / n;
  const filas = [['Prima anual', o => o.prima_total ? money(o.prima_total) : '-'], ['Diferencia', null], ['Aseguradora', o => o.aseguradora], ['Plan', o => o.plan], ['Deducible', o => o.deducible], ['Coaseguro', o => o.coaseguro], ['Suma asegurada', o => o.suma_asegurada], ['Notas', o => o.notas]];
  const base = opciones.find(o => o.actual) || null;
  const envolver = (t, ancho, font, size) => { const pal = T(t).split(/\s+/); const out = []; let l = ''; pal.forEach(p => { const z = l ? l + ' ' + p : p; if (font.widthOfTextAtSize(z, size) > ancho && l) { out.push(l); l = p; } else l = z; }); if (l) out.push(l); return out.length ? out : ['-']; };
  // Encabezados de columna
  const hEnc = 40;
  opciones.forEach((o, i) => {
    const x = M + colL + i * colW;
    page.drawRectangle({ x: x + 3, y: y - hEnc, width: colW - 6, height: hEnc, color: o.recomendada ? acento : suave });
    const et = envolver(o.etiqueta || `Opción ${i + 1}`, colW - 18, fb, 10).slice(0, 2);
    et.forEach((l, k) => page.drawText(l, { x: x + 10, y: y - 15 - k * 12, size: 10, font: fb, color: o.recomendada ? L.rgb(1, 1, 1) : tinta }));
    if (o.recomendada) page.drawText('RECOMENDADA', { x: x + 10, y: y - hEnc + 5, size: 7, font: fb, color: L.rgb(1, 1, 1) });
    else if (o.actual) page.drawText('ACTUAL', { x: x + 10, y: y - hEnc + 5, size: 7, font: fb, color: gris });
  });
  y -= hEnc + 4;
  filas.forEach(([etq, fn], r) => {
    const textos = opciones.map(o => {
      if (etq === 'Diferencia') { if (!base || o === base || !o.prima_total || !base.prima_total) return o === base ? 'Base' : '-'; const d = o.prima_total - base.prima_total; return `${d < 0 ? '-' : '+'}${money(Math.abs(d))} (${(d / base.prima_total * 100).toFixed(1)}%)`; }
      return fn(o) || '-';
    });
    if (etq === 'Diferencia' && !base) return;
    const grande = etq === 'Prima anual';
    const lineas = textos.map(t => envolver(t, colW - 20, grande ? fb : f, grande ? 13 : 9).slice(0, etq === 'Notas' ? 6 : 3));
    const alto = Math.max(...lineas.map(l => l.length)) * (grande ? 16 : 12) + 12;
    if (r % 2 === 0) page.drawRectangle({ x: M, y: y - alto, width: W - 2 * M, height: alto, color: L.rgb(0.975, 0.98, 0.985) });
    page.drawText(T(etq), { x: M + 8, y: y - 16, size: 9, font: fb, color: gris });
    lineas.forEach((ls, i) => ls.forEach((l, k) => page.drawText(l, { x: M + colL + i * colW + 10, y: y - 16 - k * (grande ? 16 : 12), size: grande ? 13 : 9, font: grande ? fb : f,
      color: grande && opciones[i].recomendada ? acento : (etq === 'Diferencia' && l.startsWith('-') ? L.rgb(0.05, 0.45, 0.35) : tinta) })));
    // Borde de la recomendada
    y -= alto;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: linea });
  });
  const ir = opciones.findIndex(o => o.recomendada);
  if (ir >= 0) { const x = M + colL + ir * colW + 3; page.drawRectangle({ x, y, width: colW - 6, height: 0, borderColor: acento, borderWidth: 0 }); }
  y -= 24;
  if (nota) envolver(nota, W - 2 * M, f, 10).slice(0, 5).forEach(l => { page.drawText(l, { x: M, y, size: 10, font: f, color: tinta }); y -= 14; });
  // Pie
  const pie = 'Primas y condiciones sujetas a confirmación y emisión por parte de cada aseguradora. Este comparativo no es una póliza ni garantiza la aceptación del riesgo.';
  envolver(pie, W - 2 * M, f, 8).forEach((l, k) => page.drawText(l, { x: M, y: 46 - k * 10, size: 8, font: f, color: gris }));
  const firma = T(`${ctx.perfil?.nombre || ''} - ${ctx.agencia?.nombre || ''}${ctx.perfil?.email ? ' - ' + ctx.perfil.email : ''}`);
  page.drawText(firma, { x: M, y: 24, size: 8, font: fb, color: acento });
  return pdf.save();
}
