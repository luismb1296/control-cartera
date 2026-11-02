// Generación de formatos en PDF a partir de los datos del expediente
import { sb, ctx, q } from '../db.js';
import { cargarPdfLib, descargar, money, fdate, RAMOS, TIPOS_CARPETA, EVENTOS, CAT_FACTURA, MESES_LARGOS, parseD, edad, toast } from '../ui.js';
import { subirArchivo } from './formas.js';

// ---------------------------------------------------------------- Variables disponibles
const dmy = s => { const d = parseD(s); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : ''; };
const fechaLarga = d => `${d.getDate()} de ${MESES_LARGOS[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`;
const sinParentesis = t => String(t || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();

export const VARIABLES = [
  ['afectado', 'Asegurado afectado (nombre)'], ['afectado_parentesco', 'Parentesco del afectado con el titular'], ['cliente_fecha_nacimiento', 'Fecha de nacimiento del afectado (dd/mm/aaaa)'],
  ['cliente_edad', 'Edad del afectado'], ['cliente_rfc', 'RFC del afectado'], ['cliente_curp', 'CURP del afectado'],
  ['contratante_nombre', 'Contratante (nombre)'], ['contratante_rfc', 'RFC del contratante'], ['cliente_telefono', 'Teléfono'], ['cliente_email', 'Correo'],
  ['cliente_domicilio', 'Domicilio completo'], ['cliente_calle', 'Calle y número'], ['cliente_colonia', 'Colonia'], ['cliente_cp', 'Código postal'],
  ['cliente_ciudad', 'Ciudad'], ['cliente_estado', 'Estado'], ['cliente_banco', 'Banco'], ['cliente_clabe', 'CLABE'], ['cliente_cuenta_titular', 'Titular de la cuenta'],
  ['poliza_numero', 'Número de póliza'], ['aseguradora_nombre', 'Aseguradora'], ['poliza_producto', 'Producto / plan'], ['poliza_ramo', 'Ramo'],
  ['poliza_inicio', 'Inicio de vigencia'], ['poliza_fin', 'Fin de vigencia'], ['siniestro_numero', 'Número de siniestro'], ['siniestro_padecimiento', 'Diagnóstico / padecimiento'],
  ['siniestro_fecha_evento', 'Fecha de primeros síntomas / del evento'], ['siniestro_tipo_evento', 'Tipo de evento (enfermedad, accidente…)'],
  ['tramite_tipo', 'Tipo de trámite (reembolso, programación…)'], ['tramite_folio', 'Folio del trámite'], ['tramite_numero', 'Número de carpeta (1, 2, 3…)'],
  ['facturas_cantidad', 'Número de facturas'], ['facturas_total', 'Importe total de facturas'], ['fecha_hoy', 'Fecha de hoy (dd/mm/aaaa)'],
  ['lugar_fecha', 'Lugar y fecha (Mérida, Yucatán, a …)'], ['agente_nombre', 'Agente'], ['agencia_nombre', 'Agencia'],
  // De la póliza (cartas y formatos de póliza o endoso)
  ['poliza_forma_pago', 'Forma de pago'], ['poliza_prima_total', 'Prima total anual'], ['poliza_bien', 'Bien asegurado (vehículo, inmueble…) en una línea'],
  ['poliza_vehiculo', 'Vehículo (marca y modelo)'], ['poliza_anio', 'Año del vehículo'], ['poliza_placas', 'Placas'], ['poliza_serie', 'Número de serie'],
  ['poliza_suma_asegurada', 'Suma asegurada'], ['asegurados_lista', 'Lista de asegurados'],
  ['motivo', 'Motivo (se escribe al generar)'], ['fecha_efecto', 'Fecha en que surte efecto (dd/mm/aaaa)'],
  ['endoso_tipo', 'Tipo de endoso'], ['endoso_descripcion', 'Descripción del endoso'], ['endoso_folio', 'Folio del endoso'],
  ['endoso_cambios', 'Cambios del endoso (dice / debe decir)'], ['endoso_importe', 'Prima del endoso'],
  // Rehabilitación (el recibo pagado tarde o el vencido)
  ['recibo_numero', 'Número de recibo (rehabilitación)'], ['recibo_importe', 'Importe del recibo'], ['recibo_fecha_limite', 'Fecha límite de pago del recibo'],
  ['fecha_pago', 'Fecha en que se pagó'], ['descubierto_desde', 'Periodo al descubierto: desde'], ['descubierto_hasta', 'Periodo al descubierto: hasta'],
];

// Sugerencia automática de variable según el nombre del campo del PDF
const SUGERENCIAS = [
  [/lugar.*fecha|fecha.*lugar/, 'lugar_fecha'], [/poliza|policy/, 'poliza_numero'], [/siniestro|reclamacion no|claim/, 'siniestro_numero'],
  [/rfc.*contratante|contratante.*rfc/, 'contratante_rfc'], [/contratante/, 'contratante_nombre'], [/parentesco/, 'afectado_parentesco'], [/nacimiento|birth/, 'cliente_fecha_nacimiento'], [/asegurado|paciente|afectado|nombre/, 'afectado'],
  [/rfc/, 'cliente_rfc'], [/curp/, 'cliente_curp'], [/edad/, 'cliente_edad'], [/tel|celular|movil/, 'cliente_telefono'], [/correo|email|e-mail|mail/, 'cliente_email'],
  [/c\.?p\.?$|codigo postal/, 'cliente_cp'], [/colonia/, 'cliente_colonia'], [/calle/, 'cliente_calle'], [/ciudad|municipio/, 'cliente_ciudad'], [/estado$|entidad/, 'cliente_estado'],
  [/domicilio|direccion/, 'cliente_domicilio'], [/clabe/, 'cliente_clabe'], [/banco/, 'cliente_banco'], [/titular/, 'cliente_cuenta_titular'],
  [/diagnostico|padecimiento|enfermedad|causa/, 'siniestro_padecimiento'], [/sintoma|ocurr|evento/, 'siniestro_fecha_evento'],
  [/(num|no|cant).*factura|factura.*(num|no|cant)/, 'facturas_cantidad'], [/importe|monto|total|reclamad/, 'facturas_total'],
  [/placa/, 'poliza_placas'], [/serie|vin|niv/, 'poliza_serie'], [/modelo|marca|vehiculo/, 'poliza_vehiculo'], [/^ano$|ano modelo|anio/, 'poliza_anio'],
  [/suma asegurada/, 'poliza_suma_asegurada'], [/forma de pago/, 'poliza_forma_pago'], [/motivo|razon/, 'motivo'], [/efecto|a partir/, 'fecha_efecto'],
  [/endoso.*folio|folio.*endoso/, 'endoso_folio'], [/folio/, 'tramite_folio'], [/tramite|tipo de reclam/, 'tramite_tipo'], [/agente/, 'agente_nombre'], [/aseguradora|compania/, 'aseguradora_nombre'],
  [/vigencia.*(inicio|desde)|inicio/, 'poliza_inicio'], [/vigencia.*(fin|hasta)|fin/, 'poliza_fin'], [/^fecha$|fecha de solicitud|fecha de hoy/, 'fecha_hoy'],
];
export function sugerirVariable(campo) {
  const t = String(campo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\-.]+/g, ' ').trim();
  return SUGERENCIAS.find(([re]) => re.test(t))?.[1] || '';
}

// Junta toda la información de una carpeta en un diccionario de variables
export async function datosCarpeta(tramiteId) {
  const t = await q(sb.from('tramites').select('*').eq('id', tramiteId).single());
  const [s, c, p, facturas, asegurados] = await Promise.all([
    t.siniestro_id ? q(sb.from('siniestros').select('*').eq('id', t.siniestro_id).maybeSingle()) : null,
    q(sb.from('clientes').select('*').eq('id', t.cliente_id).single()),
    t.poliza_id ? q(sb.from('v_polizas').select('*').eq('id', t.poliza_id).maybeSingle()) : null,
    q(sb.from('facturas').select('*').eq('tramite_id', tramiteId).order('fecha')),
    t.poliza_id ? q(sb.from('asegurados').select('*').eq('poliza_id', t.poliza_id)) : [],
  ]);
  // El afectado puede no ser el contratante (ej. un hijo): sus datos personales salen de la lista de asegurados
  const nrm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const afectadoNom = sinParentesis(s?.afectado || t.afectado) || c.nombre;
  const esContratante = !afectadoNom || nrm(afectadoNom) === nrm(c.nombre);
  const aseg = esContratante ? null : asegurados.find(a => nrm(a.nombre) === nrm(afectadoNom)) || asegurados.find(a => nrm(a.nombre).startsWith(nrm(afectadoNom).split(' ').slice(0, 2).join(' ')));
  const parentesco = esContratante ? 'Titular' : aseg?.parentesco || (String(s?.afectado || t.afectado || '').match(/\((.*?)\)/)?.[1] ?? '');
  const agente = ctx.perfiles.find(x => x.id === (p?.agente_id || c.agente_id));
  const total = facturas.reduce((a, f) => a + Number(f.total || 0), 0);
  const hoyD = new Date();
  const v = {
    afectado: afectadoNom, afectado_parentesco: parentesco, contratante_nombre: c.nombre, contratante_rfc: c.rfc,
    cliente_rfc: esContratante ? c.rfc : '', cliente_curp: esContratante ? c.curp : '',
    cliente_fecha_nacimiento: dmy(esContratante ? c.fecha_nacimiento : aseg?.fecha_nacimiento), cliente_edad: edad(esContratante ? c.fecha_nacimiento : aseg?.fecha_nacimiento) ?? '', cliente_telefono: c.telefono || c.whatsapp, cliente_email: c.email,
    cliente_domicilio: [c.calle, c.colonia ? 'Col. ' + c.colonia : '', c.codigo_postal ? 'C.P. ' + c.codigo_postal : '', c.ciudad, c.estado].filter(Boolean).join(', '),
    cliente_calle: c.calle, cliente_colonia: c.colonia, cliente_cp: c.codigo_postal, cliente_ciudad: c.ciudad, cliente_estado: c.estado,
    cliente_banco: c.banco, cliente_clabe: c.clabe, cliente_cuenta_titular: c.cuenta_titular || c.nombre,
    poliza_numero: p?.numero_poliza, aseguradora_nombre: p?.aseguradora_nombre, poliza_producto: p?.producto, poliza_ramo: p ? RAMOS[p.ramo] : '',
    poliza_inicio: dmy(p?.inicio_vigencia), poliza_fin: dmy(p?.fin_vigencia), siniestro_numero: s?.numero_siniestro, siniestro_padecimiento: s?.padecimiento || t.descripcion,
    siniestro_fecha_evento: dmy(s?.fecha_evento || t.fecha_ocurrido), siniestro_tipo_evento: s ? EVENTOS[s.tipo_evento] : '',
    tramite_tipo: TIPOS_CARPETA[t.tipo], tramite_folio: t.folio, tramite_numero: t.numero, facturas_cantidad: facturas.length ? String(facturas.length) : '',
    facturas_total: facturas.length ? money(total) : (t.monto_reclamado ? money(t.monto_reclamado) : ''), fecha_hoy: dmy(hoyD.toISOString().slice(0, 10)),
    lugar_fecha: `${[c.ciudad || 'Mérida', c.estado || 'Yucatán'].join(', ')}, a ${fechaLarga(hoyD)}`, agente_nombre: agente?.nombre, agencia_nombre: ctx.agencia?.nombre,
  };
  Object.keys(v).forEach(k => { v[k] = v[k] == null ? '' : String(v[k]); });
  return { v, t, s, c, p, facturas, total };
}

export const DATOS_EJEMPLO = Object.fromEntries(VARIABLES.map(([k, l]) => [k, ({
  afectado: 'Ana Pérez López', contratante_nombre: 'Ana Pérez López', cliente_rfc: 'PELA800101AA1', cliente_fecha_nacimiento: '01/01/1980', cliente_telefono: '999 000 0000',
  cliente_email: 'ana@ejemplo.com', cliente_domicilio: 'Calle 1 #100, Col. Centro, C.P. 97000, Mérida, Yucatán', poliza_numero: 'POL-000123', aseguradora_nombre: 'Aseguradora',
  siniestro_numero: 'SIN-0001', siniestro_padecimiento: 'Diagnóstico de ejemplo', facturas_cantidad: '3', facturas_total: '$6,850.00', cliente_banco: 'Banco',
  cliente_clabe: '000000000000000000', lugar_fecha: 'Mérida, Yucatán, a 1 de enero de 2027', tramite_tipo: 'Reembolso',
  poliza_ramo: 'Auto', poliza_producto: 'Amplia', poliza_inicio: '01/01/2026', poliza_fin: '01/01/2027', poliza_bien: 'Vehículo: Mazda CX-5 2023, placas YZA-123-B', poliza_placas: 'YZA-123-B',
  poliza_vehiculo: 'Mazda CX-5', poliza_anio: '2023', motivo: 'Venta del vehículo', fecha_efecto: '15/01/2027', afectado_parentesco: 'Titular', agente_nombre: 'Agente', agencia_nombre: 'Agencia',
})[k] || `[${l}]`]));

// Variables de una póliza (y, si viene, de su endoso) para cartas y formatos
export async function datosPoliza({ polizaId, mov = null, difs = [], afectadoId = null, motivo = '', fechaEfecto = '', reciboId = null }) {
  const p = await q(sb.from('v_polizas').select('*').eq('id', polizaId).single());
  const [c, asegurados, recibos] = await Promise.all([q(sb.from('clientes').select('*').eq('id', p.cliente_id).single()), q(sb.from('asegurados').select('*').eq('poliza_id', polizaId)),
    q(sb.from('recibos').select('*').eq('poliza_id', polizaId).order('fecha_limite'))]);
  // Recibo de la rehabilitación: el indicado, el último pagado tarde o el vencido más antiguo
  const hoyIso = new Date().toISOString().slice(0, 10);
  const rec = recibos.find(r => r.id === reciboId) || [...recibos].reverse().find(r => r.descubierto_desde) || recibos.find(r => r.estatus === 'pendiente' && r.fecha_limite < hoyIso) || null;
  const numRec = r => r ? (r.movimiento_id ? 'del endoso' : `${r.numero}/${r.total_recibos}`) : '';
  const af = asegurados.find(a => a.id === afectadoId) || null;
  const dr = p.datos_ramo || {}, agente = ctx.perfiles.find(x => x.id === (p.agente_id || c.agente_id)), hoyD = new Date();
  const bien = p.ramo === 'auto' ? [dr.vehiculo && `Vehículo: ${dr.vehiculo}${dr.anio ? ' ' + dr.anio : ''}`, dr.placas && `placas ${dr.placas}`, dr.serie && `serie ${dr.serie}`].filter(Boolean).join(', ')
    : [dr.inmueble, dr.ubicacion && `ubicado en ${dr.ubicacion}`, dr.giro, dr.suma_asegurada && `suma asegurada ${dr.suma_asegurada}`].filter(Boolean).join(', ');
  const FP = { contado: 'Contado', semestral: 'Semestral', trimestral: 'Trimestral', mensual: 'Mensual' };
  const TM = { alta_asegurado: 'Alta de asegurado', baja_asegurado: 'Baja de asegurado', cambio_vehiculo: 'Cambio de vehículo', cambio_cobertura: 'Cambio de coberturas', cambio_suma: 'Cambio de suma asegurada',
    cambio_forma_pago: 'Cambio de forma de pago', cambio_conducto: 'Cambio de conducto de cobro', cambio_beneficiarios: 'Cambio de beneficiarios', cambio_domicilio: 'Cambio de domicilio', correccion_datos: 'Corrección de datos', otro: 'Otro movimiento' };
  const v = {
    afectado: af?.nombre || c.nombre, afectado_parentesco: af ? (af.parentesco || '') : 'Titular', contratante_nombre: c.nombre, contratante_rfc: c.rfc,
    cliente_rfc: af ? '' : c.rfc, cliente_curp: af ? '' : c.curp, cliente_fecha_nacimiento: dmy(af ? af.fecha_nacimiento : c.fecha_nacimiento), cliente_edad: edad(af ? af.fecha_nacimiento : c.fecha_nacimiento) ?? '',
    cliente_telefono: c.telefono || c.whatsapp, cliente_email: c.email,
    cliente_domicilio: [c.calle, c.colonia ? 'Col. ' + c.colonia : '', c.codigo_postal ? 'C.P. ' + c.codigo_postal : '', c.ciudad, c.estado].filter(Boolean).join(', '),
    cliente_calle: c.calle, cliente_colonia: c.colonia, cliente_cp: c.codigo_postal, cliente_ciudad: c.ciudad, cliente_estado: c.estado,
    cliente_banco: c.banco, cliente_clabe: c.clabe, cliente_cuenta_titular: c.cuenta_titular || c.nombre,
    poliza_numero: p.numero_poliza, aseguradora_nombre: p.aseguradora_nombre, poliza_producto: p.producto, poliza_ramo: RAMOS[p.ramo], poliza_inicio: dmy(p.inicio_vigencia), poliza_fin: dmy(p.fin_vigencia),
    poliza_forma_pago: FP[p.forma_pago], poliza_prima_total: money(p.prima_total, p.moneda), poliza_bien: bien,
    poliza_vehiculo: dr.vehiculo, poliza_anio: dr.anio, poliza_placas: dr.placas, poliza_serie: dr.serie, poliza_suma_asegurada: dr.suma_asegurada,
    asegurados_lista: asegurados.filter(a => a.tipo !== 'beneficiario').map(a => `${a.nombre}${a.parentesco ? ' (' + a.parentesco + ')' : ''}`).join(', '),
    motivo, fecha_efecto: dmy(fechaEfecto || mov?.fecha_efecto) || '', fecha_hoy: dmy(hoyD.toISOString().slice(0, 10)),
    lugar_fecha: `${[c.ciudad || 'Mérida', c.estado || 'Yucatán'].join(', ')}, a ${fechaLarga(hoyD)}`, agente_nombre: agente?.nombre, agencia_nombre: ctx.agencia?.nombre,
    endoso_tipo: mov ? TM[mov.tipo] : '', endoso_descripcion: mov?.descripcion, endoso_folio: mov?.folio_endoso,
    recibo_numero: numRec(rec), recibo_importe: rec ? money(rec.prima_total, p.moneda) : '', recibo_fecha_limite: dmy(rec?.fecha_limite), fecha_pago: dmy(rec?.fecha_pago),
    descubierto_desde: dmy(rec?.descubierto_desde || (rec && rec.estatus === 'pendiente' ? iso1(rec.fecha_limite) : '')), descubierto_hasta: dmy(rec?.descubierto_hasta),
    endoso_cambios: difs.map(([k, a, b]) => `${k}: dice ${a}; debe decir ${b}`).join('\n'), endoso_importe: mov?.importe != null ? money(mov.importe, p.moneda) : '',
  };
  Object.keys(v).forEach(k => { v[k] = v[k] == null ? '' : String(v[k]); });
  return { v, p, c, asegurados };
}

const iso1 = s => { const d = parseD(s); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Carta libre: el texto de la plantilla con los datos, en hoja membretada y con espacio para firmas
export async function pdfCartaLibre(texto, v, titulo = '') {
  const d = await nuevoDoc(), { pdf, f, fb, gris, linea } = d;
  let page = pdf.addPage([612, 792]), y = 0;
  const cabeza = () => { page.drawText(limpio(ctx.agencia?.nombre || ''), { x: 50, y: 752, size: 10, font: fb, color: gris }); page.drawLine({ start: { x: 50, y: 742 }, end: { x: 562, y: 742 }, thickness: 1, color: linea }); y = 712; };
  cabeza();
  const lf = limpio(v.lugar_fecha || '');
  page.drawText(lf, { x: 562 - f.widthOfTextAtSize(lf, 10), y, size: 10, font: f }); y -= 30;
  if (titulo) { page.drawText(limpio(titulo), { x: 50, y, size: 12, font: fb }); y -= 24; }
  const lleno = llenarTexto(texto, v);
  lleno.split('\n').forEach(par => {
    if (!par.trim()) { y -= 8; return; }
    envolver(par, f, 10.5, 512).forEach(l => { if (y < 150) { page = pdf.addPage([612, 792]); cabeza(); } page.drawText(l, { x: 50, y, size: 10.5, font: f }); y -= 15; });
  });
  if (y < 190) { page = pdf.addPage([612, 792]); cabeza(); }
  y -= 20; page.drawText('Atentamente,', { x: 50, y, size: 10.5, font: f }); y = Math.max(110, y - 70);
  page.drawLine({ start: { x: 50, y }, end: { x: 270, y }, thickness: 0.8, color: gris });
  page.drawText(limpio(v.contratante_nombre), { x: 50, y: y - 13, size: 9, font: f }); page.drawText('Nombre y firma del contratante', { x: 50, y: y - 25, size: 8, font: f, color: gris });
  firma(d, page, y, `${v.agente_nombre || ''} - ${v.agencia_nombre || ''}`);
  try { const fl = pdf.getForm().createTextField('firma'); fl.addToPage(page, { x: 50, y: y + 2, width: 220, height: 46, borderWidth: 0 }); } catch (e) { /* sin campo */ }
  return pdf.save();
}
// Reemplaza {variable} por su valor; si no hay dato, deja una línea para llenarlo a mano
export const llenarTexto = (texto, v) => String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? (v[k] || '__________') : m));

// ---------------------------------------------------------------- Utilidades de dibujo
export async function nuevoDoc() {
  const { PDFDocument, StandardFonts, rgb } = await cargarPdfLib();
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  return { pdf, f, fb, rgb, gris: rgb(0.36, 0.4, 0.45), linea: rgb(0.8, 0.82, 0.85) };
}
// Quita caracteres que la fuente estándar no puede dibujar
export const limpio = t => String(t ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
export function envolver(texto, font, size, ancho) {
  const lineas = [];
  limpio(texto).split('\n').forEach(par => {
    let l = '';
    par.split(' ').forEach(p => { const prueba = l ? l + ' ' + p : p; if (font.widthOfTextAtSize(prueba, size) > ancho && l) { lineas.push(l); l = p; } else l = prueba; });
    lineas.push(l);
  });
  return lineas;
}
function encabezado(d, page, titulo, v) {
  const { fb, f, gris, linea } = d;
  page.drawText(limpio(ctx.agencia?.nombre || ''), { x: 50, y: 752, size: 10, font: fb, color: gris });
  page.drawText(limpio(titulo), { x: 50, y: 726, size: 16, font: fb });
  page.drawLine({ start: { x: 50, y: 716 }, end: { x: 562, y: 716 }, thickness: 1, color: linea });
  const datos = [['Asegurado afectado', v.afectado], ['Contratante', v.contratante_nombre], ['Aseguradora', v.aseguradora_nombre], ['Póliza', v.poliza_numero],
    ['Número de siniestro', v.siniestro_numero || '—'], ['Trámite', `${v.tramite_tipo} ${v.tramite_numero}${v.tramite_folio ? ' · folio ' + v.tramite_folio : ''}`],
    ['Padecimiento', v.siniestro_padecimiento]];
  let y = 696;
  datos.forEach(([k, val], i) => {
    const x = i % 2 ? 310 : 50; if (i % 2 === 0 && i) y -= 26;
    page.drawText(limpio(k).toUpperCase(), { x, y: y + 9, size: 7, font: f, color: gris });
    page.drawText(limpio(val || '—').slice(0, 58), { x, y: y - 2, size: 10, font: f });
  });
  return y - 30;
}
export function firma(d, page, y, etiqueta) {
  page.drawLine({ start: { x: 330, y }, end: { x: 562, y }, thickness: 0.8, color: d.gris });
  page.drawText(limpio(etiqueta), { x: 330, y: y - 13, size: 8, font: d.f, color: d.gris });
}

// ---------------------------------------------------------------- Relación de facturas
export async function pdfRelacion(info) {
  const { v, facturas, total } = info;
  const d = await nuevoDoc(), { pdf, f, fb, gris, linea } = d;
  let page = pdf.addPage([612, 792]);
  let y = encabezado(d, page, 'Relación de facturas', v);
  const cols = [[50, 'No.'], [72, 'Fecha'], [124, 'Emisor'], [300, 'RFC'], [380, 'Concepto'], [508, 'Importe']];
  const cabecera = () => { page.drawRectangle({ x: 48, y: y - 4, width: 516, height: 16, color: d.rgb(0.92, 0.94, 0.96) }); cols.forEach(([x, t]) => page.drawText(t, { x, y, size: 8, font: fb })); y -= 18; };
  cabecera();
  facturas.forEach((fa, i) => {
    if (y < 120) { page = pdf.addPage([612, 792]); y = 740; cabecera(); }
    const fila = [String(i + 1), dmy(fa.fecha), limpio(fa.emisor_nombre || '').slice(0, 34), fa.emisor_rfc || '', limpio(fa.concepto || CAT_FACTURA[fa.categoria] || '').slice(0, 24)];
    fila.forEach((t, j) => page.drawText(t, { x: cols[j][0], y, size: 8, font: f }));
    const imp = money(fa.total); page.drawText(imp, { x: 562 - f.widthOfTextAtSize(imp, 8), y, size: 8, font: f });
    if (fa.uuid_fiscal) page.drawText('Folio fiscal: ' + fa.uuid_fiscal, { x: 124, y: y - 10, size: 6.5, font: f, color: gris });
    page.drawLine({ start: { x: 48, y: y - 15 }, end: { x: 564, y: y - 15 }, thickness: 0.4, color: linea });
    y -= 24;
  });
  const tt = 'Total reclamado: ' + money(total);
  page.drawText(tt, { x: 562 - fb.widthOfTextAtSize(tt, 11), y: y - 6, size: 11, font: fb });
  page.drawText(`${facturas.length} factura${facturas.length === 1 ? '' : 's'}`, { x: 50, y: y - 6, size: 9, font: f, color: gris });
  firma(d, page, Math.max(70, y - 70), 'Nombre y firma del asegurado');
  page.drawText(limpio(v.lugar_fecha), { x: 50, y: Math.max(70, y - 70), size: 9, font: f });
  return pdf.save();
}

// ---------------------------------------------------------------- Carta de presentación
export async function pdfCarta(info, documentos) {
  const { v, t, facturas, total } = info;
  const d = await nuevoDoc(), { pdf, f, fb, gris } = d;
  const page = pdf.addPage([612, 792]);
  let y = encabezado(d, page, `Solicitud de ${String(v.tramite_tipo).toLowerCase()}`, v);
  const parrafo = (texto, size = 10, font = f) => { envolver(texto, font, size, 512).forEach(l => { page.drawText(l, { x: 50, y, size, font }); y -= size + 5; }); y -= 6; };
  page.drawText(limpio(v.lugar_fecha), { x: 562 - f.widthOfTextAtSize(limpio(v.lugar_fecha), 10), y, size: 10, font: f }); y -= 26;
  parrafo(`${v.aseguradora_nombre || 'Aseguradora'}\nÁrea de siniestros / reembolsos\nPresente`, 10, fb);
  const que = t.tipo === 'programacion' ? `la programación del servicio médico relacionado con ${v.siniestro_padecimiento || 'el padecimiento indicado'}`
    : t.tipo === 'reembolso' || t.tipo === 'complemento' ? `el reembolso de los gastos médicos derivados de ${v.siniestro_padecimiento || 'el padecimiento indicado'}, por un importe total de ${money(total || t.monto_reclamado || 0)}`
    : `la atención del siniestro: ${v.siniestro_padecimiento || ''}`;
  parrafo(`Por medio de la presente, a nombre del asegurado ${v.afectado}, amparado por la póliza ${v.poliza_numero || ''}${v.siniestro_numero ? ` (siniestro ${v.siniestro_numero})` : ''}, solicitamos ${que}.`);
  if (facturas.length) parrafo(`Se anexan ${facturas.length} factura${facturas.length === 1 ? '' : 's'} con su archivo XML y la relación de facturas correspondiente.`);
  const anexos = [...new Set(documentos.map(x => x.etiqueta))];
  if (anexos.length) { parrafo('Documentos que se anexan:', 10, fb); anexos.forEach(a => { page.drawText('•  ' + limpio(a), { x: 62, y, size: 10, font: f }); y -= 15; }); y -= 8; }
  if ((t.tipo === 'reembolso' || t.tipo === 'complemento') && v.cliente_clabe) {
    parrafo('Datos para el depósito del reembolso:', 10, fb);
    [['Banco', v.cliente_banco], ['CLABE', v.cliente_clabe], ['Titular', v.cliente_cuenta_titular]].forEach(([k, val]) => { page.drawText(`${k}: ${limpio(val)}`, { x: 62, y, size: 10, font: f }); y -= 15; });
    y -= 8;
  }
  parrafo('Quedamos atentos a cualquier información adicional que se requiera.');
  y = Math.max(110, y - 50);
  page.drawLine({ start: { x: 50, y }, end: { x: 270, y }, thickness: 0.8, color: gris });
  page.drawText(limpio(v.afectado), { x: 50, y: y - 13, size: 9, font: f }); page.drawText('Asegurado', { x: 50, y: y - 25, size: 8, font: f, color: gris });
  firma(d, page, y, `${v.agente_nombre || ''} - ${v.agencia_nombre || ''}`);
  return pdf.save();
}

// ---------------------------------------------------------------- Formato de aseguradora
export async function leerBytes(ruta) {
  const { data, error } = await sb.storage.from('documentos').download(ruta);
  if (error || !data) throw new Error('No se pudo leer el formato: ' + (error?.message || 'archivo no encontrado'));
  return new Uint8Array(await data.arrayBuffer());
}
export async function camposDePdf(bytes) {
  const L = await cargarPdfLib();
  const pdf = await L.PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdf.getForm().getFields().map(fl => ({ nombre: fl.getName(),
    tipo: fl instanceof L.PDFTextField ? 'texto' : fl instanceof L.PDFCheckBox ? 'casilla' : fl instanceof L.PDFDropdown ? 'lista' : 'otro' }));
}
export async function llenarFormato(formato, v, bytes) {
  const L = await cargarPdfLib(), { PDFDocument, StandardFonts } = L;
  const pdf = await PDFDocument.load(bytes || await leerBytes(formato.archivo_ruta), { ignoreEncryption: true });
  if (formato.modo === 'coordenadas') {
    const f = await pdf.embedFont(StandardFonts.Helvetica), pags = pdf.getPages();
    (Array.isArray(formato.mapeo) ? formato.mapeo : []).forEach(m => { const pg = pags[(m.pagina || 1) - 1]; if (pg && v[m.variable]) pg.drawText(limpio(v[m.variable]), { x: m.x, y: m.y, size: m.tam || 9, font: f }); });
  } else {
    const form = pdf.getForm();
    Object.entries(formato.mapeo || {}).forEach(([campo, variable]) => {
      if (!variable) return;
      try {
        const fl = form.getField(campo);
        if (fl instanceof L.PDFTextField) fl.setText(limpio(v[variable]));
        else if (fl instanceof L.PDFCheckBox && v[variable]) fl.check();
        else if (fl instanceof L.PDFDropdown && v[variable]) { try { fl.select(v[variable]); } catch (e) { } }
      } catch (e) { /* campo no encontrado: se omite */ }
    });
  }
  return pdf.save();
}

// Guarda el PDF generado en la carpeta y lo ofrece para descargar
export async function guardarYDescargar(bytes, nombre, t) {
  const archivo = new File([bytes], nombre, { type: 'application/pdf' });
  const ruta = await subirArchivo(archivo, t.cliente_id, 'tramites');
  await q(sb.from('documentos').insert({ cliente_id: t.cliente_id, poliza_id: t.poliza_id, tramite_id: t.id, tipo: 'otro', nombre_archivo: nombre, ruta }));
  const ok = await descargar(nombre, new Blob([bytes], { type: 'application/pdf' }));
  toast(ok ? 'Formato generado y guardado en la carpeta.' : 'Formato guardado en la carpeta.');
}
