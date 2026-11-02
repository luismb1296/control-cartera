// Plantillas de mensajes iniciales (las mismas que crea sql/03_modulos.sql)
export const PLANTILLAS_BASE = [
  ['recordatorio_pago', 'Recordatorio de pago', 'Recordatorio de pago de su póliza {poliza}',
    'Hola {nombre}, le recordamos que el recibo {recibo} de su póliza {poliza} de {aseguradora} por {monto} vence el {fecha}. Si ya realizó el pago, por favor envíenos su comprobante. Saludos, {agencia}.'],
  ['aviso_renovacion', 'Aviso de renovación', 'Renovación de su póliza {poliza}',
    'Hola {nombre}, su póliza de {ramo} con {aseguradora} ({poliza}) vence el {fecha}. Ya estamos preparando su renovación; en breve le compartimos las opciones. Saludos, {agencia}.'],
  ['felicitacion', 'Felicitación de cumpleaños', '¡Feliz cumpleaños!',
    '¡Feliz cumpleaños, {nombre}! Todo el equipo de {agencia} le desea un excelente día.'],
  ['envio_poliza', 'Envío de póliza', 'Su póliza {poliza}',
    'Hola {nombre}, le compartimos su póliza de {ramo} con {aseguradora} ({poliza}), vigente del {inicio} al {fecha}. Cualquier duda estamos a sus órdenes. Saludos, {agencia}.'],
  ['estatus_tramite', 'Avance de trámite', 'Avance de su trámite {folio}',
    'Hola {nombre}, le informamos que su trámite de {tramite} (folio {folio}) se encuentra: {estatus}. Le avisaremos de cualquier novedad. Saludos, {agencia}.'],
  ['reembolso_pagado', 'Reembolso pagado', 'Su {tramite} fue pagado',
    'Hola {nombre}, le confirmamos que la aseguradora pagó su {tramite} ({padecimiento}) por {monto}. Si tiene cualquier duda, estamos para servirle. Saludos, {agencia}.'],
  ['pago_vencido', 'Pago vencido', 'Su recibo de la póliza {poliza} está vencido',
    'Hola {nombre}, el recibo {recibo} de su póliza {poliza} de {aseguradora} por {monto} venció el {fecha}. Para evitar la cancelación de su seguro, le pedimos realizar el pago a la brevedad o contactarnos si ya lo realizó. Saludos, {agencia}.'],
  ['endoso_emitido', 'Endoso emitido', 'Su póliza {poliza} fue actualizada',
    'Hola {nombre}, le confirmamos que {aseguradora} emitió el cambio que solicitó en su póliza {poliza}: {movimiento}. {importe_texto} Si tiene dudas, con gusto le apoyamos. Saludos, {agencia}.'],
];
