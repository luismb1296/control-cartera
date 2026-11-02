// Prospectos y cotizaciones (embudo de ventas)
import { sb, ctx, q, puedeAdministrar } from '../db.js';
import {
  esc, money, fdate, fdia, pill, modal, input, select, textarea, opts, optsList, toast, num, txt, hoyISO, waLink,
  RAMOS, ETAPAS
} from '../ui.js';
import { formPoliza } from './formas.js';
import { refrescar } from '../app.js';
import { abrirComparativo } from './comparativo.js';

const ABIERTAS = ['prospecto', 'cotizado', 'negociacion'];

export async function vistaProspectos(main, _p, vigente) {
  const lista = await q(sb.from('prospectos').select('*').order('fecha_seguimiento'));
  if (!vigente()) return;
  const aseg = Object.fromEntries(ctx.aseguradoras.map(a => [a.id, a.nombre]));
  const agente = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  const abiertos = lista.filter(p => ABIERTAS.includes(p.etapa));
  const ganados = lista.filter(p => p.etapa === 'ganado'), perdidos = lista.filter(p => p.etapa === 'perdido');
  const cierre = ganados.length + perdidos.length ? Math.round(ganados.length / (ganados.length + perdidos.length) * 100) : null;
  const hoy = hoyISO();
  const atrasados = abiertos.filter(p => p.fecha_seguimiento && p.fecha_seguimiento <= hoy);

  main.innerHTML = `
  <header class="head"><h1>Prospectos y cotizaciones</h1>
    <button class="btn primary" type="button" id="nuevo">+ Nuevo prospecto</button></header>
  <section class="kpis">
    <div class="card kpi"><div class="k">En proceso</div><div class="v">${abiertos.length}</div><div class="s">${money(abiertos.reduce((a, p) => a + Number(p.prima_estimada || 0), 0))} de prima estimada</div></div>
    <div class="card kpi warn"><div class="k">Seguimiento para hoy</div><div class="v">${atrasados.length}</div><div class="s">incluye los atrasados</div></div>
    <div class="card kpi"><div class="k">Ganados</div><div class="v">${ganados.length}</div><div class="s">${money(ganados.reduce((a, p) => a + Number(p.prima_estimada || 0), 0))}</div></div>
    <div class="card kpi"><div class="k">Tasa de cierre</div><div class="v">${cierre == null ? '—' : cierre + '%'}</div><div class="s">ganados contra perdidos</div></div>
  </section>
  <div class="filters">
    <label for="fa" class="sr">Agente</label>
    <select id="fa"><option value="">Todos los agentes</option>${ctx.perfiles.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select>
  </div>
  <div class="tbl-wrap"><div class="kanban" id="tablero"></div></div>`;

  const tarjeta = p => {
    const tarde = ABIERTAS.includes(p.etapa) && p.fecha_seguimiento && p.fecha_seguimiento <= hoy;
    const wa = waLink(p.telefono, `Hola ${p.nombre.split(' ')[0]}, `);
    return `<article class="card kcard">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(p.nombre)}</b>${p.cliente_id ? '<span class="pill p-blue">Cliente</span>' : ''}</div>
      <div class="muted small">${esc(RAMOS[p.ramo] || '—')}${p.aseguradora_id ? ' · ' + esc(aseg[p.aseguradora_id]) : ''}</div>
      ${p.prima_estimada ? `<div class="num" style="text-align:left;margin-top:6px">${money(p.prima_estimada)}</div>` : ''}
      ${p.etapa === 'perdido' && p.motivo_perdida ? `<div class="small" style="color:var(--bad);margin-top:4px">${esc(p.motivo_perdida)}</div>` : ''}
      ${ABIERTAS.includes(p.etapa) && p.fecha_seguimiento ? `<div class="small" style="margin-top:6px;${tarde ? 'color:var(--bad);font-weight:500' : 'color:var(--muted)'}">Seguimiento: ${p.fecha_seguimiento === hoy ? 'hoy' : esc(fdia(p.fecha_seguimiento))}</div>` : ''}
      <div class="muted small">${esc(agente[p.agente_id] || '')}${p.origen ? ' · ' + esc(p.origen) : ''}</div>
      <div class="filters" style="margin-top:10px;gap:6px">
        <label class="sr" for="e${p.id}">Etapa</label>
        <select id="e${p.id}" data-etapa="${p.id}" style="min-height:34px;font-size:13px;width:auto;min-width:0">${Object.entries(ETAPAS).map(([k, [v]]) => `<option value="${k}"${k === p.etapa ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <button type="button" class="btn sm" data-edit="${p.id}">Editar</button>
        <button type="button" class="btn sm" data-cmp="${p.id}">Comparativo${p.cotizaciones?.length ? ` (${p.cotizaciones.length})` : ''}</button>
        ${wa ? `<a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${p.etapa === 'ganado' && !p.poliza_id ? `<button type="button" class="btn sm primary" data-conv="${p.id}">Emitir póliza</button>` : ''}
        ${p.poliza_id ? `<a class="btn sm" href="#/cliente/${p.cliente_id}">Ver cliente</a>` : ''}
      </div></article>`;
  };
  const pintar = () => {
    const fa = main.querySelector('#fa').value;
    const vis = lista.filter(p => !fa || p.agente_id === fa);
    main.querySelector('#tablero').innerHTML = Object.entries(ETAPAS).map(([k, [t]]) => {
      const col = vis.filter(p => p.etapa === k);
      return `<section class="kcol" aria-label="${t}"><div class="kcol-h"><span>${t} <span class="muted">(${col.length})</span></span>
        <span class="muted small">${money(col.reduce((a, p) => a + Number(p.prima_estimada || 0), 0))}</span></div>
        ${col.map(tarjeta).join('') || '<div class="empty small">Sin registros</div>'}</section>`;
    }).join('');
  };
  pintar();
  main.querySelector('#fa').onchange = pintar;
  main.querySelector('#nuevo').onclick = () => formProspecto(null, refrescar);
  main.querySelector('#tablero').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.edit) formProspecto(lista.find(p => p.id === d.edit), refrescar);
    if (d.conv) emitir(lista.find(p => p.id === d.conv));
    if (d.cmp) { const p = lista.find(x => x.id === d.cmp); abrirComparativo({ para: p.nombre, ramo: p.ramo, clienteId: p.cliente_id, opciones: p.cotizaciones || [],
      alGuardar: async ops => { try { await q(sb.from('prospectos').update({ cotizaciones: ops }).eq('id', p.id)); refrescar(); } catch (e) { toast(e.message, true); } } }); }
  });
  main.querySelector('#tablero').addEventListener('change', async e => {
    const id = e.target.dataset.etapa; if (!id) return;
    const etapa = e.target.value;
    if (etapa === 'perdido') return pedirMotivo(lista.find(p => p.id === id));
    try { await q(sb.from('prospectos').update({ etapa }).eq('id', id)); toast('Etapa actualizada.'); refrescar(); } catch (err) { toast(err.message, true); }
  });
}

function pedirMotivo(p) {
  modal({
    titulo: 'Prospecto perdido', boton: 'Guardar',
    cuerpo: input('¿Por qué se perdió?', 'motivo', { req: true, wide: true, attrs: 'placeholder="Ej. Eligió otra agencia por precio"' }),
    onSubmit: async d => { await q(sb.from('prospectos').update({ etapa: 'perdido', motivo_perdida: txt(d.motivo) }).eq('id', p.id)); toast('Registrado como perdido.'); refrescar(); }
  }).addEventListener('close', () => refrescar(), { once: true });
}

export function formProspecto(p, alGuardar) {
  const x = p || { etapa: 'prospecto', fecha_seguimiento: hoyISO() };
  modal({
    titulo: p ? 'Editar prospecto' : 'Nuevo prospecto',
    cuerpo: `<div class="form-grid">
      ${input('Nombre', 'nombre', { value: x.nombre, req: true, wide: true })}
      ${input('Teléfono', 'telefono', { type: 'tel', value: x.telefono })}
      ${input('Correo', 'email', { type: 'email', value: x.email })}
      ${select('Ramo de interés', 'ramo', '<option value="">—</option>' + opts(RAMOS, x.ramo))}
      ${select('Aseguradora cotizada', 'aseguradora_id', '<option value="">—</option>' + optsList(ctx.aseguradoras.filter(a => a.activa), x.aseguradora_id))}
      ${input('Prima estimada anual', 'prima_estimada', { type: 'number', value: x.prima_estimada, attrs: 'step="0.01" min="0"' })}
      ${select('Etapa', 'etapa', opts(Object.fromEntries(Object.entries(ETAPAS).map(([k, [v]]) => [k, v])), x.etapa))}
      ${input('Próximo seguimiento', 'fecha_seguimiento', { type: 'date', value: x.fecha_seguimiento })}
      ${input('¿Cómo llegó?', 'origen', { value: x.origen, attrs: 'placeholder="Recomendación, redes, sitio web…"' })}
      ${puedeAdministrar() ? select('Agente', 'agente_id', optsList(ctx.perfiles.filter(a => a.activo), x.agente_id || ctx.perfil.id)) : ''}
      ${textarea('Notas', 'notas', x.notas)}
    </div>`,
    onSubmit: async d => {
      const fila = { nombre: txt(d.nombre), telefono: txt(d.telefono), email: txt(d.email), ramo: d.ramo || null, aseguradora_id: d.aseguradora_id || null,
        prima_estimada: num(d.prima_estimada), etapa: d.etapa, fecha_seguimiento: txt(d.fecha_seguimiento), origen: txt(d.origen), notas: txt(d.notas) };
      if (d.agente_id) fila.agente_id = d.agente_id;
      if (p) await q(sb.from('prospectos').update(fila).eq('id', p.id));
      else await q(sb.from('prospectos').insert(fila));
      toast(p ? 'Prospecto actualizado.' : 'Prospecto registrado.');
      alGuardar?.();
    }
  });
}

// Convierte un prospecto ganado en cliente + póliza
async function emitir(p) {
  try {
    let clienteId = p.cliente_id;
    if (!clienteId) {
      const c = await q(sb.from('clientes').insert({ nombre: p.nombre, telefono: p.telefono, whatsapp: p.telefono, email: p.email, agente_id: p.agente_id }).select().single());
      clienteId = c.id;
      await q(sb.from('prospectos').update({ cliente_id: clienteId }).eq('id', p.id));
      toast('Se creó el cliente. Ahora capture los datos de la póliza.');
    }
    formPoliza({
      clienteId, modo: 'nueva',
      prefill: { ramo: p.ramo || 'gmm', aseguradora_id: p.aseguradora_id, prima_total: p.prima_estimada, agente_id: p.agente_id },
      alGuardar: async pol => {
        await q(sb.from('prospectos').update({ poliza_id: pol.id }).eq('id', p.id));
        location.hash = '#/cliente/' + clienteId;
      }
    });
  } catch (e) { toast(e.message, true); }
}
