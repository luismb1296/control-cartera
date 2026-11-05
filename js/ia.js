// Lectura automática de documentos (PDF de pólizas, estados de cuenta) con IA.
// En el prototipo usa Claude desde la página; en la versión publicada, la función "leer-documento" de Supabase.
import { sb } from './db.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const cargarScript = src => new Promise((ok, mal) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok;
  s.onerror = () => mal(new Error('No se pudo cargar el lector de PDF. Revise su conexión a internet.')); document.head.appendChild(s);
});
async function pdfjs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await cargarScript(PDFJS + 'pdf.worker.min.js');   // permite leer el PDF sin un proceso aparte
  await cargarScript(PDFJS + 'pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  return window.pdfjsLib;
}

// Texto de un PDF; si es escaneado (casi sin texto), imágenes de sus primeras páginas
export async function leerPdf(file, { maxPaginas = 8, paginasImagen = 3 } = {}) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let texto = '';
  for (let i = 1; i <= Math.min(doc.numPages, maxPaginas); i++) {
    const pg = await doc.getPage(i);
    const c = await pg.getTextContent();
    let linea = '', y = null;
    c.items.forEach(it => { const yy = Math.round(it.transform[5]); if (y !== null && Math.abs(yy - y) > 2) { texto += linea.trim() + '\n'; linea = ''; } linea += it.str + ' '; y = yy; });
    texto += linea.trim() + `\n--- fin de página ${i} ---\n`;
  }
  const imagenes = [];
  if (texto.replace(/[\s-]|fin de página \d+/g, '').length < 200) {
    for (let i = 1; i <= Math.min(doc.numPages, paginasImagen); i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1.6 });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      imagenes.push(await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85)));
    }
  }
  return { texto: texto.slice(0, 60000), imagenes, paginas: doc.numPages };
}

const blobABase64 = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });

// Pide a la IA un JSON a partir de una instrucción y el contenido del documento
export async function extraerConIA(instruccion, { texto = '', imagenes = [] }) {
  const prompt = `${instruccion}\n\nResponde únicamente con el JSON, sin texto adicional.\n\nCONTENIDO DEL DOCUMENTO:\n${texto || '(documento escaneado: ver imágenes)'}`;
  if (sb.demo) {
    let sample = null;
    try { sample = window.claude?.use ? await window.claude.use('sample') : null; } catch (e) { sample = null; }
    if (!sample) throw new Error('La lectura automática no está disponible en esta vista. En la versión publicada funciona con la función de lectura de documentos.');
    try { return await sample.json(prompt, { modelTier: 'default', ...(imagenes.length ? { images: imagenes } : {}) }); }
    catch (e) {
      const msg = { not_granted: 'Se necesita permitir que la página use Claude para leer el documento.', rate_limited: 'Demasiadas lecturas seguidas; intente en un momento.',
        images_unavailable: 'Este PDF es escaneado y aquí no se pueden enviar imágenes; use un PDF con texto.', invalid_json: 'No se pudo interpretar el documento; intente de nuevo.' }[e?.code];
      throw new Error(msg || 'No se pudo leer el documento: ' + (e?.message || 'error desconocido'));
    }
  }
  const { data, error } = await sb.functions.invoke('leer-documento', { body: { prompt, imagenes: await Promise.all(imagenes.map(blobABase64)) } });
  if (error) { const det = await error.context?.json?.().catch(() => null); throw new Error(det?.error || 'No se pudo leer el documento.'); }
  return data;
}

export const INSTRUCCION_POLIZA = `Eres un asistente que lee pólizas de seguros emitidas en México (carátulas, especificaciones, renovaciones).
Extrae los datos y devuelve un objeto JSON con estas claves (usa null cuando un dato no aparezca; no inventes nada):
{
 "aseguradora": "nombre comercial de la aseguradora",
 "numero_poliza": "texto", "numero_poliza_anterior": "texto o null",
 "ramo": "gmm | vida | auto | hogar | danos | viaje | otro",
 "producto": "nombre del plan o producto",
 "contratante": {"nombre": "", "rfc": "", "curp": "", "fecha_nacimiento": "AAAA-MM-DD", "calle": "", "colonia": "", "codigo_postal": "", "ciudad": "", "estado": "", "telefono": "", "email": ""},
 "inicio_vigencia": "AAAA-MM-DD", "fin_vigencia": "AAAA-MM-DD",
 "forma_pago": "contado | semestral | trimestral | mensual",
 "moneda": "MXN | USD | UDI",
 "prima_neta": número anual sin IVA ni recargos, "prima_total": número anual total a pagar,
 "asegurados": [{"nombre": "", "parentesco": "titular, cónyuge, hijo…", "fecha_nacimiento": "AAAA-MM-DD"}],
 "beneficiarios": [{"nombre": "", "parentesco": "", "porcentaje": número}],
 "datos_ramo": {"suma_asegurada": "", "deducible": "", "coaseguro": "", "vehiculo": "marca y modelo", "anio": "", "placas": "", "serie": "", "cobertura": "", "ubicacion": "", "destino": ""}
}
"Anual" se refiere a la vigencia completa. Las fechas en formato AAAA-MM-DD. Los importes como números sin signos ni comas.`;

export const INSTRUCCION_ESTADO_CUENTA = `Eres un asistente que lee estados de cuenta de comisiones que las aseguradoras mexicanas envían a sus agentes.
Devuelve un objeto JSON {"movimientos": [...]} con un elemento por cada comisión pagada:
{"poliza": "número de póliza", "recibo": "número o serie del recibo si aparece", "prima": número (prima neta del recibo si aparece), "comision": número (importe de comisión antes de impuestos si se distingue), "fecha": "AAAA-MM-DD"}
Ignora totales, subtotales, retenciones y movimientos que no sean comisiones de pólizas. Importes como números sin signos ni comas. No inventes datos.`;

export const INSTRUCCION_RENOVACION = `Eres un asesor experto en seguros en México (gastos médicos mayores, autos, vida, daños) que ayuda a un agente a decidir qué proponerle a un cliente al renovar su póliza.
Recibirás en JSON: la póliza anterior y la renovación (primas y coberturas), edades de los asegurados al renovar, siniestros, antigüedad con la aseguradora, historial de primas,
el incremento promedio de esa aseguradora y del ramo en la cartera de la agencia, los productos de otras aseguradoras con las que trabaja la agencia y, si hay, cotizaciones reales recibidas.

Reglas:
- No inventes precios ni porcentajes de ahorro. Solo usa cifras que vengan en los datos (por ejemplo, las cotizaciones). Si no hay cotización, describe el efecto de forma cualitativa ("baja la prima", "suele reducirla de forma importante").
- En gastos médicos: un siniestro abierto o un padecimiento ya atendido normalmente se excluye como preexistente al cambiar de aseguradora; cambiar reinicia periodos de espera salvo reconocimiento de antigüedad; las aseguradoras tienen edad máxima de aceptación para asegurados nuevos (con frecuencia entre 60 y 70 años, varía por aseguradora) y hay que verificarla; subir deducible o coaseguro, poner tope de coaseguro distinto, cambiar a un plan de menor nivel hospitalario o de cobertura en zona/red reducida son formas de bajar la prima conservando la aseguradora.
- Si el aumento está en línea con el promedio de la aseguradora, probablemente es un ajuste general; si es muy superior, pesa la edad (cambio de rango) o la siniestralidad.
- Si hubo endosos durante la vigencia (por ejemplo, el alta de un asegurado), separa esa parte del aumento: no es incremento de tarifa. Un alta cobrada a prorrata se cobra completa en la renovación. Usa "prima_actual_sin_endosos" para explicar cuánto subió la tarifa en sí.
- En autos: deducibles de daños materiales y robo, amplia vs limitada según antigüedad del vehículo, comparar con otras aseguradoras es sencillo porque no hay preexistencias.
- Sugiere solo aseguradoras de la lista de productos de la agencia o de las cotizaciones recibidas.
- Escribe en español de México, claro, en "usted" y sin tecnicismos innecesarios.

Devuelve un objeto JSON con esta forma:
{
 "resumen": "2 o 3 frases con el diagnóstico",
 "causa_probable": "frase corta: edad / siniestralidad / ajuste general de la aseguradora / cambio de coberturas / combinación / no se puede determinar",
 "recomendacion": "igual | ajuste | cambio",
 "opciones": [
   {"tipo": "igual | ajuste | cambio", "prioridad": 1, "titulo": "frase corta", "descripcion": "qué implica", "ventajas": ["..."], "riesgos": ["..."],
    "que_cotizar": "qué pedir exactamente a la aseguradora (plan, deducible, coaseguro) o cadena vacía", "efecto_prima": "efecto esperado en la prima sin inventar cifras, o la cifra de la cotización si existe"}
 ],
 "preguntas_al_cliente": ["preguntas para decidir mejor"],
 "mensaje_cliente": "mensaje breve y cordial para enviar al cliente por WhatsApp explicando el aumento y las opciones, sin cifras inventadas; firma como su agente de seguros"
}
Incluye de 2 a 4 opciones ordenadas por prioridad (1 = la que más conviene). Aunque el aumento sea bajo, revisa si hay una mejora razonable (ajuste o cotización) y dilo.
En las opciones de "cambio" di con qué aseguradora(s) y plan cotizar. En las de "ajuste" di exactamente qué cobertura modificar y a qué valor.
Si hay "cotizaciones_recibidas", agrega además:
 "comparacion": {"mejor": índice (empezando en 0) de la cotización que más conviene dentro de cotizaciones_recibidas, o "renovacion" si conviene quedarse con la renovación,
   "explicacion": "2 o 3 frases comparando precio y coberturas (deducible, coaseguro, suma, preexistencias, antigüedad) de la renovación contra cada cotización"}
Si no hay cotizaciones, no incluyas "comparacion".`;

export const INSTRUCCION_COTIZACION = `Eres un asistente que lee cotizaciones de seguros emitidas por aseguradoras en México.
Devuelve un objeto JSON con estas claves (null si no aparece; no inventes nada):
{"aseguradora": "nombre comercial", "plan": "plan o producto", "prima_total": número anual total a pagar (sin signos ni comas),
 "deducible": "texto", "coaseguro": "texto", "tope_coaseguro": "texto o null", "suma_asegurada": "texto",
 "nivel_hospitalario": "texto (plan, red o nivel de hospitales) o null", "forma_pago": "forma de pago cotizada o null",
 "notas": "una línea con condiciones relevantes: exclusiones, periodos de espera, reconocimiento de antigüedad"}
Si la cotización trae varias opciones, toma la primera o la recomendada y menciona las demás en "notas".`;

export const INSTRUCCION_ENDOSO = `Eres un asistente que lee endosos de pólizas de seguros emitidos por aseguradoras en México (documentos que modifican una póliza vigente).
Devuelve un objeto JSON con estas claves (usa null o listas vacías cuando un dato no aparezca; no inventes nada):
{
 "numero_poliza": "número de la póliza que se modifica",
 "folio_endoso": "número o folio del endoso",
 "tipo": "alta_asegurado | baja_asegurado | cambio_vehiculo | cambio_cobertura | cambio_suma | cambio_forma_pago | cambio_conducto | cambio_beneficiarios | cambio_domicilio | correccion_datos | otro",
 "descripcion": "una línea clara de qué cambia, por ejemplo: Alta de Andrea Polanco (hija)",
 "fecha_efecto": "AAAA-MM-DD desde cuándo aplica el cambio",
 "importe": número de la prima total del endoso con IVA (negativo si es devolución al cliente; 0 si no cambia la prima),
 "prima_neta": número de la prima neta del endoso sin IVA ni recargos (negativo si es devolución),
 "asegurados_alta": [{"nombre": "", "parentesco": "titular, cónyuge, hijo, hija…", "fecha_nacimiento": "AAAA-MM-DD"}],
 "asegurados_baja": ["nombre completo de cada persona que se da de baja"],
 "beneficiarios": [{"nombre": "", "parentesco": "", "porcentaje": número}],
 "datos_ramo": {"campo": "nuevo valor"} solo con los datos que cambian; usa estas claves cuando apliquen: suma_asegurada, deducible, coaseguro, vehiculo (marca y modelo), anio, placas, serie, cobertura, ubicacion,
 "forma_pago": "contado | semestral | trimestral | mensual" solo si el endoso la cambia,
 "conducto_cobro": "agente | tarjeta | domiciliado | transferencia" solo si el endoso lo cambia
}
Las fechas en formato AAAA-MM-DD. Los importes como números sin signos de moneda ni comas.`;

// Todo el texto de un PDF, página por página (para condiciones generales)
export async function leerPdfCompleto(file, alAvanzar) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    let texto = '', linea = '', y = null;
    c.items.forEach(it => { const yy = Math.round(it.transform[5]); if (y !== null && Math.abs(yy - y) > 2) { texto += linea.trim() + '\n'; linea = ''; } linea += it.str + ' '; y = yy; });
    texto += linea.trim();
    paginas.push({ pagina: i, texto: texto.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() });
    alAvanzar?.(i, doc.numPages);
  }
  const total = paginas.reduce((a, p) => a + p.texto.length, 0);
  if (total < doc.numPages * 80) throw new Error('Este PDF parece escaneado (casi no tiene texto). Pida a la aseguradora la versión digital de las condiciones generales.');
  return paginas;
}

// Búsqueda de las páginas más relacionadas con una pregunta (sin IA)
const SIN_ACENTOS = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const VACIAS = new Set('para como cual cuales cuando donde desde hasta sobre entre este esta estos estas tiene tienen puede pueden quiero saber segun poliza seguro asegurado asegurada condiciones generales que con por los las del una uno unos unas sus mas pero sin hay ser son fue esta ese esa'.split(' '));
const SINONIMOS = {
  cancel: ['cancelacion', 'rescision', 'terminacion', 'anticipada', 'devolucion', 'prima no devengada'],
  espera: ['periodo de espera', 'carencia', 'antiguedad', 'meses de cobertura continua'],
  preexist: ['preexistente', 'preexistencia', 'declaracion'],
  exclu: ['exclusion', 'no cubre', 'excluye', 'no ampara'],
  reembol: ['reembolso', 'indemnizacion', 'plazo', 'comprobantes'],
  matern: ['maternidad', 'parto', 'cesarea', 'embarazo'],
  edad: ['edad maxima', 'edad de aceptacion', 'limite de edad'],
  penaliz: ['penalizacion', 'penalidad', 'recargo', 'descuento'],
};
export function paginasRelacionadas(paginas, consulta, max = 6, maxChars = 40000) {
  const base = SIN_ACENTOS(consulta).split(/[^a-z0-9ñ]+/).filter(w => w.length > 3 && !VACIAS.has(w));
  const terminos = new Set(base.map(w => w.slice(0, 6)));
  Object.entries(SINONIMOS).forEach(([raiz, lista]) => { if (base.some(w => w.startsWith(raiz) || lista.some(l => SIN_ACENTOS(l).includes(w)))) lista.forEach(l => terminos.add(SIN_ACENTOS(l))); });
  const puntaje = p => { const t = SIN_ACENTOS(p.texto); let s = 0; terminos.forEach(w => { const n = t.split(w).length - 1; s += Math.min(n, 8) * (w.includes(' ') ? 3 : 1); }); return s; };
  const orden = paginas.map(p => ({ p, s: puntaje(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const elegidas = []; let chars = 0;
  for (const { p } of orden) { if (elegidas.length >= max || chars + p.texto.length > maxChars) break; elegidas.push(p); chars += p.texto.length; }
  return elegidas.sort((a, b) => a.pagina - b.pagina);
}
export const conPaginas = lista => lista.map(p => `[Página ${p.pagina}]\n${p.texto}`).join('\n\n');

export const INSTRUCCION_CONDICIONES = `Eres un asistente que lee condiciones generales de seguros en México (gastos médicos, vida, autos, daños) para una agencia de seguros.
Del texto (cada página viene marcada como [Página N]) arma una ficha en JSON con estas claves. Copia el texto tal como aparece (puede ser un extracto breve) e indica siempre la página.
No inventes nada: si un tema no aparece, usa null o una lista vacía.
{
 "periodos_espera": [{"padecimiento": "nombre del padecimiento o tratamiento", "meses": número de meses de espera, "general": true si es el periodo de espera general para cualquier enfermedad, "pagina": número, "texto": "extracto"}],
 "preexistencias": {"texto": "cómo trata las enfermedades preexistentes", "pagina": número},
 "exclusiones": [{"texto": "exclusión principal, resumida", "pagina": número}],
 "edad_maxima": {"anios": número o null, "texto": "edad máxima de aceptación o renovación", "pagina": número},
 "cancelacion": {"penalizacion": "resumen en una línea de lo que pasa al cancelar (penalización, devolución de prima no devengada, porcentaje)", "texto": "extracto", "pagina": número},
 "reembolsos": {"plazo": "plazo para presentar reclamaciones o reembolsos", "texto": "extracto", "pagina": número},
 "otros": [{"tema": "deducible, coaseguro, maternidad, emergencia en el extranjero u otro tema importante", "texto": "extracto", "pagina": número}]
}
Para periodos de espera expresados en años, conviértelos a meses. Incluye cada padecimiento con su propio periodo (por ejemplo hernias, cataratas, padecimientos de columna, maternidad, varices, amígdalas).`;

export const INSTRUCCION_PREGUNTA_CG = `Eres un asistente de una agencia de seguros en México. Respondes preguntas sobre una póliza usando SOLO las condiciones generales que se te dan (cada página marcada como [Página N]).
Reglas:
- Responde en español, claro y breve (máximo 6 renglones), para un agente de seguros.
- Cita siempre la página y copia el fragmento exacto que sustenta la respuesta.
- Si el texto no responde la pregunta, dilo con claridad ("Las páginas revisadas no lo mencionan") y sugiere qué consultar con la aseguradora. No uses conocimiento general ni inventes porcentajes o plazos.
- Si se dan datos del caso (antigüedad del asegurado, fecha del evento, padecimiento), aplícalos y di la conclusión (por ejemplo, si ya cumplió el periodo de espera y desde qué fecha estaría cubierto).
- Recuerda que la decisión final es de la aseguradora.
Devuelve JSON: {"respuesta": "texto", "encontrado": true o false, "citas": [{"pagina": número, "texto": "fragmento exacto"}]}`;
