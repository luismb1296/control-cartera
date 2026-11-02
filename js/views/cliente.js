import { sb, ctx, q, puedeAdministrar, recargarCatalogos } from '../db.js';
import {
  esc, money, fdate, modal, input, fdateShort, edad, iniciales, pill, waLink, toast, confirmar, hoy, parseD, sum,
  RAMOS, FORMAS, CONDUCTOS, CAMPOS_RAMO, SITUACION, SIT_RECIBO, SEGUIMIENTO, DOCS, TIPOS_TRAMITE, EST_TRAMITE, TIPOS_TAREA, EST_TAREA
, numRecibo, periodosDescubiertos, diasDescubierto, hoyISO, iso, addDays } from '../ui.js';
import { formCliente, formPoliza, formPago, formDocumento, abrirArchivo, marcarNoRenueva, verMovimientos } from './formas.js';
import { formTramite, verTramite, atorado } from './tramites.js';
import { enviarMensaje } from './mensajes.js';
import { formTarea, verTarea } from './tablero.js';
import { refrescar } from '../app.js';
import { cartasDePoliza, formatosPara } from './cartas.js';
import { abrirCondiciones, avisoCancelacion } from './condiciones.js';
import { cadenaDe } from './historico.js';

export async function vistaCliente(main, id, vigente) {
  const c = await q(sb.from('clientes').select('*').eq('id', id).maybeSingle());
  if (!vigente()) return;
  if (!c) { main.innerHTML = '<div class="card"><h2>Cliente no encontrado</h2><p class="muted">Puede que no tenga acceso a este cliente.</p><a href="#/clientes">Volver a clientes</a></div>'; return; }

  const [polizas, recibos, docs, notas, tramites, tareas] = await Promise.all([
    q(sb.from('v_polizas').select('*').eq('cliente_id', id).order('fin_vigencia', { ascending: false })),
    q(sb.from('v_recibos').select('*').eq('cliente_id', id).order('fecha_limite')),
    q(sb.from('documentos').select('*').eq('cliente_id', id).is('tramite_id', null).is('tarea_id', null).order('creado_en', { ascending: false })),
    q(sb.from('notas_cliente').select('*').eq('cliente_id', id).order('creado_en', { ascending: false })),
    q(sb.from('tramites').select('*').eq('cliente_id', id).order('actualizado_en', { ascending: false })),
    q(sb.from('tareas').select('*').eq('cliente_id', id).order('creado_en', { ascending: false })),
  ]);
  const ids = polizas.map(p => p.id);
  const [asegurados, movs] = ids.length ? await Promise.all([q(sb.from('asegurados').select('*').in('poliza_id', ids)), q(sb.from('movimientos').select('id,poliza_id,estatus,tipo').in('poliza_id', ids))]) : [[], []];
  if (!vigente()) return;

  const nombreDe = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  const aseguradora = Object.fromEntries(ctx.aseguradoras.map(a => [a.id, a.nombre]));
  const activas = polizas.filter(p => p.estatus === 'activa');
  const historial = polizas.filter(p => p.estatus !== 'activa');
  const wa = waLink(c.whatsapp || c.telefono, `Hola ${c.nombre.split(' ')[0]}, `);
  const e = edad(c.fecha_nacimiento);
  const domicilio = [c.calle, c.colonia, c.codigo_postal ? 'C.P. ' + c.codigo_postal : '', c.ciudad, c.estado].filter(Boolean).join(', ');
  const anioAlta = new Date(c.creado_en).getFullYear();
  const acceso = ctx.accesosPortal.find(p => p.cliente_id === c.id);

  main.innerHTML = `
  <div class="muted"><a href="#/clientes">Clientes</a> / ${esc(c.nombre)}</div>
  <header class="card">
    <div class="head" style="align-items:flex-start">
      <div style="display:flex;gap:16px;align-items:center">
        <div class="avatar" style="width:56px;height:56px;font-size:20px;background:var(--accent-bg);color:var(--accent)">${esc(iniciales(c.nombre))}</div>
        <div><h1 style="font-size:24px">${esc(c.nombre)}</h1>
          <div class="chips" style="margin-top:6px">
            <span class="pill p-blue">${c.tipo_persona === 'moral' ? 'Persona moral' : 'Persona física'}</span>
            <span class="pill p-gray">Cliente desde ${anioAlta}</span>
            <span class="pill p-gray">Agente: ${esc(nombreDe[c.agente_id] || '—')}</span>
            ${c.activo ? '' : '<span class="pill p-bad">Inactivo</span>'}
          </div></div>
      </div>
      <div class="filters">
        ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">Correo</a>` : ''}
        ${acceso ? `<span class="pill ${acceso.activo ? 'p-ok' : 'p-gray'}" title="${esc(acceso.email || '')}">${acceso.activo ? 'Con acceso al portal' : 'Portal desactivado'}</span>`
          : puedeAdministrar() ? '<button class="btn" type="button" id="portal">Dar acceso al portal</button>' : ''}
        <button class="btn" type="button" id="editar">Editar</button>
        <button class="btn primary" type="button" id="nPol">+ Póliza</button>
      </div>
    </div>
    <div class="grid-info" style="border-top:1px solid var(--line);padding-top:16px;margin-top:16px">
      <div><div class="lbl">RFC</div><div class="val">${esc(c.rfc || '—')}</div></div>
      ${c.curp ? `<div><div class="lbl">CURP</div><div class="val">${esc(c.curp)}</div></div>` : ''}
      <div><div class="lbl">${c.tipo_persona === 'moral' ? 'Constitución' : 'Nacimiento'}</div><div class="val">${c.fecha_nacimiento ? fdate(c.fecha_nacimiento) + (e != null && c.tipo_persona === 'fisica' ? ` · ${e} años` : '') : '—'}</div></div>
      <div><div class="lbl">Teléfono</div><div class="val">${esc(c.telefono || '—')}</div></div>
      <div><div class="lbl">Correo</div><div class="val">${esc(c.email || '—')}</div></div>
      <div><div class="lbl">Domicilio</div><div class="val">${esc(domicilio || '—')}</div></div>
      <div><div class="lbl">Cuenta para reembolsos</div><div class="val">${c.clabe ? `${esc(c.banco || '')} · CLABE ${esc(c.clabe)}` : '—'}</div></div>
    </div>
    ${c.notas ? `<p class="muted small" style="margin:14px 0 0;white-space:pre-line">${esc(c.notas)}</p>` : ''}
  </header>

  <div class="tabs" role="tablist" aria-label="Secciones del cliente">
    <button type="button" role="tab" aria-selected="true" data-tab="pol">Pólizas (${activas.length})</button>
    <button type="button" role="tab" aria-selected="false" data-tab="pag">Pagos (${recibos.length})</button>
    <button type="button" role="tab" aria-selected="false" data-tab="tra">Trámites (${tramites.length})</button>
    <button type="button" role="tab" aria-selected="false" data-tab="act">Actividad (${tareas.filter(t => t.estatus !== 'listo').length} abiertas)</button>
    ${historial.length ? `<button type="button" role="tab" aria-selected="false" data-tab="his">Pólizas anteriores (${historial.length})</button>` : ''}
  </div>

  <section class="row">
    <div class="col" style="flex:2 1 560px" id="panel"></div>
    <aside class="col" style="flex:1 1 300px">
      <div class="card">
        <div class="card-head" style="margin-bottom:12px"><h2>Documentos</h2><button class="btn sm" type="button" id="subir">Subir</button></div>
        ${docs.length ? `<div class="list">${docs.map(d => `
          <div class="li"><div style="min-width:0"><button type="button" class="linkbtn" data-abrir="${esc(d.ruta)}" style="text-align:left">${esc(DOCS[d.tipo] || d.tipo)}</button>
            <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.nombre_archivo)}</div></div>
            <div style="display:flex;gap:6px;align-items:center">${alertaDoc(d)}
              <button type="button" class="x" style="font-size:18px;min-width:32px;min-height:32px" aria-label="Borrar ${esc(d.nombre_archivo)}" data-borrar="${d.id}">×</button></div></div>`).join('')}</div>`
          : '<div class="empty">Sin documentos. Suba INE, comprobante de domicilio, constancia fiscal o pólizas.</div>'}
        ${faltantes(docs, c)}
      </div>
      <div class="card">
        <h2 style="margin-bottom:12px">Bitácora</h2>
        <form id="fNota"><label for="nota" class="sr">Agregar nota</label>
          <textarea id="nota" placeholder="Escribir una nota… (llamadas, acuerdos, pendientes)" style="min-height:64px"></textarea>
          <button class="btn sm" type="submit" style="margin-top:8px">Agregar nota</button></form>
        <div class="list" style="margin-top:14px">${notas.map(n => `
          <div><div class="muted small">${fdateShort(n.creado_en.slice(0, 10))} · ${esc(nombreDe[n.autor_id] || '')}</div>
          <div style="margin-top:2px;white-space:pre-line">${esc(n.texto)}</div></div>`).join('') || '<div class="empty">Sin notas.</div>'}</div>
      </div>
      ${puedeAdministrar() ? `<button type="button" class="linkbtn small" id="baja" style="align-self:flex-start">${c.activo ? 'Marcar cliente como inactivo' : 'Reactivar cliente'}</button>` : ''}
    </aside>
  </section>`;

  const panel = main.querySelector('#panel');
  const tarjeta = p => {
    const dr = p.datos_ramo || {};
    const extras = (CAMPOS_RAMO[p.ramo] || []).filter(([k]) => dr[k]).map(([k, l]) => `<div><div class="lbl">${esc(l)}</div><div class="val">${esc(dr[k])}</div></div>`).join('');
    const pers = asegurados.filter(a => a.poliza_id === p.id);
    const aseg = pers.filter(a => a.tipo === 'asegurado'), ben = pers.filter(a => a.tipo === 'beneficiario');
    const rec = recibos.filter(r => r.poliza_id === p.id);
    const pagados = rec.filter(r => r.estatus === 'pagado').length;
    const etiqueta = p.situacion === 'por_renovar' ? `<span class="pill p-warn">Renueva en ${p.dias_para_vencer} días</span>` : pill(SITUACION, p.situacion);
    return `<div class="card">
      <div class="head" style="align-items:flex-start;gap:12px">
        <div><div class="chips" style="align-items:center"><h2>${RAMOS[p.ramo]}</h2>${etiqueta}
          ${p.estatus === 'activa' && (p.dias_para_vencer <= 60 || p.seguimiento === 'no_renueva') ? pill(SEGUIMIENTO, p.seguimiento) : ''}</div>
          <div class="muted" style="margin-top:4px">${esc(p.aseguradora_nombre)}${p.producto ? ' · ' + esc(p.producto) : ''} · Póliza ${esc(p.numero_poliza || 's/n')}</div></div>
        <div class="filters acciones">
          ${p.estatus === 'activa' ? `<button type="button" class="btn sm${p.situacion === 'por_renovar' || p.situacion === 'vencida' ? ' primary' : ''}" data-ren="${p.id}">Renovar</button>` : ''}
          ${p.estatus === 'activa' && p.dias_para_vencer <= 60 && p.seguimiento !== 'no_renueva' ? `<button type="button" class="btn sm" data-avisar="${p.id}">Avisar renovación</button><button type="button" class="btn sm" data-norenueva="${p.id}">No renueva</button>` : ''}
          <button type="button" class="btn sm" data-envio="${p.id}">Enviar póliza</button>
          <button type="button" class="btn sm" data-cartas="${p.id}">Cartas y formatos</button>
          <button type="button" class="btn sm" data-cg="${p.id}">Condiciones generales</button>
          <a class="btn sm" href="#/historico/${p.id}" data-hist="${p.id}">Histórico de renovaciones (${cadenaDe(p.id, polizas).length})</a>
          <button type="button" class="btn sm" data-movs="${p.id}">Endosos (${movs.filter(m => m.poliza_id === p.id).length})</button>
          <button type="button" class="btn sm" data-edit="${p.id}">Editar</button>
          ${p.estatus === 'activa' ? `<button type="button" class="btn sm danger" data-cancel="${p.id}">Cancelar</button>` : ''}
        </div>
      </div>
      <div class="grid-info" style="margin-top:16px">
        <div><div class="lbl">Vigencia</div><div class="val">${fdate(p.inicio_vigencia)} – ${fdate(p.fin_vigencia)}</div></div>
        <div><div class="lbl">Forma de pago</div><div class="val">${FORMAS[p.forma_pago]} · ${esc((CONDUCTOS[p.conducto_cobro] || '').toLowerCase())}</div></div>
        <div><div class="lbl">Prima total</div><div class="val">${money(p.prima_total, p.moneda)}</div></div>
        <div><div class="lbl">Recibos pagados</div><div class="val">${pagados} de ${rec.length}</div></div>
        <div><div class="lbl">Plazo de pago</div><div class="val">${p.dias_primer_pago ?? p.dias_gracia ?? 30} días el primero${p.forma_pago !== 'contado' ? ` · ${p.dias_gracia ?? 30} los siguientes` : ''}</div></div>
        <div><div class="lbl">Comisión</div><div class="val">${Number(p.pct_comision)}%</div></div>
        ${extras}
        ${aseg.length ? `<div><div class="lbl">Asegurados</div><div class="val">${aseg.map(a => esc(a.nombre + (a.parentesco ? ` (${a.parentesco})` : ''))).join('<br>')}</div></div>` : ''}
        ${ben.length ? `<div><div class="lbl">Beneficiarios</div><div class="val">${ben.map(a => esc(a.nombre + (a.porcentaje != null ? ` · ${Number(a.porcentaje)}%` : ''))).join('<br>')}</div></div>` : ''}
      </div>
      ${avisoCobertura(p, rec)}
      ${p.notas ? `<p class="muted small" style="margin:14px 0 0;white-space:pre-line">${esc(p.notas)}</p>` : ''}
    </div>`;
  };
  const tablaRecibos = (lista, titulo) => `<div class="card"><h2 style="margin-bottom:8px">${titulo}</h2>
    ${lista.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Póliza</th><th>Recibo</th><th>Fecha límite</th><th class="num">Importe</th><th>Estatus</th><th>Pagado</th><th></th></tr></thead>
      <tbody>${lista.map(r => `<tr><td>${RAMOS[r.ramo]} · ${esc(aseguradoraDe(r))}</td><td>${numRecibo(r)}</td>
        <td class="nw">${fdate(r.fecha_limite)}</td><td class="num">${money(r.prima_total)}</td><td>${pill(SIT_RECIBO, r.situacion)}</td>
        <td class="nw">${r.fecha_pago ? fdate(r.fecha_pago) : '—'}</td>
        <td class="nw">${r.estatus === 'pendiente' ? `<button type="button" class="btn sm" data-pagar="${r.id}">Marcar pagado</button>` : ''}
            ${r.comprobante_ruta ? `<button type="button" class="linkbtn small" data-abrir="${esc(r.comprobante_ruta)}">Comprobante</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Sin recibos.</div>'}</div>`;
  function aseguradoraDe(r) { return polizas.find(p => p.id === r.poliza_id)?.aseguradora_nombre || ''; }

  const tabs = {
    pol: () => {
      const proximos = recibos.filter(r => r.estatus === 'pendiente' && activas.some(p => p.id === r.poliza_id)).slice(0, 6);
      return (activas.length ? activas.map(tarjeta).join('') : '<div class="card empty">Este cliente no tiene pólizas vigentes. Agregue una con “+ Póliza”.</div>')
        + (proximos.length ? tablaRecibos(proximos, 'Próximos recibos') : '');
    },
    pag: () => tablaRecibos([...recibos].sort((a, b) => b.fecha_limite.localeCompare(a.fecha_limite)), 'Todos los recibos'),
    his: () => historial.map(tarjeta).join(''),
    act: () => {
      const cuenta = (lista, f) => lista.filter(f).length;
      const esSin = t => t.tipo.startsWith('siniestro');
      const porPol = p => ({
        reemb: cuenta(tramites, t => t.poliza_id === p.id && t.tipo === 'reembolso'), prog: cuenta(tramites, t => t.poliza_id === p.id && t.tipo === 'programacion'),
        sin: cuenta(tramites, t => t.poliza_id === p.id && esSin(t)), end: cuenta(movs, m => m.poliza_id === p.id), tar: cuenta(tareas, t => t.poliza_id === p.id)
      });
      const quien = Object.fromEntries(ctx.perfiles.map(x => [x.id, x.nombre]));
      return `<div class="card"><div class="card-head"><h2>Historial del cliente</h2><button type="button" class="btn sm primary" id="nTar">+ Tarea</button></div>
        <div class="contadores">
          <div class="kpi"><div class="k">Reembolsos</div><div class="v">${cuenta(tramites, t => t.tipo === 'reembolso')}</div></div>
          <div class="kpi"><div class="k">Programaciones</div><div class="v">${cuenta(tramites, t => t.tipo === 'programacion')}</div></div>
          <div class="kpi"><div class="k">Siniestros</div><div class="v">${cuenta(tramites, esSin)}</div></div>
          <div class="kpi"><div class="k">Endosos</div><div class="v">${movs.length}</div></div>
          <div class="kpi"><div class="k">Emisiones y renovaciones</div><div class="v">${polizas.length}</div></div>
          <div class="kpi"><div class="k">Tareas abiertas</div><div class="v">${cuenta(tareas, t => t.estatus !== 'listo')}</div></div>
        </div></div>
      <div class="card"><h2 style="margin-bottom:8px">Por póliza</h2><div class="tbl-wrap"><table>
        <thead><tr><th>Póliza</th><th>Vigencia</th><th class="num">Reembolsos</th><th class="num">Programaciones</th><th class="num">Siniestros</th><th class="num">Endosos</th><th class="num">Tareas</th></tr></thead>
        <tbody>${polizas.map(p => { const x = porPol(p); return `<tr><td><div class="nw">${esc(p.numero_poliza || 's/n')}</div><div class="muted small">${esc(p.aseguradora_nombre)} · ${esc(RAMOS[p.ramo])}</div></td>
          <td class="nw">${fdate(p.inicio_vigencia)} – ${fdate(p.fin_vigencia)}<div>${pill(SITUACION, p.situacion)}</div></td>
          <td class="num">${x.reemb}</td><td class="num">${x.prog}</td><td class="num">${x.sin}</td><td class="num">${x.end}</td><td class="num">${x.tar}</td></tr>`; }).join('')}</tbody></table></div></div>
      <div class="card"><h2 style="margin-bottom:8px">Tareas</h2>${tareas.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Tarea</th><th>Tipo</th><th>Responsable</th><th>Fecha</th><th>Estado</th></tr></thead>
        <tbody>${tareas.map(t => `<tr class="click" data-tarea="${t.id}"><td>${esc(t.titulo)}</td><td>${esc(TIPOS_TAREA[t.tipo])}</td><td>${esc(quien[t.asignado_a] || '—')}</td>
          <td class="nw">${t.fecha ? fdate(t.fecha) : '—'}</td><td><span class="mcell st-${t.estatus}" style="display:inline-block;width:auto;padding:4px 10px">${EST_TAREA[t.estatus]}</span></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Este cliente no tiene tareas.</div>'}</div>`;
    },
    tra: () => `<div class="card"><div class="card-head"><h2>Siniestros, reembolsos y trámites</h2><button type="button" class="btn sm primary" id="nTra">+ Nuevo trámite</button></div>
      ${tramites.length ? `<div class="tbl-wrap"><table><thead><tr><th>Trámite</th><th>Folio</th><th>Afectado</th><th class="num">Reclamado</th><th class="num">Pagado</th><th>Estatus</th></tr></thead>
        <tbody>${tramites.map(t => `<tr class="click" data-tra="${t.id}"><td>${esc(TIPOS_TRAMITE[t.tipo])}<div class="muted small">${fdate(t.fecha_ocurrido)}</div></td>
          <td class="nw">${esc(t.folio || '—')}</td><td>${esc(t.afectado || '—')}</td><td class="num">${t.monto_reclamado != null ? money(t.monto_reclamado) : '—'}</td>
          <td class="num">${t.monto_pagado != null ? money(t.monto_pagado) : '—'}</td><td>${pill(EST_TRAMITE, t.estatus)}${atorado(t) ? ' <span class="pill p-bad">Sin movimiento</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Sin trámites registrados.</div>'}</div>`,
  };
  const mostrar = t => {
    main.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
    panel.innerHTML = tabs[t]();
    panel.querySelector('#nTar')?.addEventListener('click', () => formTarea({ prefill: { cliente_id: c.id }, alGuardar: () => refrescar() }));
    panel.querySelector('#nTra')?.addEventListener('click', () => formTramite({ clienteId: c.id, alGuardar: tr => verTramite(tr.id, refrescar) }));
  };
  mostrar('pol');
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => mostrar(b.dataset.tab));

  // Acciones
  main.querySelector('#editar').onclick = () => formCliente(c, refrescar);
  main.querySelector('#portal')?.addEventListener('click', () => darAccesoPortal(c));
  main.querySelector('#nPol').onclick = () => formPoliza({ clienteId: c.id, modo: 'nueva', alGuardar: refrescar });
  main.querySelector('#subir').onclick = () => formDocumento(c.id, polizas, refrescar);
  main.querySelector('#baja')?.addEventListener('click', async () => {
    if (c.activo && !(await confirmar('Marcar como inactivo', 'El cliente dejará de aparecer en las listas y en el calendario. Sus pólizas y documentos se conservan.'))) return;
    await q(sb.from('clientes').update({ activo: !c.activo }).eq('id', c.id)); refrescar();
  });
  main.querySelector('#fNota').onsubmit = async ev => {
    ev.preventDefault();
    const t = main.querySelector('#nota').value.trim(); if (!t) return;
    try { await q(sb.from('notas_cliente').insert({ cliente_id: c.id, texto: t })); refrescar(); } catch (e) { toast(e.message, true); }
  };
  main.addEventListener('click', async ev => {
    const tr = ev.target.closest('tr[data-tra]'); if (tr) return verTramite(tr.dataset.tra, refrescar);
    const ta = ev.target.closest('tr[data-tarea]'); if (ta) return verTarea(ta.dataset.tarea, refrescar);
    const d = ev.target.dataset; if (!d) return;
    try {
      if (d.abrir) abrirArchivo(d.abrir);
      else if (d.borrar) {
        const doc = docs.find(x => x.id === d.borrar);
        if (!(await confirmar('Borrar documento', `Se borrará "${doc.nombre_archivo}". Esta acción no se puede deshacer.`, 'Borrar'))) return;
        await sb.storage.from('documentos').remove([doc.ruta]);
        await q(sb.from('documentos').delete().eq('id', doc.id)); toast('Documento borrado.'); refrescar();
      }
      else if (d.edit) formPoliza({ poliza: polizas.find(p => p.id === d.edit), modo: 'editar', alGuardar: refrescar });
      else if (d.ren) formPoliza({ poliza: polizas.find(p => p.id === d.ren), modo: 'renovar', alGuardar: refrescar });
      else if (d.cancel) {
        const p = polizas.find(x => x.id === d.cancel);
        const pen = await avisoCancelacion(p);
        if (!(await confirmar('Cancelar póliza', `La póliza ${p.numero_poliza || ''} quedará cancelada y sus recibos pendientes también.${pen ? ` Según las condiciones generales (${pen.cg}${pen.pagina ? ', p. ' + pen.pagina : ''}): ${pen.texto}.` : ''}`, 'Cancelar póliza'))) return;
        await q(sb.from('polizas').update({ estatus: 'cancelada' }).eq('id', p.id)); toast('Póliza cancelada.'); refrescar();
        // Si hay carta de cancelación para esta aseguradora, se ofrece de una vez
        const fs = formatosPara(await q(sb.from('formatos').select('*').eq('ambito', 'poliza').eq('activo', true)), p, 'cancelacion');
        if (fs.length) cartasDePoliza({ poliza: p, uso: 'cancelacion' });
      }
      else if (d.cg) abrirCondiciones({ poliza: polizas.find(x => x.id === d.cg) });
      else if (d.cartas) cartasDePoliza({ poliza: polizas.find(x => x.id === d.cartas), alTerminar: refrescar });
      else if (d.pagar) formPago(recibos.find(r => r.id === d.pagar), refrescar);
      else if (d.movs) verMovimientos(polizas.find(p => p.id === d.movs), refrescar);
      else if (d.norenueva) marcarNoRenueva(polizas.find(p => p.id === d.norenueva), refrescar);
      else if (d.avisar || d.envio) {
        const p = polizas.find(x => x.id === (d.avisar || d.envio));
        enviarMensaje(d.avisar ? 'aviso_renovacion' : 'envio_poliza', { nombre: c.nombre, poliza: p.numero_poliza, aseguradora: p.aseguradora_nombre,
          ramo: RAMOS[p.ramo].toLowerCase(), inicio: fdate(p.inicio_vigencia), fecha: fdate(p.fin_vigencia) }, { telefono: c.whatsapp || c.telefono, email: c.email });
      }
    } catch (e) { toast(e.message, true); }
  });
}

function alertaDoc(d) {
  if (d.vigente_hasta && parseD(d.vigente_hasta) < hoy()) return '<span class="pill p-bad">Vencido</span>';
  if (d.tipo === 'comprobante_domicilio' && !d.vigente_hasta && (Date.now() - new Date(d.creado_en)) / 86400000 > 90) return '<span class="pill p-bad">Más de 3 meses</span>';
  if (d.vigente_hasta) return `<span class="muted small">Vence ${fdate(d.vigente_hasta).slice(3)}</span>`;
  return '';
}
function faltantes(docs, c) {
  const req = c.tipo_persona === 'moral' ? ['constancia_fiscal', 'comprobante_domicilio'] : ['ine', 'comprobante_domicilio', 'constancia_fiscal'];
  const faltan = req.filter(t => !docs.some(d => d.tipo === t));
  return faltan.length ? `<p class="small" style="margin:14px 0 0;color:var(--warn)">Falta: ${faltan.map(t => DOCS[t]).join(', ')}.</p>` : '';
}

// Invita al cliente a su portal: con su correo entra a ver pólizas, pagos y trámites, y a solicitar reembolsos
function darAccesoPortal(c) {
  modal({
    titulo: 'Dar acceso al portal', boton: 'Enviar invitación',
    cuerpo: `<p style="margin-top:0">${esc(c.nombre)} recibirá un correo para crear su contraseña. En el portal podrá:</p>
      <ul class="small" style="margin:0 0 14px;padding-left:20px;line-height:1.7"><li>Ver sus pólizas y descargar sus documentos.</li><li>Ver sus pagos pendientes y enviar comprobantes.</li>
        <li>Solicitar reembolsos subiendo sus facturas e informe médico.</li><li>Seguir el avance de sus trámites.</li></ul>
      <p class="muted small">No verá notas internas, el tablero ni información de otros clientes.</p>
      <div class="form-grid">${input('Nombre', 'nombre', { value: c.nombre, req: true })}${input('Correo', 'email', { type: 'email', value: c.email || '', req: true })}</div>`,
    onSubmit: async x => {
      const email = x.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Escriba un correo válido.');
      const { error } = await sb.functions.invoke('invitar-usuario', { body: { nombre: x.nombre.trim(), email, rol: 'cliente', cliente_id: c.id } });
      if (error) { const det = await error.context?.json?.().catch(() => null); throw new Error(det?.error || error.message || 'No se pudo enviar la invitación.'); }
      await recargarCatalogos();
      toast(sb.demo ? 'Acceso creado (en el prototipo no se envía correo). Puede probarlo con "ver como".' : 'Invitación enviada al cliente.');
      refrescar();
    }
  });
}

// Periodos sin cobertura: pagos tardíos (rehabilitación) y recibos vencidos sin pagar
function avisoCobertura(p, rec) {
  const hoyIso = hoyISO();
  const vencido = p.estatus === 'activa' ? rec.filter(r => r.estatus === 'pendiente' && Number(r.prima_total) > 0 && r.fecha_limite < hoyIso).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite))[0] : null;
  const periodos = periodosDescubiertos(rec);
  if (!vencido && !periodos.length) return '';
  return `<div style="margin-top:14px;border-left:4px solid var(--${vencido ? 'bad' : 'warn'});padding:8px 12px;background:var(--surface-2);border-radius:0 8px 8px 0">
    ${vencido ? `<div class="small"><b style="color:var(--bad)">Sin cobertura desde el ${fdate(iso(addDays(parseD(vencido.fecha_limite), 1)))}</b>: el recibo ${numRecibo(vencido)} venció el ${fdate(vencido.fecha_limite)}. Al pagarlo se rehabilita, pero esos días quedan al descubierto.</div>` : ''}
    ${periodos.map(x => `<div class="small"><b>Periodo al descubierto: ${fdate(x.desde)} al ${fdate(x.hasta)}</b> (${diasDescubierto(x)} día${diasDescubierto(x) === 1 ? '' : 's'}) · recibo ${numRecibo(x.recibo)} pagado el ${fdate(x.recibo.fecha_pago)}, después de su fecha límite. Lo que ocurra o se diagnostique en esas fechas no tiene cobertura.</div>`).join('')}
  </div>`;
}
