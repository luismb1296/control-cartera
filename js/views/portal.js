// Portal del cliente: el asegurado ve sus pólizas, pagos, trámites y documentos,
// avisa sus pagos y solicita reembolsos subiendo sus facturas. Solo lectura, salvo altas.
import { sb, ctx, q } from '../db.js';
import {
  esc, money, fdate, pill, modal, select, textarea, opts, optsList, toast, txt, hoyISO, primerNombre, diffDays, sum,
  RAMOS, FORMAS, CAMPOS_RAMO, SIT_RECIBO, DOCS, DOCS_CLIENTE, TIPOS_CARPETA, EST_TRAMITE, TRAMITE_ABIERTO, TIPOS_MOV, EST_MOV, REQ_MOV, input
, numRecibo, periodosDescubiertos } from '../ui.js';
import { subirArchivo, abrirArchivo } from './formas.js';
import { leerCFDI, categoriaDe, calcularEsperado } from './tramites.js';
import { pendientesDeFirma, firmarDocumento } from './firma.js';

export const RUTAS_PORTAL = [
  ['inicio', 'Inicio', portalInicio],
  ['polizas', 'Mis pólizas', portalPolizas],
  ['pagos', 'Mis pagos', portalPagos],
  ['tramites', 'Mis trámites', portalTramites],
  ['reembolso', 'Solicitar reembolso', portalReembolso],
  ['documentos', 'Mis documentos', portalDocumentos],
];

// Lo que el cliente necesita saber de cada estatus (sin notas internas)
const EXPLICA = {
  por_ingresar: 'Recibimos su solicitud. Estamos revisando sus documentos para ingresarlos a la aseguradora.',
  ingresado: 'Ya está ingresado en la aseguradora. Le avisaremos en cuanto haya respuesta.',
  en_revision: 'La aseguradora está revisando su trámite.',
  info_adicional: 'La aseguradora pidió información adicional. Su agente se pondrá en contacto con usted.',
  pagado: 'Trámite pagado o aprobado por la aseguradora.',
  rechazado: 'La aseguradora no aprobó este trámite. Su agente le explicará el motivo y las opciones.',
  cerrado: 'Trámite cerrado.',
};
const nombreCarpeta = t => `${TIPOS_CARPETA[t.tipo] || 'Trámite'}${t.numero && (t.numero > 1 || ['reembolso', 'complemento'].includes(t.tipo)) ? ' ' + t.numero : ''}`;
const ramo = p => RAMOS[p.ramo] || p.ramo;
const miAgente = c => ctx.perfiles.find(p => p.id === c?.agente_id) || null;
// El trámite lo atiende el agente del cliente (o, si no tiene, operaciones/administración)
const responsable = c => c?.agente_id || ctx.perfiles.find(p => p.activo && p.rol === 'operaciones')?.id || ctx.perfiles.find(p => p.activo && p.rol === 'admin')?.id || null;
// Endosos: lo que el cliente necesita saber de cada estatus
const EXPLICA_MOV = {
  solicitado: 'Recibimos su solicitud. Su agente la revisará y la enviará a la aseguradora.',
  enviado: 'Ya la enviamos a la aseguradora. Le avisaremos en cuanto la emita.',
  en_revision: 'La aseguradora está revisando el cambio.',
  emitido: 'La aseguradora emitió el cambio en su póliza.',
  entregado: 'Cambio emitido y entregado.',
  rechazado: 'La aseguradora no aceptó el cambio. Su agente le explicará el motivo y las opciones.',
};
// Cambios que el cliente puede pedir desde el portal
const PEDIBLES = ['alta_asegurado', 'baja_asegurado', 'cambio_vehiculo', 'cambio_beneficiarios', 'cambio_domicilio', 'cambio_forma_pago', 'cambio_conducto', 'correccion_datos', 'otro'];
const etiquetaComprobante = r => `Comprobante recibo ${r.numero}-${r.total_recibos}`;

async function cargar() {
  const id = ctx.perfil.cliente_id;
  const [c, polizas, recibos, docs, siniestros, tramites] = await Promise.all([
    q(sb.from('clientes').select('*').eq('id', id).maybeSingle()),
    q(sb.from('v_polizas').select('*').eq('cliente_id', id).order('fin_vigencia', { ascending: false })),
    q(sb.from('v_recibos').select('*').eq('cliente_id', id).order('fecha_limite')),
    q(sb.from('documentos').select('*').eq('cliente_id', id).order('creado_en', { ascending: false })),
    q(sb.from('siniestros').select('*').eq('cliente_id', id).order('creado_en', { ascending: false })),
    q(sb.from('tramites').select('*').eq('cliente_id', id).order('creado_en')),
  ]);
  if (!c) throw new Error('No encontramos su información. Comuníquese con su agente.');
  const pids = polizas.map(p => p.id), tids = tramites.map(t => t.id);
  const [asegurados, facturas, endosos] = await Promise.all([
    pids.length ? q(sb.from('asegurados').select('*').in('poliza_id', pids)) : [],
    tids.length ? q(sb.from('facturas').select('*').in('tramite_id', tids)) : [],
    pids.length ? q(sb.from('movimientos').select('*').in('poliza_id', pids).order('creado_en', { ascending: false })) : [],
  ]);
  return { c, polizas, recibos, docs, siniestros, tramites, asegurados, facturas, endosos, vigentes: polizas.filter(p => p.estatus === 'activa') };
}

// ---------------------------------------------------------------- Inicio
export async function portalInicio(main, _p, vigente) {
  const d = await cargar(); if (!vigente()) return;
  const pend = d.recibos.filter(r => r.estatus === 'pendiente');
  const vencidos = pend.filter(r => r.situacion === 'vencido');
  const prox = pend.find(r => r.situacion !== 'vencido');
  const abiertos = d.tramites.filter(t => TRAMITE_ABIERTO.includes(t.estatus));
  const anio = String(new Date().getFullYear());
  const recuperado = sum(d.tramites.filter(t => t.estatus === 'pagado' && String(t.actualizado_en || '').startsWith(anio)), t => t.monto_pagado);
  const renuevan = d.vigentes.filter(p => p.dias_para_vencer != null && p.dias_para_vencer <= 60 && p.dias_para_vencer >= 0);
  const ag = miAgente(d.c);

  main.innerHTML = `
  <div class="head"><div><h1>Hola, ${esc(primerNombre(d.c.nombre))}</h1>
    <p class="muted" style="margin:4px 0 0">Aquí puede consultar sus seguros con ${esc(ctx.agencia?.nombre || 'su agencia')}.</p></div>
    <div class="filters"><a class="btn primary" href="#/reembolso">Solicitar reembolso</a></div></div>
  ${vencidos.length ? `<div class="card pend-banner bad" role="alert"><b>Tiene ${vencidos.length} pago${vencidos.length > 1 ? 's' : ''} vencido${vencidos.length > 1 ? 's' : ''} por ${money(sum(vencidos, r => r.prima_total))}.</b>
    Si ya pagó, avísenos con su comprobante para no perder la cobertura. <a href="#/pagos">Ver mis pagos</a></div>` : ''}
  ${pendientesDeFirma(d.docs).length ? `<a class="card pend-banner" href="#/documentos"><b>Tiene ${pendientesDeFirma(d.docs).length} documento${pendientesDeFirma(d.docs).length > 1 ? 's' : ''} por firmar.</b> <span>Firmar ahora</span></a>` : ''}
  <section class="kpis">
    <a class="card kpi" href="#/polizas"><div class="k">Pólizas vigentes</div><div class="v">${d.vigentes.length}</div><div class="s">${[...new Set(d.vigentes.map(ramo))].join(', ') || 'Sin pólizas vigentes'}</div></a>
    <a class="card kpi${vencidos.length ? ' bad' : ''}" href="#/pagos"><div class="k">Próximo pago</div><div class="v">${prox ? money(prox.prima_total) : vencidos.length ? 'Vencido' : 'Al corriente'}</div>
      <div class="s">${prox ? `Antes del ${fdate(prox.fecha_limite)} · ${esc(ramo(prox))}` : vencidos.length ? 'Revise sus pagos' : 'No tiene pagos pendientes'}</div></a>
    <a class="card kpi" href="#/tramites"><div class="k">Trámites en curso</div><div class="v">${abiertos.length}</div><div class="s">${abiertos.length ? 'Reembolsos y programaciones' : 'Ninguno en este momento'}</div></a>
    <div class="card kpi"><div class="k">Reembolsos pagados en ${anio}</div><div class="v">${money(recuperado)}</div><div class="s">Recuperado por sus trámites</div></div>
  </section>
  <section class="row">
    <div class="col card" style="flex:2 1 420px">
      <h2>¿Qué necesita hacer?</h2>
      <div class="list">
        <a class="li" href="#/reembolso"><span><b>Solicitar un reembolso</b><div class="muted small">Suba sus facturas (XML y PDF) e informe médico.</div></span><span aria-hidden="true">›</span></a>
        <a class="li" href="#/pagos"><span><b>Avisar un pago</b><div class="muted small">Envíe su comprobante y lo aplicamos.</div></span><span aria-hidden="true">›</span></a>
        <a class="li" href="#/polizas"><span><b>Descargar mi póliza</b><div class="muted small">Carátulas, condiciones y coberturas.</div></span><span aria-hidden="true">›</span></a>
        <a class="li" href="#/polizas?cambio=1"><span><b>Solicitar un cambio en mi póliza</b><div class="muted small">Agregar o quitar asegurados, cambiar vehículo, beneficiarios o domicilio.</div></span><span aria-hidden="true">›</span></a>
        <a class="li" href="#/documentos"><span><b>Actualizar mis documentos</b><div class="muted small">INE, comprobante de domicilio, constancia fiscal.</div></span><span aria-hidden="true">›</span></a>
      </div>
      ${renuevan.length ? `<h2 style="margin-top:20px">Próximas renovaciones</h2><div class="list">${renuevan.map(p => `<div class="li"><span>${esc(ramo(p))} · ${esc(p.aseguradora_nombre)} <span class="muted small">${esc(p.numero_poliza || '')}</span></span>
        <span class="small">${fdate(p.fin_vigencia)} · en ${p.dias_para_vencer} días</span></div>`).join('')}</div>
        <p class="muted small">Su agente le enviará la propuesta de renovación antes de esa fecha.</p>` : ''}
    </div>
    <div class="col card" style="flex:1 1 260px">
      <h2>Su agente</h2>
      ${ag ? `<p style="margin:0"><b>${esc(ag.nombre)}</b></p>${ag.email ? `<p class="small" style="margin:4px 0 12px"><a href="mailto:${esc(ag.email)}">${esc(ag.email)}</a></p>` : ''}` : '<p class="muted">Sin agente asignado.</p>'}
      <p class="muted small">Para cambios en su póliza (agregar o quitar asegurados, cambiar vehículo, beneficiarios), use <a href="#/polizas?cambio=1">Solicitar un cambio</a>. Para cancelar, escriba a su agente.</p>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- Pólizas
export async function portalPolizas(main, _p, vigente) {
  const d = await cargar(); if (!vigente()) return;
  const docsDe = p => d.docs.filter(x => x.poliza_id === p.id && !x.tramite_id && !x.tarea_id && !x.movimiento_id && x.tipo !== 'otro');
  const endososDe = p => d.endosos.filter(m => m.poliza_id === p.id);
  const anteriores = d.polizas.filter(p => p.estatus !== 'activa');
  const tarjeta = p => {
    const campos = (CAMPOS_RAMO[p.ramo] || []).filter(([k]) => p.datos_ramo?.[k]);
    const aseg = d.asegurados.filter(a => a.poliza_id === p.id);
    const docs = docsDe(p);
    return `<article class="card">
      <div class="head" style="align-items:flex-start"><div><h2 style="margin:0">${esc(ramo(p))} · ${esc(p.aseguradora_nombre)}</h2>
        <div class="muted small" style="margin-top:4px">${esc(p.producto || '')}${p.producto ? ' · ' : ''}Póliza ${esc(p.numero_poliza || 'en trámite')}</div></div>
        ${p.estatus === 'activa' ? '<span class="pill p-ok">Vigente</span>' : `<span class="pill p-gray">${p.estatus === 'renovada' ? 'Renovada' : p.estatus === 'cancelada' ? 'Cancelada' : 'Vencida'}</span>`}</div>
      <div class="grid-info" style="margin-top:14px">
        <div><div class="lbl">Vigencia</div><div class="val">${fdate(p.inicio_vigencia)} al ${fdate(p.fin_vigencia)}</div></div>
        <div><div class="lbl">Forma de pago</div><div class="val">${esc(FORMAS[p.forma_pago] || p.forma_pago)}</div></div>
        <div><div class="lbl">Prima anual</div><div class="val">${money(p.prima_total, p.moneda)}</div></div>
        ${campos.map(([k, l]) => `<div><div class="lbl">${esc(l)}</div><div class="val">${esc(p.datos_ramo[k])}</div></div>`).join('')}
      </div>
      ${periodosDescubiertos(d.recibos.filter(r => r.poliza_id === p.id)).map(x => `<div class="small" style="margin-top:14px;border-left:4px solid var(--warn);padding:8px 12px;background:var(--surface-2);border-radius:0 8px 8px 0">
        <b>Periodo sin cobertura: ${fdate(x.desde)} al ${fdate(x.hasta)}.</b> El recibo con fecha límite ${fdate(x.recibo.fecha_limite)} se pagó el ${fdate(x.recibo.fecha_pago)}; la póliza se rehabilitó, pero lo que haya ocurrido o se haya diagnosticado en esas fechas no está cubierto.</div>`).join('')}
      ${p.estatus === 'activa' && d.recibos.some(r => r.poliza_id === p.id && r.situacion === 'vencido' && Number(r.prima_total) > 0) ? `<div class="small" role="alert" style="margin-top:14px;border-left:4px solid var(--bad);padding:8px 12px;background:var(--surface-2);border-radius:0 8px 8px 0">
        <b style="color:var(--bad)">Tiene un pago vencido: mientras no se pague, esta póliza no tiene cobertura.</b> <a href="#/pagos">Ver mis pagos</a></div>` : ''}
      ${aseg.length ? `<div style="margin-top:14px"><div class="lbl">${p.ramo === 'vida' ? 'Asegurado y beneficiarios' : 'Asegurados'}</div>
        <div class="chips" style="margin-top:6px">${aseg.map(a => `<span class="pill p-gray">${esc(a.nombre)}${a.parentesco ? ` · ${esc(a.parentesco)}` : ''}${a.porcentaje ? ` · ${a.porcentaje}%` : ''}</span>`).join('')}</div></div>` : ''}
      <div style="margin-top:14px"><div class="lbl">Documentos</div>
        ${docs.length ? `<div class="list" style="margin-top:6px">${docs.map(x => `<div class="li"><span>${esc(DOCS[x.tipo] || x.tipo)} <span class="muted small">${esc(x.nombre_archivo)}</span></span>
          <button class="btn sm" type="button" data-ver="${esc(x.ruta)}">Descargar</button></div>`).join('')}</div>`
          : '<p class="muted small" style="margin:6px 0 0">Aún no hay documentos de esta póliza. Si necesita su carátula, pídala a su agente.</p>'}</div>
      <div style="margin-top:14px"><div class="head" style="margin:0"><div class="lbl">Cambios a su póliza (endosos)</div>
        ${p.estatus === 'activa' ? `<button type="button" class="btn sm" data-cambio="${p.id}">Solicitar un cambio</button>` : ''}</div>
        ${endososDe(p).length ? `<div class="list" style="margin-top:6px">${endososDe(p).map(m => { const arch = d.docs.filter(x => x.movimiento_id === m.id && x.tipo === 'endoso');
          return `<div class="li" style="align-items:flex-start"><div><b>${esc(TIPOS_MOV[m.tipo] || 'Cambio')}</b> ${pill(EST_MOV, m.estatus)}
            <div class="muted small">${esc(m.descripcion || '')}</div><div class="small" style="margin-top:2px">${esc(EXPLICA_MOV[m.estatus] || '')}${['emitido', 'entregado'].includes(m.estatus) && Number(m.importe) ? ` ${Number(m.importe) > 0 ? 'Ajuste de prima' : 'Devolución'}: ${money(Math.abs(m.importe), p.moneda)}.` : ''}</div></div>
            ${arch.map(x => `<button class="btn sm" type="button" data-ver="${esc(x.ruta)}">Descargar endoso</button>`).join('')}</div>`; }).join('')}</div>`
          : '<p class="muted small" style="margin:6px 0 0">Sin cambios registrados.</p>'}</div>
    </article>`;
  };
  main.innerHTML = `<div class="head"><h1>Mis pólizas</h1></div>
    ${d.vigentes.length ? d.vigentes.map(tarjeta).join('') : '<div class="card empty">No tiene pólizas vigentes.</div>'}
    ${anteriores.length ? `<details class="card"><summary><b>Pólizas anteriores (${anteriores.length})</b></summary><div style="margin-top:12px">${anteriores.map(tarjeta).join('')}</div></details>` : ''}`;
  main.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => abrirArchivo(b.dataset.ver));
  const pedir = pid => solicitarCambio(d, pid, () => { history.replaceState(null, '', '#/polizas'); portalPolizas(main, _p, vigente); });
  main.querySelectorAll('[data-cambio]').forEach(b => b.onclick = () => pedir(b.dataset.cambio));
  if (/[?&]cambio=1/.test(location.hash) && d.vigentes.length) pedir(d.vigentes[0].id);
}

// El cliente pide un endoso: su agente lo recibe en Endosos y en sus pendientes
function solicitarCambio(d, polizaId, alTerminar) {
  const docsTipos = t => [...new Set([...(REQ_MOV[t] || []).map(([k]) => k).filter(k => k !== 'solicitud_endoso'), 'otro'])];
  modal({
    titulo: 'Solicitar un cambio en su póliza', boton: 'Enviar solicitud',
    cuerpo: `<p class="muted" style="margin-top:0">Su agente revisará la solicitud y la enviará a la aseguradora. Le avisaremos cuando el cambio quede emitido.</p>
      <div class="form-grid">
        ${select('Póliza', 'poliza_id', optsList(d.vigentes, polizaId, p => `${ramo(p)} · ${p.aseguradora_nombre} · ${p.numero_poliza || ''}`), { req: true, wide: true })}
        ${select('¿Qué desea cambiar?', 'tipo', opts(Object.fromEntries(PEDIBLES.map(k => [k, TIPOS_MOV[k]])), 'alta_asegurado'), { req: true, wide: true })}
        <div class="wide" id="pcAlta"><div class="form-grid">${input('Nombre completo de la persona', 'alta_nombre')}${input('Parentesco', 'alta_par', { attrs: 'placeholder="Ej. hija, cónyuge"' })}${input('Fecha de nacimiento', 'alta_nac', { type: 'date' })}</div></div>
        ${textarea('Explique el cambio', 'descripcion', '', { wide: true })}
        <div class="field"><label for="pcDocTipo">Tipo de documento</label><select id="pcDocTipo" name="doc_tipo"></select></div>
        <div class="field"><label for="pcArch">Documentos (opcional)</label><input id="pcArch" type="file" multiple accept=".pdf,image/*"></div>
      </div>
      <p class="muted small" id="pcReq" style="margin-bottom:0"></p>`,
    onOpen: f => {
      const vis = () => {
        f.querySelector('#pcAlta').hidden = f.tipo.value !== 'alta_asegurado';
        f.doc_tipo.innerHTML = docsTipos(f.tipo.value).map(k => `<option value="${k}">${esc(DOCS[k])}</option>`).join('');
        const req = (REQ_MOV[f.tipo.value] || []).filter(([k]) => k !== 'solicitud_endoso' && !(k === 'cuestionario_medico' && d.polizas.find(p => p.id === f.poliza_id.value)?.ramo !== 'gmm'));
        f.querySelector('#pcReq').textContent = req.length ? 'Normalmente la aseguradora pide: ' + req.map(([, l]) => l.toLowerCase()).join(', ') + '. Puede subirlos ahora o después.' : '';
      };
      f.tipo.onchange = vis; f.poliza_id.onchange = vis; vis();
    },
    onSubmit: async (x, f) => {
      const desc = txt(x.descripcion), alta = x.tipo === 'alta_asegurado' && txt(x.alta_nombre);
      if (!desc && !alta) throw new Error('Explique brevemente qué desea cambiar.');
      const cambios = alta ? { asegurados_alta: [{ nombre: txt(x.alta_nombre), parentesco: txt(x.alta_par) || 'otro', fecha_nacimiento: x.alta_nac || null }] } : {};
      const m = await q(sb.from('movimientos').insert({ poliza_id: x.poliza_id, tipo: x.tipo, estatus: 'solicitado', solicitado_por_cliente: true, cambios,
        descripcion: desc || `Alta de ${txt(x.alta_nombre)}`, fecha_efecto: null, responsable_id: responsable(d.c), creado_por: ctx.perfil.id }).select().single());
      for (const file of f.querySelector('#pcArch').files) {
        const ruta = await subirArchivo(file, d.c.id, 'endosos');
        await q(sb.from('documentos').insert({ cliente_id: d.c.id, poliza_id: x.poliza_id, movimiento_id: m.id, tipo: x.doc_tipo || 'otro', nombre_archivo: file.name, ruta }));
      }
      toast('Solicitud enviada. Su agente le dará seguimiento.');
      alTerminar?.();
    },
  });
}

// ---------------------------------------------------------------- Pagos
export async function portalPagos(main, _p, vigente) {
  const d = await cargar(); if (!vigente()) return;
  const enviado = r => d.docs.some(x => x.poliza_id === r.poliza_id && String(x.nombre_archivo).startsWith(etiquetaComprobante(r)));
  const pend = d.recibos.filter(r => r.estatus === 'pendiente');
  const pagados = d.recibos.filter(r => r.estatus === 'pagado').sort((a, b) => String(b.fecha_pago).localeCompare(String(a.fecha_pago))).slice(0, 24);
  const fila = r => `<tr><td>${esc(ramo(r))} · ${esc(r.aseguradora_nombre || '')}<div class="muted small">${esc(r.numero_poliza || '')} · recibo ${numRecibo(r)}</div></td>
    <td class="nw">${fdate(r.estatus === 'pagado' ? r.fecha_pago : r.fecha_limite)}</td><td class="num">${money(r.prima_total)}</td>
    <td>${pill(SIT_RECIBO, r.situacion)}</td>
    <td>${r.estatus === 'pendiente' ? (enviado(r) ? '<span class="pill p-blue">Comprobante enviado</span>' : `<button class="btn sm" type="button" data-pago="${r.id}">Ya pagué</button>`) : ''}</td></tr>`;
  main.innerHTML = `<div class="head"><h1>Mis pagos</h1></div>
    <section class="card"><h2>Por pagar (${pend.length})</h2>
      ${pend.length ? `<div class="tbl-wrap"><table><thead><tr><th>Póliza</th><th>Fecha límite</th><th class="num">Importe</th><th>Situación</th><th></th></tr></thead><tbody>${pend.map(fila).join('')}</tbody></table></div>
        <p class="muted small">Si ya pagó directamente a la aseguradora o por transferencia, use "Ya pagué" para enviarnos el comprobante. Si su póliza tiene cargo automático a tarjeta, el cobro se refleja solo.</p>`
        : '<p class="muted">Está al corriente. No tiene pagos pendientes.</p>'}
    </section>
    ${pagados.length ? `<section class="card"><h2>Pagos realizados</h2><div class="tbl-wrap"><table><thead><tr><th>Póliza</th><th>Fecha de pago</th><th class="num">Importe</th><th>Situación</th><th></th></tr></thead>
      <tbody>${pagados.map(fila).join('')}</tbody></table></div></section>` : ''}`;
  main.querySelectorAll('[data-pago]').forEach(b => b.onclick = () => avisarPago(d.recibos.find(r => r.id === b.dataset.pago), d.c, () => portalPagos(main, null, vigente)));
}

function avisarPago(r, c, alTerminar) {
  modal({
    titulo: 'Avisar pago', boton: 'Enviar comprobante',
    cuerpo: `<p style="margin-top:0">${esc(ramo(r))} · ${esc(r.numero_poliza || '')} · recibo ${numRecibo(r)} · <b>${money(r.prima_total)}</b></p>
      <div class="form-grid">
        <div class="field"><label for="ppF">Fecha en que pagó</label><input id="ppF" name="fecha" type="date" value="${hoyISO()}" max="${hoyISO()}" required></div>
        <div class="field"><label for="ppC">Comprobante *</label><input id="ppC" name="archivo" type="file" accept=".pdf,image/*" required></div>
        ${textarea('Comentarios (opcional)', 'nota', '')}
      </div><p class="muted small">Su agente revisará el comprobante y aplicará el pago con la aseguradora.</p>`,
    onSubmit: async (x, form) => {
      const f = form.archivo.files[0]; if (!f) throw new Error('Adjunte el comprobante de pago.');
      const ruta = await subirArchivo(f, c.id, 'pagos');
      await q(sb.from('documentos').insert({ cliente_id: c.id, poliza_id: r.poliza_id, tipo: 'otro', nombre_archivo: `${etiquetaComprobante(r)} - ${f.name}`, ruta }));
      await q(sb.from('tareas').insert({ titulo: `Verificar pago de ${c.nombre} · recibo ${numRecibo(r)} (${money(r.prima_total)})`, tipo: 'cobranza', estatus: 'no_iniciado', prioridad: 'alta',
        cliente_id: c.id, poliza_id: r.poliza_id, asignado_a: responsable(c), fecha: hoyISO(),
        descripcion: `El cliente avisó desde el portal que pagó el ${fdate(x.fecha)}. Comprobante en sus documentos.${txt(x.nota) ? `\nComentario: ${x.nota}` : ''}` }));
      toast('Comprobante enviado. Le avisaremos cuando quede aplicado.');
      alTerminar();
    }
  });
}

// ---------------------------------------------------------------- Trámites
export async function portalTramites(main, _p, vigente) {
  const d = await cargar(); if (!vigente()) return;
  const polDe = id => d.polizas.find(p => p.id === id);
  const exp = s => {
    const carpetas = d.tramites.filter(t => t.siniestro_id === s.id);
    const esperado = s.deducible != null || s.coaseguro_pct != null ? calcularEsperado(s, carpetas, d.facturas) : {};
    const p = polDe(s.poliza_id);
    const abierto = carpetas.some(t => TRAMITE_ABIERTO.includes(t.estatus));
    return `<article class="card">
      <div class="head" style="align-items:flex-start"><div><h2 style="margin:0">${esc(s.padecimiento || 'Trámite')}</h2>
        <div class="muted small" style="margin-top:4px">${[s.afectado ? 'Afectado: ' + s.afectado : '', p ? `${ramo(p)} · ${p.aseguradora_nombre} · ${p.numero_poliza || ''}` : '', s.numero_siniestro ? 'Siniestro ' + s.numero_siniestro : '', s.fecha_evento ? 'Desde ' + fdate(s.fecha_evento) : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
        ${abierto ? '<span class="pill p-blue">En curso</span>' : '<span class="pill p-gray">Sin trámites abiertos</span>'}</div>
      <div class="list" style="margin-top:12px">${carpetas.map(t => {
        const fs = d.facturas.filter(f => f.tramite_id === t.id), e = esperado[t.id];
        return `<div class="li" style="align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:0;flex:1 1 260px"><b>${esc(nombreCarpeta(t))}</b> ${pill(EST_TRAMITE, t.estatus)}
            <div class="muted small" style="margin-top:4px">${esc(EXPLICA[t.estatus] || '')}</div>
            <div class="small" style="margin-top:4px">Enviado ${fdate(String(t.creado_en).slice(0, 10))}${t.fecha_ingreso ? ` · ingresado a la aseguradora ${fdate(t.fecha_ingreso)}` : ''}${t.folio ? ` · folio ${esc(t.folio)}` : ''}${fs.length ? ` · ${fs.length} factura${fs.length > 1 ? 's' : ''}` : ''}</div></div>
          <div class="small" style="text-align:right">${t.monto_reclamado ? `Reclamado <b>${money(t.monto_reclamado)}</b>` : ''}
            ${t.monto_pagado != null ? `<div>Pagado <b>${money(t.monto_pagado)}</b></div>` : e && TRAMITE_ABIERTO.includes(t.estatus) ? `<div class="muted">Estimado ${money(e.esperado)}</div>` : ''}</div>
        </div>`;
      }).join('') || '<p class="muted small">Sin carpetas.</p>'}</div>
      ${p?.ramo === 'gmm' || s.tipo_evento === 'enfermedad' || s.tipo_evento === 'accidente' ? `<div style="margin-top:12px"><a class="btn sm" href="#/reembolso?s=${s.id}">+ Nuevo reembolso de este padecimiento</a></div>` : ''}
    </article>`;
  };
  const abiertos = d.siniestros.filter(s => d.tramites.some(t => t.siniestro_id === s.id && TRAMITE_ABIERTO.includes(t.estatus)));
  const otros = d.siniestros.filter(s => !abiertos.includes(s));
  main.innerHTML = `<div class="head"><h1>Mis trámites</h1><div class="filters"><a class="btn primary" href="#/reembolso">Solicitar reembolso</a></div></div>
    ${d.siniestros.length ? '' : '<div class="card empty">No tiene trámites. Cuando solicite un reembolso o una programación de cirugía, aquí verá su avance.</div>'}
    ${abiertos.map(exp).join('')}
    ${otros.length ? `<h2 style="margin:8px 0">Anteriores</h2>${otros.map(exp).join('')}` : ''}
    ${d.siniestros.length ? '<p class="muted small">El monto estimado considera su deducible y coaseguro; la cantidad final la determina la aseguradora.</p>' : ''}`;
}

// ---------------------------------------------------------------- Solicitar reembolso / programación
export async function portalReembolso(main, _p, vigente) {
  const d = await cargar(); if (!vigente()) return;
  const sPre = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  const gmm = d.vigentes.filter(p => ['gmm', 'vida', 'viaje'].includes(p.ramo));
  const polizas = gmm.length ? gmm : d.vigentes;
  if (!polizas.length) { main.innerHTML = '<div class="head"><h1>Solicitar reembolso</h1></div><div class="card empty">No tiene pólizas vigentes para solicitar un reembolso. Comuníquese con su agente.</div>'; return; }
  const sIni = d.siniestros.find(s => s.id === sPre);
  const polIni = sIni?.poliza_id && polizas.some(p => p.id === sIni.poliza_id) ? sIni.poliza_id : polizas[0].id;
  let facturas = [];   // [{xml, pdf, datos, dup}]

  main.innerHTML = `<div class="head"><div><h1>Solicitar reembolso o programación</h1>
    <p class="muted" style="margin:4px 0 0">Suba sus documentos y nosotros armamos el trámite con la aseguradora.</p></div></div>
  <form class="card" id="rForm" novalidate>
    <div class="form-grid">
      ${select('¿Qué necesita?', 'tipo', opts({ reembolso: 'Reembolso de gastos ya pagados', programacion: 'Programación de cirugía o tratamiento' }, 'reembolso'), { req: true, wide: true })}
      ${select('Póliza', 'poliza_id', optsList(polizas, polIni, p => `${ramo(p)} · ${p.aseguradora_nombre} · ${p.numero_poliza || ''}`), { req: true, wide: true })}
      <div class="field wide"><label for="rExp">Padecimiento</label><select id="rExp" name="siniestro_id"></select></div>
      <div class="field" data-nuevo><label for="rAf">Persona atendida *</label><select id="rAf" name="afectado"></select></div>
      <div class="field" data-nuevo><label for="rFe">Fecha de primeros síntomas o del accidente</label><input id="rFe" name="fecha_evento" type="date" max="${hoyISO()}"></div>
      <div class="field wide" data-nuevo><label for="rPa">Diagnóstico o motivo *</label><input id="rPa" name="padecimiento" placeholder="Ej. infección de vías respiratorias, fractura de muñeca"></div>
      <div class="field wide" id="rFacBox"><label for="rFac">Facturas (XML y PDF) *</label>
        <input id="rFac" type="file" multiple accept=".xml,.pdf">
        <div class="muted small">Suba el XML de cada factura: de ahí tomamos el importe y el folio fiscal. Puede seleccionar varios archivos a la vez.</div>
        <div id="rFacLista" style="margin-top:8px"></div></div>
      <div class="field wide"><label for="rInf">Informe médico</label><input id="rInf" type="file" accept=".pdf,image/*" multiple></div>
      <div class="field wide"><label for="rOtros">Recetas, estudios u otros documentos</label><input id="rOtros" type="file" accept=".pdf,image/*" multiple></div>
      ${textarea('Comentarios para su agente (opcional)', 'comentarios', '')}
    </div>
    <div class="card" style="margin-top:12px" id="rCuenta">
      <div class="lbl">Cuenta para el depósito del reembolso</div>
      <div class="val">${d.c.clabe ? `${esc(d.c.banco || '')} · CLABE ${esc(d.c.clabe)}${d.c.cuenta_titular ? ` · a nombre de ${esc(d.c.cuenta_titular)}` : ''}` : 'No tenemos registrada su cuenta. Escriba en comentarios su banco, CLABE y titular, y suba su estado de cuenta en "otros documentos".'}</div>
    </div>
    <div class="error" role="alert" id="rErr"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><a class="btn" href="#/tramites">Cancelar</a><button class="btn primary" type="submit" id="rEnviar">Enviar solicitud</button></div>
  </form>`;

  const f = main.querySelector('#rForm');
  const pintarExpedientes = () => {
    const pid = f.poliza_id.value;
    const lista = d.siniestros.filter(s => s.poliza_id === pid && s.estatus !== 'cerrado');
    f.siniestro_id.innerHTML = `<option value="">Es un padecimiento nuevo</option>${lista.map(s => `<option value="${s.id}"${s.id === sPre ? ' selected' : ''}>Ya tengo trámites: ${esc(s.padecimiento || 'sin nombre')}${s.afectado ? ' · ' + esc(s.afectado) : ''}</option>`).join('')}`;
    const pol = d.polizas.find(p => p.id === pid);
    const personas = [...new Set([d.c.nombre, ...d.asegurados.filter(a => a.poliza_id === pid && a.tipo !== 'beneficiario').map(a => a.nombre)])];
    f.afectado.innerHTML = personas.map(n => `<option>${esc(n)}</option>`).join('');
    if (pol?.ramo !== 'gmm' && !personas.length) f.afectado.innerHTML = `<option>${esc(d.c.nombre)}</option>`;
    nuevoVisible();
  };
  const nuevoVisible = () => { const nuevo = !f.siniestro_id.value; main.querySelectorAll('[data-nuevo]').forEach(x => x.hidden = !nuevo); };
  const tipoCambia = () => { main.querySelector('#rFacBox label').textContent = f.tipo.value === 'reembolso' ? 'Facturas (XML y PDF) *' : 'Facturas o presupuesto (si los tiene)'; };
  f.poliza_id.onchange = pintarExpedientes; f.siniestro_id.onchange = nuevoVisible; f.tipo.onchange = tipoCambia;
  pintarExpedientes();

  const lista = main.querySelector('#rFacLista');
  const pintarFacturas = () => {
    if (!facturas.length) { lista.innerHTML = ''; return; }
    const validas = facturas.filter(x => !x.dup && !x.error);
    lista.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Factura</th><th>Fecha</th><th class="num">Total</th><th></th></tr></thead><tbody>
      ${facturas.map(x => `<tr><td>${esc(x.datos?.emisor_nombre || x.base)}<div class="muted small">${[x.xml ? 'XML' : '', x.pdf ? 'PDF' : ''].filter(Boolean).join(' + ')}</div></td>
        <td class="nw">${x.datos?.fecha ? fdate(x.datos.fecha) : '—'}</td><td class="num">${x.datos?.total ? money(x.datos.total) : '—'}</td>
        <td>${x.error ? `<span class="pill p-bad">${esc(x.error)}</span>` : x.dup ? '<span class="pill p-warn">Ya la había enviado</span>' : !x.xml ? '<span class="pill p-warn">Falta XML</span>' : '<span class="pill p-ok">Lista</span>'}</td></tr>`).join('')}
      </tbody></table></div><p class="small" style="margin:6px 0 0">Total a reclamar: <b>${money(sum(validas, x => x.datos?.total))}</b>${validas.some(x => !x.xml) ? ' <span class="muted">(las facturas sin XML las revisará su agente)</span>' : ''}</p>`;
  };
  main.querySelector('#rFac').onchange = async e => {
    const grupos = {};
    [...e.target.files].forEach(a => { const base = a.name.replace(/\.(xml|pdf)$/i, ''); (grupos[base.toLowerCase()] ||= { base })[/\.xml$/i.test(a.name) ? 'xml' : 'pdf'] = a; });
    facturas = [];
    for (const g of Object.values(grupos)) {
      try { g.datos = g.xml ? leerCFDI(await g.xml.text()) : { emisor_nombre: g.base, total: 0 }; } catch (err) { g.error = err.message; }
      if (g.datos?.uuid_fiscal) {
        const ya = await q(sb.from('facturas').select('id').eq('uuid_fiscal', g.datos.uuid_fiscal));
        g.dup = ya.length > 0 || facturas.some(x => x.datos?.uuid_fiscal === g.datos.uuid_fiscal);
      }
      facturas.push(g);
    }
    pintarFacturas();
  };

  f.onsubmit = async ev => {
    ev.preventDefault();
    const err = main.querySelector('#rErr'), btn = main.querySelector('#rEnviar'); err.textContent = '';
    const x = Object.fromEntries(new FormData(f));
    const validas = facturas.filter(v => !v.dup && !v.error);
    const informes = [...main.querySelector('#rInf').files], otros = [...main.querySelector('#rOtros').files];
    const nuevo = !x.siniestro_id;
    if (nuevo && !txt(x.padecimiento)) { err.textContent = 'Escriba el diagnóstico o motivo.'; f.padecimiento.focus(); return; }
    if (x.tipo === 'reembolso' && !validas.length) { err.textContent = facturas.length ? 'Las facturas seleccionadas ya se habían enviado o no se pudieron leer.' : 'Suba al menos una factura.'; return; }
    if (x.tipo === 'programacion' && !validas.length && !informes.length && !otros.length) { err.textContent = 'Suba el informe médico o la orden del médico.'; return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const c = d.c, resp = responsable(c), pol = x.poliza_id;
      let sid = x.siniestro_id, s = d.siniestros.find(z => z.id === sid);
      if (nuevo) {
        s = await q(sb.from('siniestros').insert({ cliente_id: c.id, poliza_id: pol, tipo_evento: 'enfermedad', afectado: txt(x.afectado), padecimiento: txt(x.padecimiento),
          fecha_evento: txt(x.fecha_evento) || hoyISO(), responsable_id: resp }).select().single());
        sid = s.id;
      }
      const t = await q(sb.from('tramites').insert({ siniestro_id: sid, cliente_id: c.id, poliza_id: pol, tipo: x.tipo, afectado: s.afectado, responsable_id: resp,
        descripcion: txt(x.comentarios) ? `Comentario del cliente: ${x.comentarios}` : 'Solicitud enviada desde el portal', fecha_ocurrido: hoyISO(),
        monto_reclamado: validas.length ? Math.round(sum(validas, v => v.datos?.total) * 100) / 100 : null }).select().single());
      const problemas = [];
      for (const v of validas) {
        try {
          const fila = { ...v.datos, tramite_id: t.id, categoria: categoriaDe(v.datos) };
          if (v.xml) fila.xml_ruta = await subirArchivo(v.xml, c.id, 'facturas');
          if (v.pdf) fila.pdf_ruta = await subirArchivo(v.pdf, c.id, 'facturas');
          await q(sb.from('facturas').insert(fila));
        } catch (e2) { problemas.push(`${v.datos?.emisor_nombre || v.base}: ${/duplicate|ya existe|unique/i.test(e2.message) ? 'ya estaba registrada' : e2.message}`); }
      }
      for (const [lista2, tipo] of [[informes, 'informe_medico'], [otros, 'otro']])
        for (const a of lista2) {
          const ruta = await subirArchivo(a, c.id, 'tramites');
          await q(sb.from('documentos').insert({ cliente_id: c.id, poliza_id: pol, tramite_id: t.id, tipo: /receta/i.test(a.name) ? 'receta' : /estudio|laborator|resultado/i.test(a.name) ? 'estudios' : tipo, nombre_archivo: a.name, ruta }));
        }
      await q(sb.from('tramite_eventos').insert({ tramite_id: t.id, estatus: t.estatus, texto: `Solicitud enviada por el cliente desde el portal${validas.length ? ` con ${validas.length} factura${validas.length > 1 ? 's' : ''}` : ''}` }));
      await q(sb.from('tareas').insert({ titulo: `Revisar ${x.tipo === 'reembolso' ? 'reembolso' : 'programación'} enviado por ${c.nombre} (portal)`, tipo: x.tipo, estatus: 'no_iniciado', prioridad: 'alta',
        cliente_id: c.id, poliza_id: pol, tramite_id: t.id, asignado_a: resp, fecha: hoyISO(),
        descripcion: `Padecimiento: ${s.padecimiento || '—'}. Afectado: ${s.afectado || '—'}.${txt(x.comentarios) ? `\nComentario del cliente: ${x.comentarios}` : ''}` }));
      toast(problemas.length ? `Solicitud enviada. Revise: ${problemas.join('; ')}.` : 'Solicitud enviada. Su agente la revisará y le avisará cuando esté ingresada.', !!problemas.length);
      location.hash = '#/tramites';
    } catch (e3) {
      err.textContent = e3.message; btn.disabled = false; btn.textContent = 'Enviar solicitud';
    }
  };
}

// ---------------------------------------------------------------- Documentos
export async function portalDocumentos(main, _p, vigente) {
  const d = await cargar(); if (!vigente()) return;
  const docs = d.docs.filter(x => !x.tramite_id && !x.tarea_id);
  const polDe = id => d.polizas.find(p => p.id === id);
  const porFirmar = pendientesDeFirma(d.docs);
  main.innerHTML = `<div class="head"><h1>Mis documentos</h1><div class="filters"><button class="btn primary" type="button" id="dSub">Subir documento</button></div></div>
    ${porFirmar.length ? `<section class="card" style="border-color:var(--warn-line)"><h2 style="margin-bottom:10px">Por firmar (${porFirmar.length})</h2><div class="list">${porFirmar.map(x => `<div class="li">
      <div style="min-width:0"><div>${esc(x.nombre_archivo)}</div><div class="muted small">${esc(DOCS[x.tipo] || x.tipo)}${x.tramite_id ? ' · de uno de sus trámites' : ''}</div></div>
      <button class="btn sm primary" type="button" data-firmar="${x.id}">Firmar</button></div>`).join('')}</div></section>` : ''}
    <section class="card">${docs.length ? `<div class="list">${docs.map(x => {
      const p = polDe(x.poliza_id), vence = x.vigente_hasta && diffDays(x.vigente_hasta, hoyISO()) < 0;
      return `<div class="li"><div style="min-width:0"><div>${esc(DOCS[x.tipo] || x.tipo)} ${vence ? '<span class="pill p-warn">Vencido</span>' : ''}</div>
        <div class="muted small">${esc(x.nombre_archivo)} · ${fdate(String(x.creado_en).slice(0, 10))}${p ? ` · ${esc(ramo(p))} ${esc(p.numero_poliza || '')}` : ''}</div></div>
        <button class="btn sm" type="button" data-ver="${esc(x.ruta)}">Descargar</button></div>`;
    }).join('')}</div>` : '<p class="muted">No hay documentos.</p>'}
    <p class="muted small">Mantenga al día su INE, comprobante de domicilio (no mayor a 3 meses) y constancia de situación fiscal: la aseguradora los pide en renovaciones y reembolsos.</p></section>`;
  main.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => abrirArchivo(b.dataset.ver));
  main.querySelectorAll('[data-firmar]').forEach(b => b.onclick = () => firmarDocumento(d.docs.find(x => x.id === b.dataset.firmar), d.c, () => portalDocumentos(main, null, vigente)));
  main.querySelector('#dSub').onclick = () => modal({
    titulo: 'Subir documento', boton: 'Subir',
    cuerpo: `<div class="form-grid">
      ${select('Tipo de documento', 'tipo', opts(Object.fromEntries(DOCS_CLIENTE.filter(k => k !== 'poliza').map(k => [k, DOCS[k]])), 'ine'), { req: true })}
      <div class="field wide"><label for="dArch">Archivo *</label><input id="dArch" name="archivo" type="file" required accept=".pdf,image/*"></div>
    </div>`,
    onSubmit: async (x, form) => {
      const a = form.archivo.files[0]; if (!a) throw new Error('Seleccione un archivo.');
      const ruta = await subirArchivo(a, d.c.id);
      await q(sb.from('documentos').insert({ cliente_id: d.c.id, tipo: x.tipo, nombre_archivo: a.name, ruta }));
      await q(sb.from('tareas').insert({ titulo: `${d.c.nombre} subió ${DOCS[x.tipo] || 'un documento'} desde el portal`, tipo: 'otro', estatus: 'no_iniciado', prioridad: 'baja',
        cliente_id: d.c.id, asignado_a: responsable(d.c), fecha: hoyISO() }));
      toast('Documento enviado. Gracias.');
      portalDocumentos(main, null, vigente);
    }
  });
}
