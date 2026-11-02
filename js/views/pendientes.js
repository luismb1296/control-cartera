// "Mis pendientes del día": todo lo que requiere atención, en una sola lista
import { sb, ctx, q } from '../db.js';
import { esc, money, fdia, fdateShort, hoy, hoyISO, iso, addDays, proximoCumple, diasDesde, iniciales, primerNombre, RAMOS, TIPOS_TRAMITE, DOCS, TRAMITE_ABIERTO, EST_TAREA, PRIORIDADES, toast , numRecibo, TIPOS_MOV } from '../ui.js';
import { formPago, formPoliza, marcarNoRenueva } from './formas.js';
import { enviarMensaje } from './mensajes.js';
import { verTramite, atorado } from './tramites.js';
import { verTarea, formTarea, sinLeer } from './tablero.js';
import { endosoAtrasado, endosoPorAplicar } from './endosos.js';
import { refrescar } from '../app.js';

export async function calcularPendientes() {
  const h = hoyISO(), en3 = iso(addDays(hoy(), 3)), en15 = iso(addDays(hoy(), 15));
  const [recibos, polizas, abiertas, tramites, prospectos, clientes, docs, comentarios, lecturas, movs, polMov] = await Promise.all([
    q(sb.from('v_recibos').select('*').eq('estatus', 'pendiente').lte('fecha_limite', en3).order('fecha_limite')),
    q(sb.from('v_polizas').select('*').eq('estatus', 'activa').lte('fin_vigencia', en15).order('fin_vigencia')),
    q(sb.from('tareas').select('*').neq('estatus', 'listo').order('fecha')),
    q(sb.from('tramites').select('*')),
    q(sb.from('prospectos').select('*').lte('fecha_seguimiento', h).order('fecha_seguimiento')),
    q(sb.from('clientes').select('id,nombre,fecha_nacimiento,tipo_persona,telefono,whatsapp,email,activo,agente_id').eq('activo', true)),
    q(sb.from('documentos').select('cliente_id,tipo,vigente_hasta,creado_en')),
    q(sb.from('tarea_comentarios').select('tarea_id,autor_id,creado_en')),
    q(sb.from('tarea_lecturas').select('tarea_id,visto_en')),
    q(sb.from('movimientos').select('*').in('estatus', ['solicitado', 'enviado', 'en_revision', 'emitido', 'entregado'])),
    q(sb.from('v_polizas').select('id,numero_poliza,cliente_id,cliente_nombre,aseguradora_nombre,agente_id')),
  ]);
  // Mis tareas: atrasadas o de hoy, urgentes, de prioridad alta sin fecha, detenidas o con comentarios nuevos
  const nuevos = sinLeer(comentarios, lecturas);
  const motivos = t => [
    t.fecha && t.fecha < h ? ['tarde', 'Atrasada'] : null, t.fecha === h ? ['hoy', 'Hoy'] : null,
    t.prioridad === 'urgente' ? ['urg', 'Urgente'] : !t.fecha && t.prioridad === 'alta' ? ['urg', 'Prioridad alta'] : null,
    t.estatus === 'detenido' ? ['det', 'Detenida'] : null, nuevos[t.id] ? ['com', `${nuevos[t.id]} comentario${nuevos[t.id] > 1 ? 's' : ''} nuevo${nuevos[t.id] > 1 ? 's' : ''}`] : null,
  ].filter(Boolean);
  const orden = t => (t.fecha && t.fecha < h ? 0 : t.prioridad === 'urgente' ? 1 : t.estatus === 'detenido' ? 2 : nuevos[t.id] ? 3 : 4);
  const tareas = abiertas.filter(t => t.asignado_a === ctx.perfil.id).map(t => ({ ...t, motivos: motivos(t) }))
    .filter(t => t.motivos.some(([k]) => k !== 'hoy') || t.fecha === h).sort((a, b) => orden(a) - orden(b) || String(a.fecha || '9').localeCompare(String(b.fecha || '9')));
  const misIds = new Set(tareas.map(t => t.id));
  // Cada pendiente sabe si ya tiene una tarea abierta en el tablero
  const tareaDe = (origen, extra) => abiertas.find(t => t.origen === origen || (extra && extra(t))) || null;
  const ligar = (lista, origen, extra) => lista.map(x => ({ ...x, _tarea: tareaDe(origen(x), extra && (t => extra(t, x))) }))
    .filter(x => !(x._tarea && misIds.has(x._tarea.id)));   // si es mía y ya está en "Mis tareas", no se repite
  const cli = Object.fromEntries(clientes.map(c => [c.id, c]));
  const conPoliza = new Set(polizas.map(p => p.cliente_id));

  const grupos = [
    { id: 'tareas', titulo: 'Mis tareas del tablero', nota: 'Asignadas a usted: atrasadas, de hoy, urgentes, detenidas o con comentarios nuevos', items: tareas },
    { id: 'cobranza', titulo: 'Cobranza', nota: 'Recibos vencidos o que vencen en los próximos 3 días', items: ligar(recibos, r => 'recibo:' + r.id) },
    { id: 'renovar', titulo: 'Renovaciones', nota: 'Pólizas que vencen en 15 días o ya vencieron, sin renovación confirmada',
      items: ligar(polizas.filter(p => !['aceptada', 'no_renueva'].includes(p.seguimiento)), p => 'renovacion:' + p.id, (t, p) => t.tipo === 'renovacion' && t.poliza_id === p.id) },
    { id: 'tramites', titulo: 'Trámites sin movimiento', nota: 'Siniestros y reembolsos que pasaron su plazo de seguimiento',
      items: ligar(tramites.filter(atorado), t => 'tramite:' + t.id, (ta, t) => ta.tramite_id === t.id) },
    { id: 'endosos', titulo: 'Endosos', nota: 'Pedidos desde el portal, sin movimiento con la aseguradora o emitidos sin aplicar a la póliza',
      items: ligar(movs.map(m => { const p = polMov.find(x => x.id === m.poliza_id); if (!p) return null;
        const motivo = m.solicitado_por_cliente && m.estatus === 'solicitado' ? 'portal' : endosoAtrasado(m) ? 'atraso' : endosoPorAplicar(m) ? 'aplicar' : null;
        return motivo ? { ...m, motivo, cliente_id: p.cliente_id, cliente_nombre: p.cliente_nombre, numero_poliza: p.numero_poliza, aseguradora_nombre: p.aseguradora_nombre, agente_id: p.agente_id } : null; }).filter(Boolean),
        m => 'endoso:' + m.id, (t, m) => t.movimiento_id === m.id) },
    { id: 'prospectos', titulo: 'Seguimiento a prospectos', nota: 'Para hoy o atrasados', items: prospectos.filter(p => ['prospecto', 'cotizado', 'negociacion'].includes(p.etapa)) },
    { id: 'cumple', titulo: 'Cumpleaños de hoy', nota: '', items: clientes.filter(c => c.tipo_persona === 'fisica' && c.fecha_nacimiento && iso(proximoCumple(c.fecha_nacimiento)) === h) },
  ];
  // Documentos: clientes con pólizas por renovar a quienes les falta algo o lo tienen vencido
  const faltan = [];
  const todos = await q(sb.from('v_polizas').select('cliente_id').eq('estatus', 'activa'));
  new Set(todos.map(p => p.cliente_id)).forEach(id => {
    const c = cli[id]; if (!c) return;
    const req = c.tipo_persona === 'moral' ? ['constancia_fiscal', 'comprobante_domicilio'] : ['ine', 'comprobante_domicilio', 'constancia_fiscal'];
    const suyos = docs.filter(d => d.cliente_id === id);
    const falta = req.filter(t => !suyos.some(d => d.tipo === t && !(d.vigente_hasta && d.vigente_hasta < h)));
    if (falta.length) faltan.push({ id: id, cliente: c, falta });
  });
  grupos.push({ id: 'docs', titulo: 'Expedientes incompletos', nota: 'Clientes con póliza vigente a quienes les falta o se les venció un documento', items: ligar(faltan, x => 'docs:' + x.id), secundario: true });
  // Lo que ya tiene responsable en el tablero no se cuenta dos veces
  const total = grupos.filter(g => !g.secundario).reduce((a, g) => a + g.items.filter(x => !x._tarea).length, 0);
  grupos.forEach(g => g.items.sort((a, b) => (a._tarea ? 1 : 0) - (b._tarea ? 1 : 0)));
  return { grupos, cli, conPoliza, total };
}

export async function vistaPendientes(main, _p, vigente) {
  const { grupos, cli, total } = await calcularPendientes();
  if (!vigente()) return;
  const h = hoyISO();
  const persona = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  // Acción del tablero: si ya hay tarea, quién la tiene y en qué va; si no, el botón para pasarla
  const tab = (g, x) => x._tarea
    ? `<button type="button" class="en-tablero" data-a="tarea" data-id="${x._tarea.id}" title="Ver la tarea"><span class="mini">${esc(iniciales(persona[x._tarea.asignado_a] || '?'))}</span>En tablero: ${esc(primerNombre(persona[x._tarea.asignado_a] || 'sin asignar'))} · ${esc(EST_TAREA[x._tarea.estatus])}</button>`
    : `<button type="button" class="btn sm" data-a="altablero" data-g="${g}" data-id="${x.id}" title="Crear una tarea en el tablero con responsable y fecha">Pasar al tablero</button>`;
  const fila = (izq, der, x) => `<div class="li${x?._tarea ? ' atendido' : ''}" style="align-items:flex-start"><div style="min-width:0">${izq}</div><div class="filters" style="gap:6px;justify-content:flex-end">${der}</div></div>`;
  const render = {
    cobranza: r => fila(`<a href="#/cliente/${r.cliente_id}">${esc(r.cliente_nombre)}</a>
        <div class="muted small">Recibo ${numRecibo(r)} · ${esc(r.numero_poliza || 's/n')} · ${money(r.prima_total)} ·
        <span style="${r.fecha_limite < h ? 'color:var(--bad)' : ''}">${r.fecha_limite < h ? 'venció ' : 'vence '}${esc(fdateShort(r.fecha_limite))}</span></div>`,
      `<button type="button" class="btn sm" data-a="recordar" data-id="${r.id}">Recordar</button><button type="button" class="btn sm" data-a="pagar" data-id="${r.id}">Marcar pagado</button>${tab('cobranza', r)}`, r),
    renovar: p => fila(`<a href="#/cliente/${p.cliente_id}">${esc(p.cliente_nombre)}</a>
        <div class="muted small">${esc(RAMOS[p.ramo])} · ${esc(p.aseguradora_nombre)} · ${esc(p.numero_poliza || 's/n')} ·
        <span style="${p.dias_para_vencer < 0 ? 'color:var(--bad)' : ''}">${p.dias_para_vencer < 0 ? `venció hace ${-p.dias_para_vencer} días` : p.dias_para_vencer === 0 ? 'vence hoy' : `vence en ${p.dias_para_vencer} días`}</span></div>`,
      `<button type="button" class="btn sm" data-a="avisar" data-id="${p.id}">Avisar</button><button type="button" class="btn sm primary" data-a="renovar" data-id="${p.id}">Renovar</button><button type="button" class="btn sm" data-a="norenueva" data-id="${p.id}">No renueva</button>${tab('renovar', p)}`, p),
    tramites: t => fila(`<a href="#/cliente/${t.cliente_id}">${esc(cli[t.cliente_id]?.nombre || '')}</a>
        <div class="muted small">${esc(TIPOS_TRAMITE[t.tipo])} · folio ${esc(t.folio || 's/f')} · sin movimiento hace ${diasDesde(t.actualizado_en)} días</div>`,
      `<button type="button" class="btn sm" data-a="tramite" data-id="${t.id}">Abrir</button>${tab('tramites', t)}`, t),
    tareas: t => fila(`<button type="button" class="linkbtn" data-a="tarea" data-id="${t.id}" style="text-align:left">${esc(t.titulo)}</button>
        <div class="small" style="margin-top:3px">${t.motivos.filter(([k]) => k !== 'hoy' || t.motivos.length === 1).map(([k, txt]) => `<span class="motivo ${k}">${esc(txt)}</span>`).join('')}
        <span class="muted">${t.fecha ? esc(fdia(t.fecha)) : 'Sin fecha'} · ${esc(PRIORIDADES[t.prioridad])}${t.cliente_id && cli[t.cliente_id] ? ` · <a href="#/cliente/${t.cliente_id}">${esc(cli[t.cliente_id].nombre)}</a>` : ''}</span></div>`,
      `<button type="button" class="btn sm" data-a="tarea" data-id="${t.id}">Abrir</button><button type="button" class="btn sm" data-a="hecha" data-id="${t.id}">Hecha</button>`),
    endosos: m => fila(`<a href="#/endoso/${m.id}">${esc(m.cliente_nombre)}</a>
        <div class="muted small">${esc(TIPOS_MOV[m.tipo])} · ${esc(m.aseguradora_nombre)} ${esc(m.numero_poliza || 's/n')} ·
        <span style="color:${m.motivo === 'atraso' ? 'var(--bad)' : m.motivo === 'aplicar' ? 'var(--warn)' : 'var(--accent)'}">${m.motivo === 'portal' ? 'el cliente lo pidió desde el portal' : m.motivo === 'atraso' ? `sin movimiento hace ${diasDesde(m.actualizado_en || m.creado_en)} días` : 'emitido, falta aplicarlo a la póliza'}</span></div>`,
      `<a class="btn sm" href="#/endoso/${m.id}">Abrir</a>${tab('endosos', m)}`, m),
    prospectos: p => fila(`<span>${esc(p.nombre)}</span><div class="muted small">${esc(RAMOS[p.ramo] || '')} · ${p.fecha_seguimiento < h ? 'atrasado desde ' + esc(fdia(p.fecha_seguimiento)) : 'hoy'}</div>`,
      `<a class="btn sm" href="#/prospectos">Ver embudo</a>`),
    cumple: c => fila(`<a href="#/cliente/${c.id}">${esc(c.nombre)}</a>`, `<button type="button" class="btn sm" data-a="felicitar" data-id="${c.id}">Felicitar</button>`),
    docs: x => fila(`<a href="#/cliente/${x.cliente.id}">${esc(x.cliente.nombre)}</a><div class="muted small">Falta: ${x.falta.map(t => esc(DOCS[t])).join(', ')}</div>`, tab('docs', x), x),
  };

  main.innerHTML = `
  <header class="head"><div><h1>Mis pendientes</h1>
    <p class="muted" style="margin:4px 0 0">${total ? `${total} pendientes que requieren atención hoy` : 'Todo al día. No hay pendientes urgentes.'}</p></div></header>
  <section class="row">${grupos.map(g => g.items.length ? `
    <div class="card" style="flex:1 1 440px">
      <div class="card-head" style="margin-bottom:4px"><h2>${g.titulo} <span class="muted">(${g.items.length})</span></h2></div>
      ${g.nota ? `<p class="muted small" style="margin:0 0 12px">${g.nota}</p>` : ''}
      <div class="list" data-g="${g.id}">${g.items.slice(0, g.secundario ? 8 : 30).map(render[g.id]).join('')}</div>
      ${g.items.length > (g.secundario ? 8 : 30) ? `<p class="muted small">Y ${g.items.length - (g.secundario ? 8 : 30)} más.</p>` : ''}
    </div>` : '').join('')}
  </section>`;

  const buscar = (g, id) => grupos.find(x => x.id === g).items.find(i => i.id === id);
  main.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.dataset.id, a = b.dataset.a;
    try {
      if (a === 'pagar') formPago(buscar('cobranza', id), refrescar);
      if (a === 'recordar') {
        const r = buscar('cobranza', id), c = cli[r.cliente_id] || {};
        enviarMensaje('recordatorio_pago', { nombre: r.cliente_nombre, recibo: `${numRecibo(r)}`, poliza: r.numero_poliza, monto: money(r.prima_total), fecha: fdia(r.fecha_limite), ramo: RAMOS[r.ramo] },
          { telefono: c.whatsapp || c.telefono, email: c.email });
      }
      if (a === 'avisar') {
        const p = buscar('renovar', id), c = cli[p.cliente_id] || {};
        enviarMensaje('aviso_renovacion', { nombre: p.cliente_nombre, poliza: p.numero_poliza, aseguradora: p.aseguradora_nombre, ramo: RAMOS[p.ramo].toLowerCase(), fecha: fdia(p.fin_vigencia) },
          { telefono: c.whatsapp || c.telefono, email: c.email });
      }
      if (a === 'renovar') formPoliza({ poliza: await q(sb.from('polizas').select('*').eq('id', id).single()), modo: 'renovar', alGuardar: refrescar });
      if (a === 'norenueva') marcarNoRenueva(buscar('renovar', id), refrescar);
      if (a === 'tramite') verTramite(id, refrescar);
      if (a === 'tarea') verTarea(id, refrescar);
      if (a === 'hecha') { await q(sb.from('tareas').update({ estatus: 'listo' }).eq('id', id)); toast('Tarea completada.'); refrescar(); }
      if (a === 'altablero') formTarea({ prefill: prefillTarea(b.dataset.g, buscar(b.dataset.g, id), cli), alGuardar: () => { toast('Listo, ya está en el tablero.'); refrescar(); } });
      if (a === 'felicitar') { const c = cli[id]; enviarMensaje('felicitacion', { nombre: c.nombre }, { telefono: c.whatsapp || c.telefono, email: c.email }); }
    } catch (err) { toast(err.message, true); }
  });
}

// Datos con los que se crea la tarea a partir de un pendiente
function prefillTarea(g, x, cli) {
  const h = hoyISO(), c = cli[x.cliente_id || x.cliente?.id] || {};
  const base = { estatus: 'no_iniciado', fecha: h, asignado_a: c.agente_id || ctx.perfil.id, cliente_id: x.cliente_id || x.cliente?.id || null };
  if (g === 'cobranza') return { ...base, titulo: `Cobrar recibo ${numRecibo(x)} de ${x.cliente_nombre}`, tipo: 'cobranza', prioridad: 'alta', poliza_id: x.poliza_id,
    descripcion: `Recibo de ${money(x.prima_total)} con fecha límite ${fdia(x.fecha_limite)}. Se cierra sola al marcarlo pagado.`, origen: 'recibo:' + x.id };
  if (g === 'renovar') return { ...base, titulo: `Renovar ${RAMOS[x.ramo].toLowerCase()} de ${x.cliente_nombre}`, tipo: 'renovacion', prioridad: x.dias_para_vencer <= 5 ? 'urgente' : 'alta',
    poliza_id: x.id, asignado_a: x.agente_id || base.asignado_a, descripcion: `Póliza ${x.numero_poliza || 's/n'} de ${x.aseguradora_nombre}, vence ${fdia(x.fin_vigencia)}. Se cierra sola al registrar la renovación.`, origen: 'renovacion:' + x.id };
  if (g === 'tramites') {
    const tipo = { reembolso: 'reembolso', complemento: 'reembolso', programacion: 'programacion' }[x.tipo] || (String(x.tipo).startsWith('siniestro') ? 'siniestro' : 'otro');
    return { ...base, titulo: `Dar seguimiento a ${TIPOS_TRAMITE[x.tipo].toLowerCase()} de ${c.nombre || ''}`.trim(), tipo, prioridad: 'alta', poliza_id: x.poliza_id, tramite_id: x.id,
      asignado_a: x.responsable_id || base.asignado_a, descripcion: `Folio ${x.folio || 's/f'}. Sin movimiento hace ${diasDesde(x.actualizado_en)} días.`, origen: 'tramite:' + x.id };
  }
  if (g === 'endosos') return { ...base, titulo: `Endoso: ${TIPOS_MOV[x.tipo].toLowerCase()} de ${x.cliente_nombre}`, tipo: 'endoso', prioridad: x.motivo === 'atraso' ? 'alta' : 'media', poliza_id: x.poliza_id,
    movimiento_id: x.id, asignado_a: x.responsable_id || x.agente_id || base.asignado_a, origen: 'endoso:' + x.id,
    descripcion: `${x.descripcion || ''}\nSe cierra sola cuando el endoso se entrega al cliente o la aseguradora lo rechaza.`.trim() };
  if (g === 'docs') return { ...base, titulo: `Pedir documentos a ${x.cliente.nombre}`, tipo: 'otro', prioridad: 'baja', fecha: iso(addDays(hoy(), 7)),
    descripcion: 'Falta: ' + x.falta.map(t => DOCS[t]).join(', ') + '.', origen: 'docs:' + x.id };
  return base;
}
