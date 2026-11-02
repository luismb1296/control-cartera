// Firma desde el portal: el cliente firma con el dedo (o el mouse) un PDF que la agencia le pidió firmar.
// Se genera una copia firmada; el original no se toca.
import { sb, ctx, q } from '../db.js';
import { esc, modal, toast, hoyISO, cargarPdfLib } from '../ui.js';
import { subirArchivo, abrirArchivo } from './formas.js';

export const pendientesDeFirma = docs => docs.filter(d => d.firma_solicitada && !d.firma_de && !docs.some(x => x.firma_de === d.id));
export const firmadoDe = (d, docs) => docs.find(x => x.firma_de === d.id) || null;

// Coloca la firma: en el campo del PDF que se llame "firma" si existe; si no, abajo a la derecha de la última página
async function estamparFirma(bytes, png, texto) {
  const L = await cargarPdfLib();
  const pdf = await L.PDFDocument.load(bytes, { ignoreEncryption: true });
  const img = await pdf.embedPng(png), f = await pdf.embedFont(L.StandardFonts.Helvetica);
  const T = s => String(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  let lugar = null;
  try {
    const campo = pdf.getForm().getFields().find(x => /firma|signature/i.test(x.getName()));
    const w = campo?.acroField.getWidgets()[0];
    if (w) { const r = w.getRectangle(), pg = pdf.getPages().find(p => p.ref === w.P()) || pdf.getPages()[pdf.getPageCount() - 1]; lugar = { pg, x: r.x, y: r.y, w: r.width, h: Math.max(r.height, 30) }; }
  } catch (e) { /* sin formulario */ }
  if (!lugar) { const pg = pdf.getPages()[pdf.getPageCount() - 1], { width } = pg.getSize(); lugar = { pg, x: width - 250, y: 70, w: 200, h: 64 }; }
  const s = Math.min(lugar.w / img.width, lugar.h / img.height);
  lugar.pg.drawImage(img, { x: lugar.x + (lugar.w - img.width * s) / 2, y: lugar.y, width: img.width * s, height: img.height * s });
  lugar.pg.drawText(T(texto), { x: Math.max(20, lugar.x - 40), y: Math.max(8, lugar.y - 11), size: 6.5, font: f, color: L.rgb(0.35, 0.38, 0.42) });
  try { pdf.getForm().flatten(); } catch (e) { /* sin formulario */ }
  return pdf.save();
}

export function firmarDocumento(doc, cliente, alTerminar) {
  let trazos = 0;
  modal({
    titulo: 'Firmar documento', boton: 'Firmar y enviar',
    cuerpo: `<p style="margin-top:0">La agencia le pide firmar: <b>${esc(doc.nombre_archivo)}</b></p>
      <button type="button" class="btn sm" id="fVer">Ver el documento</button>
      <div class="field" style="margin-top:14px"><label for="fLienzo">Firme aquí con el dedo o el mouse</label>
        <div class="lienzo-firma"><canvas id="fLienzo" aria-label="Espacio para firmar"></canvas><span class="linea-firma" aria-hidden="true"></span></div>
        <div class="filters" style="justify-content:space-between;margin-top:6px"><span class="muted small">${esc(cliente.nombre)}</span><button type="button" class="linkbtn small" id="fBorrar">Borrar firma</button></div></div>
      <label class="small" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input type="checkbox" id="fAcepto" style="width:auto;min-height:0;margin-top:3px">
        Leí el documento y acepto firmarlo electrónicamente. Mi firma se agregará a una copia del PDF con la fecha y hora.</label>`,
    onOpen: f => {
      f.querySelector('#fVer').onclick = () => abrirArchivo(doc.ruta);
      const cv = f.querySelector('#fLienzo'), ctx2 = cv.getContext('2d');
      const ajustar = () => { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; ctx2.scale(dpr, dpr); ctx2.lineWidth = 2.4; ctx2.lineCap = 'round'; ctx2.lineJoin = 'round'; ctx2.strokeStyle = '#0B1F3A'; };
      requestAnimationFrame(ajustar);
      let dib = false, ult = null;
      const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('pointerdown', e => { dib = true; ult = pt(e); cv.setPointerCapture(e.pointerId); trazos++; });
      cv.addEventListener('pointermove', e => { if (!dib) return; const p = pt(e); ctx2.beginPath(); ctx2.moveTo(...ult); ctx2.lineTo(...p); ctx2.stroke(); ult = p; });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cv.addEventListener(t, () => { dib = false; }));
      f.querySelector('#fBorrar').onclick = () => { ctx2.clearRect(0, 0, cv.width, cv.height); trazos = 0; };
    },
    onSubmit: async (_d, f) => {
      if (!trazos) throw new Error('Dibuje su firma en el recuadro.');
      if (!f.querySelector('#fAcepto').checked) throw new Error('Marque la casilla para aceptar la firma electrónica.');
      const png = await new Promise(r => f.querySelector('#fLienzo').toBlob(b => b.arrayBuffer().then(r), 'image/png'));
      const { data, error } = await sb.storage.from('documentos').download(doc.ruta);
      if (error || !data) throw new Error('No se pudo abrir el documento original.');
      const ahora = new Date();
      const sello = `Firmado electrónicamente por ${cliente.nombre} el ${ahora.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })} desde el portal de ${ctx.agencia?.nombre || 'la agencia'}.`;
      const bytes = await estamparFirma(new Uint8Array(await data.arrayBuffer()), new Uint8Array(png), sello);
      const nombre = doc.nombre_archivo.replace(/\.pdf$/i, '') + ' (firmado).pdf';
      const ruta = await subirArchivo(new File([bytes], nombre, { type: 'application/pdf' }), cliente.id, doc.tramite_id ? 'tramites' : 'firmados');
      await q(sb.from('documentos').insert({ cliente_id: cliente.id, poliza_id: doc.poliza_id || null, tramite_id: doc.tramite_id || null, movimiento_id: doc.movimiento_id || null, tipo: doc.tipo, nombre_archivo: nombre, ruta, firma_de: doc.id }));
      await q(sb.from('tareas').insert({ titulo: `${cliente.nombre} firmó "${doc.nombre_archivo}"`, tipo: doc.tramite_id ? 'reembolso' : doc.movimiento_id ? 'endoso' : 'otro', estatus: 'no_iniciado', prioridad: 'alta', movimiento_id: doc.movimiento_id || null,
        cliente_id: cliente.id, tramite_id: doc.tramite_id || null, asignado_a: cliente.agente_id || null, fecha: hoyISO(),
        descripcion: 'El documento firmado ya está en su carpeta. Revíselo y súbalo a la aseguradora.' }));
      toast('Documento firmado. Su agente ya lo recibió.');
      alTerminar?.();
    }
  });
}
