// Avisos por WhatsApp Business (API de Meta): orden de variables de cada plantilla.
// Meta exige plantillas aprobadas con variables numeradas {{1}}, {{2}}…; aquí se define qué dato va en cada número.
export const VARS_WA = {
  recordatorio_pago: ['nombre', 'recibo', 'poliza', 'aseguradora', 'monto', 'fecha'],
  pago_vencido: ['nombre', 'recibo', 'poliza', 'aseguradora', 'monto', 'fecha'],
  aviso_renovacion: ['nombre', 'ramo', 'aseguradora', 'poliza', 'fecha'],
  felicitacion: ['nombre'],
  reembolso_pagado: ['nombre', 'tramite', 'padecimiento', 'monto'],
  endoso_emitido: ['nombre', 'aseguradora', 'poliza', 'movimiento', 'importe_texto'],
};
export const CANALES = { correo: 'Solo correo', whatsapp: 'Solo WhatsApp', ambos: 'Correo y WhatsApp' };
// Texto de la plantilla con {{n}} en lugar de {variable}, para registrarla en Meta
export function textoParaMeta(clave, texto) {
  const vars = VARS_WA[clave] || [];
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => { const i = vars.indexOf(k); return i >= 0 ? `{{${i + 1}}}` : (k === 'agencia' ? m : ''); });
}
// Canales por los que sale un aviso según la configuración y los datos del cliente
export function canalesDe(cfg, x, wa) {
  const c = cfg?.canal || 'correo', out = [];
  if ((c === 'correo' || c === 'ambos') && x.email) out.push('correo');
  if ((c === 'whatsapp' || c === 'ambos') && x.telefono && wa?.phone_number_id) out.push('whatsapp');
  return out;
}
