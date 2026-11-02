// Oportunidades de venta cruzada: clientes con huecos en su protección
import { sb, ctx, q } from '../db.js';
import { esc, toast, fdate, iso, hoyISO, parseD, addDays, hoy, primerNombre, waLink, edad, RAMOS, modal, textarea } from '../ui.js';
import { refrescar } from '../app.js';

export const TIPOS_OP = {
  vida: ['Seguro de vida', 'vida', 'Tiene gastos médicos o auto, pero no seguro de vida.'],
  gmm: ['Gastos médicos', 'gmm', 'Tiene otros seguros con usted, pero no gastos médicos mayores.'],
  hogar: ['Seguro de hogar', 'hogar', 'Asegura su auto pero no su casa.'],
  hijo25: ['Hijo que sale de la póliza', 'gmm', ''],
  empresa: ['Daños o responsabilidad civil', 'danos', 'Empresa sin seguro de daños ni de responsabilidad civil.'],
  colectivo: ['Gastos médicos colectivo', 'gmm', 'Empresa con seguro de daños, pero sin gastos médicos para su personal.'],
};
const MENSAJE = {
  vida: 'Hola {nombre}, ¿cómo está? Revisando su expediente vi que ya protege su salud y su patrimonio con nosotros, pero no cuenta con un seguro de vida. ¿Le gustaría que le prepare una cotización sin compromiso para proteger a su familia? Saludos, {agente}.',
  gmm: 'Hola {nombre}, ¿cómo está? Vi que no cuenta con un seguro de gastos médicos mayores con nosotros. Hoy una hospitalización puede costar cientos de miles de pesos. ¿Le preparo algunas opciones sin compromiso? Saludos, {agente}.',
  hogar: 'Hola {nombre}, ¿cómo está? Ya protegemos su auto; ¿le gustaría que también le cotice un seguro para su casa? Cubre incendio, robo, daños por lluvia y responsabilidad civil, y suele costar menos de lo que se imagina. Saludos, {agente}.',
  hijo25: 'Hola {nombre}, ¿cómo está? {detalle} En muchas pólizas familiares los hijos salen al cumplir 25 años. Para que no se quede sin cobertura, ¿le preparo opciones de una póliza propia? Saludos, {agente}.',
  empresa: 'Hola {nombre}, ¿cómo está? Me gustaría platicarle sobre un seguro para su negocio que cubre daños al inmueble, contenidos y responsabilidad civil frente a terceros. ¿Le preparo una cotización? Saludos, {agente}.',
  colectivo: 'Hola {nombre}, ¿cómo está? Un seguro de gastos médicos colectivo es una prestación muy valorada por los colaboradores y es deducible para la empresa. ¿Le preparo una cotización? Saludos, {agente}.',
};
const ESTADOS = { contactado: ['Contactado', 'p-blue'], prospecto: ['Ya es prospecto', 'p-ok'], descartada: ['Descartada', 'p-gray'] };
let filtro = 'todas', soloNuevas = true;

export async function calcularOportunidades() {
  const [clientes, polizas, estados] = await Promise.all([
    q(sb.from('clientes').select('id,nombre,tipo_persona,fecha_nacimiento,telefono,whatsapp,email,agente_id,activo').eq('activo', true)),
    q(sb.from('v_polizas').select('id,cliente_id,ramo,aseguradora_nombre,numero_poliza,estatus').eq('estatus', 'activa')),
    q(sb.from('oportunidades').select('*')),
  ]);
  const gmmIds = polizas.filter(p => p.ramo === 'gmm').map(p => p.id);
  const asegurados = gmmIds.length ? await q(sb.from('asegurados').select('poliza_id,nombre,parentesco,fecha_nacimiento,tipo').in('poliza_id', gmmIds)) : [];
  const h = hoy(), en12 = addDays(h, 365), out = [];
  clientes.forEach(c => {
    const ps = polizas.filter(p => p.cliente_id === c.id); if (!ps.length) return;
    const tiene = r => ps.some(p => p.ramo === r);
    const add = (tipo, detalle = TIPOS_OP[tipo][2], extra = {}) => out.push({ id: `${c.id}:${tipo}`, cliente: c, tipo, detalle, productos: [...new Set(ps.map(p => p.ramo))], ...extra });
    if (c.tipo_persona === 'moral') {
      if (!tiene('danos')) add('empresa');
      else if (!tiene('gmm')) add('colectivo');
      return;
    }
    if (!tiene('vida') && (tiene('gmm') || tiene('auto'))) add('vida');
    if (!tiene('gmm') && (tiene('vida') || tiene('auto') || tiene('hogar'))) add('gmm');
    if (tiene('auto') && !tiene('hogar')) add('hogar');
    // Hijos asegurados que cumplen 25 en los próximos 12 meses
    asegurados.filter(a => ps.some(p => p.id === a.poliza_id) && a.tipo !== 'beneficiario' && /hij/i.test(a.parentesco || '') && a.fecha_nacimiento).forEach(a => {
      const n = parseD(a.fecha_nacimiento), cumple25 = new Date(n.getFullYear() + 25, n.getMonth(), n.getDate());
      if (cumple25 >= h && cumple25 <= en12) out.push({ id: `${c.id}:hijo25:${a.nombre}`, cliente: c, tipo: 'hijo25', productos: [...new Set(ps.map(p => p.ramo))],
        detalle: `${a.nombre} cumple 25 años el ${fdate(iso(cumple25))}; en muchas pólizas familiares los hijos salen a esa edad.`, persona: a.nombre, fecha: iso(cumple25) });
    });
  });
  const estadoDe = o => estados.find(e => e.cliente_id === o.cliente.id && e.tipo === (o.persona ? `hijo25:${o.persona}` : o.tipo)) || null;
  return out.map(o => ({ ...o, estado: estadoDe(o) }))
    .filter(o => !(o.estado?.estatus === 'descartada' && (!o.estado.hasta || o.estado.hasta >= hoyISO())));
}

export async function vistaOportunidades(main, _p, vigente) {
  const todas = await calcularOportunidades();
  if (!vigente()) return;
  const persona = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
  const lista = todas.filter(o => (filtro === 'todas' || o.tipo === filtro) && (!soloNuevas || !o.estado));
  const cuenta = t => todas.filter(o => o.tipo === t && (!soloNuevas || !o.estado)).length;
  main.innerHTML = `
  <div class="head"><div><h1>Oportunidades</h1>
    <p class="muted" style="margin:4px 0 0">Clientes con huecos en su protección. Cada uno es una venta posible con alguien que ya confía en ustedes.</p></div>
    <div class="filters"><button class="btn primary" type="button" id="oCamp" disabled>Mensaje a seleccionados</button></div></div>
  <section class="kpis">
    <div class="card kpi"><div class="k">Oportunidades abiertas</div><div class="v">${todas.filter(o => !o.estado).length}</div><div class="s">En ${new Set(todas.filter(o => !o.estado).map(o => o.cliente.id)).size} clientes</div></div>
    <div class="card kpi"><div class="k">Contactados</div><div class="v">${todas.filter(o => o.estado?.estatus === 'contactado').length}</div><div class="s">Esperando respuesta</div></div>
    <div class="card kpi"><div class="k">Convertidas en prospecto</div><div class="v">${todas.filter(o => o.estado?.estatus === 'prospecto').length}</div><div class="s">Siguen en Prospectos</div></div>
    <div class="card kpi warn"><div class="k">Hijos que salen de la póliza</div><div class="v">${todas.filter(o => o.tipo === 'hijo25' && !o.estado).length}</div><div class="s">Cumplen 25 en los próximos 12 meses</div></div>
  </section>
  <div class="filters"><div class="chips" role="group" aria-label="Tipo">${[['todas', 'Todas'], ...Object.entries(TIPOS_OP).map(([k, v]) => [k, v[0]])].map(([k, t]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${filtro === k}">${t}${k !== 'todas' ? ` (${cuenta(k)})` : ''}</button>`).join('')}</div>
    <label class="small" style="display:flex;gap:6px;align-items:center;margin-left:auto"><input type="checkbox" id="oNuevas" ${soloNuevas ? 'checked' : ''} style="width:auto;min-height:0"> Solo sin contactar</label></div>
  <section class="card">${lista.length ? `<div class="tbl-wrap"><table><thead><tr><th><label class="sr" for="oTodas">Seleccionar todas</label><input type="checkbox" id="oTodas" style="width:auto;min-height:0"></th><th>Cliente</th><th>Oportunidad</th><th>Tiene</th><th>Agente</th><th></th></tr></thead><tbody>
    ${lista.map((o, i) => `<tr><td><label class="sr" for="os${i}">Seleccionar</label><input type="checkbox" id="os${i}" data-sel="${i}" style="width:auto;min-height:0"></td>
      <td><a href="#/cliente/${o.cliente.id}">${esc(o.cliente.nombre)}</a>${o.cliente.fecha_nacimiento && o.cliente.tipo_persona === 'fisica' ? `<div class="muted small">${edad(o.cliente.fecha_nacimiento)} años</div>` : ''}</td>
      <td><span class="op-tag">${esc(TIPOS_OP[o.tipo][0])}</span>${o.estado ? ' ' + `<span class="pill ${ESTADOS[o.estado.estatus][1]}">${ESTADOS[o.estado.estatus][0]}</span>` : ''}<div class="small" style="margin-top:4px">${esc(o.detalle)}</div></td>
      <td class="small">${o.productos.map(r => esc(RAMOS[r])).join(', ')}</td>
      <td class="small nw">${esc(primerNombre(persona[o.cliente.agente_id] || '—'))}</td>
      <td class="nw" style="text-align:right"><button type="button" class="btn sm" data-msg="${i}">Mensaje</button> <button type="button" class="btn sm" data-pros="${i}"${o.estado?.estatus === 'prospecto' ? ' disabled' : ''}>Crear prospecto</button> <button type="button" class="linkbtn small" data-desc="${i}">Descartar</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No hay oportunidades con este filtro. ¡Buena señal!</div>'}
    <p class="muted small" style="margin:12px 0 0">Las reglas se calculan con las pólizas vigentes. "Descartar" la oculta por 6 meses.</p></section>`;

  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; refrescar(); });
  main.querySelector('#oNuevas').onchange = e => { soloNuevas = e.target.checked; refrescar(); };
  const sels = () => [...main.querySelectorAll('[data-sel]:checked')].map(x => lista[Number(x.dataset.sel)]);
  const actualizarBtn = () => { const n = sels().length; const b = main.querySelector('#oCamp'); b.disabled = !n; b.textContent = n ? `Mensaje a seleccionados (${n})` : 'Mensaje a seleccionados'; };
  main.querySelector('#oTodas')?.addEventListener('change', e => { main.querySelectorAll('[data-sel]').forEach(x => { x.checked = e.target.checked; }); actualizarBtn(); });
  main.querySelectorAll('[data-sel]').forEach(x => x.onchange = actualizarBtn);
  main.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => campana([lista[Number(b.dataset.msg)]]));
  main.querySelector('#oCamp').onclick = () => campana(sels());
  main.querySelectorAll('[data-pros]').forEach(b => b.onclick = () => crearProspecto(lista[Number(b.dataset.pros)]));
  main.querySelectorAll('[data-desc]').forEach(b => b.onclick = () => marcar(lista[Number(b.dataset.desc)], 'descartada', iso(addDays(hoy(), 182))).then(() => { toast('Oportunidad descartada por 6 meses.'); refrescar(); }));
}

const claveEstado = o => o.tipo === 'hijo25' ? `hijo25:${o.persona}` : o.tipo;
async function marcar(o, estatus, hasta = null, nota = null) {
  const fila = { cliente_id: o.cliente.id, tipo: claveEstado(o), estatus, hasta, nota };
  if (o.estado) await q(sb.from('oportunidades').update(fila).eq('id', o.estado.id));
  else o.estado = await q(sb.from('oportunidades').insert(fila).select().single());
}

const textoDe = o => (MENSAJE[o.tipo] || '').replace('{nombre}', primerNombre(o.cliente.nombre)).replace('{detalle}', o.tipo === 'hijo25' ? `${primerNombre(o.persona)} cumple 25 años el ${fdate(o.fecha)}.` : '')
  .replace('{agente}', ctx.perfiles.find(p => p.id === o.cliente.agente_id)?.nombre || ctx.perfil.nombre);

// Mensajes uno por uno (WhatsApp abre cada conversación); al abrirlo queda como "contactado"
function campana(lista) {
  const dlg = modal({
    titulo: lista.length > 1 ? `Mensaje a ${lista.length} clientes` : 'Enviar mensaje', boton: 'Listo',
    cuerpo: `<p class="muted small" style="margin-top:0">Revise el mensaje de cada cliente y ábralo en WhatsApp. Al abrirlo, la oportunidad queda como contactada.</p>
      <div class="col" style="gap:14px">${lista.map((o, i) => `<div class="camp-item"><div class="filters" style="justify-content:space-between"><b>${esc(o.cliente.nombre)}</b><span class="op-tag">${esc(TIPOS_OP[o.tipo][0])}</span></div>
        <label class="sr" for="cm${i}">Mensaje para ${esc(o.cliente.nombre)}</label><textarea id="cm${i}" style="min-height:90px;margin-top:6px">${esc(textoDe(o))}</textarea>
        <div class="filters" style="margin-top:6px">${(o.cliente.whatsapp || o.cliente.telefono) ? `<button type="button" class="btn sm primary" data-wa="${i}">Abrir en WhatsApp</button>` : '<span class="small" style="color:var(--warn)">Sin teléfono</span>'}
          ${o.cliente.email ? `<a class="btn sm" data-mail="${i}" href="mailto:${esc(o.cliente.email)}">Correo</a>` : ''}<span class="small muted" data-ok="${i}"></span></div></div>`).join('')}</div>`,
    onOpen: f => {
      const hecho = async i => { try { await marcar(lista[i], 'contactado'); f.querySelector(`[data-ok="${i}"]`).textContent = '✓ Contactado'; } catch (e) { toast(e.message, true); } };
      f.querySelectorAll('[data-wa]').forEach(b => b.onclick = () => { const i = Number(b.dataset.wa), o = lista[i]; const l = waLink(o.cliente.whatsapp || o.cliente.telefono, f.querySelector('#cm' + i).value); if (l) window.open(l, '_blank', 'noopener'); hecho(i); });
      f.querySelectorAll('[data-mail]').forEach(a => a.onclick = () => { const i = Number(a.dataset.mail); a.href = `mailto:${lista[i].cliente.email}?subject=${encodeURIComponent('Una propuesta para usted')}&body=${encodeURIComponent(f.querySelector('#cm' + i).value)}`; hecho(i); });
    },
    onSubmit: () => refrescar(),
  });
  return dlg;
}

async function crearProspecto(o) {
  try {
    const c = o.cliente;
    await q(sb.from('prospectos').insert({ nombre: o.tipo === 'hijo25' ? o.persona : c.nombre, telefono: c.whatsapp || c.telefono || null, email: c.email || null, ramo: TIPOS_OP[o.tipo][1],
      agente_id: c.agente_id || ctx.perfil.id, etapa: 'prospecto', cliente_id: c.id, origen: 'Venta cruzada', fecha_seguimiento: hoyISO(), notas: o.detalle }));
    await marcar(o, 'prospecto');
    toast('Prospecto creado. Lo encuentra en Prospectos.'); refrescar();
  } catch (e) { toast(e.message, true); }
}
