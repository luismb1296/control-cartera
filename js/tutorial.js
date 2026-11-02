// Tutoriales guiados: resaltan partes de la pantalla y explican para qué sirven.
// Se muestran solos la primera vez que la persona entra a cada sección y se repiten con el botón "?".
import { ctx, sb } from './db.js';
import { esc, toast } from './ui.js';

const N = s => `.nav a[data-r=${s}]`;
// Cada paso: el = elemento a resaltar (si no existe se omite; sin "el" se muestra al centro), t = título, x = explicación
const TOURS = {
  inicio: { nombre: 'Inicio', pasos: [
    { t: 'Bienvenido a su control de cartera', x: 'Le muestro en un minuto cómo está organizada la app. Puede salir cuando quiera y repetir este recorrido con el botón de ayuda, abajo a la derecha.' },
    { el: '.nav', t: 'El menú', x: 'Desde aquí entra a cada sección: clientes, pólizas, cobranza, siniestros, calendario y más. La sección en la que está se marca con una barra.' },
    { el: '#badge', t: 'Sus pendientes del día', x: 'Este número le dice cuántas cosas requieren atención hoy: pagos vencidos, renovaciones, trámites detenidos, tareas y cumpleaños.' },
    { el: '#buscar', t: 'Buscar rápido', x: 'Escriba un nombre, número de póliza o RFC y vaya directo a la ficha del cliente.' },
    { el: '#nPoliza', t: 'Registrar una póliza', x: 'Da de alta una póliza nueva. Si tiene el PDF, súbalo y los datos se llenan solos.' },
    { el: '.kpis', t: 'Sus números clave', x: 'Pólizas vigentes, prima en cartera, renovaciones próximas, recibos vencidos y comisión del mes. Los recuadros en naranja o rojo piden atención.' },
    { el: '#tRen', t: 'Próximas renovaciones', x: 'Las pólizas que vencen pronto. Cambie el seguimiento (cotizando, enviada, aceptada…), avise al cliente o renueve desde aquí.' },
    { el: '.modo', t: 'Modo claro u oscuro', x: 'Elija cómo quiere ver la app. Automático sigue la configuración de su computadora o celular.' },
  ] },
  pendientes: { nombre: 'Mis pendientes', pasos: [
    { t: 'Mis pendientes', x: 'Todo lo que requiere atención hoy: sus tareas del tablero, cobranza, renovaciones, trámites sin movimiento, prospectos y cumpleaños.' },
    { el: '[data-g=tareas]', t: 'Sus tareas del tablero', x: 'Las tareas asignadas a usted que piden atención: atrasadas, de hoy, urgentes, detenidas o con comentarios nuevos. La etiqueta de color le dice por qué aparece.' },
    { el: '.list [data-a=pagar], .list [data-a=renovar], .list [data-a=tramite]', t: 'Resuelva sin salir', x: 'Cada pendiente trae su acción: registrar el pago, avisar por WhatsApp, renovar o abrir el trámite. Al resolverlo desaparece de la lista.' },
    { el: '[data-a=altablero]', t: 'Pasar al tablero', x: 'Si alguien más se va a encargar, conviértalo en tarea con responsable y fecha. Se cierra sola cuando el pendiente se resuelve.' },
    { el: '.en-tablero', t: 'Ya tiene responsable', x: 'Este pendiente ya está en el tablero: aquí ve quién lo tiene y en qué va, para no hacerlo dos veces.' },
  ] },
  tablero: { nombre: 'Tablero de trabajo', pasos: [
    { t: 'Tablero de trabajo', x: 'Aquí se reparten y siguen las tareas del equipo, como en Monday: emisiones, reembolsos, endosos, cobranza y más.' },
    { el: '#nueva', t: 'Crear una tarea', x: 'Asigne la tarea a una persona, con fecha y prioridad, y lígala a un cliente o póliza para que quede en su historial.' },
    { el: '.filters', t: 'Filtrar y agrupar', x: 'Vea solo sus tareas, un tipo o un estado, y agrupe por tipo, responsable, aseguradora o fecha.' },
    { el: '.board-group .mcell', t: 'Cambie el estado con un clic', x: 'Estado y prioridad se cambian directo en la tabla. Al marcar "Listo", la tarea se archiva.' },
    { el: '.board-group .upd', t: 'Conversación de la tarea', x: 'Abra la tarea para dejar comentarios, subir archivos y ver todo lo que ha pasado con ella.' },
    { el: '.auto-tag', t: 'Tareas automáticas', x: 'La app crea sola las tareas de renovaciones próximas y recibos vencidos, asignadas al agente del cliente. Se configuran en Configuración.' },
    { el: '.upd.nuevo', t: 'Comentarios sin leer', x: 'El punto de color avisa que alguien le escribió en esa tarea desde la última vez que la abrió.' },
    { el: '#impMonday', t: 'Traer sus tareas de Monday', x: 'Si exporta su tablero de Monday a Excel, aquí lo importa en un paso.' },
  ] },
  clientes: { nombre: 'Clientes', pasos: [
    { t: 'Clientes', x: 'La lista de todos sus clientes con sus pólizas y datos de contacto.' },
    { el: '#bq', t: 'Buscar', x: 'Busque por nombre, RFC, teléfono o correo.' },
    { el: '#nuevo', t: 'Nuevo cliente', x: 'Registre un cliente con sus datos, domicilio y cuenta bancaria para reembolsos.' },
    { el: '#importar', t: 'Importar desde Excel', x: 'Si ya tiene su cartera en Excel o SIGA, súbala y la app crea clientes y pólizas de una vez.' },
    { el: '#tabla tbody tr', t: 'Abrir la ficha', x: 'Haga clic en un cliente para ver todo: pólizas, pagos, trámites, documentos y notas.' },
  ] },
  cliente: { nombre: 'Ficha del cliente', pasos: [
    { t: 'Ficha del cliente', x: 'Toda la información de un cliente en un solo lugar.' },
    { el: '.filters', t: 'Acciones rápidas', x: 'Escríbale por WhatsApp o correo, edite sus datos, registre una póliza o dele acceso a su portal.' },
    { el: '.tabs', t: 'Todo su historial', x: 'Pólizas vigentes, pagos, trámites y siniestros, actividad del tablero y pólizas anteriores, en pestañas.' },
    { el: '[data-hist]', t: 'Histórico de renovaciones', x: 'Todas las vigencias de la póliza en orden, de la más reciente a la más antigua, cada una con sus endosos, recibos y documentos.' },
    { el: '[data-cartas]', t: 'Cartas y formatos', x: 'Genere en un clic la carta de cancelación, de baja de asegurado u otros formatos de la aseguradora, ya llenos con los datos de la póliza.' },
    { el: '#subir', t: 'Documentos', x: 'Suba INE, comprobante de domicilio, constancia fiscal o pólizas. La app le avisa qué documentos faltan.' },
    { el: '#nota', t: 'Bitácora', x: 'Anote llamadas, acuerdos y pendientes con el cliente. Queda con fecha y quién la escribió.' },
  ] },
  polizas: { nombre: 'Pólizas', pasos: [
    { t: 'Pólizas', x: 'Todas las pólizas de la cartera, de todas las aseguradoras y ramos.' },
    { el: '.filters', t: 'Filtros', x: 'Filtre por aseguradora, ramo, estatus o agente, y busque por número de póliza o cliente.' },
    { el: '#nueva', t: 'Nueva póliza', x: 'Registre una póliza. Los recibos de pago se generan solos según la forma de pago.' },
    { el: '#csv', t: 'Descargar a Excel', x: 'Baje la lista filtrada para trabajarla o compartirla.' },
  ] },
  renovaciones: { nombre: 'Renovaciones', pasos: [
    { t: 'Renovaciones del mes', x: 'Aquí trabaja las renovaciones mes con mes: qué pólizas renuevan, cuáles ya cargó y cuáles subieron demasiado.' },
    { el: '.mesbar', t: 'Elija el mes', x: 'Por omisión se muestra el mes siguiente, que es el que normalmente se descarga de los portales.' },
    { el: '#rExcel', t: 'Reporte en Excel', x: 'Descargue la lista con una hoja por aseguradora, para ir portal por portal bajando cada renovación.' },
    { el: '[data-cargar]', t: 'Cargar la renovación', x: 'Suba el PDF de la renovación y los datos se llenan solos. Al guardar, la app la compara con el año anterior.' },
    { el: '.kpis', t: 'Avance y alzas', x: 'Cuántas lleva cargadas, el incremento promedio y cuántas subieron más del porcentaje que usted configuró.' },
    { el: 'a.btn[href^="#/renovacion/"]', t: 'Analizar', x: 'Para las que subieron mucho, la app revisa edades, siniestros, antigüedad y coberturas, y le propone opciones para el cliente.' },
  ] },
  renovacion: { nombre: 'Análisis de renovación', pasos: [
    { el: '.salto', t: 'Cuánto subió', x: 'La prima del año anterior contra la renovación, en porcentaje y en pesos.' },
    { el: '.senales', t: 'Qué hay que considerar', x: 'Edades, siniestros, antigüedad, coberturas y cuánto subió esa aseguradora en promedio en su cartera. Esto lo calcula la app con sus datos.' },
    { el: '#aCot', t: 'Cotizaciones', x: 'Agregue cotizaciones de otras aseguradoras (puede subir el PDF). Así la propuesta compara precios reales.' },
    { el: '#propuesta', t: 'Propuesta', x: 'Opciones ordenadas: quedarse igual, ajustar coberturas o cambiar de aseguradora, con ventajas, riesgos, qué cotizar y un mensaje listo para el cliente.' },
    { el: '[name=decision]', t: 'Decisión', x: 'Anote qué se decidió. Queda en la lista del mes para saber cómo va cada cliente.' },
  ] },
  oportunidades: { nombre: 'Oportunidades', pasos: [
    { t: 'Oportunidades de venta', x: 'Clientes con huecos en su protección: sin seguro de vida, sin gastos médicos, con auto pero sin casa, empresas sin daños, o hijos que cumplen 25 y salen de la póliza familiar.' },
    { el: '.chips', t: 'Filtrar por tipo', x: 'Vea un tipo de oportunidad a la vez para armar campañas.' },
    { el: '[data-sel]', t: 'Mensajes en bloque', x: 'Seleccione varios clientes y envíeles un mensaje listo por WhatsApp o correo. Al enviarlo quedan como contactados.' },
    { el: '[data-pros]', t: 'Crear prospecto', x: 'Si el cliente se interesa, pásela a Prospectos para darle seguimiento hasta emitir.' },
  ] },
  comisiones: { nombre: 'Comisiones', pasos: [
    { t: 'Comisiones', x: 'Metas de cada agente, lo que le toca pagarle con lo que la aseguradora sí pagó y las facturas de comisiones de la agencia.' },
    { el: '.mesbar', t: 'Mes', x: 'La comisión cuenta en el mes en que la aseguradora la pagó.' },
    { el: '.agente', t: 'Cada agente', x: 'Avance contra su meta, comisión cobrada de sus pólizas, su porcentaje y cuánto le corresponde. Descargue la liquidación y márquela como pagada.' },
    { el: '[data-p=facturas]', t: 'Facturas a aseguradoras', x: 'Registre los CFDI que la agencia emite a cada aseguradora y compárelos con las comisiones cobradas.' },
  ] },
  cobranza: { nombre: 'Cobranza', pasos: [
    { t: 'Cobranza', x: 'Todos los recibos por cobrar: vencidos, por vencer y pagados.' },
    { el: '.kpis', t: 'Resumen', x: 'Cuánto está vencido, cuánto vence pronto y cuánto se ha cobrado.' },
    { el: '.chips', t: 'Qué mostrar', x: 'Cambie entre vencidos, próximos y pagados.' },
    { el: '#tabla tbody tr', t: 'Registrar pago o avisar', x: 'En cada recibo puede marcarlo como pagado o mandar el recordatorio por WhatsApp con un clic.' },
    { el: '[data-rehab]', t: 'Rehabilitación', x: 'Si un recibo se pasó de su fecha límite, la póliza queda sin cobertura. Genere aquí la solicitud de rehabilitación; al registrar el pago, la app guarda el periodo al descubierto.' },
  ] },
  tramites: { nombre: 'Siniestros y reembolsos', pasos: [
    { t: 'Siniestros y reembolsos', x: 'Cada siniestro es un expediente con carpetas: programación de cirugía, reembolso 1, 2, 3…' },
    { el: '.kpis', t: 'Cómo va todo', x: 'Expedientes abiertos, lo que está en reclamación, los que no se han movido y lo recuperado para sus clientes.' },
    { el: '#nuevo', t: 'Nuevo siniestro', x: 'Abra el expediente y su primera carpeta. Después agrega más carpetas al mismo padecimiento.' },
    { el: '#tabla tbody tr', t: 'Abrir el expediente', x: 'Ahí sube facturas, revisa requisitos, genera los formatos de la aseguradora y ve el reembolso esperado.' },
  ] },
  historico: { nombre: 'Histórico de renovaciones', pasos: [
    { t: 'Histórico de renovaciones', x: 'Todas las vigencias de esta póliza, de la más reciente a la más antigua. Cada año es una póliza con sus propios endosos, recibos y documentos.' },
    { el: '.historico tbody tr', t: 'Ver un año', x: 'Haga clic en cualquier vigencia para ver sus endosos, recibos, documentos y siniestros.' },
  ] },
  endosos: { nombre: 'Endosos', pasos: [
    { t: 'Endosos', x: 'Cada cambio al contrato de una póliza: altas y bajas de asegurados, cambio de vehículo, coberturas, beneficiarios, forma de pago o domicilio.' },
    { el: '.kpis', t: 'Cómo van', x: 'Los que están en proceso, los que no se han movido, los emitidos que falta aplicar a la póliza y la prima que dejaron en el año.' },
    { el: '#eNuevo', t: 'Nuevo endoso', x: 'Elija la póliza, diga qué cambia y cuánto cuesta. Si ya tiene el PDF del endoso, la IA llena los datos.' },
    { el: '.chips', t: 'Qué mostrar', x: '«Requieren atención» junta lo que pidieron los clientes desde su portal, lo atrasado y lo emitido sin aplicar.' },
    { el: '#eTabla tbody tr', t: 'Abrir el endoso', x: 'Ahí sigue su avance, sube los requisitos, genera la solicitud para firma y lo aplica a la póliza.' },
  ] },
  endoso: { nombre: 'Detalle del endoso', pasos: [
    { t: 'El endoso', x: 'Todo el cambio en una página: qué cambia, en qué va con la aseguradora, documentos y prima.' },
    { el: '.pasos', t: 'Avance', x: 'Solicitado → enviado → en revisión → emitido → entregado. Si pasa el plazo sin movimiento, aparece en Mis pendientes.' },
    { el: '[data-estatus]', t: 'Avanzar', x: 'Marque cada paso con un clic. Al emitirse se le pide el folio de la aseguradora.' },
    { el: '.tbl-wrap', t: 'Antes y después', x: 'Lo que cambia en la póliza. Al aplicarlo se actualizan asegurados, datos, forma de pago, domicilio y prima; se puede deshacer.' },
    { el: '#mSol', t: 'Solicitud para firma', x: 'Genere la solicitud de endoso ya llena y pida al cliente que la firme desde su portal.' },
    { el: '#mMsg', t: 'Avisar al cliente', x: 'Mande por WhatsApp o correo que su endoso ya se emitió y cuánto cambió su prima.' },
  ] },
  siniestro: { nombre: 'Expediente de siniestro', pasos: [
    { t: 'Expediente', x: 'Todo el siniestro de un asegurado: sus carpetas, facturas, documentos y seguimiento.' },
    { el: '[data-carpeta]', t: 'Carpetas', x: 'Cada trámite ante la aseguradora es una carpeta: programación, reembolso 1, reembolso 2…' },
    { el: '#cgPreg', t: 'Condiciones generales', x: 'La app revisa el periodo de espera del padecimiento contra las condiciones generales del producto, y aquí puede hacerles cualquier pregunta: responde citando la página.' },
    { el: '#sCarpeta', t: 'Nueva carpeta', x: 'Agregue un reembolso o complemento del mismo padecimiento.' },
    { el: '#fUp', t: 'Subir facturas', x: 'Suba los XML y PDF de las facturas: la app lee emisor, importe y folio fiscal, y evita duplicados.' },
    { el: '[data-gen]', t: 'Formatos listos para firmar', x: 'Genere la relación de facturas, la carta y los formatos de la aseguradora ya llenos con los datos de la póliza.' },
    { el: '#cEst', t: 'Estatus', x: 'Actualice el estatus (ingresado, en revisión, pagado…). Queda en el historial y avisa si la carpeta se detiene.' },
  ] },
  prospectos: { nombre: 'Prospectos', pasos: [
    { t: 'Prospectos', x: 'Sus posibles clientes, desde el primer contacto hasta que se emite la póliza.' },
    { el: '#nuevo', t: 'Nuevo prospecto', x: 'Registre quién es, qué le interesa y cuándo darle seguimiento.' },
    { el: '#tablero', t: 'Etapas', x: 'Mueva cada prospecto entre etapas. Cuando se gane, conviértalo en cliente y póliza sin volver a capturar.' },
  ] },
  calendario: { nombre: 'Calendario', pasos: [
    { t: 'Calendario', x: 'Fechas de pago, renovaciones, inicios de vigencia, cumpleaños, tareas y seguimientos en un solo calendario.' },
    { el: '.chips', t: 'Qué mostrar', x: 'Encienda o apague cada tipo de evento.' },
    { el: '#prev', t: 'Cambiar de mes', x: 'Avance o regrese de mes, o vuelva a hoy.' },
    { el: '#nTarea', t: 'Agendar', x: 'Cree una tarea con fecha para usted o alguien del equipo.' },
  ] },
  ventas: { nombre: 'Ventas e ingresos', pasos: [
    { t: 'Ventas e ingresos', x: 'Producción, cobranza y comisiones del año, por mes, aseguradora, ramo y agente.' },
    { el: '#anio', t: 'Año', x: 'Cambie el año para comparar.' },
    { el: '#conciliar', t: 'Conciliar comisiones', x: 'Suba el estado de cuenta de la aseguradora y la app registra las comisiones que coinciden y le dice cuáles le deben.' },
    { el: '#reporte', t: 'Reporte mensual', x: 'Genere en PDF el reporte del mes: producción, cobranza, renovaciones, siniestros y tareas.' },
  ] },
  config: { nombre: 'Configuración', pasos: [
    { t: 'Configuración', x: 'Ajuste la app a su agencia.' },
    { el: '.tabs', t: 'Secciones', x: 'Marca y usuarios, plantillas de mensajes, avisos automáticos por correo, historial de cambios, aseguradoras y productos, y formatos y cartas (de la aseguradora o libres) para siniestros, pólizas y endosos, y las condiciones generales de cada producto.' },
    { el: '#colores', t: 'Colores de la empresa', x: 'Elija una paleta o sus propios colores. Se ven en toda la app y en el portal de clientes.' },
    { el: '#invitar', t: 'Usuarios', x: 'Invite a su equipo y elija qué puede ver y hacer cada quien.' },
  ] },
  // Portal del cliente
  'portal-inicio': { nombre: 'Inicio', pasos: [
    { t: 'Bienvenido a su portal', x: 'Aquí consulta sus seguros, sus pagos y el avance de sus trámites. Le muestro cómo en unos pasos.' },
    { el: '.kpis', t: 'Su resumen', x: 'Pólizas vigentes, su próximo pago y sus trámites en curso.' },
    { el: '.nav', t: 'El menú', x: 'Mis pólizas, mis pagos, mis trámites, solicitar reembolso y mis documentos.' },
    { el: '.filters .btn.primary', t: 'Solicitar un reembolso', x: 'Suba sus facturas e informe médico y nosotros armamos el trámite con la aseguradora.' },
  ] },
  'portal-polizas': { nombre: 'Mis pólizas', pasos: [
    { t: 'Mis pólizas', x: 'Sus pólizas vigentes con vigencia, forma de pago, coberturas y asegurados.' },
    { el: '[data-ver]', t: 'Descargar', x: 'Descargue la carátula, sus endosos u otros documentos de su póliza.' },
    { el: '[data-cambio]', t: 'Solicitar un cambio', x: 'Pida agregar o quitar asegurados, cambiar vehículo, beneficiarios o domicilio. Su agente le avisa cuando quede emitido.' },
  ] },
  'portal-pagos': { nombre: 'Mis pagos', pasos: [
    { t: 'Mis pagos', x: 'Sus pagos pendientes y los que ya realizó.' },
    { el: '[data-pago]', t: 'Avisar que ya pagó', x: 'Envíenos el comprobante y su agente aplica el pago con la aseguradora.' },
  ] },
  'portal-tramites': { nombre: 'Mis trámites', pasos: [
    { t: 'Mis trámites', x: 'El avance de sus reembolsos y programaciones, con lo reclamado, lo pagado y un estimado de lo que le corresponde.' },
  ] },
  'portal-reembolso': { nombre: 'Solicitar reembolso', pasos: [
    { t: 'Solicitar reembolso', x: 'Llene unos datos y suba sus documentos. Su agente recibe la solicitud al momento.' },
    { el: '#rExp', t: 'Padecimiento', x: 'Si ya tiene trámites por el mismo padecimiento, elíjalo. Si es nuevo, escriba el diagnóstico.' },
    { el: '#rFacBox', t: 'Facturas', x: 'Suba el XML y el PDF de cada factura. Tomamos de ahí el importe y le avisamos si una ya la había enviado.' },
    { el: '#rEnviar', t: 'Enviar', x: 'Al enviar, verá su trámite en "Mis trámites" con su estatus.' },
  ] },
  'portal-documentos': { nombre: 'Mis documentos', pasos: [
    { t: 'Mis documentos', x: 'Sus documentos registrados con la agencia.' },
    { el: '#dSub', t: 'Subir documento', x: 'Mantenga al día su INE, comprobante de domicilio y constancia fiscal.' },
  ] },
};

// ---------------------------------------------------------------- Lo que ya vio cada persona (en este navegador)
const LLAVE = 'cc-tutoriales';
const leer = () => { try { return JSON.parse(localStorage.getItem(LLAVE) || '{}'); } catch (e) { return {}; } };
const escribir = d => { try { localStorage.setItem(LLAVE, JSON.stringify(d)); } catch (e) { /* sin almacenamiento */ } };
const yo = () => ctx.perfil?.id || 'anon';
const estado = () => leer()[yo()] || {};
// Las preferencias también se guardan en el perfil, para que se respeten en cualquier dispositivo
const prefs = () => ctx.perfil?.preferencias || {};
async function guardarPrefs(cambios) {
  if (!ctx.perfil) return;
  ctx.perfil.preferencias = { ...prefs(), ...cambios };
  try { await sb.rpc('guardar_preferencias', { p: cambios }); } catch (e) { /* se queda en este navegador */ }
}
function marcar(clave, v = true) {
  const d = leer(); d[yo()] = { ...(d[yo()] || {}), [clave]: v }; escribir(d);
  if (clave !== '_apagados' && v && !(prefs().tutoriales_vistos || []).includes(clave)) guardarPrefs({ tutoriales_vistos: [...(prefs().tutoriales_vistos || []), clave] });
}
const visto = clave => !!estado()[clave] || (prefs().tutoriales_vistos || []).includes(clave);
export function reiniciarTutoriales() { const d = leer(); d[yo()] = {}; delete d._apagadosNavegador; escribir(d); guardarPrefs({ tutoriales: true, tutoriales_vistos: [] }); }
export const tutorialesApagados = () => prefs().tutoriales === false || !!estado()._apagados || !!leer()._apagadosNavegador;
// Activa o desactiva que los tutoriales aparezcan solos al entrar a cada sección
export function activarTutoriales(on) {
  const d = leer(); d[yo()] = { ...(d[yo()] || {}), _apagados: !on }; if (on) delete d._apagadosNavegador; escribir(d);
  guardarPrefs({ tutoriales: !!on });
}

export const claveTour = ruta => (ctx.perfil?.rol === 'cliente' ? 'portal-' : '') + ruta;
export const hayTour = clave => !!TOURS[clave];

// Al entrar a una sección por primera vez
export function tutorialAuto(clave) {
  if (!TOURS[clave] || tutorialesApagados() || visto(clave) || abierto) return;
  setTimeout(() => { if (!document.querySelector('dialog[open]')) iniciarTour(clave); }, 700);
}

// ---------------------------------------------------------------- Recorrido
let abierto = null;
const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
const buscar = sel => [...document.querySelectorAll(sel)].find(visible) || null;
const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function iniciarTour(clave) {
  const tour = TOURS[clave]; if (!tour) return;
  cerrarTour(false);
  const pasos = tour.pasos.filter(p => !p.el || buscar(p.el));
  if (!pasos.length) return;
  let i = 0;
  const previo = document.activeElement;
  const capa = document.createElement('div'); capa.className = 'tour-capa';
  capa.innerHTML = `<div class="tour-foco"></div>
    <div class="tour-globo" role="dialog" aria-modal="true" aria-labelledby="tourT" aria-describedby="tourX" tabindex="-1">
      <div class="tour-flecha"></div>
      <div class="tour-sup"><span class="tour-sec">${esc(tour.nombre)}</span><button type="button" class="tour-x" data-t="cerrar" aria-label="Cerrar tutorial">×</button></div>
      <h3 id="tourT"></h3><p id="tourX"></p>
      <div class="tour-pie"><div class="tour-puntos" aria-hidden="true"></div><span class="sr" id="tourN"></span>
        <div class="tour-bot"><button type="button" class="btn sm" data-t="atras">Anterior</button><button type="button" class="btn sm primary" data-t="sig">Siguiente</button></div></div>
      <div class="tour-apagar"><button type="button" class="linkbtn small" data-t="apagar">No volver a mostrar tutoriales</button> <span>(se reactivan en el botón ?)</span></div>
    </div>`;
  document.body.appendChild(capa);
  const foco = capa.querySelector('.tour-foco'), globo = capa.querySelector('.tour-globo');

  const colocar = () => {
    const p = pasos[i], el = p.el ? buscar(p.el) : null, M = 8, vw = innerWidth, vh = innerHeight;
    globo.classList.toggle('centro', !el); foco.classList.toggle('vacio', !el);
    if (!el) { foco.style.cssText = `top:${vh / 2}px;left:${vw / 2}px;width:0;height:0`; globo.style.cssText = ''; return; }
    const r = el.getBoundingClientRect();
    const box = { top: Math.max(4, r.top - M), left: Math.max(4, r.left - M), width: Math.min(vw - 8, r.width + M * 2), height: Math.min(vh - 8, r.height + M * 2) };
    foco.style.cssText = `top:${box.top}px;left:${box.left}px;width:${box.width}px;height:${box.height}px`;
    const gw = Math.min(360, vw - 24), gh = globo.offsetHeight || 220;
    // Junto a la barra lateral: a la derecha; si no, abajo o arriba según el espacio
    let lado, top, left;
    if (box.left + box.width + gw + 20 < vw && box.height > vh * 0.5) { lado = 'der'; left = box.left + box.width + 14; top = Math.min(Math.max(12, box.top + 20), vh - gh - 12); }
    else if (box.top + box.height + gh + 20 < vh) { lado = 'abajo'; top = box.top + box.height + 14; left = Math.min(Math.max(12, box.left + box.width / 2 - gw / 2), vw - gw - 12); }
    else if (box.top - gh - 20 > 0) { lado = 'arriba'; top = box.top - gh - 14; left = Math.min(Math.max(12, box.left + box.width / 2 - gw / 2), vw - gw - 12); }
    else { lado = 'centro-libre'; top = Math.max(12, vh - gh - 12); left = Math.max(12, vw / 2 - gw / 2); }
    globo.dataset.lado = lado;
    globo.style.cssText = `top:${top}px;left:${left}px;width:${gw}px`;
    const fl = capa.querySelector('.tour-flecha');
    if (lado === 'der') fl.style.cssText = `top:${Math.min(gh - 24, Math.max(14, box.top + Math.min(box.height, 60) / 2 - top))}px;left:-7px`;
    else fl.style.cssText = `left:${Math.min(gw - 24, Math.max(14, box.left + box.width / 2 - left - 7))}px;${lado === 'abajo' ? 'top:-7px' : 'bottom:-7px'}`;
  };
  const pintar = () => {
    const p = pasos[i];
    capa.querySelector('#tourT').textContent = p.t;
    capa.querySelector('#tourX').textContent = p.x;
    capa.querySelector('#tourN').textContent = `Paso ${i + 1} de ${pasos.length}`;
    capa.querySelector('.tour-puntos').innerHTML = pasos.map((_, k) => `<i${k === i ? ' class="on"' : ''}></i>`).join('');
    capa.querySelector('[data-t=atras]').hidden = i === 0;
    capa.querySelector('[data-t=sig]').textContent = i === pasos.length - 1 ? 'Entendido' : 'Siguiente';
    const el = p.el ? buscar(p.el) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducido() ? 'auto' : 'smooth' });
    }
    globo.classList.remove('entra'); void globo.offsetWidth; globo.classList.add('entra');
    colocar(); setTimeout(colocar, reducido() ? 0 : 380);
    globo.focus({ preventScroll: true });
  };
  const ir = d => { const n = i + d; if (n < 0) return; if (n >= pasos.length) { cerrar(true); return; } i = n; pintar(); };
  const cerrar = completo => { marcar(clave); cerrarTour(); if (completo === 'apagar') { activarTutoriales(false); toast('Listo, los tutoriales ya no aparecerán solos. Puede verlos cuando quiera en el botón ?.'); } previo?.focus?.({ preventScroll: true }); };
  capa.addEventListener('click', e => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t === 'sig') ir(1); else if (t === 'atras') ir(-1); else if (t === 'cerrar') cerrar(false); else if (t === 'apagar') cerrar('apagar');
  });
  const teclas = e => {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); ir(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); ir(-1); }
    else if (e.key === 'Tab') {   // el foco se queda dentro del globo
      const f = [...globo.querySelectorAll('button:not([hidden])')]; const a = f.indexOf(document.activeElement);
      if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const rep = () => colocar();
  document.addEventListener('keydown', teclas, true); addEventListener('resize', rep); addEventListener('scroll', rep, true);
  abierto = { capa, quitar: () => { document.removeEventListener('keydown', teclas, true); removeEventListener('resize', rep); removeEventListener('scroll', rep, true); } };
  requestAnimationFrame(() => { capa.classList.add('on'); pintar(); });
}

export function cerrarTour() {
  if (!abierto) return;
  const { capa, quitar } = abierto; abierto = null; quitar();
  capa.classList.remove('on'); setTimeout(() => capa.remove(), reducido() ? 0 : 220);
}

// ---------------------------------------------------------------- Botón de ayuda
export function botonAyuda(rutaActual) {
  let b = document.getElementById('ayuda');
  if (!b) {
    b = document.createElement('div'); b.id = 'ayuda';
    b.innerHTML = `<button type="button" class="ayuda-btn" aria-expanded="false" aria-controls="ayudaMenu" title="Ayuda">?<span class="sr">Ayuda y tutoriales</span></button>
      <div class="ayuda-menu" id="ayudaMenu" hidden>
        <div class="ayuda-h">Ayuda</div>
        <button type="button" data-a="seccion"></button>
        <button type="button" data-a="general">Recorrido general de la app</button>
        <label class="ayuda-sw"><input type="checkbox" data-a="auto"> Mostrar tutoriales al entrar a cada sección</label>
        <button type="button" data-a="reiniciar">Volver a ver los tutoriales desde el inicio</button>
      </div>`;
    document.body.appendChild(b);
    const btn = b.querySelector('.ayuda-btn'), menu = b.querySelector('.ayuda-menu');
    const abrir = v => { menu.hidden = !v; btn.setAttribute('aria-expanded', String(v)); if (v) menu.querySelector('button:not([hidden])')?.focus(); };
    btn.onclick = () => { b.querySelector('[data-a=auto]').checked = !tutorialesApagados(); abrir(menu.hidden); };
    b.querySelector('[data-a=auto]').onchange = e => { activarTutoriales(e.target.checked); toast(e.target.checked ? 'Los tutoriales aparecerán al entrar por primera vez a cada sección.' : 'Listo, los tutoriales ya no aparecerán solos.'); };
    document.addEventListener('click', e => { if (!b.contains(e.target)) abrir(false); });
    b.addEventListener('keydown', e => { if (e.key === 'Escape') { abrir(false); btn.focus(); } });
    menu.onclick = e => {
      const a = e.target.closest('button[data-a]')?.dataset.a; if (!a) return; abrir(false);
      if (a === 'seccion') iniciarTour(b.dataset.clave);
      if (a === 'general') { if (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] !== 'inicio' && location.hash) { location.hash = '#/inicio'; setTimeout(() => iniciarTour(claveTour('inicio')), 700); } else iniciarTour(claveTour('inicio')); }
      if (a === 'reiniciar') { reiniciarTutoriales(); toast('Listo. Los tutoriales aparecerán otra vez al entrar a cada sección.'); }
    };
  }
  const clave = claveTour(rutaActual);
  b.dataset.clave = clave;
  const s = b.querySelector('[data-a=seccion]');
  s.hidden = !TOURS[clave]; s.textContent = TOURS[clave] ? `Tutorial de "${TOURS[clave].nombre}"` : '';
  return b;
}
