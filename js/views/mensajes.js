// Envío de mensajes con plantilla (WhatsApp, correo o copiar)
import { ctx } from '../db.js';
import { esc, modal, llenarPlantilla, waLink, toast, primerNombre } from '../ui.js';

/**
 * Abre el redactor de mensajes.
 * clave: plantilla sugerida (recordatorio_pago, aviso_renovacion, felicitacion, envio_poliza, estatus_tramite)
 * datos: valores para las variables {nombre}, {poliza}, {monto}…
 * contacto: { telefono, email }
 */
export function enviarMensaje(clave, datos, contacto = {}) {
  const vars = { agencia: ctx.agencia?.nombre || '', ...datos, nombre: datos.nombre ? primerNombre(datos.nombre) : '' };
  const lista = ctx.plantillas;
  const actual = () => lista.find(p => p.clave === sel) || lista[0];
  let sel = lista.some(p => p.clave === clave) ? clave : lista[0]?.clave;
  if (!lista.length) { toast('No hay plantillas. Agréguelas en Configuración.', true); return; }

  modal({
    titulo: 'Enviar mensaje',
    cuerpo: `
      <div class="form-grid">
        <div class="field"><label for="mPl">Plantilla</label>
          <select id="mPl">${lista.map(p => `<option value="${esc(p.clave)}"${p.clave === sel ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>
        <div class="field"><label for="mPara">Para</label>
          <input id="mPara" value="${esc([contacto.telefono, contacto.email].filter(Boolean).join(' · ') || 'Sin teléfono ni correo registrado')}" readonly></div>
        <div class="field wide"><label for="mTx">Mensaje (puede editarlo antes de enviar)</label>
          <textarea id="mTx" style="min-height:150px"></textarea></div>
      </div>
      <div class="filters" style="margin-top:14px">
        <a class="btn primary" id="mWa" target="_blank" rel="noopener">Abrir en WhatsApp</a>
        <a class="btn" id="mMail">Abrir correo</a>
        <button type="button" class="btn" id="mCopy">Copiar texto</button>
      </div>
      <p class="muted small" style="margin-bottom:0">Los textos de las plantillas se editan en Configuración.</p>`,
    onOpen: f => {
      const tx = f.querySelector('#mTx'), wa = f.querySelector('#mWa'), mail = f.querySelector('#mMail');
      const enlaces = () => {
        const w = waLink(contacto.telefono, tx.value);
        wa.hidden = !w; if (w) wa.href = w;
        mail.hidden = !contacto.email;
        if (contacto.email) mail.href = `mailto:${contacto.email}?subject=${encodeURIComponent(llenarPlantilla(actual().asunto || '', vars))}&body=${encodeURIComponent(tx.value)}`;
      };
      const pintar = () => { tx.value = llenarPlantilla(actual().texto, vars); enlaces(); };
      f.querySelector('#mPl').onchange = e => { sel = e.target.value; pintar(); };
      tx.oninput = enlaces;
      f.querySelector('#mCopy').onclick = async () => {
        try { await navigator.clipboard.writeText(tx.value); toast('Texto copiado.'); }
        catch { tx.select(); toast('Seleccioné el texto: cópielo con Ctrl + C.'); }
      };
      pintar();
    }
  });
}
