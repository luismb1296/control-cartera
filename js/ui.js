// Utilidades de formato, catálogos y componentes de interfaz

export const RAMOS = {
  gmm: 'Gastos médicos', vida: 'Vida', auto: 'Auto', hogar: 'Hogar',
  danos: 'Daños', viaje: 'Viaje', otro: 'Otro'
};
export const FORMAS = { contado: 'Contado', semestral: 'Semestral', trimestral: 'Trimestral', mensual: 'Mensual' };
export const CONDUCTOS = { agente: 'Pago con agente', tarjeta: 'Cargo a tarjeta', domiciliado: 'Domiciliado', transferencia: 'Transferencia' };
export const SEGUIMIENTO = {
  sin_contactar: ['Sin contactar', 'p-bad'], cotizando: ['Cotizando', 'p-warn'],
  enviada: ['Enviada al cliente', 'p-blue'], aceptada: ['Aceptada', 'p-ok'], no_renueva: ['No renueva', 'p-gray']
};
export const SITUACION = {
  vigente: ['Vigente', 'p-blue'], por_renovar: ['Por renovar', 'p-warn'], vencida: ['Vencida', 'p-bad'],
  renovada: ['Renovada', 'p-gray'], cancelada: ['Cancelada', 'p-gray']
};
export const SIT_RECIBO = {
  pendiente: ['Pendiente', 'p-warn'], vencido: ['Vencido', 'p-bad'], pagado: ['Pagado', 'p-ok'], cancelado: ['Cancelado', 'p-gray']
};
export const DOCS = {
  ine: 'INE / identificación', comprobante_domicilio: 'Comprobante de domicilio', constancia_fiscal: 'Constancia de situación fiscal',
  poliza: 'Póliza (PDF)', tarjeta_circulacion: 'Tarjeta de circulación', factura: 'Factura', formato_reclamacion: 'Formato de reclamación',
  informe_medico: 'Informe médico', receta: 'Receta médica', estudios: 'Estudios / resultados', estado_cuenta: 'Estado de cuenta bancario',
  aviso_accidente: 'Aviso / declaración del siniestro', finiquito: 'Finiquito / carta de pago', fotos: 'Fotografías', presupuesto: 'Presupuesto', endoso: 'Endoso (PDF)', solicitud_endoso: 'Solicitud de endoso', acta_nacimiento: 'Acta de nacimiento', cuestionario_medico: 'Cuestionario médico', factura_vehiculo: 'Factura del vehículo', carta: 'Carta / formato', otro: 'Otro'
};
export const DOCS_CLIENTE = ['ine', 'comprobante_domicilio', 'constancia_fiscal', 'poliza', 'tarjeta_circulacion', 'estado_cuenta', 'otro'];
export const TIPOS_CARPETA = { programacion: 'Programación', reembolso: 'Reembolso', complemento: 'Complemento', siniestro_auto: 'Siniestro de auto',
  siniestro_danos: 'Siniestro de daños', siniestro_vida: 'Reclamación de vida', otro: 'Trámite' };
export const EVENTOS = { enfermedad: 'Enfermedad', accidente: 'Accidente', auto: 'Auto', danos: 'Daños / hogar', vida: 'Vida', otro: 'Otro' };
export const CAT_FACTURA = { honorarios: 'Honorarios médicos', hospital: 'Hospital', farmacia: 'Farmacia', laboratorio: 'Laboratorio', imagen: 'Imagenología', otro: 'Otro' };
export const EST_FACTURA = { presentada: ['Presentada', 'p-blue'], pagada: ['Pagada', 'p-ok'], parcial: ['Pago parcial', 'p-warn'], rechazada: ['Rechazada', 'p-bad'] };
// Requisitos por tipo de carpeta: [tipo de documento, descripción, obligatorio]
export const REQUISITOS = {
  reembolso: [['formato_reclamacion', 'Formato de reclamación firmado', true], ['informe_medico', 'Informe médico', true], ['__facturas', 'Facturas (XML y PDF)', true],
    ['receta', 'Recetas médicas', false], ['estudios', 'Estudios y resultados', false], ['ine', 'Identificación del asegurado', true], ['estado_cuenta', 'Estado de cuenta para el depósito', true]],
  programacion: [['formato_reclamacion', 'Solicitud o formato firmado', true], ['informe_medico', 'Informe médico', true], ['estudios', 'Estudios que soportan el diagnóstico', true],
    ['presupuesto', 'Presupuesto del hospital o médico', false], ['ine', 'Identificación del asegurado', true]],
  complemento: [['formato_reclamacion', 'Formato de reclamación firmado', true], ['__facturas', 'Facturas (XML y PDF)', true], ['informe_medico', 'Informe médico de seguimiento', false]],
  siniestro_auto: [['aviso_accidente', 'Declaración del siniestro', true], ['ine', 'Identificación del conductor', true], ['fotos', 'Fotografías', true], ['presupuesto', 'Presupuesto de reparación', false]],
  siniestro_danos: [['aviso_accidente', 'Aviso del siniestro', true], ['fotos', 'Fotografías', true], ['presupuesto', 'Presupuesto de reparación', true], ['__facturas', 'Facturas de reposición', false]],
  siniestro_vida: [['formato_reclamacion', 'Formato de reclamación', true], ['ine', 'Identificación de beneficiarios', true], ['otro', 'Acta de defunción y certificado médico', true], ['estado_cuenta', 'Estado de cuenta de beneficiarios', true]],
  otro: [],
};
// Campos adicionales que se piden según el ramo
export const CAMPOS_RAMO = {
  gmm: [['suma_asegurada', 'Suma asegurada'], ['deducible', 'Deducible'], ['coaseguro', 'Coaseguro']],
  vida: [['suma_asegurada', 'Suma asegurada'], ['plazo', 'Plazo']],
  auto: [['vehiculo', 'Marca y modelo'], ['anio', 'Año'], ['placas', 'Placas'], ['serie', 'Número de serie'], ['cobertura', 'Cobertura']],
  hogar: [['inmueble', 'Tipo de inmueble'], ['ubicacion', 'Domicilio asegurado'], ['suma_asegurada', 'Suma asegurada']],
  danos: [['giro', 'Giro'], ['ubicacion', 'Ubicación'], ['suma_asegurada', 'Suma asegurada']],
  viaje: [['destino', 'Destino'], ['viajeros', 'Número de viajeros']],
  otro: [['descripcion', 'Descripción']]
};

export const TIPOS_TRAMITE = {
  reembolso: 'Reembolso', programacion: 'Programación de cirugía / servicio', complemento: 'Complemento', siniestro_auto: 'Siniestro de auto',
  siniestro_danos: 'Siniestro de daños / hogar', siniestro_vida: 'Reclamación de vida', otro: 'Otro trámite'
};
export const EST_TRAMITE = {
  por_ingresar: ['Por ingresar', 'p-gray'], ingresado: ['Ingresado', 'p-blue'], en_revision: ['En revisión', 'p-blue'],
  info_adicional: ['Piden información', 'p-warn'], pagado: ['Pagado / aprobado', 'p-ok'], rechazado: ['Rechazado', 'p-bad'], cerrado: ['Cerrado', 'p-gray']
};
export const TRAMITE_ABIERTO = ['por_ingresar', 'ingresado', 'en_revision', 'info_adicional'];
export const TIPOS_MOV = {
  alta_asegurado: 'Alta de asegurado', baja_asegurado: 'Baja de asegurado', cambio_vehiculo: 'Cambio de vehículo', cambio_cobertura: 'Cambio de coberturas',
  cambio_suma: 'Cambio de suma asegurada', cambio_forma_pago: 'Cambio de forma de pago', cambio_conducto: 'Cambio de conducto de cobro',
  cambio_beneficiarios: 'Cambio de beneficiarios', cambio_domicilio: 'Cambio de domicilio', correccion_datos: 'Corrección de datos', otro: 'Otro movimiento'
};
export const EST_MOV = { solicitado: ['Solicitado', 'p-gray'], enviado: ['Enviado a la aseguradora', 'p-blue'], en_revision: ['En revisión', 'p-blue'],
  emitido: ['Emitido', 'p-ok'], entregado: ['Entregado al cliente', 'p-ok'], rechazado: ['Rechazado', 'p-bad'] };
export const FLUJO_MOV = ['solicitado', 'enviado', 'en_revision', 'emitido', 'entregado'];
export const MOV_ABIERTO = ['solicitado', 'enviado', 'en_revision'];
// Requisitos por tipo de endoso (documentos que suele pedir la aseguradora)
export const REQ_MOV = {
  alta_asegurado: [['solicitud_endoso', 'Solicitud de endoso firmada'], ['acta_nacimiento', 'Acta de nacimiento o identificación'], ['cuestionario_medico', 'Cuestionario médico (gastos médicos)']],
  baja_asegurado: [['solicitud_endoso', 'Solicitud de endoso firmada']],
  cambio_vehiculo: [['solicitud_endoso', 'Solicitud de endoso firmada'], ['factura_vehiculo', 'Factura del vehículo'], ['tarjeta_circulacion', 'Tarjeta de circulación']],
  cambio_cobertura: [['solicitud_endoso', 'Solicitud de endoso firmada']],
  cambio_suma: [['solicitud_endoso', 'Solicitud de endoso firmada']],
  cambio_forma_pago: [['solicitud_endoso', 'Solicitud de endoso firmada']],
  cambio_conducto: [['solicitud_endoso', 'Solicitud de endoso firmada'], ['estado_cuenta', 'Estado de cuenta o tarjeta para el cargo']],
  cambio_beneficiarios: [['solicitud_endoso', 'Solicitud de endoso firmada'], ['ine', 'Identificación del asegurado']],
  cambio_domicilio: [['solicitud_endoso', 'Solicitud de endoso firmada'], ['comprobante_domicilio', 'Comprobante de domicilio']],
  correccion_datos: [['solicitud_endoso', 'Solicitud de endoso firmada'], ['ine', 'Documento que respalda la corrección']],
  otro: [['solicitud_endoso', 'Solicitud de endoso firmada']],
};
// Para qué sirve un formato o carta de póliza: los tipos de endoso más otras cartas
export const USOS_POLIZA = {
  cancelacion: 'Cancelación de póliza', rehabilitacion: 'Rehabilitación de póliza', ...Object.fromEntries(Object.entries(TIPOS_MOV).filter(([k]) => k !== 'otro')),
  devolucion_prima: 'Devolución de prima', aclaracion: 'Aclaración o queja', carta_libre: 'Otra carta',
};
// Periodo al descubierto: días entre la fecha límite y el pago tardío de un recibo (sin cobertura)
export const periodosDescubiertos = recibos => (recibos || []).filter(r => r.descubierto_desde).map(r => ({ desde: r.descubierto_desde, hasta: r.descubierto_hasta || r.descubierto_desde, recibo: r }))
  .sort((a, b) => String(b.desde).localeCompare(String(a.desde)));
export const enDescubierto = (fecha, recibos) => fecha ? periodosDescubiertos(recibos).find(x => fecha >= x.desde && fecha <= x.hasta) || null : null;
export const diasDescubierto = x => Math.round((parseD(x.hasta) - parseD(x.desde)) / 864e5) + 1;
// Texto del número de recibo (los recibos de endoso no son parte de la serie normal)
export const numRecibo = r => r?.movimiento_id ? (Number(r.prima_total) < 0 ? 'de devolución de endoso' : 'de endoso') : `${r?.numero}/${r?.total_recibos}`;
export const ETAPAS = {
  prospecto: ['Prospecto', 'p-gray'], cotizado: ['Cotizado', 'p-blue'], negociacion: ['En negociación', 'p-warn'],
  ganado: ['Ganado', 'p-ok'], perdido: ['Perdido', 'p-bad']
};
// Tablero de trabajo
export const TIPOS_TAREA = {
  emision: 'Emisión', renovacion: 'Renovación', reembolso: 'Reembolso', programacion: 'Programación de cirugía',
  siniestro: 'Siniestro', endoso: 'Endoso', cancelacion: 'Cancelación', cobranza: 'Cobranza', cotizacion: 'Cotización', otro: 'Otro'
};
export const EST_TAREA = { no_iniciado: 'No iniciado', en_proceso: 'En proceso', detenido: 'Detenido', listo: 'Listo' };
export const PRIORIDADES = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' };
export const TAREA_A_TRAMITE = { reembolso: 'reembolso', programacion: 'programacion', siniestro: 'siniestro_danos' };

export const PLANES = { prueba: 'Prueba', basico: 'Básico', profesional: 'Profesional', empresa: 'Empresa' };

// Rellena una plantilla: "Hola {nombre}" + {nombre: 'Ana'} → "Hola Ana"
export function llenarPlantilla(texto, datos) {
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (datos[k] != null && datos[k] !== '' ? String(datos[k]) : m));
}
export const primerNombre = n => String(n || '').trim().split(/\s+/)[0] || '';
export function diasDesde(fechaIso) { const d = new Date(fechaIso); return Math.floor((Date.now() - d.getTime()) / 86400000); }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function money(n, moneda = 'MXN') {
  const v = Number(n || 0);
  if (moneda === 'UDI') return v.toLocaleString('es-MX', { maximumFractionDigits: 2 }) + ' UDI';
  return v.toLocaleString('es-MX', { style: 'currency', currency: moneda, maximumFractionDigits: 2 });
}
export function moneyShort(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toLocaleString('es-MX', { maximumFractionDigits: 2 }) + ' M';
  return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}
// Fechas: la base guarda 'AAAA-MM-DD'; se manejan como fecha local
export function parseD(s) { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function hoy() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function hoyISO() { return iso(hoy()); }
export function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
export function addMonths(d, n) { const r = new Date(d.getFullYear(), d.getMonth() + n, 1); const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate(); r.setDate(Math.min(d.getDate(), last)); return r; }
export function diffDays(a, b) { return Math.round((parseD(a) - parseD(b)) / 86400000); }
export function fdate(s) { const d = parseD(s); return d ? `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]} ${d.getFullYear()}` : '—'; }
export function fdateShort(s) { const d = parseD(s); return d ? `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}` : '—'; }
export function fdia(s) { const d = parseD(s); return d ? `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}` : '—'; }
export function edad(s) { const n = parseD(s); if (!n) return null; const h = hoy(); let e = h.getFullYear() - n.getFullYear(); if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--; return e; }
// Próximo cumpleaños (29 de febrero → 28 en años no bisiestos)
export function proximoCumple(s) {
  const n = parseD(s); if (!n) return null; const h = hoy();
  const en = y => { const last = new Date(y, n.getMonth() + 1, 0).getDate(); return new Date(y, n.getMonth(), Math.min(n.getDate(), last)); };
  let c = en(h.getFullYear()); if (c < h) c = en(h.getFullYear() + 1); return c;
}
export function iniciales(nombre) { return String(nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase(); }
export function pill(map, key) { const [t, c] = map[key] || [key, 'p-gray']; return `<span class="pill ${c}">${esc(t)}</span>`; }
export function telLimpio(t) { const d = String(t || '').replace(/\D/g, ''); return d.length === 10 ? '52' + d : d; }
export function waLink(tel, texto) { const t = telLimpio(tel); return t ? `https://wa.me/${t}?text=${encodeURIComponent(texto || '')}` : null; }
export function opts(obj, sel) { return Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join(''); }
export function optsList(list, sel, label = x => x.nombre) { return list.map(x => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(label(x))}</option>`).join(''); }
export function sum(arr, f) { return arr.reduce((a, x) => a + Number(f(x) || 0), 0); }

// Aviso breve en la parte inferior
let tt;
export function toast(msg, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(tt); tt = setTimeout(() => { el.className = ''; }, bad ? 5000 : 2800);
}

// Ventana modal con formulario. onSubmit recibe los datos del formulario.
export function modal({ titulo, cuerpo, boton = 'Guardar', onSubmit, onOpen, peligro = false }) {
  const dlg = document.getElementById('modal');
  dlg.innerHTML = `
    <form method="dialog" novalidate>
      <div class="modal-h"><h2>${esc(titulo)}</h2><button type="button" class="x" aria-label="Cerrar" data-close>×</button></div>
      <div class="modal-b">${cuerpo}<div class="error" role="alert"></div></div>
      <div class="modal-f">
        <button type="button" class="btn" data-close>Cancelar</button>
        ${onSubmit ? `<button type="submit" class="btn ${peligro ? 'danger' : 'primary'}">${esc(boton)}</button>` : ''}
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.error');
  dlg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dlg.close());
  form.onsubmit = async ev => {
    ev.preventDefault();
    if (!onSubmit) return dlg.close();
    const req = [...form.querySelectorAll('[required]')].find(i => !String(i.value).trim());
    if (req) { err.textContent = 'Complete los campos obligatorios.'; req.focus(); return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; err.textContent = '';
    try {
      const datos = Object.fromEntries(new FormData(form).entries());
      const r = await onSubmit(datos, form);
      if (r !== false) dlg.close();
    } catch (e) { err.textContent = e.message; }
    btn.disabled = false;
  };
  dlg.showModal();
  if (onOpen) onOpen(form);
  return dlg;
}

export function confirmar(titulo, texto, boton = 'Confirmar') {
  return new Promise(res => {
    let ok = false;
    const dlg = modal({ titulo, cuerpo: `<p>${esc(texto)}</p>`, boton, peligro: true, onSubmit: () => { ok = true; } });
    dlg.addEventListener('close', () => res(ok), { once: true });
  });
}

// Campo simple con etiqueta asociada
let uid = 0;
export function input(label, name, { type = 'text', value = '', req = false, wide = false, attrs = '' } = {}) {
  const id = 'f' + (++uid);
  return `<div class="field${wide ? ' wide' : ''}"><label for="${id}">${esc(label)}${req ? ' *' : ''}</label>
    <input id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}"${req ? ' required' : ''} ${attrs}></div>`;
}
export function select(label, name, optionsHtml, { req = false, wide = false, attrs = '' } = {}) {
  const id = 'f' + (++uid);
  return `<div class="field${wide ? ' wide' : ''}"><label for="${id}">${esc(label)}${req ? ' *' : ''}</label>
    <select id="${id}" name="${esc(name)}"${req ? ' required' : ''} ${attrs}>${optionsHtml}</select></div>`;
}
export function textarea(label, name, value = '', { wide = true } = {}) {
  const id = 'f' + (++uid);
  return `<div class="field${wide ? ' wide' : ''}"><label for="${id}">${esc(label)}</label>
    <textarea id="${id}" name="${esc(name)}">${esc(value)}</textarea></div>`;
}
export const num = v => (v === '' || v == null ? null : Number(String(v).replace(/[$,\s]/g, '')));
export const txt = v => (v == null || String(v).trim() === '' ? null : String(v).trim());

// Entregar un archivo generado (PDF, CSV) al usuario.
// Dentro de Claude usa la función de descargas de la plataforma; en la versión publicada, una descarga normal.
export async function descargar(nombre, datos) {
  const blob = datos instanceof Blob ? datos : new Blob([datos]);
  let cap = null;
  try { cap = window.claude?.use ? await window.claude.use('downloads') : null; } catch (e) { cap = null; }
  if (cap) {
    try { await cap.save({ filename: nombre, data: blob }); return true; }
    catch (e) { if (e?.code !== 'declined') toast('No se pudo descargar el archivo en esta vista.', true); return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return true;
}

// Librería para crear y llenar PDF (se carga solo cuando se necesita)
export function cargarPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
    s.onload = () => ok(window.PDFLib);
    s.onerror = () => mal(new Error('No se pudo cargar el generador de PDF. Revise su conexión a internet.'));
    document.head.appendChild(s);
  });
}
