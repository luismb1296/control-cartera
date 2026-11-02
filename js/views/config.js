import { sb, ctx, q, puedeAdministrar, recargarCatalogos } from '../db.js';
import { esc, toast, modal, input, select, opts, confirmar, fdate, PLANES, llenarPlantilla, RAMOS, TIPOS_TRAMITE, EST_TRAMITE, SEGUIMIENTO, FORMAS } from '../ui.js';
import { refrescar, recargarApp, aplicarMarca } from '../app.js';
import { subirArchivo } from './formas.js';
import { VARIABLES as VARS_PDF, sugerirVariable, camposDePdf, llenarFormato, leerBytes, DATOS_EJEMPLO, pdfCartaLibre } from './pdfs.js';
import { USOS_POLIZA, textarea } from '../ui.js';
import { CARTA_EJEMPLO } from './cartas.js';
import { tablaCondiciones, accionCondiciones } from './condiciones.js';
import { TIPOS_CARPETA, descargar, cargarPdfLib, iso } from '../ui.js';
import { PALETAS, PALETA_BASE, paletaDe, variables, aplicarPaleta } from '../tema.js';
import { VARS_WA, CANALES, textoParaMeta, canalesDe } from '../whatsapp.js';

const ROLES = { admin: 'Administración', operaciones: 'Operaciones', agente: 'Agente' };
const ROLES_DESC = { admin: 'Ve y edita todo, administra usuarios y la agencia', operaciones: 'Ve y edita toda la cartera', agente: 'Solo ve y edita sus propios clientes' };
const VARIABLES = '{nombre} {poliza} {aseguradora} {ramo} {monto} {fecha} {inicio} {recibo} {tramite} {folio} {estatus} {agencia}';
const EJEMPLO = { nombre: 'María', poliza: 'AXA-GMM-88213', aseguradora: 'AXA', ramo: 'gastos médicos', monto: '$4,076.67', fecha: '02 nov 2026',
  inicio: '02 nov 2025', recibo: '12/12', tramite: 'reembolso', folio: 'AXA-RB-552190', estatus: 'en revisión', movimiento: 'alta de asegurado (Andrea)', importe_texto: 'El ajuste de prima es de $3,480.00.' };

export async function vistaConfig(main, _p, vigente) {
  const admin = ctx.perfil.rol === 'admin', gestion = puedeAdministrar();
  const bitacora = gestion ? await q(sb.from('bitacora').select('*').order('creado_en', { ascending: false }).limit(300)) : [];
  if (!vigente()) return;
  const ag = ctx.agencia || {};
  const formatos = await q(sb.from('formatos').select('*').order('nombre'));
  const condiciones = await q(sb.from('condiciones_generales').select('id,aseguradora_id,producto_id,ramo,nombre,version,vigente_desde,archivo_ruta,paginas,ficha,ficha_revisada,activo').order('nombre'));
  if (!vigente()) return;
  const activos = ctx.perfiles.filter(p => p.activo).length;

  main.innerHTML = `
  <header class="head"><h1>Configuración</h1></header>
  <div class="tabs" role="tablist" aria-label="Secciones">
    <button type="button" role="tab" data-tab="agencia" aria-selected="true">Agencia y usuarios</button>
    <button type="button" role="tab" data-tab="plantillas" aria-selected="false">Plantillas de mensajes</button>
    ${gestion ? '<button type="button" role="tab" data-tab="avisos" aria-selected="false">Avisos y tareas automáticas</button>' : ''}
    ${gestion ? '<button type="button" role="tab" data-tab="historial" aria-selected="false">Historial de cambios</button>' : ''}
    <button type="button" role="tab" data-tab="catalogos" aria-selected="false">Aseguradoras y productos</button>
    <button type="button" role="tab" data-tab="formatos" aria-selected="false">Formatos y cartas</button>
    <button type="button" role="tab" data-tab="condiciones" aria-selected="false">Condiciones generales</button>
  </div>
  <div id="panel"></div>`;

  const paneles = {
    agencia: () => `<section class="row">
      <div class="card" style="flex:1 1 380px">
        <h2 style="margin-bottom:14px">Marca de la agencia</h2>
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px">
          <div class="logo-box">${ctx.logoUrl ? `<img src="${esc(ctx.logoUrl)}" alt="Logo de ${esc(ag.nombre)}">` : `<span class="muted small">Sin logo</span>`}</div>
          <div><div style="font-weight:600">${esc(ag.nombre || '')}</div><div class="muted small">El logo aparece en el menú. Los colores se eligen abajo.</div></div>
        </div>
        ${admin ? `<div class="form-grid">
          ${input('Nombre de la agencia', 'agNombre', { value: ag.nombre, wide: true })}
          <div class="field"><label for="agLogo">Logo (PNG o JPG)</label><input id="agLogo" type="file" accept="image/png,image/jpeg,image/svg+xml"></div>
        </div>
        <div class="filters" style="margin-top:14px"><button type="button" class="btn primary" id="agGuardar">Guardar marca</button>
          ${ag.logo_ruta ? '<button type="button" class="btn" id="agQuitar">Quitar logo</button>' : ''}</div>`
        : '<p class="muted small">Solo un administrador puede cambiar la marca.</p>'}
      </div>
      ${tarjetaColores(admin)}
      ${tarjetaTC(admin)}
      <div class="card" style="flex:1 1 380px">
        <div class="card-head"><h2>Usuarios</h2>${admin ? '<button type="button" class="btn sm primary" id="invitar">+ Invitar usuario</button>' : ''}</div>
        <div class="list">${ctx.perfiles.map(p => `<div class="li"><div style="min-width:0"><div>${esc(p.nombre)} ${p.activo ? '' : '<span class="pill p-gray">Inactivo</span>'}</div>
          <div class="muted small">${esc(p.email || '')}</div></div>
          ${admin && p.id !== ctx.perfil.id ? `<div class="filters" style="gap:6px"><label class="sr" for="r${p.id}">Rol de ${esc(p.nombre)}</label>
            <select id="r${p.id}" data-rol="${p.id}" style="min-height:34px;width:auto;font-size:13px">${opts(ROLES, p.rol)}</select>
            <button type="button" class="btn sm" data-act="${p.id}">${p.activo ? 'Desactivar' : 'Activar'}</button></div>`
            : `<span class="pill ${p.rol === 'agente' ? 'p-gray' : 'p-blue'}">${ROLES[p.rol]}</span>`}</div>`).join('')}</div>
        <p class="muted small" style="margin-top:14px">${Object.entries(ROLES_DESC).map(([k, v]) => `<b>${ROLES[k]}:</b> ${v}.`).join(' ')}</p>
        <h3 style="margin:18px 0 8px;font-size:15px">Accesos al portal de clientes (${ctx.accesosPortal.length})</h3>
        ${ctx.accesosPortal.length ? `<div class="list">${ctx.accesosPortal.map(p => `<div class="li"><div style="min-width:0"><div><a href="#/cliente/${p.cliente_id}">${esc(p.nombre)}</a> ${p.activo ? '' : '<span class="pill p-gray">Sin acceso</span>'}</div>
          <div class="muted small">${esc(p.email || '')}</div></div>
          ${admin ? `<button type="button" class="btn sm" data-act="${p.id}">${p.activo ? 'Quitar acceso' : 'Reactivar'}</button>` : ''}</div>`).join('')}</div>`
          : '<p class="muted small">Ningún cliente tiene acceso todavía. Se da desde la ficha del cliente con "Dar acceso al portal". Los accesos de clientes no cuentan para el límite de usuarios del plan.</p>'}
      </div>
      <div class="card" style="flex:1 1 280px">
        <h2 style="margin-bottom:12px">Plan</h2>
        <div class="kpi"><div class="v" style="font-size:24px">${esc(PLANES[ag.plan] || ag.plan || '—')}</div>
          <div class="s">${activos} de ${ag.limite_usuarios ?? '—'} usuarios activos</div>
          <div class="meter"><div style="width:${Math.min(100, activos / (ag.limite_usuarios || 1) * 100)}%"></div></div>
          <div class="s" style="margin-top:8px">${ag.vigente_hasta ? 'Vigente hasta el ' + fdate(ag.vigente_hasta) : 'Sin fecha de vencimiento'}</div></div>
        <p class="muted small">Para cambiar de plan o agregar usuarios, contacte a su proveedor del sistema.</p>
      </div>
      <div class="card" style="flex:1 1 280px">
        <h2 style="margin-bottom:12px">Mi cuenta</h2>
        <p style="margin-top:0">${esc(ctx.perfil.nombre)}<br><span class="muted small">${ROLES[ctx.perfil.rol]} · ${esc(ctx.perfil.email || '')}</span></p>
        <button type="button" class="btn" id="pw">Cambiar contraseña</button>
      </div>
      ${sb.demo ? `<div class="card" style="flex:1 1 280px">
        <h2 style="margin-bottom:12px">Datos del prototipo</h2>
        <p class="muted" style="margin-top:0">Los datos son de ejemplo y se guardan solo en este navegador.</p>
        <button type="button" class="btn danger" id="reset">Restablecer datos de ejemplo</button>
      </div>` : ''}
    </section>`,

    plantillas: () => `<div class="card">
      <p class="muted" style="margin-top:0">Estos textos se usan en los botones Recordar, Avisar, Felicitar, Enviar póliza y Avisar al cliente. Las palabras entre llaves se llenan solas con los datos del cliente.</p>
      <p class="small" style="margin-top:0">Variables disponibles: <code>${esc(VARIABLES)}</code></p>
      <div class="list">${ctx.plantillas.map(p => `<div class="li" style="align-items:flex-start;border-top:1px solid var(--line);padding-top:12px">
        <div style="min-width:0"><b>${esc(p.nombre)}</b><div class="muted small" style="white-space:pre-line;margin-top:4px">${esc(llenarPlantilla(p.texto, { ...EJEMPLO, agencia: ag.nombre }))}</div></div>
        ${gestion ? `<button type="button" class="btn sm" data-pl="${p.id}">Editar</button>` : ''}</div>`).join('')}</div>
    </div>`,

    historial: () => `<div class="card">
      <div class="filters" style="margin-bottom:12px">
        <label for="hU" class="sr">Usuario</label><select id="hU" style="width:auto"><option value="">Todos los usuarios</option>${ctx.perfiles.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select>
        <label for="hT" class="sr">Sección</label><select id="hT" style="width:auto"><option value="">Todo</option>${opts(TABLAS)}</select>
        <label for="hB" class="sr">Buscar</label><input id="hB" type="search" class="search" placeholder="Buscar cliente, póliza o folio">
      </div>
      <div id="hLista"></div>
      <p class="muted small">Se muestran los últimos 300 cambios. Cada registro guarda quién hizo el cambio, cuándo y los valores anteriores.</p>
    </div>`,

    avisos: () => {
      const a = { activo: false, pago_dias: 5, pago_vencido: true, renovacion_dias: 30, cumpleanos: true, reporte_mensual: true, copia_a: '', ...(ag.avisos || {}) };
      const chk = (id, v, etq) => `<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="${id}"${v ? ' checked' : ''} style="width:auto;min-height:0"> ${etq}</label>`;
      const manana = new Date(); manana.setDate(manana.getDate() + 1);
      const ta = { renovacion: true, renovacion_dias: 30, cobranza: true, ...(ag.tareas_auto || {}) };
      const wa = ag.whatsapp || {};
      return `<section class="row">
      <div class="card" style="flex:1 1 380px">
        <h2 style="margin-bottom:6px">Envío diario de correos</h2>
        <p class="muted small" style="margin-top:0">Todos los días a las 8:00 a. m. se envían solos los correos a los clientes, con los textos de sus plantillas. Cada aviso se envía una sola vez.</p>
        <div class="col" style="gap:12px">
          ${chk('avActivo', a.activo, '<b>Enviar avisos automáticos</b>')}
          <div class="form-grid">
            ${input('Recordar pagos (días antes de la fecha límite)', 'avPagoDias', { type: 'number', value: a.pago_dias, attrs: 'min="0" max="30"' })}
            ${input('Avisar renovación (días antes del fin de vigencia)', 'avRenDias', { type: 'number', value: a.renovacion_dias, attrs: 'min="1" max="90"' })}
          </div>
          ${chk('avVencido', a.pago_vencido, 'Avisar al día siguiente de que un pago se venció')}
          ${chk('avCumple', a.cumpleanos, 'Felicitar a los clientes en su cumpleaños')}
          ${chk('avReembolso', a.reembolso_pagado !== false, 'Avisar al cliente cuando la aseguradora pague su reembolso')}
          ${chk('avEndoso', a.endoso_emitido !== false, 'Avisar al cliente cuando la aseguradora emita su endoso')}
          ${chk('avReporte', a.reporte_mensual, 'Enviar a los administradores un resumen del mes el día 1')}
          <div class="field"><label for="avCanal">Enviar por</label><select id="avCanal">${opts(CANALES, a.canal || 'correo')}</select>
            <div class="muted small" style="margin-top:4px">Si elige WhatsApp, configure la cuenta de WhatsApp Business abajo. Si el cliente no tiene teléfono, se le manda por correo.</div></div>
          <div class="form-grid">
            ${input('Correo remitente', 'avRem', { type: 'email', value: ag.correo_remitente, attrs: 'placeholder="avisos@suagencia.mx"' })}
            ${input('Enviarme copia del resumen diario a', 'avCopia', { type: 'email', value: a.copia_a })}
          </div>
          ${admin ? '<div><button type="button" class="btn primary" id="avGuardar">Guardar</button></div>' : '<p class="muted small" style="margin:0">Solo un administrador puede cambiar esta configuración.</p>'}
          ${sb.demo ? '<p class="small" style="color:var(--warn);margin:0">En el prototipo los correos no se envían; abajo puede ver cuáles saldrían.</p>' : ''}
        </div>
      </div>
      <div class="card" style="flex:1 1 380px">
        <h2 style="margin-bottom:6px">Tareas automáticas en el tablero</h2>
        <p class="muted small" style="margin-top:0">La app crea la tarea, la asigna al agente del cliente y la cierra sola cuando el pendiente se resuelve. Nunca repite una tarea que ya existió.</p>
        <div class="col" style="gap:12px">
          ${chk('taRen', ta.renovacion, '<b>Renovaciones:</b> crear la tarea cuando la póliza esté por vencer')}
          <div class="form-grid">${input('Con cuántos días de anticipación', 'taRenDias', { type: 'number', value: ta.renovacion_dias, attrs: 'min="7" max="90"' })}</div>
          ${chk('taCob', ta.cobranza, '<b>Cobranza:</b> crear la tarea el día después de que un recibo se vence')}
          <p class="muted small" style="margin:0">Se cierran solas al renovar la póliza (o marcar que no renueva) y al marcar el recibo como pagado.</p>
          ${admin ? '<div><button type="button" class="btn primary" id="taGuardar">Guardar</button></div>' : ''}
        </div>
      </div>
      <div class="card" style="flex:2 1 520px">
        <div class="card-head"><h2>Vista previa</h2>
          <div class="filters"><label for="avFecha" class="small">Avisos del día</label><input type="date" id="avFecha" value="${iso(manana)}" style="width:auto"></div></div>
        <div id="avPrev"><p class="muted">Cargando…</p></div>
      </div>
      <div class="card" style="flex:1 1 100%" id="waCard">
        <div class="card-head"><div><h2>WhatsApp Business</h2><p class="muted small" style="margin:4px 0 0">Los avisos salen del número de WhatsApp de la agencia, con plantillas aprobadas por Meta. Meta cobra cada conversación iniciada por la empresa; en México el costo es bajo.</p></div>
          <span class="pill ${wa.phone_number_id ? 'p-ok' : 'p-gray'}">${wa.phone_number_id ? 'Configurado' : 'Sin configurar'}</span></div>
        <details${wa.phone_number_id ? '' : ' open'}><summary class="small" style="cursor:pointer;font-weight:600">Cómo activarlo (una sola vez)</summary>
          <ol class="small" style="line-height:1.7;margin:8px 0 0;padding-left:20px">
            <li>En <b>business.facebook.com</b> cree la cuenta de WhatsApp Business de la agencia y agregue el número (no puede estar usándose en la app de WhatsApp normal).</li>
            <li>En <b>Plantillas de mensajes</b> registre cada plantilla con el texto de abajo (categoría <i>Utilidad</i>; la de cumpleaños, <i>Marketing</i>). Meta las aprueba en minutos u horas.</li>
            <li>Copie el <b>Identificador del número</b> (Phone number ID) y péguelo aquí.</li>
            <li>Genere un <b>token permanente</b> y guárdelo en Supabase como secreto <code>WHATSAPP_TOKEN</code> (no se guarda en la app por seguridad).</li>
          </ol></details>
        <div class="form-grid" style="margin-top:12px">
          ${input('Identificador del número (Phone number ID)', 'waId', { value: wa.phone_number_id || '' })}
          ${input('Idioma de las plantillas', 'waIdioma', { value: wa.idioma || 'es_MX' })}
        </div>
        <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Aviso</th><th>Nombre de la plantilla en Meta</th><th>Texto para registrarla</th></tr></thead><tbody>
          ${Object.keys(VARS_WA).map(k => { const pl = ctx.plantillas.find(p => p.clave === k); return `<tr><td class="nw">${esc(pl?.nombre || k)}</td>
            <td><label class="sr" for="wa-${k}">Plantilla de ${esc(pl?.nombre || k)}</label><input id="wa-${k}" data-wa="${k}" value="${esc(wa.plantillas?.[k] || k)}" style="min-height:36px"></td>
            <td class="small"><div class="wa-txt">${esc(textoParaMeta(k, pl?.texto).replace('{agencia}', ag.nombre))}</div><button type="button" class="linkbtn small" data-wacopy="${k}">Copiar</button></td></tr>`; }).join('')}
        </tbody></table></div>
        ${admin ? '<div style="margin-top:12px"><button type="button" class="btn primary" id="waGuardar">Guardar WhatsApp</button></div>' : ''}
      </div>
      <div class="card" style="flex:1 1 100%"><h2 style="margin-bottom:10px">Últimos envíos</h2><div id="avHist"><p class="muted">Cargando…</p></div></div>
    </section>`;
    },

    condiciones: () => tablaCondiciones(condiciones, gestion),
    formatos: () => `<p class="muted" style="margin-top:0">Aquí van los formatos y cartas que se llenan solos con los datos del cliente y la póliza. Hay dos tipos:</p>
      <ul class="muted small" style="margin-top:0"><li><b>Formato PDF de la aseguradora:</b> el PDF tal cual; se indica qué dato va en cada campo.</li>
        <li><b>Carta libre:</b> un texto con datos entre llaves, como {contratante_nombre}; la app lo pasa a PDF con el nombre de la agencia y espacio para firmas.</li></ul>
      <p class="muted small">Cada uno se usa en las carpetas de siniestro (reclamación, informe médico…) o en las pólizas y endosos (cancelación, baja de asegurado, cambio de vehículo…). Aparecen en el botón «Cartas y formatos» de cada póliza y en «Generar» de cada endoso.</p>
      ${gestion ? '<div class="filters" style="margin-bottom:16px"><button type="button" class="btn primary" id="nForm">+ Subir formato PDF</button><button type="button" class="btn" id="nCarta">+ Nueva carta libre</button></div>' : ''}
      <div class="card" style="padding:8px 12px">${formatos.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Formato</th><th>Aseguradora</th><th>Se usa en</th><th>Tipo</th><th></th></tr></thead>
        <tbody>${[...formatos].sort((a, b) => (a.ambito || '').localeCompare(b.ambito || '') || a.nombre.localeCompare(b.nombre, 'es')).map(f => {
          const n = f.modo === 'campos' ? Object.values(f.mapeo || {}).filter(Boolean).length : (f.mapeo || []).length;
          return `<tr${f.activo ? '' : ' style="opacity:.6"'}><td><b>${esc(f.nombre)}</b>${f.activo ? '' : ' <span class="pill p-gray">Inactivo</span>'}</td>
          <td>${f.aseguradora_id ? esc(ctx.aseguradoras.find(a => a.id === f.aseguradora_id)?.nombre || '') : 'Todas'}</td>
          <td>${f.ambito === 'poliza' ? `<span class="muted small">Pólizas:</span> ${(f.usos || []).map(t => `<span class="tag">${esc(USOS_POLIZA[t] || t)}</span>`).join(' ')}${(f.ramos || []).length ? ` <span class="muted small">· ${f.ramos.map(r => esc(RAMOS[r])).join(', ')}</span>` : ''}`
            : `<span class="muted small">Siniestros:</span> ${(f.tipos_tramite || []).map(t => `<span class="tag">${esc(TIPOS_CARPETA[t] || t)}</span>`).join(' ')}`}</td>
          <td>${f.modo === 'texto' ? 'Carta libre' : f.modo === 'campos' ? `PDF · ${n} campos ligados` : `<span class="pill p-warn">PDF sin campos llenables</span>`}</td>
          <td class="nw"><button type="button" class="linkbtn small" data-fprobar="${f.id}">Probar</button>${gestion ? ` · <button type="button" class="linkbtn small" data-fedit="${f.id}">Editar</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">Aún no hay formatos.</div>'}</div>
      <p class="muted small">Funciona con PDF que tienen campos para llenar (los que se pueden escribir en Adobe Reader). Si un formato es un PDF plano o escaneado, envíelo a soporte para configurarlo por posición.</p>`,

    catalogos: () => `<p class="muted" style="margin-top:0">Los plazos de pago se usan para calcular la fecha límite de cada recibo: el primer recibo con el plazo de primer pago y los siguientes con el de pagos subsecuentes. Si un producto no tiene plazos propios, usa los de su aseguradora.</p>
      ${gestion ? '<div class="filters" style="margin-bottom:16px"><button type="button" class="btn primary" id="nAseg">+ Agregar aseguradora</button></div>' : ''}
      <section class="row">${ctx.aseguradoras.map(a => {
        const prods = ctx.productos.filter(x => x.aseguradora_id === a.id).sort((x, y) => (RAMOS[x.ramo] + x.nombre).localeCompare(RAMOS[y.ramo] + y.nombre));
        const dias = (v, def) => v != null ? `${v} días` : `<span class="muted">${def} días*</span>`;
        return `<div class="card" style="flex:1 1 600px">
          <div class="card-head"><div><h2>${esc(a.nombre)} ${a.activa ? '' : '<span class="pill p-gray">Inactiva</span>'}</h2>
            <div class="muted small" style="margin-top:4px">Primer pago: <b>${a.dias_primer_pago ?? 30} días</b> · Pagos subsecuentes: <b>${a.dias_pago_subsecuente ?? 30} días</b></div></div>
            ${gestion ? `<div class="filters" style="gap:6px"><button type="button" class="btn sm" data-aedit="${a.id}">Editar</button><button type="button" class="btn sm primary" data-pnew="${a.id}">+ Producto</button></div>` : ''}</div>
          ${prods.length ? `<div class="tbl-wrap"><table><thead><tr><th>Producto</th><th>Ramo</th><th>1er pago</th><th>Siguientes</th><th class="num">Comisión</th><th></th></tr></thead>
            <tbody>${prods.map(x => `<tr${x.activo ? '' : ' style="opacity:.6"'}><td>${esc(x.nombre)}${x.activo ? '' : ' <span class="pill p-gray">Inactivo</span>'}</td><td>${esc(RAMOS[x.ramo])}</td>
              <td class="nw">${dias(x.dias_primer_pago, a.dias_primer_pago ?? 30)}</td><td class="nw">${dias(x.dias_pago_subsecuente, a.dias_pago_subsecuente ?? 30)}</td>
              <td class="num">${x.pct_comision != null ? Number(x.pct_comision) + '%' : '—'}</td>
              <td class="nw">${gestion ? `<button type="button" class="linkbtn small" data-pedit="${x.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small" style="margin-bottom:0">* Sin plazo propio: usa el de la aseguradora.</p>`
            : '<div class="empty">Sin productos registrados.</div>'}
        </div>`;
      }).join('')}</section>`,
  };

  const panel = main.querySelector('#panel');
  const mostrar = t => {
    main.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
    panel.innerHTML = paneles[t]();
    if (t === 'historial') pintarHistorial();
    if (t === 'avisos') pintarAvisos();
    aplicarMarca();   // descarta una vista previa sin guardar al cambiar de pestaña
    if (t === 'agencia') { iniciarColores(panel, admin); iniciarTC(panel); }
  };
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => mostrar(b.dataset.tab));
  mostrar(sessionStorageGet() || 'agencia');

  async function pintarAvisos() {
    const TIPO = { recordatorio_pago: 'Recordatorio de pago', pago_vencido: 'Pago vencido', aviso_renovacion: 'Aviso de renovación', felicitacion: 'Cumpleaños', reembolso_pagado: 'Reembolso pagado', endoso_emitido: 'Endoso emitido' };
    const prev = panel.querySelector('#avPrev'), hist = panel.querySelector('#avHist');
    const cargar = async () => {
      try {
        const lista = await q(sb.rpc('avisos_del_dia', { p_fecha: panel.querySelector('#avFecha').value }));
        const cfgA = ag.avisos || {}, waA = ag.whatsapp || {};
        const can = x => { const c = canalesDe(cfgA, x, waA); return c.length ? c : (x.email ? ['correo'] : []); };
        const nC = lista.filter(x => can(x).includes('correo')).length, nW = lista.filter(x => can(x).includes('whatsapp')).length, sin = lista.filter(x => !can(x).length).length;
        prev.innerHTML = lista.length ? `<p class="small muted" style="margin-top:0">${[nC ? `${nC} por correo` : '', nW ? `${nW} por WhatsApp` : '', sin ? `${sin} sin correo ni teléfono` : ''].filter(Boolean).join(' · ')}.</p>
          <div class="list">${lista.map(x => {
            const pl = ctx.plantillas.find(p => p.clave === x.tipo) || {};
            return `<details style="border-top:1px solid var(--line);padding-top:10px"><summary style="cursor:pointer;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <span><span class="tag">${esc(TIPO[x.tipo] || x.tipo)}</span> ${esc(x.cliente_nombre)}</span>
              <span class="small">${can(x).map(c => `<span class="canal c-${c}">${c === 'correo' ? 'Correo' : 'WhatsApp'}</span>`).join(' ') || '<span style="color:var(--warn)">Sin correo ni teléfono</span>'}</span></summary>
              <div class="feed" style="margin-top:8px"><div class="msg"><div class="small"><b>${esc(llenarPlantilla(pl.asunto || '', x.datos))}</b></div>
              <div style="white-space:pre-line;margin-top:4px">${esc(llenarPlantilla(pl.texto || '', x.datos))}</div></div></div></details>`;
          }).join('')}</div>` : '<div class="empty">No hay avisos para ese día.</div>';
      } catch (e) { prev.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    panel.querySelector('#avFecha').onchange = cargar;
    cargar();
    try {
      const env = await q(sb.from('avisos_enviados').select('*').order('creado_en', { ascending: false }).limit(50));
      hist.innerHTML = env.length ? `<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Aviso</th><th>Para</th><th>Resultado</th></tr></thead>
        <tbody>${env.map(e => `<tr><td class="nw">${fdate(e.fecha)}</td><td>${esc(TIPO[e.tipo] || e.tipo)}</td><td>${esc(e.destinatario || '')}</td>
          <td>${e.estatus === 'enviado' ? '<span class="pill p-ok">Enviado</span>' : `<span class="pill p-bad" title="${esc(e.detalle || '')}">Error</span>`}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Todavía no se ha enviado ningún aviso.</div>';
    } catch (e) { hist.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }

  function pintarHistorial() {
    const u = panel.querySelector('#hU').value, t = panel.querySelector('#hT').value, b = panel.querySelector('#hB').value.trim().toLowerCase();
    const lista = bitacora.filter(x => (!u || x.usuario_id === u) && (!t || x.tabla === t) && (!b || String(x.etiqueta || '').toLowerCase().includes(b)));
    const quien = Object.fromEntries(ctx.perfiles.map(p => [p.id, p.nombre]));
    panel.querySelector('#hLista').innerHTML = lista.length ? `<div class="list">${lista.map(x => `<div style="border-top:1px solid var(--line);padding-top:10px">
      <div class="muted small">${new Date(x.creado_en).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</div>
      <div><b>${esc(quien[x.usuario_id] || 'Sistema')}</b> ${ACCION[x.accion]} ${TABLAS_UNO[x.tabla] || x.tabla} <b>${esc(x.etiqueta || '')}</b></div>
      ${x.accion === 'UPDATE' ? `<div class="small" style="margin-top:4px">${describirCambios(x.cambios)}</div>` : ''}</div>`).join('')}</div>`
      : '<div class="empty">No hay cambios con esos filtros. Los cambios se registran a partir de ahora.</div>';
  }

  // Eventos
  panel.addEventListener('input', e => { if (['hU', 'hT', 'hB'].includes(e.target.id)) pintarHistorial(); });
  panel.addEventListener('change', async e => {
    if (['hU', 'hT'].includes(e.target.id)) return pintarHistorial();
    const id = e.target.dataset.rol; if (!id) return;
    try { await q(sb.from('perfiles').update({ rol: e.target.value }).eq('id', id)); await recargarCatalogos(); toast('Rol actualizado.'); } catch (err) { toast(err.message, true); }
  });
  panel.addEventListener('click', async e => {
    const el = e.target, d = el.dataset;
    if (el.id === 'nCG' || d.cgficha || d.cgrehacer || d.cgact || d.cgpdf) { try { await accionCondiciones(el, condiciones, () => { recordar('condiciones'); refrescar(); }); } catch (err) { toast(err.message, true); } return; }
    try {
      if (el.id === 'agGuardar') {
        const cambios = { nombre: panel.querySelector('[name=agNombre]').value.trim() || ag.nombre };
        const f = panel.querySelector('#agLogo').files[0];
        if (f) { if (f.size > 1024 * 1024) throw new Error('El logo debe pesar menos de 1 MB.'); cambios.logo_ruta = await subirArchivo(f, 'marca'); }
        await q(sb.from('agencias').update(cambios).eq('id', ag.id));
        await recargarCatalogos(); aplicarMarca(); recordar('agencia'); await recargarApp(); toast('Marca actualizada.');
      }
      if (el.id === 'agQuitar') { await q(sb.from('agencias').update({ logo_ruta: null }).eq('id', ag.id)); await recargarCatalogos(); recordar('agencia'); await recargarApp(); }
      if (el.id === 'invitar') invitar();
      if (d.act) {
        const p = ctx.perfiles.find(x => x.id === d.act) || ctx.accesosPortal.find(x => x.id === d.act);
        await q(sb.from('perfiles').update({ activo: !p.activo }).eq('id', p.id)); await recargarCatalogos(); recordar('agencia'); refrescar();
      }
      if (el.id === 'pw') cambiarPw();
      if (el.id === 'reset') {
        if (!(await confirmar('Restablecer datos', 'Se borrarán los cambios que hizo en el prototipo y se cargarán de nuevo los datos de ejemplo.', 'Restablecer'))) return;
        sb.demo.restablecer(); history.replaceState(null, '', '#/inicio'); await recargarApp(); toast('Datos de ejemplo restablecidos.');
      }
      if (d.pl) editarPlantilla(ctx.plantillas.find(p => p.id === d.pl));
      if (el.id === 'avGuardar') {
        const v = id => panel.querySelector('#' + id), n = (id, def) => { const x = Number(panel.querySelector(`[name=${id}]`).value); return isNaN(x) ? def : x; };
        const avisos = { ...(ag.avisos || {}), activo: v('avActivo').checked, pago_dias: n('avPagoDias', 5), renovacion_dias: n('avRenDias', 30), pago_vencido: v('avVencido').checked,
          cumpleanos: v('avCumple').checked, reembolso_pagado: v('avReembolso').checked, endoso_emitido: v('avEndoso').checked, canal: v('avCanal').value, reporte_mensual: v('avReporte').checked, copia_a: panel.querySelector('[name=avCopia]').value.trim() };
        await q(sb.from('agencias').update({ avisos, correo_remitente: panel.querySelector('[name=avRem]').value.trim() || null }).eq('id', ag.id));
        await recargarCatalogos(); recordar('avisos'); toast(avisos.activo ? 'Avisos automáticos activados.' : 'Configuración guardada (avisos desactivados).'); refrescar();
      }
      if (el.id === 'waGuardar') {
        const plantillas = {}; panel.querySelectorAll('[data-wa]').forEach(i => { plantillas[i.dataset.wa] = i.value.trim() || i.dataset.wa; });
        const whatsapp = { phone_number_id: panel.querySelector('[name=waId]').value.trim() || null, idioma: panel.querySelector('[name=waIdioma]').value.trim() || 'es_MX', plantillas };
        await q(sb.from('agencias').update({ whatsapp }).eq('id', ag.id)); await recargarCatalogos(); recordar('avisos'); toast('Configuración de WhatsApp guardada.'); refrescar();
      }
      if (d.wacopy) {
        const t = el.parentElement.querySelector('.wa-txt').textContent;
        try { await navigator.clipboard.writeText(t); toast('Texto copiado.'); } catch { toast('No se pudo copiar; selecciónelo a mano.', true); }
      }
      if (el.id === 'taGuardar') {
        const dias = Math.min(90, Math.max(7, Number(panel.querySelector('[name=taRenDias]').value) || 30));
        const tareas_auto = { renovacion: panel.querySelector('#taRen').checked, renovacion_dias: dias, cobranza: panel.querySelector('#taCob').checked };
        await q(sb.from('agencias').update({ tareas_auto }).eq('id', ag.id));
        await recargarCatalogos();
        const { data: n } = await sb.rpc('crear_tareas_automaticas');
        recordar('avisos'); toast(n ? `Guardado. Se crearon ${n} tareas nuevas en el tablero.` : 'Guardado.'); refrescar();
      }
      if (el.id === 'nCarta' || (d.fedit && formatos.find(f => f.id === d.fedit)?.modo === 'texto')) formCarta(formatos.find(f => f.id === d.fedit));
      else if (el.id === 'nForm' || d.fedit) formFormato(formatos.find(f => f.id === d.fedit));
      if (d.fprobar) {
        const f = formatos.find(x => x.id === d.fprobar);
        const bytes = f.modo === 'texto' ? await pdfCartaLibre(f.texto, DATOS_EJEMPLO) : await llenarFormato(f, DATOS_EJEMPLO);
        await descargar(`Prueba - ${f.nombre}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
      }
      if (el.id === 'nAseg' || d.aedit) formAseguradora(ctx.aseguradoras.find(a => a.id === d.aedit));
      if (d.pnew || d.pedit) formProducto(ctx.productos.find(x => x.id === d.pedit), d.pnew);
    } catch (err) { toast(err.message, true); }
  });

  function formAseguradora(a) {
    modal({
      titulo: a ? 'Editar aseguradora' : 'Nueva aseguradora',
      cuerpo: `<div class="form-grid">${input('Nombre', 'nombre', { value: a?.nombre, req: true, wide: true })}
        ${input('Días para pagar el primer recibo', 'd1', { type: 'number', value: a?.dias_primer_pago ?? 30, req: true, attrs: 'min="0"' })}
        ${input('Días para pagar los recibos siguientes', 'd2', { type: 'number', value: a?.dias_pago_subsecuente ?? 30, req: true, attrs: 'min="0"' })}
        ${a ? select('Estatus', 'activa', opts({ si: 'Activa', no: 'Inactiva (no aparece al capturar pólizas)' }, a.activa ? 'si' : 'no'), { wide: true }) : ''}</div>`,
      onSubmit: async x => {
        const fila = { nombre: x.nombre.trim(), dias_primer_pago: Number(x.d1), dias_pago_subsecuente: Number(x.d2) };
        if (a) fila.activa = x.activa === 'si';
        if (a) await q(sb.from('aseguradoras').update(fila).eq('id', a.id)); else await q(sb.from('aseguradoras').insert(fila));
        await recargarCatalogos(); recordar('catalogos'); toast(a ? 'Aseguradora actualizada. Aplica a las pólizas nuevas.' : 'Aseguradora agregada.'); refrescar();
      }
    });
  }
  function formProducto(x, asegId) {
    const a = ctx.aseguradoras.find(y => y.id === (x?.aseguradora_id || asegId));
    modal({
      titulo: (x ? 'Editar producto' : 'Nuevo producto') + ' · ' + a.nombre,
      cuerpo: `<div class="form-grid">
        ${input('Nombre del producto / plan', 'nombre', { value: x?.nombre, req: true, wide: true })}
        ${select('Ramo', 'ramo', opts(RAMOS, x?.ramo || 'gmm'), { req: true })}
        ${input('% de comisión', 'pct', { type: 'number', value: x?.pct_comision ?? '', attrs: 'step="0.01" min="0" max="100"' })}
        ${input('Días para pagar el primer recibo', 'd1', { type: 'number', value: x?.dias_primer_pago ?? '', attrs: `min="0" placeholder="${a.dias_primer_pago ?? 30} (de la aseguradora)"` })}
        ${input('Días para pagar los recibos siguientes', 'd2', { type: 'number', value: x?.dias_pago_subsecuente ?? '', attrs: `min="0" placeholder="${a.dias_pago_subsecuente ?? 30} (de la aseguradora)"` })}
        ${x ? select('Estatus', 'activo', opts({ si: 'Activo', no: 'Inactivo (ya no se vende)' }, x.activo ? 'si' : 'no')) : ''}
      </div><p class="muted small">Deje vacíos los días para usar los de ${esc(a.nombre)}. Los cambios aplican a las pólizas nuevas.</p>`,
      onSubmit: async v => {
        const fila = { nombre: v.nombre.trim(), ramo: v.ramo, pct_comision: v.pct === '' ? null : Number(v.pct),
          dias_primer_pago: v.d1 === '' ? null : Number(v.d1), dias_pago_subsecuente: v.d2 === '' ? null : Number(v.d2) };
        if (x) { fila.activo = v.activo === 'si'; await q(sb.from('productos').update(fila).eq('id', x.id)); }
        else await q(sb.from('productos').insert({ ...fila, aseguradora_id: a.id }));
        await recargarCatalogos(); recordar('catalogos'); toast(x ? 'Producto actualizado.' : 'Producto agregado.'); refrescar();
      }
    });
  }
  async function formFormato(f) {
    let bytes = null, archivo = null, campos = [];
    if (f) { try { bytes = await leerBytes(f.archivo_ruta); campos = await camposDePdf(bytes); } catch (e) { toast(e.message, true); } }
    const tabla = (mapeo = {}) => campos.length ? `<div class="tbl-wrap" style="max-height:340px;overflow:auto"><table>
        <thead><tr><th>Campo del PDF</th><th>Se llena con</th></tr></thead>
        <tbody>${campos.map((c, i) => `<tr><td>${esc(c.nombre)}${c.tipo === 'casilla' ? ' <span class="muted small">(casilla)</span>' : ''}</td><td><label class="sr" for="mp${i}">Dato para ${esc(c.nombre)}</label>
          <select id="mp${i}" data-campo="${esc(c.nombre)}" style="min-height:34px;font-size:13px"><option value="">— Dejar vacío —</option>
          ${VARS_PDF.map(([k, l]) => `<option value="${k}"${(f ? mapeo[c.nombre] : sugerirVariable(c.nombre)) === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
        <p class="muted small">Revisé los nombres de los campos y sugerí el dato de cada uno; corrija los que no coincidan.</p>`
      : (bytes ? '<p class="small" style="color:var(--warn)">Este PDF no tiene campos llenables. Se guardará, pero para llenarlo solo hay que configurarlo por posición (envíelo a soporte).</p>' : '');
    const tiposSel = f?.tipos_tramite || ['reembolso'];
    const ambito0 = f?.ambito || 'tramite';
    const dlg = modal({
      titulo: f ? 'Editar formato' : 'Subir formato',
      cuerpo: `<div class="form-grid">
        ${input('Nombre del formato', 'nombre', { value: f?.nombre, req: true, wide: true, attrs: 'placeholder="Ej. Formato de reclamación de gastos médicos"' })}
        ${select('Aseguradora', 'aseguradora_id', '<option value="">Todas</option>' + ctx.aseguradoras.map(a => `<option value="${a.id}"${a.id === f?.aseguradora_id ? ' selected' : ''}>${esc(a.nombre)}</option>`).join(''))}
        ${f ? select('Estatus', 'activo', opts({ si: 'Activo', no: 'Inactivo' }, f.activo ? 'si' : 'no')) : '<div class="field"><label for="ffile">Archivo PDF *</label><input id="ffile" type="file" accept="application/pdf,.pdf"></div>'}
        ${select('Se usa en', 'ambito', opts({ tramite: 'Carpetas de siniestro y reembolso', poliza: 'Pólizas y endosos' }, ambito0), { wide: true })}
        <fieldset class="wide" id="fsTramite" style="border:1px solid var(--border);border-radius:8px;padding:10px 12px"${ambito0 === 'poliza' ? ' hidden' : ''}><legend class="small muted">Se usa en carpetas de</legend>
          <div class="chips">${Object.entries(TIPOS_CARPETA).map(([k, v]) => `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="t_${k}"${tiposSel.includes(k) ? ' checked' : ''} style="width:auto;min-height:0"> ${esc(v)}</label>`).join('')}</div></fieldset>
        ${usosPoliza(f, ambito0 !== 'poliza')}
      </div>
      <div id="fMap" style="margin-top:16px">${tabla(f?.mapeo)}</div>`,
      onOpen: form => {
        form.ambito.onchange = () => { form.querySelector('#fsTramite').hidden = form.ambito.value === 'poliza'; form.querySelector('#fsPoliza').hidden = form.ambito.value !== 'poliza'; };
        const inp = form.querySelector('#ffile');
        if (inp) inp.onchange = async () => {
          const box = form.querySelector('#fMap'); archivo = inp.files[0]; if (!archivo) return;
          box.innerHTML = '<p class="muted">Leyendo los campos del PDF…</p>';
          try { bytes = new Uint8Array(await archivo.arrayBuffer()); campos = await camposDePdf(bytes); box.innerHTML = tabla(); if (!form.nombre.value) form.nombre.value = archivo.name.replace(/\.pdf$/i, ''); }
          catch (e) { box.innerHTML = `<p class="error">No se pudo leer el PDF: ${esc(e.message)}</p>`; bytes = null; }
        };
      },
      onSubmit: async (x, form) => {
        const tipos = x.ambito === 'poliza' ? [] : Object.keys(TIPOS_CARPETA).filter(k => x['t_' + k]);
        if (x.ambito !== 'poliza' && !tipos.length) throw new Error('Elija al menos un tipo de carpeta.');
        const usos = Object.keys(USOS_POLIZA).filter(k => x['u_' + k]), ramos = Object.keys(RAMOS).filter(k => x['r_' + k]);
        if (x.ambito === 'poliza' && !usos.length) throw new Error('Elija para qué sirve (cancelación, baja de asegurado…).');
        if (!f && !bytes) throw new Error('Seleccione el archivo PDF del formato.');
        const mapeo = {}; form.querySelectorAll('[data-campo]').forEach(sl => { if (sl.value) mapeo[sl.dataset.campo] = sl.value; });
        const fila = { nombre: x.nombre.trim(), aseguradora_id: x.aseguradora_id || null, tipos_tramite: tipos, ambito: x.ambito, usos: x.ambito === 'poliza' ? usos : [], ramos: x.ambito === 'poliza' ? ramos : [], modo: campos.length ? 'campos' : 'coordenadas', mapeo: campos.length ? mapeo : (f?.mapeo || []) };
        if (f) { fila.activo = x.activo === 'si'; await q(sb.from('formatos').update(fila).eq('id', f.id)); }
        else { fila.archivo_ruta = await subirArchivo(archivo, 'formatos'); await q(sb.from('formatos').insert(fila)); }
        recordar('formatos'); toast(f ? 'Formato actualizado.' : x.ambito === 'poliza' ? 'Formato guardado. Ya aparece en «Cartas y formatos» de las pólizas.' : 'Formato guardado. Ya aparece en las carpetas de siniestro.'); refrescar();
      }
    });
    return dlg;
  }
  // Para qué sirve un formato de póliza y en qué ramos
  function usosPoliza(f, oculto) {
    const u = f?.usos || [], r = f?.ramos || [];
    const caja = (n, k, v, on) => `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="${n}_${k}"${on ? ' checked' : ''} style="width:auto;min-height:0"> ${esc(v)}</label>`;
    return `<fieldset class="wide" id="fsPoliza" style="border:1px solid var(--border);border-radius:8px;padding:10px 12px"${oculto ? ' hidden' : ''}><legend class="small muted">Sirve para</legend>
        <div class="chips">${Object.entries(USOS_POLIZA).map(([k, v]) => caja('u', k, v, u.includes(k))).join('')}</div>
        <div class="small muted" style="margin:12px 0 6px">Solo en estos ramos (si no marca ninguno, en todos)</div>
        <div class="chips">${Object.entries(RAMOS).map(([k, v]) => caja('r', k, v, r.includes(k))).join('')}</div></fieldset>`;
  }
  // Carta libre: texto con datos entre llaves
  function formCarta(f) {
    const dlg = modal({
      titulo: f ? 'Editar carta libre' : 'Nueva carta libre',
      cuerpo: `<div class="form-grid">
        ${input('Nombre de la carta', 'nombre', { value: f?.nombre, req: true, wide: true, attrs: 'placeholder="Ej. Carta de cancelación de póliza de auto"' })}
        ${select('Aseguradora', 'aseguradora_id', '<option value="">Todas</option>' + ctx.aseguradoras.map(a => `<option value="${a.id}"${a.id === f?.aseguradora_id ? ' selected' : ''}>${esc(a.nombre)}</option>`).join(''))}
        ${f ? select('Estatus', 'activo', opts({ si: 'Activa', no: 'Inactiva' }, f.activo ? 'si' : 'no')) : ''}
        ${usosPoliza(f, false)}
        <div class="field wide"><label for="ctTexto">Texto de la carta *</label><textarea id="ctTexto" name="texto" style="min-height:260px;font-size:13px">${esc(f?.texto || CARTA_EJEMPLO)}</textarea>
          <div class="muted small" style="margin-top:4px">La fecha y el lugar van arriba, y «Atentamente» con las firmas del contratante y del agente se agregan al final automáticamente.</div></div>
        <details class="wide"><summary class="small" style="cursor:pointer">Datos que puede usar (clic para insertarlo donde está el cursor)</summary>
          <div class="chips" style="margin-top:8px">${VARS_PDF.filter(([k]) => !/^(siniestro|tramite|facturas)/.test(k)).map(([k, l]) => `<button type="button" class="chip" data-var="${k}" title="${esc(l)}">${esc(l)}</button>`).join('')}</div></details>
      </div>`,
      onOpen: form => {
        const tx = form.querySelector('#ctTexto'); let pos = tx.value.length;
        tx.addEventListener('blur', () => { pos = tx.selectionStart; });
        form.querySelectorAll('[data-var]').forEach(b => b.onclick = () => { const t = `{${b.dataset.var}}`; tx.value = tx.value.slice(0, pos) + t + tx.value.slice(pos); pos += t.length; tx.focus(); tx.setSelectionRange(pos, pos); });
      },
      onSubmit: async x => {
        const usos = Object.keys(USOS_POLIZA).filter(k => x['u_' + k]), ramos = Object.keys(RAMOS).filter(k => x['r_' + k]);
        if (!usos.length) throw new Error('Elija para qué sirve la carta (cancelación, baja de asegurado…).');
        if (!String(x.texto || '').trim()) throw new Error('Escriba el texto de la carta.');
        const desconocidas = [...String(x.texto).matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => !VARS_PDF.some(([v]) => v === k));
        if (desconocidas.length) throw new Error(`Estos datos no existen: ${[...new Set(desconocidas)].map(k => '{' + k + '}').join(', ')}. Use la lista de datos disponibles.`);
        const fila = { nombre: x.nombre.trim(), aseguradora_id: x.aseguradora_id || null, ambito: 'poliza', usos, ramos, modo: 'texto', texto: x.texto, tipos_tramite: [], mapeo: {}, archivo_ruta: null };
        if (f) { fila.activo = x.activo === 'si'; await q(sb.from('formatos').update(fila).eq('id', f.id)); }
        else await q(sb.from('formatos').insert(fila));
        recordar('formatos'); toast(f ? 'Carta actualizada.' : 'Carta guardada. Ya aparece en «Cartas y formatos» de las pólizas.'); refrescar();
      }
    });
    return dlg;
  }
  function invitar() {
    modal({
      titulo: 'Invitar usuario', boton: 'Enviar invitación',
      cuerpo: `<p class="muted" style="margin-top:0">La persona recibirá un correo para crear su contraseña y entrar al sistema.</p><div class="form-grid">
        ${input('Nombre', 'nombre', { req: true })}${input('Correo', 'email', { type: 'email', req: true })}
        ${select('Rol', 'rol', opts(ROLES, 'agente'))}</div>`,
      onSubmit: async x => {
        const { error } = await sb.functions.invoke('invitar-usuario', { body: { nombre: x.nombre.trim(), email: x.email.trim().toLowerCase(), rol: x.rol } });
        if (error) { const det = await error.context?.json?.().catch(() => null); throw new Error(det?.error || error.message || 'No se pudo enviar la invitación.'); }
        await recargarCatalogos(); recordar('agencia'); toast(sb.demo ? 'Usuario agregado (en el prototipo no se envía correo).' : 'Invitación enviada.'); refrescar();
      }
    });
  }
  function editarPlantilla(p) {
    modal({
      titulo: 'Editar plantilla: ' + p.nombre,
      cuerpo: `<div class="form-grid">${input('Asunto (para correo)', 'asunto', { value: p.asunto, wide: true })}
        <div class="field wide"><label for="plTx">Texto</label><textarea id="plTx" name="texto" style="min-height:140px">${esc(p.texto)}</textarea></div></div>
        <p class="small muted">Variables: <code>${esc(VARIABLES)}</code></p>
        <div class="field"><label>Vista previa</label><div id="plPrev" class="card" style="white-space:pre-line;padding:12px"></div></div>`,
      onOpen: f => { const tx = f.querySelector('#plTx'), pv = f.querySelector('#plPrev'); const r = () => { pv.textContent = llenarPlantilla(tx.value, { ...EJEMPLO, agencia: ag.nombre }); }; tx.oninput = r; r(); },
      onSubmit: async x => {
        if (!x.texto.trim()) throw new Error('El texto no puede quedar vacío.');
        await q(sb.from('plantillas').update({ asunto: x.asunto.trim(), texto: x.texto.trim() }).eq('id', p.id));
        await recargarCatalogos(); recordar('plantillas'); toast('Plantilla guardada.'); refrescar();
      }
    });
  }
  function cambiarPw() {
    modal({
      titulo: 'Cambiar contraseña', boton: 'Guardar',
      cuerpo: input('Nueva contraseña (mínimo 8 caracteres)', 'pw', { type: 'password', req: true }),
      onSubmit: async x => {
        if (x.pw.length < 8) throw new Error('Debe tener al menos 8 caracteres.');
        const { error } = await sb.auth.updateUser({ password: x.pw }); if (error) throw error;
        toast('Contraseña actualizada.');
      }
    });
  }
}

// Recordar la pestaña al volver a pintar
let pestana = null;
const recordar = t => { pestana = t; };
const sessionStorageGet = () => { const t = pestana; pestana = null; return t; };

const TABLAS = { productos: 'Productos', clientes: 'Clientes', polizas: 'Pólizas', recibos: 'Recibos', documentos: 'Documentos', tramites: 'Trámites', movimientos: 'Endosos', prospectos: 'Prospectos' };
const TABLAS_UNO = { productos: 'el producto', clientes: 'el cliente', polizas: 'la póliza', recibos: 'un recibo de', documentos: 'el documento', tramites: 'el trámite', movimientos: 'el endoso', prospectos: 'el prospecto' };
const ACCION = { INSERT: 'registró', UPDATE: 'modificó', DELETE: 'borró' };
const CAMPOS = {
  nombre: 'Nombre', rfc: 'RFC', telefono: 'Teléfono', whatsapp: 'WhatsApp', email: 'Correo', fecha_nacimiento: 'Nacimiento', agente_id: 'Agente', activo: 'Activo',
  numero_poliza: 'Número de póliza', inicio_vigencia: 'Inicio', fin_vigencia: 'Fin', forma_pago: 'Forma de pago', prima_neta: 'Prima neta', prima_total: 'Prima total',
  pct_comision: '% comisión', estatus: 'Estatus', seguimiento: 'Seguimiento', motivo_no_renovacion: 'Motivo de no renovación', fecha_pago: 'Fecha de pago',
  comision_recibida: 'Comisión recibida', monto_pagado: 'Monto pagado', monto_reclamado: 'Monto reclamado', folio: 'Folio', etapa: 'Etapa', aseguradora_id: 'Aseguradora',
  producto: 'Producto', ramo: 'Ramo', dias_primer_pago: 'Días primer pago', dias_gracia: 'Días pagos subsecuentes', dias_pago_subsecuente: 'Días pagos subsecuentes', producto_id: 'Producto del catálogo', datos_ramo: 'Datos del ramo', notas: 'Notas', descripcion: 'Descripción', colonia: 'Colonia', calle: 'Calle',
};
function valor(k, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (k === 'agente_id' || k === 'responsable_id') return ctx.perfiles.find(p => p.id === v)?.nombre || '—';
  if (k === 'aseguradora_id') return ctx.aseguradoras.find(a => a.id === v)?.nombre || '—';
  if (k === 'producto_id') return ctx.productos.find(a => a.id === v)?.nombre || '—';
  if (k === 'forma_pago') return FORMAS[v] || v;
  if (k === 'ramo') return RAMOS[v] || v;
  if (k === 'seguimiento') return SEGUIMIENTO[v]?.[0] || v;
  if (k === 'estatus') return EST_TRAMITE[v]?.[0] || v;
  if (typeof v === 'object') return Object.entries(v).map(([a, b]) => `${a}: ${b}`).join(', ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fdate(v);
  return String(v);
}
function describirCambios(c) {
  if (!c) return '';
  return Object.entries(c).filter(([k]) => !k.endsWith('_id') || ['agente_id', 'aseguradora_id', 'responsable_id', 'producto_id'].includes(k)).slice(0, 6)
    .map(([k, [a, b]]) => `<span class="muted">${esc(CAMPOS[k] || k)}:</span> ${esc(valor(k, a))} → <b>${esc(valor(k, b))}</b>`).join('<br>');
}

// ---------------------------------------------------------------- Colores de la empresa
const igual = (a, b) => ['principal', 'secundario', 'menu'].every(k => a[k].toUpperCase() === b[k].toUpperCase());
function tarjetaColores(admin) {
  const pal = paletaDe(ctx.agencia);
  const nombre = Object.entries(PALETAS).find(([, p]) => igual(p, pal))?.[1].nombre || 'Personalizada';
  return `<div class="card" style="flex:1 1 100%" id="colores">
    <div class="card-head"><div><h2>Colores de la empresa</h2>
      <p class="muted small" style="margin:4px 0 0">Se ven en toda la app, en modo claro y oscuro, para todo el equipo y en el portal de clientes. El modo claro u oscuro lo elige cada persona en el menú.</p></div>
      <span class="pill p-blue" id="palNombre">${esc(nombre)}</span></div>
    <div class="row">
      <div class="col" style="flex:3 1 420px">
        <div class="paletas" role="group" aria-label="Paletas listas">${Object.entries(PALETAS).map(([k, p]) => `<button type="button" class="paleta" data-pal="${k}" aria-pressed="${igual(p, pal)}"${admin ? '' : ' disabled'}>
          <span class="muestras" aria-hidden="true"><i style="background:${p.principal}"></i><i style="background:${p.secundario}"></i><i style="background:${p.menu}"></i></span>${esc(p.nombre)}</button>`).join('')}</div>
        <div class="colores" style="margin-top:16px">
          <div class="field"><label for="cPri">Principal</label><input id="cPri" type="color" value="${pal.principal}"${admin ? '' : ' disabled'}><div class="muted small" style="margin-top:4px">Botones, enlaces y gráficas</div></div>
          <div class="field"><label for="cSec">Secundario</label><input id="cSec" type="color" value="${pal.secundario}"${admin ? '' : ' disabled'}><div class="muted small" style="margin-top:4px">Contadores y ventas nuevas</div></div>
          <div class="field"><label for="cMen">Tono del menú</label><input id="cMen" type="color" value="${pal.menu}"${admin ? '' : ' disabled'}><div class="muted small" style="margin-top:4px">Le da un ligero matiz al menú lateral</div></div>
        </div>
        <p class="small" id="palAviso" role="status" style="margin:12px 0 0;color:var(--muted)"></p>
        ${admin ? `<div class="filters" style="margin-top:14px"><button type="button" class="btn primary" id="palGuardar">Guardar colores</button>
          <button type="button" class="btn" id="palDeshacer">Descartar cambios</button></div>` : '<p class="muted small">Solo un administrador puede cambiar los colores.</p>'}
      </div>
      <div class="col" style="flex:2 1 320px;gap:12px" id="palVista"></div>
    </div>
  </div>`;
}

function miniVista(v, titulo) {
  const chip = (bg, fg, t, r = 999) => `<span style="background:${bg};color:${fg};border-radius:${r}px;padding:3px 9px;font-size:11px;font-weight:700">${t}</span>`;
  return `<div><div class="small muted" style="margin-bottom:6px">${titulo}</div>
    <div class="vista" style="background:${v['--bg']};border-color:${v['--border']}">
      <div class="vn" style="background:linear-gradient(180deg,${v['--nav']},${v['--nav-2']});color:${v['--nav-ink']}">
        <i style="opacity:1;height:10px;width:70%;background:${v['--nav-fg']}"></i><i class="on" style="background:${v['--nav-hi']};border:1px solid ${v['--nav-line']};opacity:1"></i><i></i><i></i><i></i></div>
      <div class="vm">
        <div style="background:${v['--surface']};border:1px solid ${v['--border']};border-radius:10px;padding:10px;color:${v['--ink']}">
          <div style="font-size:11px;color:${v['--muted']}">Prima en cartera</div><b>$885,710</b>
          <div style="height:6px;border-radius:3px;background:${v['--accent-bg']};margin-top:6px"><div style="width:62%;height:6px;border-radius:3px;background:${v['--accent']}"></div></div></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${chip(v['--accent'], v['--on-accent'], 'Nueva póliza', 8)}${chip(v['--orange'], v['--on-orange'], '12')}${chip(v['--accent-bg'], v['--accent'], 'Vigente')}</div>
      </div></div></div>`;
}

function iniciarColores(panel, admin) {
  const box = panel.querySelector('#colores'); if (!box) return;
  const leer = () => ({ principal: box.querySelector('#cPri').value.toUpperCase(), secundario: box.querySelector('#cSec').value.toUpperCase(), menu: box.querySelector('#cMen').value.toUpperCase() });
  const pintar = (vivo = true) => {
    const pal = leer(), v = variables(pal);
    box.querySelector('#palVista').innerHTML = miniVista(v.claro, 'Modo claro') + miniVista(v.oscuro, 'Modo oscuro');
    const k = Object.keys(PALETAS).find(x => igual(PALETAS[x], pal));
    box.querySelectorAll('[data-pal]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pal === k)));
    box.querySelector('#palNombre').textContent = k ? PALETAS[k].nombre : 'Personalizada';
    const cambio = !igual(pal, paletaDe(ctx.agencia));
    const avisos = [];
    if (v.ajustado) avisos.push('El color principal es claro para textos: en botones y enlaces usamos un tono un poco más oscuro para que se lea bien.');
    if (cambio && admin) avisos.push('Vista previa en toda la app. Guarde para conservar los colores.');
    box.querySelector('#palAviso').textContent = avisos.join(' ');
    if (vivo) aplicarPaleta(pal);
  };
  if (admin) {
    box.querySelectorAll('[data-pal]').forEach(b => b.onclick = () => {
      const p = PALETAS[b.dataset.pal];
      box.querySelector('#cPri').value = p.principal; box.querySelector('#cSec').value = p.secundario; box.querySelector('#cMen').value = p.menu; pintar();
    });
    box.querySelectorAll('input[type=color]').forEach(i => i.oninput = () => pintar());
    box.querySelector('#palDeshacer').onclick = () => {
      const p = paletaDe(ctx.agencia);
      box.querySelector('#cPri').value = p.principal; box.querySelector('#cSec').value = p.secundario; box.querySelector('#cMen').value = p.menu; pintar();
    };
    box.querySelector('#palGuardar').onclick = async () => {
      const pal = leer(), k = Object.keys(PALETAS).find(x => igual(PALETAS[x], pal));
      try {
        await q(sb.from('agencias').update({ color: pal.principal, paleta: { nombre: k || 'personalizada', secundario: pal.secundario, menu: pal.menu } }).eq('id', ctx.agencia.id));
        await recargarCatalogos(); aplicarMarca(); pintar(false); toast('Colores guardados para toda la agencia.');
      } catch (e) { toast(e.message, true); }
    };
  }
  pintar(false);
}

// ---------------------------------------------------------------- Tipo de cambio
function tarjetaTC(admin) {
  const man = ctx.agencia?.tipo_cambio_manual || {};
  const fila = (m, etq) => { const t = ctx.tc[m]; return `<div><div class="lbl">${etq}</div><div class="val" style="font-size:20px;font-family:var(--display)">${t ? (m === 'UDI' ? '$' + t.valor.toFixed(6) : '$' + t.valor.toFixed(4)) : '—'}</div>
    <div class="muted small">${t ? `${esc(t.fuente)}${t.fecha ? ' · ' + fdate(t.fecha) : ''}` : 'Sin tipo de cambio: estas pólizas no se suman a los totales en pesos'}</div></div>`; };
  return `<div class="card" style="flex:1 1 380px" id="tcCard">
    <h2 style="margin-bottom:6px">Tipo de cambio</h2>
    <p class="muted small" style="margin-top:0">Las pólizas en dólares y UDIS se convierten a pesos para totales, reportes y ventas. Cada día se toma el tipo de cambio FIX y el valor de la UDI publicados por Banxico.</p>
    <div class="grid-info">${fila('USD', 'Dólar (USD)')}${fila('UDI', 'UDI')}</div>
    ${admin ? `<details style="margin-top:14px"><summary class="small" style="cursor:pointer">Capturar tipo de cambio a mano</summary>
      <div class="form-grid" style="margin-top:10px">${input('Dólar', 'tcUSD', { type: 'number', value: man.USD ?? '', attrs: 'step="0.0001" min="0"' })}${input('UDI', 'tcUDI', { type: 'number', value: man.UDI ?? '', attrs: 'step="0.000001" min="0"' })}</div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="tcPref" ${man.preferir ? 'checked' : ''} style="width:auto;min-height:0"> Usar siempre estos valores en lugar de los de Banxico</label>
      <div style="margin-top:10px"><button type="button" class="btn sm primary" id="tcGuardar">Guardar</button></div></details>` : ''}
  </div>`;
}
function iniciarTC(panel) {
  const b = panel.querySelector('#tcGuardar'); if (!b) return;
  b.onclick = async () => {
    const v = n => { const x = Number(panel.querySelector(`[name=${n}]`).value); return x > 0 ? x : null; };
    const tipo_cambio_manual = { USD: v('tcUSD'), UDI: v('tcUDI'), preferir: panel.querySelector('#tcPref').checked, fecha: iso(new Date()) };
    try { await q(sb.from('agencias').update({ tipo_cambio_manual }).eq('id', ctx.agencia.id)); await recargarCatalogos(); toast('Tipo de cambio guardado.'); recordar('agencia'); refrescar(); }
    catch (e) { toast(e.message, true); }
  };
}
