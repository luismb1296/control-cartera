// Siniestros: expediente por evento con carpetas (programación, reembolso 1, 2…), facturas, requisitos y formatos
import { sb, ctx, q } from '../db.js';
import {
  esc, money, fdate, pill, modal, input, select, textarea, opts, optsList, toast, num, txt, hoyISO, diasDesde, confirmar,
  RAMOS, TIPOS_TRAMITE, EST_TRAMITE, TRAMITE_ABIERTO, DOCS, TIPOS_CARPETA, EVENTOS, CAT_FACTURA, EST_FACTURA, REQUISITOS, enDescubierto, numRecibo
} from '../ui.js';
import { subirArchivo, abrirArchivo } from './formas.js';
import { enviarMensaje } from './mensajes.js';
import { datosCarpeta, pdfRelacion, pdfCarta, llenarFormato, guardarYDescargar } from './pdfs.js';
import { refrescar } from '../app.js';
import { firmadoDe } from './firma.js';
import { cargarCondiciones, cgDePoliza, antiguedadDe, revisarEspera, bloqueEspera, abrirCondiciones } from './condiciones.js';

// Estado de firma de un documento de la carpeta
function estadoFirma(d, docs) {
  if (d.firma_de) return '<span class="pill p-ok">Firmado por el cliente</span>';
  const f = firmadoDe(d, docs);
  if (f) return '<span class="pill p-ok">Firmado</span>';
  if (d.firma_solicitada) return `<span class="pill p-warn">Esperando firma del cliente</span> <button type="button" class="linkbtn small" data-cfirma="${d.id}">Cancelar</button>`;
  return /\.pdf$/i.test(d.nombre_archivo) ? `<button type="button" class="linkbtn small" data-pfirma="${d.id}">Pedir firma al cliente</button>` : '';
}

export const atorado = t => TRAMITE_ABIERTO.includes(t.estatus) && diasDesde(t.actualizado_en) > t.dias_alerta;
const nombreCarpeta = t => `${TIPOS_CARPETA[t.tipo] || 'Trámite'}${t.numero && (t.numero > 1 || ['reembolso', 'complemento'].includes(t.tipo)) ? ' ' + t.numero : ''}`;
const ICO_CARPETA = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// Abre la carpeta dentro de su expediente
export async function verTramite(id) {
  const t = await q(sb.from('tramites').select('id,siniestro_id').eq('id', id).single());
  document.getElementById('modal')?.close?.();
  location.hash = `#/siniestro/${t.siniestro_id}?c=${id}`;
}

// Crea una carpeta; si no hay expediente, también lo crea
export async function crearCarpeta({ cliente_id, poliza_id = null, tipo, descripcion = null, responsable_id, siniestro_id = null, afectado = null, padecimiento = null }) {
  let sid = siniestro_id;
  if (!sid) {
    const evento = { siniestro_auto: 'auto', siniestro_danos: 'danos', siniestro_vida: 'vida' }[tipo] || 'enfermedad';
    const s = await q(sb.from('siniestros').insert({ cliente_id, poliza_id, tipo_evento: evento, afectado, padecimiento: padecimiento || descripcion,
      fecha_evento: hoyISO(), responsable_id: responsable_id || ctx.perfil.id }).select().single());
    sid = s.id;
  }
  const t = await q(sb.from('tramites').insert({ siniestro_id: sid, cliente_id, poliza_id, tipo, descripcion, afectado, responsable_id: responsable_id || ctx.perfil.id,
    fecha_ocurrido: hoyISO() }).select().single());
  await q(sb.from('tramite_eventos').insert({ tramite_id: t.id, estatus: t.estatus, texto: 'Carpeta creada' }));
  return t;
}

// Reembolso esperado: el deducible se aplica una sola vez por siniestro y el coaseguro hasta su tope
export function calcularEsperado(s, carpetas, facturas) {
  const pct = Number(s.coaseguro_pct || 0) / 100;
  let dedRest = Number(s.deducible || 0), topeRest = s.coaseguro_tope != null ? Number(s.coaseguro_tope) : Infinity;
  const r = {};
  carpetas.filter(t => ['reembolso', 'complemento'].includes(t.tipo)).sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en))).forEach(t => {
    const fs = facturas.filter(f => f.tramite_id === t.id && f.estatus !== 'rechazada');
    const gastos = fs.length ? fs.reduce((a, f) => a + Number(f.total || 0), 0) : Number(t.monto_reclamado || 0);
    const ded = Math.min(gastos, dedRest); dedRest -= ded;
    const base = gastos - ded, coa = Math.min(base * pct, topeRest); topeRest -= coa;
    r[t.id] = { gastos, ded, dedRest, base, coa, pct, esperado: Math.round((base - coa) * 100) / 100, topeRest };
  });
  return r;
}

// ---------------------------------------------------------------- Lista de expedientes
export async function vistaTramites(main, _p, vigente) {
  const [siniestros, tramites, clientes, polizas] = await Promise.all([
    q(sb.from('siniestros').select('*').order('creado_en', { ascending: false })),
    q(sb.from('tramites').select('*')),
    q(sb.from('clientes').select('id,nombre')),
    q(sb.from('v_polizas').select('id,numero_poliza,aseguradora_nombre,ramo')),
  ]);
  if (!vigente()) return;
  const cli = Object.fromEntries(clientes.map(c => [c.id, c.nombre])), pol = Object.fromEntries(polizas.map(p => [p.id, p]));
  const carpetas = id => tramites.filter(t => t.siniestro_id === id);
  const abiertos = siniestros.filter(s => s.estatus === 'abierto');
  const tramAbiertos = tramites.filter(t => TRAMITE_ABIERTO.includes(t.estatus));
  const anio = new Date().getFullYear();
  const pagadosAnio = tramites.filter(t => t.estatus === 'pagado' && new Date(t.actualizado_en).getFullYear() === anio);

  main.innerHTML = `
  <header class="head"><h1>Siniestros y reembolsos</h1>
    <button class="btn primary" type="button" id="nuevo">+ Nuevo siniestro</button></header>
  <section class="kpis">
    <div class="card kpi"><div class="k">Expedientes abiertos</div><div class="v">${abiertos.length}</div><div class="s">${tramAbiertos.length} carpetas en trámite</div></div>
    <div class="card kpi"><div class="k">En reclamación</div><div class="v">${money(tramAbiertos.reduce((a, t) => a + Number(t.monto_reclamado || 0), 0))}</div><div class="s">carpetas abiertas</div></div>
    <div class="card kpi bad"><div class="k">Sin movimiento</div><div class="v">${tramites.filter(atorado).length}</div><div class="s">pasaron su plazo de seguimiento</div></div>
    <div class="card kpi"><div class="k">Recuperado en ${anio}</div><div class="v">${money(pagadosAnio.reduce((a, t) => a + Number(t.monto_pagado || 0), 0))}</div><div class="s">${pagadosAnio.length} carpetas pagadas</div></div>
  </section>
  <div class="filters">
    <div class="chips" role="group" aria-label="Mostrar">
      <button type="button" class="chip" data-f="abiertos" aria-pressed="true">Abiertos</button>
      <button type="button" class="chip" data-f="atorados" aria-pressed="false">Con carpetas sin movimiento</button>
      <button type="button" class="chip" data-f="cerrados" aria-pressed="false">Cerrados</button>
      <button type="button" class="chip" data-f="todos" aria-pressed="false">Todos</button>
    </div>
    <label for="bq" class="sr">Buscar</label><input id="bq" class="search" type="search" placeholder="Cliente, padecimiento o folio">
  </div>
  <div class="card" style="padding:8px 12px"><div class="tbl-wrap" id="tabla"></div></div>`;

  let f = 'abiertos';
  const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pintar = () => {
    const b = norm(main.querySelector('#bq').value);
    const lista = siniestros.filter(s => ({ abiertos: s.estatus === 'abierto', cerrados: s.estatus === 'cerrado', todos: true, atorados: carpetas(s.id).some(atorado) })[f]
      && (!b || norm(cli[s.cliente_id]).includes(b) || norm(s.padecimiento).includes(b) || norm(s.numero_siniestro).includes(b) || carpetas(s.id).some(t => norm(t.folio).includes(b))));
    main.querySelector('#tabla').innerHTML = lista.length ? `<table>
      <thead><tr><th>Cliente</th><th>Siniestro</th><th>Póliza</th><th>Carpetas</th><th class="num">Reclamado</th><th class="num">Pagado</th><th>Estatus</th></tr></thead>
      <tbody>${lista.map(s => {
        const cs = carpetas(s.id), p = pol[s.poliza_id];
        return `<tr class="click" data-s="${s.id}"><td><a href="#/cliente/${s.cliente_id}">${esc(cli[s.cliente_id] || '')}</a><div class="muted small">${esc(s.afectado || '')}</div></td>
          <td><div>${esc(s.padecimiento || EVENTOS[s.tipo_evento])}</div><div class="muted small">${esc(EVENTOS[s.tipo_evento])}${s.numero_siniestro ? ' · ' + esc(s.numero_siniestro) : ''}</div></td>
          <td>${p ? `<div class="nw">${esc(p.numero_poliza || 's/n')}</div><div class="muted small">${esc(p.aseguradora_nombre)}</div>` : '—'}</td>
          <td><div class="chips" style="gap:4px">${cs.map(t => `<span class="pill ${EST_TRAMITE[t.estatus]?.[1] || 'p-gray'}" title="${esc(EST_TRAMITE[t.estatus]?.[0])}">${esc(nombreCarpeta(t))}</span>`).join('')}</div>
            ${cs.some(atorado) ? '<div class="small" style="color:var(--bad);margin-top:4px">Una carpeta sin movimiento</div>' : ''}</td>
          <td class="num">${money(cs.reduce((a, t) => a + Number(t.monto_reclamado || 0), 0))}</td><td class="num">${money(cs.reduce((a, t) => a + Number(t.monto_pagado || 0), 0))}</td>
          <td>${s.estatus === 'abierto' ? '<span class="pill p-blue">Abierto</span>' : '<span class="pill p-gray">Cerrado</span>'}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">No hay expedientes en esta vista.</div>';
  };
  pintar();
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; main.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', x === b)); pintar(); });
  main.querySelector('#bq').oninput = pintar;
  main.querySelector('#tabla').onclick = e => { const tr = e.target.closest('tr[data-s]'); if (tr && e.target.tagName !== 'A') location.hash = '#/siniestro/' + tr.dataset.s; };
  main.querySelector('#nuevo').onclick = () => formTramite({ alGuardar: t => verTramite(t.id) });
}

// ---------------------------------------------------------------- Nuevo siniestro (expediente + primera carpeta)
export async function formTramite({ clienteId, alGuardar }) {
  const clientes = clienteId ? [] : await q(sb.from('clientes').select('id,nombre').eq('activo', true).order('nombre'));
  const polizasDe = cid => cid ? q(sb.from('v_polizas').select('id,numero_poliza,aseguradora_nombre,ramo,estatus').eq('cliente_id', cid)) : Promise.resolve([]);
  const polOpts = ps => '<option value="">— Sin póliza —</option>' + ps.map(p => `<option value="${p.id}">${esc(p.numero_poliza || 's/n')} · ${esc(p.aseguradora_nombre)} · ${esc(RAMOS[p.ramo])}${p.estatus !== 'activa' ? ' (' + p.estatus + ')' : ''}</option>`).join('');
  const iniciales = await polizasDe(clienteId);
  modal({
    titulo: 'Nuevo siniestro',
    cuerpo: `<p class="muted" style="margin-top:0">Se crea el expediente del siniestro con su primera carpeta. Las siguientes (reembolsos subsecuentes, complementos) se agregan dentro del expediente.</p>
    <div class="form-grid">
      ${clientes.length ? select('Cliente', 'cliente_id', '<option value="">Seleccione…</option>' + optsList(clientes, ''), { req: true, wide: true, attrs: 'data-cli' }) : ''}
      ${select('Póliza', 'poliza_id', polOpts(iniciales), { wide: true, attrs: 'data-pol' })}
      ${select('Tipo de evento', 'tipo_evento', opts(EVENTOS, 'enfermedad'))}
      ${select('Primera carpeta', 'tipo', opts(TIPOS_CARPETA, 'reembolso'), { req: true })}
      ${input('Asegurado afectado', 'afectado', { attrs: 'placeholder="Nombre de quien tuvo el padecimiento"' })}
      ${input('Padecimiento / diagnóstico / causa', 'padecimiento', { req: true })}
      ${input('Fecha de primeros síntomas / del evento', 'fecha_evento', { type: 'date', value: hoyISO() })}
      ${input('Número de siniestro (si ya lo asignó la aseguradora)', 'numero_siniestro')}
      ${select('Responsable', 'responsable_id', optsList(ctx.perfiles.filter(p => p.activo), ctx.perfil.id))}
    </div>`,
    onOpen: f => { const c = f.querySelector('[data-cli]'); if (c) c.onchange = async () => { f.querySelector('[data-pol]').innerHTML = polOpts(await polizasDe(c.value)); }; },
    onSubmit: async d => {
      const cid = clienteId || d.cliente_id;
      const s = await q(sb.from('siniestros').insert({ cliente_id: cid, poliza_id: d.poliza_id || null, tipo_evento: d.tipo_evento, afectado: txt(d.afectado),
        padecimiento: txt(d.padecimiento), fecha_evento: txt(d.fecha_evento), numero_siniestro: txt(d.numero_siniestro), responsable_id: d.responsable_id }).select().single());
      const t = await crearCarpeta({ cliente_id: cid, poliza_id: s.poliza_id, tipo: d.tipo, descripcion: s.padecimiento, responsable_id: d.responsable_id, siniestro_id: s.id, afectado: s.afectado });
      toast('Expediente creado.');
      alGuardar?.(t);
    }
  });
}

// ---------------------------------------------------------------- Expediente
export async function vistaSiniestro(main, id, vigente) {
  const s = await q(sb.from('siniestros').select('*').eq('id', id).maybeSingle());
  if (!vigente()) return;
  if (!s) { main.innerHTML = '<div class="card"><h2>Expediente no encontrado</h2><a href="#/tramites">Volver a siniestros</a></div>'; return; }
  const [c, p, carpetas, docs, formatos, recPol] = await Promise.all([
    q(sb.from('clientes').select('*').eq('id', s.cliente_id).single()),
    s.poliza_id ? q(sb.from('v_polizas').select('*').eq('id', s.poliza_id).maybeSingle()) : null,
    q(sb.from('tramites').select('*').eq('siniestro_id', id).order('creado_en')),
    q(sb.from('documentos').select('*').eq('cliente_id', s.cliente_id).order('creado_en', { ascending: false })),
    q(sb.from('formatos').select('*').eq('activo', true)),
    s.poliza_id ? q(sb.from('recibos').select('*').eq('poliza_id', s.poliza_id)) : [],
  ]);
  // ¿El evento cayó en un periodo sin cobertura (pago tardío o recibo vencido sin pagar)?
  const descubierto = enDescubierto(s.fecha_evento, recPol);
  const vencidoAntes = !descubierto && s.fecha_evento ? recPol.filter(r => r.estatus === 'pendiente' && Number(r.prima_total) > 0 && r.fecha_limite < s.fecha_evento).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite))[0] : null;
  const ids = carpetas.map(t => t.id);
  const [facturas, eventos] = ids.length ? await Promise.all([
    q(sb.from('facturas').select('*').in('tramite_id', ids).order('fecha')),
    q(sb.from('tramite_eventos').select('*').in('tramite_id', ids).order('creado_en', { ascending: false })),
  ]) : [[], []];
  if (!vigente()) return;
  const quien = Object.fromEntries(ctx.perfiles.map(x => [x.id, x.nombre]));
  const sel = new URLSearchParams(location.hash.split('?')[1] || '').get('c');
  let actual = carpetas.find(t => t.id === sel) || carpetas.find(t => TRAMITE_ABIERTO.includes(t.estatus)) || carpetas[carpetas.length - 1];
  const reclamado = carpetas.reduce((a, t) => a + Number(t.monto_reclamado || 0), 0), pagado = carpetas.reduce((a, t) => a + Number(t.monto_pagado || 0), 0);

  main.innerHTML = `
  <div class="muted"><a href="#/tramites">Siniestros</a> / <a href="#/cliente/${c.id}">${esc(c.nombre)}</a></div>
  <header class="card">
    <div class="head" style="align-items:flex-start">
      <div><div class="chips" style="align-items:center"><h1 style="font-size:22px">${esc(s.padecimiento || EVENTOS[s.tipo_evento])}</h1>
        ${s.estatus === 'abierto' ? '<span class="pill p-blue">Abierto</span>' : '<span class="pill p-gray">Cerrado</span>'}<span class="pill p-gray">${esc(EVENTOS[s.tipo_evento])}</span></div>
        <div class="muted" style="margin-top:4px">${esc(s.afectado || c.nombre)}${p ? ` · ${esc(p.aseguradora_nombre)} · póliza ${esc(p.numero_poliza || 's/n')}` : ''}</div></div>
      <div class="filters"><button type="button" class="btn" id="sEdit">Editar expediente</button>
        <button type="button" class="btn" id="sCerrar">${s.estatus === 'abierto' ? 'Cerrar expediente' : 'Reabrir'}</button>
        <button type="button" class="btn primary" id="sCarpeta">+ Nueva carpeta</button></div>
    </div>
    <div class="grid-info" style="border-top:1px solid var(--line);padding-top:14px;margin-top:14px">
      <div><div class="lbl">Número de siniestro</div><div class="val">${esc(s.numero_siniestro || 'Sin asignar')}</div></div>
      <div><div class="lbl">Fecha del evento</div><div class="val">${fdate(s.fecha_evento)}</div></div>
      <div><div class="lbl">Deducible</div><div class="val">${s.deducible != null ? money(s.deducible) : '—'}</div></div>
      <div><div class="lbl">Coaseguro</div><div class="val">${s.coaseguro_pct != null ? Number(s.coaseguro_pct) + '%' : '—'}</div></div>
      <div><div class="lbl">Reclamado</div><div class="val">${money(reclamado)}</div></div>
      <div><div class="lbl">Pagado</div><div class="val">${money(pagado)}${reclamado ? ` <span class="muted small">(${Math.round(pagado / reclamado * 100)}%)</span>` : ''}</div></div>
      <div><div class="lbl">Responsable</div><div class="val">${esc(quien[s.responsable_id] || '—')}</div></div>
    </div>
    ${descubierto ? `<div role="alert" style="margin-top:14px;border-left:4px solid var(--bad);padding:10px 14px;background:var(--surface-2);border-radius:0 8px 8px 0">
      <b style="color:var(--bad)">El evento ocurrió en un periodo al descubierto.</b> La póliza estuvo sin cobertura del ${fdate(descubierto.desde)} al ${fdate(descubierto.hasta)}
      (el recibo ${numRecibo(descubierto.recibo)} venció el ${fdate(descubierto.recibo.fecha_limite)} y se pagó el ${fdate(descubierto.recibo.fecha_pago)}). La aseguradora puede rechazar este siniestro; revíselo antes de ingresarlo.</div>`
      : vencidoAntes ? `<div role="alert" style="margin-top:14px;border-left:4px solid var(--bad);padding:10px 14px;background:var(--surface-2);border-radius:0 8px 8px 0">
      <b style="color:var(--bad)">El evento ocurrió con un recibo vencido.</b> El recibo ${numRecibo(vencidoAntes)} venció el ${fdate(vencidoAntes.fecha_limite)} y sigue sin pagarse: la póliza no tenía cobertura en la fecha del evento.</div>` : ''}
  </header>
  <div id="cgCaso"></div>
  <nav class="tabs" aria-label="Carpetas del expediente">${carpetas.map(t => `<button type="button" role="tab" data-carpeta="${t.id}" aria-selected="${t.id === actual?.id}"
    style="display:inline-flex;gap:8px;align-items:center">${ICO_CARPETA}${esc(nombreCarpeta(t))} <span class="pill ${EST_TRAMITE[t.estatus]?.[1]}" style="font-size:11px">${esc(EST_TRAMITE[t.estatus]?.[0])}</span></button>`).join('')}</nav>
  <div id="carpeta"></div>`;

  // Revisión contra condiciones generales (periodo de espera del padecimiento)
  if (p) (async () => {
    const box = main.querySelector('#cgCaso'); if (!box) return;
    const cg = cgDePoliza(p, await cargarCondiciones());
    const caso = { afectado: s.afectado || c.nombre, padecimiento: s.padecimiento, fecha_evento: s.fecha_evento, tipo_evento: s.tipo_evento };
    if (!cg) { box.innerHTML = `<p class="muted small" style="margin:0">No hay condiciones generales cargadas para ${esc(p.aseguradora_nombre)} · ${esc(p.producto || RAMOS[p.ramo])}. Se agregan en Configuración → Condiciones generales.</p>`; return; }
    let rev = '';
    if (p.ramo === 'gmm' && s.padecimiento) { const ant = await antiguedadDe(p, caso.afectado); rev = bloqueEspera(revisarEspera(cg.ficha, { padecimiento: s.padecimiento, tipoEvento: s.tipo_evento, fechaEvento: s.fecha_evento, desde: ant.fecha }), ant, caso); }
    box.innerHTML = `<div class="card"><div class="card-head"><h2>Condiciones generales</h2><button type="button" class="btn sm" id="cgPreg">Preguntar a las condiciones</button></div>
      <p class="muted small" style="margin-top:0">${esc(cg.nombre)}${cg.version ? ' · ' + esc(cg.version) : ''}${cg.ficha_revisada ? '' : ' · ficha sin revisar'}</p>${rev.replace('margin:0 0 14px', 'margin:0')}</div>`;
    box.querySelector('#cgPreg').onclick = () => abrirCondiciones({ poliza: p, caso });
  })().catch(() => {});
  const esperados = calcularEsperado(s, carpetas, facturas);
  const bloqueEsperado = t => {
    const e = esperados[t.id]; if (!e) return '';
    if (s.deducible == null && s.coaseguro_pct == null) return `<div class="card"><h2 style="margin-bottom:6px">Reembolso esperado</h2>
      <p class="muted small" style="margin:0">Capture el deducible y el coaseguro en <button type="button" class="linkbtn small" id="sEdit2">Editar expediente</button> para calcular cuánto debería pagar la aseguradora.</p></div>`;
    const fila = (k, v, neg) => `<div class="li"><span>${k}</span><span class="num">${neg ? '− ' : ''}${money(v)}</span></div>`;
    const pagado = t.monto_pagado != null ? Number(t.monto_pagado) : null, dif = pagado == null ? null : Math.round((e.esperado - pagado) * 100) / 100;
    return `<div class="card"><h2 style="margin-bottom:10px">Reembolso esperado</h2>
      <div class="list" style="gap:8px">
        ${fila('Gastos presentados', e.gastos)}
        ${fila(`Deducible aplicado${e.dedRest > 0 ? ` <span class="muted small">(quedan ${money(e.dedRest)} por cubrir)</span>` : ''}`, e.ded, true)}
        ${fila(`Coaseguro ${Math.round(e.pct * 1000) / 10}%${s.coaseguro_tope != null ? ` <span class="muted small">(tope ${money(s.coaseguro_tope)}${e.topeRest <= 0 ? ', alcanzado' : ''})</span>` : ''}`, e.coa, true)}
        <div class="li" style="border-top:1px solid var(--line);padding-top:8px;font-weight:600"><span>Debería pagar la aseguradora</span><span class="num">${money(e.esperado)}</span></div>
        ${pagado != null ? fila('Pagó la aseguradora', pagado) : ''}
      </div>
      ${dif == null ? '<p class="muted small" style="margin-bottom:0">Cuando registre el pago, se compara contra este cálculo.</p>'
        : dif > 1 ? `<p class="small" style="color:var(--bad);margin-bottom:0;font-weight:500">Pagaron ${money(dif)} menos de lo esperado. Revise el finiquito o pida la aclaración a la aseguradora.</p>`
        : dif < -1 ? `<p class="small" style="color:var(--accent);margin-bottom:0">Pagaron ${money(-dif)} más de lo calculado; revise si el deducible o coaseguro registrados son correctos.</p>`
        : '<p class="small" style="color:var(--ok);margin-bottom:0;font-weight:500">El pago coincide con lo esperado.</p>'}
    </div>`;
  };
  const pintarCarpeta = () => {
    const t = actual; if (!t) { main.querySelector('#carpeta').innerHTML = '<div class="card empty">Este expediente no tiene carpetas. Agregue una.</div>'; return; }
    const fs = facturas.filter(f => f.tramite_id === t.id), ds = docs.filter(d => d.tramite_id === t.id), evs = eventos.filter(e => e.tramite_id === t.id);
    const docsCliente = docs.filter(d => !d.tramite_id);
    const req = (REQUISITOS[t.tipo] || []).map(([tipo, etq, oblig]) => {
      const hay = tipo === '__facturas' ? fs.length > 0 : ds.some(d => d.tipo === tipo) || (['ine', 'estado_cuenta'].includes(tipo) && docsCliente.some(d => d.tipo === tipo));
      return { tipo, etq, oblig, hay, deCliente: !ds.some(d => d.tipo === tipo) && hay && tipo !== '__facturas' };
    });
    const faltan = req.filter(r => r.oblig && !r.hay).length;
    const totalF = fs.reduce((a, f) => a + Number(f.total || 0), 0), pagF = fs.reduce((a, f) => a + Number(f.monto_pagado || 0), 0);
    const aplica = formatos.filter(fo => fo.ambito !== 'poliza' && (!fo.aseguradora_id || fo.aseguradora_id === p?.aseguradora_id) && (fo.tipos_tramite || []).includes(t.tipo));
    main.querySelector('#carpeta').innerHTML = `
    <section class="row">
      <div class="col" style="flex:2 1 600px">
        <div class="card">
          <div class="head" style="align-items:flex-start"><div><h2>${esc(nombreCarpeta(t))}</h2>
            <div class="muted small" style="margin-top:4px">${t.folio ? 'Folio ' + esc(t.folio) : 'Sin folio de la aseguradora'} · ${t.fecha_ingreso ? 'ingresada el ' + fdate(t.fecha_ingreso) : 'sin ingresar'} · último movimiento ${diasDesde(t.actualizado_en) === 0 ? 'hoy' : 'hace ' + diasDesde(t.actualizado_en) + ' días'}</div></div>
            <div class="filters"><label for="cEst" class="sr">Estatus</label>
              <select id="cEst" style="width:auto">${Object.entries(EST_TRAMITE).map(([k, [v]]) => `<option value="${k}"${k === t.estatus ? ' selected' : ''}>${v}</option>`).join('')}</select>
              <button type="button" class="btn sm" id="cEdit">Editar datos</button><button type="button" class="btn sm" id="cMsg">Avisar al cliente</button></div></div>
          <div class="grid-info" style="margin-top:14px">
            <div><div class="lbl">Reclamado</div><div class="val">${money(t.monto_reclamado || 0)}</div></div>
            <div><div class="lbl">Pagado / aprobado</div><div class="val">${t.monto_pagado != null ? money(t.monto_pagado) : '—'}</div></div>
            <div><div class="lbl">Afectado</div><div class="val">${esc(t.afectado || s.afectado || '—')}</div></div>
            <div><div class="lbl">Responsable</div><div class="val">${esc(quien[t.responsable_id] || '—')}</div></div>
          </div>
          ${atorado(t) ? `<p class="small" style="color:var(--bad);margin-bottom:0">Pasaron más de ${t.dias_alerta} días sin movimiento: dar seguimiento.</p>` : ''}
        </div>
        ${bloqueEsperado(t)}

        <div class="card">
          <div class="card-head"><h2>Facturas <span class="muted">(${fs.length})</span></h2>
            <div class="filters"><label class="btn sm primary" for="fUp" style="cursor:pointer">Subir facturas (XML y PDF)</label>
              <input type="file" id="fUp" class="sr" multiple accept=".xml,.pdf,application/xml,text/xml,application/pdf"></div></div>
          <p class="muted small" style="margin-top:0">Puede seleccionar varios archivos a la vez. Del XML se leen emisor, RFC, folio fiscal, fecha e importe; el PDF con el mismo nombre se liga a su factura.</p>
          ${fs.length ? `<div class="tbl-wrap"><table>
            <thead><tr><th>Factura</th><th class="num">Total</th><th>Estatus</th><th class="num">Pagado</th><th></th></tr></thead>
            <tbody>${fs.map(f => `<tr data-f="${f.id}">
              <td><div>${esc(f.emisor_nombre || '—')}</div><div class="muted small">${fdate(f.fecha)} · ${esc(CAT_FACTURA[f.categoria])}${f.uuid_fiscal ? '' : ' · <span style="color:var(--warn)">sin XML</span>'}</div>
                <div class="small">${f.xml_ruta ? `<button type="button" class="linkbtn small" data-abrir="${esc(f.xml_ruta)}">XML</button> ` : ''}${f.pdf_ruta ? `<button type="button" class="linkbtn small" data-abrir="${esc(f.pdf_ruta)}">PDF</button>` : ''}</div></td>
              <td class="num">${money(f.total)}</td>
              <td><label class="sr" for="fe${f.id}">Estatus</label><select id="fe${f.id}" data-fcampo="estatus" style="min-height:32px;width:auto;font-size:13px">${Object.entries(EST_FACTURA).map(([k, [v]]) => `<option value="${k}"${k === f.estatus ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
              <td class="num"><label class="sr" for="fp${f.id}">Pagado</label><input id="fp${f.id}" data-fcampo="monto_pagado" type="number" step="0.01" min="0" value="${f.monto_pagado ?? ''}" placeholder="—" style="width:100px;min-height:32px;text-align:right"></td>
              <td class="nw"><button type="button" class="linkbtn small" data-fedit="${f.id}">Editar</button> · <button type="button" class="linkbtn small" data-fdel="${f.id}">Quitar</button></td></tr>`).join('')}
              <tr style="font-weight:600"><td>Total</td><td class="num">${money(totalF)}</td><td></td><td class="num">${money(pagF)}</td><td></td></tr></tbody></table></div>`
            : '<div class="empty">Sin facturas en esta carpeta.</div>'}
        </div>

        <div class="card">
          <div class="card-head"><h2>Formatos prellenados</h2></div>
          <p class="muted small" style="margin-top:0">Se llenan con los datos del cliente, la póliza, el siniestro y las facturas de esta carpeta. Se guardan aquí y se descargan en PDF para imprimir y firmar.</p>
          <div class="list">
            ${aplica.map(fo => `<div class="li"><div><b>${esc(fo.nombre)}</b><div class="muted small">${fo.aseguradora_id ? esc(ctx.aseguradoras.find(a => a.id === fo.aseguradora_id)?.nombre || '') : 'Formato general'}</div></div>
              <button type="button" class="btn sm primary" data-gen="formato" data-fid="${fo.id}">Generar</button></div>`).join('')}
            ${fs.length ? `<div class="li"><div><b>Relación de facturas</b><div class="muted small">Lista de las ${fs.length} facturas con total y firma del asegurado</div></div><button type="button" class="btn sm" data-gen="relacion">Generar</button></div>` : ''}
            <div class="li"><div><b>Carta de solicitud</b><div class="muted small">Dirigida a la aseguradora, con la lista de anexos${['reembolso', 'complemento'].includes(t.tipo) ? ' y los datos bancarios' : ''}</div></div><button type="button" class="btn sm" data-gen="carta">Generar</button></div>
          </div>
          ${!aplica.length ? `<p class="small muted" style="margin-bottom:0">Aún no hay formatos de ${esc(p?.aseguradora_nombre || 'esta aseguradora')} para ${esc(TIPOS_CARPETA[t.tipo].toLowerCase())}. Se agregan en Configuración → Formatos.</p>` : ''}
          ${['reembolso', 'complemento'].includes(t.tipo) && !c.clabe ? `<p class="small" style="color:var(--warn);margin-bottom:0">El cliente no tiene CLABE registrada; agréguela en su ficha para que aparezca en los formatos.</p>` : ''}
        </div>
      </div>

      <aside class="col" style="flex:1 1 320px">
        <div class="card">
          <h2 style="margin-bottom:6px">Requisitos</h2>
          <p class="small" style="margin:0 0 12px;color:${faltan ? 'var(--warn)' : 'var(--ok)'}">${faltan ? `Faltan ${faltan} documento${faltan > 1 ? 's' : ''} obligatorio${faltan > 1 ? 's' : ''}` : 'Expediente completo para enviar'}</p>
          <div class="list">${req.map(r => `<div class="li" style="align-items:flex-start"><div style="display:flex;gap:8px">
              <span aria-hidden="true" style="font-weight:700;color:${r.hay ? 'var(--ok)' : r.oblig ? 'var(--bad)' : 'var(--muted)'}">${r.hay ? '✓' : r.oblig ? '!' : '○'}</span>
              <span>${esc(r.etq)}${r.oblig ? '' : ' <span class="muted small">(opcional)</span>'}${r.deCliente ? '<div class="muted small">En el expediente del cliente</div>' : ''}</span></div>
            ${r.tipo === '__facturas' ? '' : `<label class="linkbtn small" for="rq-${r.tipo}" style="cursor:pointer;white-space:nowrap">${r.hay ? 'Agregar' : 'Subir'}</label><input type="file" id="rq-${r.tipo}" data-doctipo="${r.tipo}" class="sr" accept=".pdf,image/*">`}</div>`).join('')}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Documentos <span class="muted">(${ds.length})</span></h2>
            <label class="btn sm" for="dUp" style="cursor:pointer">Subir</label><input type="file" id="dUp" data-doctipo="otro" class="sr" accept=".pdf,image/*,.doc,.docx"></div>
          <div class="list">${ds.map(d => `<div class="li"><div style="min-width:0"><button type="button" class="linkbtn" data-abrir="${esc(d.ruta)}" style="text-align:left">${esc(d.nombre_archivo)}</button>
            <div class="muted small">${esc(DOCS[d.tipo] || d.tipo)} · ${fdate(d.creado_en.slice(0, 10))}</div>
            <div style="margin-top:4px">${estadoFirma(d, docs)}</div></div>
            <button type="button" class="x" style="font-size:18px;min-width:32px;min-height:32px" aria-label="Quitar ${esc(d.nombre_archivo)}" data-ddel="${d.id}">×</button></div>`).join('') || '<div class="empty">Sin documentos.</div>'}</div>
        </div>
        <div class="card">
          <h2 style="margin-bottom:10px">Seguimiento</h2>
          <div style="display:flex;gap:8px;margin-bottom:12px"><label for="eNota" class="sr">Nota</label><input id="eNota" placeholder="Ej. Llamé a la aseguradora"><button type="button" class="btn" id="eAdd">Agregar</button></div>
          <div class="list">${evs.map(e => `<div><div class="muted small">${fdate(e.creado_en.slice(0, 10))} · ${esc(quien[e.autor_id] || '')}${e.estatus ? ' · ' + esc(EST_TRAMITE[e.estatus]?.[0] || e.estatus) : ''}</div><div>${esc(e.texto)}</div></div>`).join('') || '<div class="empty">Sin movimientos.</div>'}</div>
        </div>
      </aside>
    </section>`;
  };
  pintarCarpeta();

  const recargar = () => { history.replaceState(null, '', `#/siniestro/${id}?c=${actual?.id || ''}`); refrescar(); };
  const cont = main;
  cont.querySelectorAll('[data-carpeta]').forEach(b => b.onclick = () => {
    actual = carpetas.find(t => t.id === b.dataset.carpeta);
    cont.querySelectorAll('[data-carpeta]').forEach(x => x.setAttribute('aria-selected', x === b));
    history.replaceState(null, '', `#/siniestro/${id}?c=${actual.id}`); pintarCarpeta();
  });
  cont.querySelector('#sEdit').onclick = () => formExpediente(s, recargar);
  cont.querySelector('#sCerrar').onclick = async () => { await q(sb.from('siniestros').update({ estatus: s.estatus === 'abierto' ? 'cerrado' : 'abierto' }).eq('id', id)); recargar(); };
  cont.querySelector('#sCarpeta').onclick = () => modal({
    titulo: 'Nueva carpeta en el expediente',
    cuerpo: `<div class="form-grid">${select('Tipo de carpeta', 'tipo', opts(TIPOS_CARPETA, carpetas.some(t => t.tipo === 'reembolso') ? 'reembolso' : 'programacion'), { req: true })}
      ${input('Descripción', 'descripcion', { wide: true, attrs: 'placeholder="Ej. Medicamentos y consultas de seguimiento"' })}</div>
      <p class="muted small">Si ya hay reembolsos en este expediente, el nuevo se numera solo (Reembolso 2, 3…).</p>`,
    onSubmit: async d => {
      const t = await crearCarpeta({ cliente_id: s.cliente_id, poliza_id: s.poliza_id, tipo: d.tipo, descripcion: txt(d.descripcion) || s.padecimiento, siniestro_id: id, afectado: s.afectado });
      actual = t; toast(`Carpeta "${nombreCarpeta(t)}" creada.`); recargar();
    }
  });

  // Eventos dentro de la carpeta
  cont.addEventListener('change', async e => {
    const el = e.target, t = actual;
    try {
      if (el.id === 'cEst') { await q(sb.from('tramites').update({ estatus: el.value }).eq('id', t.id)); toast('Estatus actualizado.'); return recargar(); }
      if (el.dataset.fcampo) {
        const fid = el.closest('tr').dataset.f, campo = el.dataset.fcampo;
        await q(sb.from('facturas').update({ [campo]: campo === 'monto_pagado' ? num(el.value) : el.value }).eq('id', fid));
        if (campo !== 'categoria') await sincronizarMontos(t.id);
        return recargar();
      }
      if (el.id === 'fUp') return subirFacturas([...el.files], t, recargar);
      if (el.dataset.doctipo) {
        const file = el.files[0]; if (!file) return;
        const ruta = await subirArchivo(file, t.cliente_id, 'tramites');
        await q(sb.from('documentos').insert({ cliente_id: t.cliente_id, poliza_id: t.poliza_id, tramite_id: t.id, tipo: el.dataset.doctipo, nombre_archivo: file.name, ruta }));
        await q(sb.from('tramite_eventos').insert({ tramite_id: t.id, texto: `Documento agregado: ${DOCS[el.dataset.doctipo] || 'otro'} (${file.name})` }));
        toast('Documento guardado en la carpeta.'); return recargar();
      }
    } catch (err) { toast(err.message, true); }
  });
  cont.addEventListener('click', async e => {
    const b = e.target.closest('button,[data-abrir]'); if (!b) return;
    const t = actual, d = b.dataset;
    try {
      if (d.abrir) return abrirArchivo(d.abrir);
      if (b.id === 'cEdit') return formCarpeta(t, recargar);
      if (b.id === 'sEdit2') return formExpediente(s, recargar);
      if (b.id === 'cMsg') return enviarMensaje('estatus_tramite', { nombre: c.nombre, tramite: nombreCarpeta(t).toLowerCase(), folio: t.folio || 'en trámite',
        estatus: EST_TRAMITE[t.estatus][0].toLowerCase(), poliza: p?.numero_poliza, aseguradora: p?.aseguradora_nombre }, { telefono: c.whatsapp || c.telefono, email: c.email });
      if (b.id === 'eAdd') {
        const v = cont.querySelector('#eNota').value.trim(); if (!v) return;
        await q(sb.from('tramite_eventos').insert({ tramite_id: t.id, texto: v })); return recargar();
      }
      if (d.fdel) {
        if (!(await confirmar('Quitar factura', 'La factura se quitará de esta carpeta.', 'Quitar'))) return;
        await q(sb.from('facturas').delete().eq('id', d.fdel)); await sincronizarMontos(t.id); return recargar();
      }
      if (d.fedit) return formFactura(facturas.find(f => f.id === d.fedit), t, recargar);
      if (d.pfirma) {
        await q(sb.from('documentos').update({ firma_solicitada: true }).eq('id', d.pfirma));
        const acceso = ctx.accesosPortal.some(a => a.cliente_id === t.cliente_id && a.activo);
        toast(acceso ? 'Listo. El cliente lo verá en su portal para firmarlo.' : 'Firma solicitada, pero el cliente aún no tiene acceso al portal: dele acceso desde su ficha.', !acceso);
        return recargar();
      }
      if (d.cfirma) { await q(sb.from('documentos').update({ firma_solicitada: false }).eq('id', d.cfirma)); return recargar(); }
      if (d.ddel) {
        const doc = docs.find(x => x.id === d.ddel);
        if (!(await confirmar('Quitar documento', `Se borrará "${doc.nombre_archivo}".`, 'Borrar'))) return;
        await sb.storage.from('documentos').remove([doc.ruta]); await q(sb.from('documentos').delete().eq('id', doc.id)); return recargar();
      }
      if (d.gen) {
        b.disabled = true; const txt0 = b.textContent; b.textContent = 'Generando…';
        try {
          const info = await datosCarpeta(t.id);
          const base = `${nombreCarpeta(t)} - ${info.v.afectado}`.replace(/[\\/:*?"<>|]+/g, '');
          if (d.gen === 'relacion') await guardarYDescargar(await pdfRelacion(info), `Relación de facturas - ${base}.pdf`, t);
          if (d.gen === 'carta') {
            const anexos = docs.filter(x => x.tramite_id === t.id && x.tipo !== 'otro').map(x => ({ etiqueta: DOCS[x.tipo] }));
            if (info.facturas.length) anexos.push({ etiqueta: `Facturas (${info.facturas.length}) en PDF y XML` });
            await guardarYDescargar(await pdfCarta(info, anexos), `Carta de solicitud - ${base}.pdf`, t);
          }
          if (d.gen === 'formato') {
            const fo = formatos.find(x => x.id === d.fid);
            await guardarYDescargar(await llenarFormato(fo, info.v), `${fo.nombre} - ${base}.pdf`, t);
          }
          await q(sb.from('tramite_eventos').insert({ tramite_id: t.id, texto: 'Formato generado: ' + (d.gen === 'formato' ? formatos.find(x => x.id === d.fid).nombre : d.gen === 'relacion' ? 'Relación de facturas' : 'Carta de solicitud') }));
          recargar();
        } catch (err2) { toast(err2.message, true); b.disabled = false; b.textContent = txt0; }
      }
    } catch (err) { toast(err.message, true); }
  });
  cont.addEventListener('keydown', e => { if (e.target.id === 'eNota' && e.key === 'Enter') { e.preventDefault(); cont.querySelector('#eAdd').click(); } });
}

// El monto reclamado y pagado de la carpeta se calcula con sus facturas
async function sincronizarMontos(tramiteId) {
  const fs = await q(sb.from('facturas').select('total,monto_pagado').eq('tramite_id', tramiteId));
  if (!fs.length) return;
  const cambios = { monto_reclamado: fs.reduce((a, f) => a + Number(f.total || 0), 0) };
  if (fs.some(f => f.monto_pagado != null)) cambios.monto_pagado = fs.reduce((a, f) => a + Number(f.monto_pagado || 0), 0);
  await q(sb.from('tramites').update(cambios).eq('id', tramiteId));
}

// ---------------------------------------------------------------- Facturas (CFDI)
export function leerCFDI(texto) {
  const x = new DOMParser().parseFromString(texto, 'application/xml');
  if (x.getElementsByTagName('parsererror').length) throw new Error('El archivo XML está dañado.');
  const uno = n => x.getElementsByTagNameNS('*', n)[0];
  const c = uno('Comprobante'); if (!c) throw new Error('El XML no es una factura electrónica (CFDI).');
  const em = uno('Emisor'), re = uno('Receptor'), tfd = uno('TimbreFiscalDigital');
  const imp = [...x.getElementsByTagNameNS('*', 'Impuestos')].find(n => n.hasAttribute('TotalImpuestosTrasladados'));
  const conceptos = [...x.getElementsByTagNameNS('*', 'Concepto')].map(n => n.getAttribute('Descripcion')).filter(Boolean);
  const n = v => (v == null || v === '' ? null : Number(v));
  return {
    uuid_fiscal: tfd?.getAttribute('UUID')?.toUpperCase() || null, serie_folio: [c.getAttribute('Serie'), c.getAttribute('Folio')].filter(Boolean).join('-') || null,
    emisor_nombre: em?.getAttribute('Nombre') || null, emisor_rfc: em?.getAttribute('Rfc') || null, receptor_nombre: re?.getAttribute('Nombre') || null,
    receptor_rfc: re?.getAttribute('Rfc') || null, fecha: (c.getAttribute('Fecha') || '').slice(0, 10) || null,
    concepto: conceptos.slice(0, 3).join('; ').slice(0, 200) || null, subtotal: n(c.getAttribute('SubTotal')), iva: n(imp?.getAttribute('TotalImpuestosTrasladados')),
    total: n(c.getAttribute('Total')) ?? 0,
  };
}
export function categoriaDe(f) {
  const t = `${f.emisor_nombre || ''} ${f.concepto || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/farmac|medicament|botica/.test(t)) return 'farmacia';
  if (/laborator|analisis|biometr|cultivo|patolog/.test(t)) return 'laboratorio';
  if (/rayos|imagen|tomograf|resonanc|ultrason|radiolog|mastograf/.test(t)) return 'imagen';
  if (/hospital|clinica|sanatorio|medica sur|star medica|centro medico/.test(t)) return 'hospital';
  if (/honorario|consulta|cirujan|dr\.|dra\.|anestesi|medico/.test(t)) return 'honorarios';
  return 'otro';
}

async function subirFacturas(files, t, alTerminar) {
  if (!files.length) return;
  const grupos = {};
  files.forEach(f => { const base = f.name.replace(/\.(xml|pdf)$/i, '').toLowerCase(); (grupos[base] ||= {})[/\.xml$/i.test(f.name) ? 'xml' : 'pdf'] = f; });
  const resumen = { ok: 0, dup: [], err: [], sinXml: 0 };
  for (const [base, g] of Object.entries(grupos)) {
    try {
      let datos = { emisor_nombre: g.pdf?.name.replace(/\.pdf$/i, '') || base, total: 0 };
      if (g.xml) datos = leerCFDI(await g.xml.text());
      else resumen.sinXml++;
      if (datos.uuid_fiscal) {
        const ya = await q(sb.from('facturas').select('id,tramite_id').eq('uuid_fiscal', datos.uuid_fiscal));
        if (ya.length) { resumen.dup.push(datos.emisor_nombre || base); continue; }
      }
      const fila = { ...datos, tramite_id: t.id, categoria: categoriaDe(datos) };
      if (g.xml) fila.xml_ruta = await subirArchivo(g.xml, t.cliente_id, 'facturas');
      if (g.pdf) fila.pdf_ruta = await subirArchivo(g.pdf, t.cliente_id, 'facturas');
      await q(sb.from('facturas').insert(fila));
      resumen.ok++;
    } catch (e) { resumen.err.push(`${base}: ${/duplicate|ya existe/i.test(e.message) ? 'factura ya registrada' : e.message}`); }
  }
  await sincronizarMontos(t.id);
  if (resumen.ok) await q(sb.from('tramite_eventos').insert({ tramite_id: t.id, texto: `${resumen.ok} factura${resumen.ok > 1 ? 's' : ''} agregada${resumen.ok > 1 ? 's' : ''}` }));
  const avisos = [];
  if (resumen.ok) avisos.push(`${resumen.ok} factura${resumen.ok > 1 ? 's' : ''} agregada${resumen.ok > 1 ? 's' : ''}`);
  if (resumen.sinXml) avisos.push(`${resumen.sinXml} sin XML: capture su importe con "Editar"`);
  if (resumen.dup.length) avisos.push(`ya registrada${resumen.dup.length > 1 ? 's' : ''} antes (no se duplicó): ${resumen.dup.join(', ')}`);
  if (resumen.err.length) avisos.push('Errores: ' + resumen.err.join('; '));
  toast(avisos.join('. ') + '.', !!(resumen.dup.length || resumen.err.length));
  alTerminar();
}

function formFactura(f, t, alGuardar) {
  modal({
    titulo: 'Editar factura',
    cuerpo: `<div class="form-grid">
      ${input('Emisor', 'emisor_nombre', { value: f.emisor_nombre, req: true, wide: true })}
      ${input('RFC del emisor', 'emisor_rfc', { value: f.emisor_rfc })}
      ${input('Fecha', 'fecha', { type: 'date', value: f.fecha })}
      ${select('Categoría', 'categoria', opts(CAT_FACTURA, f.categoria))}
      ${input('Total', 'total', { type: 'number', value: f.total, req: true, attrs: 'step="0.01" min="0"' })}
      ${input('Folio fiscal (UUID)', 'uuid_fiscal', { value: f.uuid_fiscal, wide: true })}
      ${input('Concepto', 'concepto', { value: f.concepto, wide: true })}
    </div>`,
    onSubmit: async d => {
      await q(sb.from('facturas').update({ emisor_nombre: txt(d.emisor_nombre), emisor_rfc: txt(d.emisor_rfc)?.toUpperCase() ?? null, fecha: txt(d.fecha), categoria: d.categoria,
        total: num(d.total) ?? 0, uuid_fiscal: txt(d.uuid_fiscal)?.toUpperCase() ?? null, concepto: txt(d.concepto) }).eq('id', f.id));
      await sincronizarMontos(t.id); toast('Factura actualizada.'); alGuardar();
    }
  });
}

function formExpediente(s, alGuardar) {
  modal({
    titulo: 'Editar expediente',
    cuerpo: `<div class="form-grid">
      ${input('Padecimiento / diagnóstico / causa', 'padecimiento', { value: s.padecimiento, req: true, wide: true })}
      ${select('Tipo de evento', 'tipo_evento', opts(EVENTOS, s.tipo_evento))}
      ${input('Asegurado afectado', 'afectado', { value: s.afectado })}
      ${input('Número de siniestro', 'numero_siniestro', { value: s.numero_siniestro })}
      ${input('Fecha del evento / primeros síntomas', 'fecha_evento', { type: 'date', value: s.fecha_evento })}
      ${input('Deducible', 'deducible', { type: 'number', value: s.deducible, attrs: 'step="0.01" min="0"' })}
      ${input('Coaseguro %', 'coaseguro_pct', { type: 'number', value: s.coaseguro_pct, attrs: 'step="0.01" min="0" max="100"' })}
      ${input('Tope de coaseguro (si aplica)', 'coaseguro_tope', { type: 'number', value: s.coaseguro_tope, attrs: 'step="0.01" min="0"' })}
      ${select('Responsable', 'responsable_id', optsList(ctx.perfiles.filter(p => p.activo || p.id === s.responsable_id), s.responsable_id))}
      ${textarea('Notas', 'notas', s.notas)}
    </div>`,
    onSubmit: async d => {
      await q(sb.from('siniestros').update({ padecimiento: txt(d.padecimiento), tipo_evento: d.tipo_evento, afectado: txt(d.afectado), numero_siniestro: txt(d.numero_siniestro),
        fecha_evento: txt(d.fecha_evento), deducible: num(d.deducible), coaseguro_pct: num(d.coaseguro_pct), coaseguro_tope: num(d.coaseguro_tope), responsable_id: d.responsable_id, notas: txt(d.notas) }).eq('id', s.id));
      toast('Expediente actualizado.'); alGuardar();
    }
  });
}

function formCarpeta(t, alGuardar) {
  modal({
    titulo: 'Datos de la carpeta',
    cuerpo: `<div class="form-grid">
      ${input('Folio de la aseguradora', 'folio', { value: t.folio })}
      ${input('Fecha de ingreso a la aseguradora', 'fecha_ingreso', { type: 'date', value: t.fecha_ingreso })}
      ${input('Monto reclamado', 'monto_reclamado', { type: 'number', value: t.monto_reclamado, attrs: 'step="0.01" min="0"' })}
      ${input('Monto pagado / aprobado', 'monto_pagado', { type: 'number', value: t.monto_pagado, attrs: 'step="0.01" min="0"' })}
      ${input('Asegurado afectado', 'afectado', { value: t.afectado })}
      ${input('Avisarme si pasa sin movimiento (días)', 'dias_alerta', { type: 'number', value: t.dias_alerta, attrs: 'min="1"' })}
      ${select('Responsable', 'responsable_id', optsList(ctx.perfiles.filter(p => p.activo || p.id === t.responsable_id), t.responsable_id))}
      ${textarea('Descripción', 'descripcion', t.descripcion)}
    </div><p class="muted small">Si la carpeta tiene facturas, el monto reclamado se calcula con ellas.</p>`,
    onSubmit: async d => {
      await q(sb.from('tramites').update({ folio: txt(d.folio), fecha_ingreso: txt(d.fecha_ingreso), monto_reclamado: num(d.monto_reclamado), monto_pagado: num(d.monto_pagado),
        afectado: txt(d.afectado), dias_alerta: num(d.dias_alerta) || 15, responsable_id: d.responsable_id, descripcion: txt(d.descripcion) }).eq('id', t.id));
      toast('Carpeta actualizada.'); alGuardar();
    }
  });
}
