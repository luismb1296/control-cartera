import { sb, ctx, configurado, cargarContexto, q } from './db.js';
import { esc, iniciales, toast } from './ui.js';
import { vistaInicio } from './views/inicio.js';
import { vistaClientes } from './views/clientes.js';
import { vistaCliente } from './views/cliente.js';
import { vistaPolizas } from './views/polizas.js';
import { vistaCobranza } from './views/cobranza.js';
import { vistaCalendario } from './views/calendario.js';
import { vistaVentas } from './views/ventas.js';
import { vistaConfig } from './views/config.js';
import { vistaPendientes, calcularPendientes } from './views/pendientes.js';
import { vistaTramites, vistaSiniestro } from './views/tramites.js';
import { vistaProspectos } from './views/prospectos.js';
import { vistaTablero } from './views/tablero.js';
import { vistaRenovaciones, vistaAnalisis } from './views/renovaciones.js';
import { vistaOportunidades } from './views/oportunidades.js';
import { vistaComisiones } from './views/comisiones.js';
import { vistaEndosos, vistaEndoso } from './views/endosos.js';
import { vistaHistorico } from './views/historico.js';
import { RUTAS_PORTAL } from './views/portal.js';
import { tutorialAuto, botonAyuda, claveTour, cerrarTour } from './tutorial.js';
import { botonCampana, iniciarNotificaciones } from './notificaciones.js';
import { aplicarPaleta, paletaDe, aplicarModo, cambiarModo, modoActual, MODOS } from './tema.js';

aplicarModo();

const app = document.getElementById('app');

const RUTAS = [
  ['inicio', 'Inicio', vistaInicio],
  ['pendientes', 'Mis pendientes', vistaPendientes],
  ['tablero', 'Tablero de trabajo', vistaTablero],
  ['clientes', 'Clientes', vistaClientes],
  ['polizas', 'Pólizas', vistaPolizas],
  ['renovaciones', 'Renovaciones', vistaRenovaciones],
  ['cobranza', 'Cobranza', vistaCobranza],
  ['tramites', 'Siniestros y reembolsos', vistaTramites],
  ['endosos', 'Endosos', vistaEndosos],
  ['prospectos', 'Prospectos', vistaProspectos],
  ['oportunidades', 'Oportunidades', vistaOportunidades],
  ['calendario', 'Calendario', vistaCalendario],
  ['ventas', 'Ventas e ingresos', vistaVentas],
  ['comisiones', 'Comisiones', vistaComisiones],
];
const ROLES = { admin: 'Administración', operaciones: 'Operaciones', agente: 'Agente', cliente: 'Cliente (portal)' };
// Íconos del menú (trazo de 24 px)
const IC = {
  inicio: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  pendientes: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  tablero: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  polizas: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  endosos: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/><path d="M14 3v5h5"/><path d="M19 8v3"/><path d="m17.5 14.5 3 3L15 23h-3v-3z"/>',
  cobranza: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  tramites: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
  prospectos: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  ventas: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  oportunidades: '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.6V16h6v-.1c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 2.5z"/>',
  comisiones: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><circle cx="9.5" cy="9.5" r="1.2"/><circle cx="14.5" cy="14.5" r="1.2"/>',
  renovaciones: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L21 15"/><path d="M21 20v-5h-5"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  pagos: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  reembolso: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15l3 3 3-3"/>',
  documentos: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
};
const ICM = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></svg>',
  claro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  oscuro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};
const icono = r => IC[r] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[r]}</svg>` : '';

const esPortal = () => ctx.perfil?.rol === 'cliente';
const rutas = () => esPortal() ? RUTAS_PORTAL : RUTAS;

// Versión instalable en el celular (solo en la versión publicada, no en el prototipo)
if (sb && !sb.demo && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

async function iniciar() {
  if (!configurado) {
    app.innerHTML = `<div class="login"><div class="card"><h1>Falta configurar</h1>
      <p class="muted">Abra el archivo <b>js/config.js</b> y pegue la URL y la llave "anon" de su proyecto de Supabase.</p></div></div>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return pantallaLogin();
  try {
    const ok = await cargarContexto(session.user.id);
    if (!ok) {
      app.innerHTML = `<div class="login"><div class="card"><h1>Usuario sin perfil</h1>
        <p class="muted">Su usuario (${esc(session.user.email)}) existe, pero no está dado de alta en ninguna agencia. Pida al administrador que lo registre.</p>
        <button class="btn" id="salir">Cerrar sesión</button></div></div>`;
      document.getElementById('salir').onclick = salir;
      return;
    }
  } catch (e) {
    app.innerHTML = `<div class="login"><div class="card"><h1>No se pudo cargar</h1><p class="error">${esc(e.message)}</p>
      <button class="btn" onclick="location.reload()">Reintentar</button></div></div>`;
    return;
  }
  await tareasAutomaticas();
  pintarMarco();
  window.addEventListener('hashchange', () => { const dlg = document.getElementById('modal'); if (dlg?.open) dlg.close(); navegar(); });
  navegar();
}

function pantallaLogin() {
  app.innerHTML = `
  <div class="login"><form class="card" id="login" novalidate>
    <h1 style="font-size:22px">Control de Cartera</h1>
    <p class="muted" style="margin:6px 0 22px">Inicie sesión con su correo de la agencia.</p>
    <div class="field" style="margin-bottom:14px"><label for="em">Correo</label><input id="em" type="email" autocomplete="username" required></div>
    <div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <div class="error" role="alert"></div>
    <button class="btn primary" style="width:100%;margin-top:18px" type="submit">Entrar</button>
    <button class="linkbtn small" style="margin-top:14px" type="button" id="olvide">Olvidé mi contraseña</button>
  </form></div>`;
  const f = document.getElementById('login');
  const err = f.querySelector('.error');
  f.onsubmit = async ev => {
    ev.preventDefault();
    const email = f.em.value.trim(), password = f.pw.value;
    if (!email || !password) { err.textContent = 'Escriba su correo y contraseña.'; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; err.textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) { err.textContent = /Invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message; return; }
    iniciar();
  };
  document.getElementById('olvide').onclick = async () => {
    const email = f.em.value.trim();
    if (!email) { err.textContent = 'Escriba primero su correo.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    err.textContent = error ? error.message : '';
    if (!error) toast('Le enviamos un correo para restablecer su contraseña.');
  };
}

function pintarMarco() {
  const p = ctx.perfil;
  aplicarMarca();
  app.innerHTML = `
  <div class="layout">
    <nav class="nav" aria-label="Menú principal">
      ${ctx.logoUrl ? `<div class="brand-logo"><img src="${esc(ctx.logoUrl)}" alt="${esc(ctx.agencia?.nombre || '')}"></div>` : '<div class="brand">Control de Cartera</div>'}
      <div class="agency">${esc(ctx.agencia?.nombre || '')}</div>
      ${rutas().map(([r, t]) => `<a href="#/${r}" data-r="${r}">${icono(r)}<span>${t}</span>${r === 'pendientes' ? '<span class="badge" id="badge" hidden></span>' : ''}</a>`).join('')}
      <div class="spacer"></div>
      ${esPortal() ? '' : `<a href="#/config" data-r="config">${icono('config')}<span>Configuración</span></a>`}
      <div class="me">
        <div class="avatar">${esc(iniciales(p.nombre))}</div>
        <div><div style="color:var(--nav-fg)">${esc(p.nombre)}</div><div style="color:var(--nav-muted);font-size:12px">${ROLES[p.rol] || p.rol}</div></div>
        ${botonCampana()}
        ${sb.demo ? '' : '<button type="button" id="salir" title="Cerrar sesión">Salir</button>'}
      </div>
      <div class="modo" role="group" aria-label="Tema de la pantalla"><span class="modo-t" aria-hidden="true">Tema</span>${Object.entries(MODOS).map(([k, t]) => `<button type="button" data-modo="${k}" aria-pressed="${modoActual() === k}" title="${t}" aria-label="Tema ${t.toLowerCase()}">${ICM[k]}</button>`).join('')}</div>
      ${sb.demo ? `<div class="demo-box">
        <label for="verComo">Prototipo · ver como</label>
        <select id="verComo">${sb.demo.usuarios().map(u => `<option value="${u.id}"${u.id === p.id ? ' selected' : ''}>${esc(u.nombre)} (${ROLES[u.rol] || u.rol})</option>`).join('')}</select>
      </div>` : ''}
    </nav>
    <main id="main"></main>
  </div>`;
  document.getElementById('salir')?.addEventListener('click', salir);
  iniciarNotificaciones();
  document.querySelectorAll('[data-modo]').forEach(b => b.onclick = () => {
    cambiarModo(b.dataset.modo);
    document.querySelectorAll('[data-modo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  document.getElementById('verComo')?.addEventListener('change', async e => {
    sb.demo.cambiarUsuario(e.target.value);
    await recargarApp();
    toast('Ahora ve la app como ' + ctx.perfil.nombre + '.');
  });
}

// Vuelve a cargar usuario y catálogos y pinta de nuevo (prototipo: cambio de usuario o datos restablecidos)
export async function recargarApp() {
  const { data: { session } } = await sb.auth.getSession();
  await cargarContexto(session.user.id);
  await tareasAutomaticas();
  pintarMarco(); navegar();
}

// Renovaciones próximas y recibos vencidos crean su tarea en el tablero (una sola vez cada una)
async function tareasAutomaticas() {
  if (ctx.perfil?.rol === 'cliente') return;
  try { await sb.rpc('crear_tareas_automaticas'); } catch (e) { /* no es crítico */ }
}

async function salir() { await sb.auth.signOut(); location.hash = ''; location.reload(); }

let navId = 0;
export async function navegar() {
  const id = ++navId;
  cerrarTour();
  if (ctx.agencia) aplicarMarca();   // descarta una vista previa de colores que no se guardó
  const [ruta, param] = ((location.hash.replace(/^#\/?/, '').split('?')[0]) || 'inicio').split('/');
  // Se reemplaza <main> en cada navegación para no acumular eventos de vistas anteriores
  const viejo = document.getElementById('main');
  const main = viejo.cloneNode(false); viejo.replaceWith(main);
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.r === ruta || ((ruta === 'cliente' || ruta === 'historico') && a.dataset.r === 'clientes') || (ruta === 'siniestro' && a.dataset.r === 'tramites') || (ruta === 'renovacion' && a.dataset.r === 'renovaciones') || (ruta === 'endoso' && a.dataset.r === 'endosos')));
  const vistas = Object.fromEntries(rutas().map(([r, , v]) => [r, v]));
  if (!esPortal()) { vistas.cliente = vistaCliente; vistas.config = vistaConfig; vistas.siniestro = vistaSiniestro; vistas.renovacion = vistaAnalisis; vistas.endoso = vistaEndoso; vistas.historico = vistaHistorico; }
  const vista = vistas[ruta] || vistas.inicio;
  main.innerHTML = '<div class="loading">Cargando…</div>';
  try {
    await vista(main, param, () => id === navId);
    window.scrollTo(0, 0);
    if (id === navId) {
      const seccion = vistas[ruta] ? ruta : 'inicio';
      botonAyuda(seccion); tutorialAuto(claveTour(seccion));
    }
    actualizarBadge();
  } catch (e) {
    if (id !== navId) return;
    main.innerHTML = `<div class="card"><h2>Ocurrió un problema</h2><p class="error">${esc(e.message)}</p>
      <button class="btn" type="button" onclick="location.reload()">Recargar</button></div>`;
  }
}

// Volver a pintar la vista actual (después de guardar algo)
export function refrescar() { navegar(); }

sb?.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') nuevaContrasena(); });
function nuevaContrasena() {
  import('./ui.js').then(({ modal, input }) => modal({
    titulo: 'Nueva contraseña', boton: 'Guardar contraseña',
    cuerpo: input('Nueva contraseña (mínimo 8 caracteres)', 'pw', { type: 'password', req: true }),
    onSubmit: async d => {
      if (d.pw.length < 8) throw new Error('Debe tener al menos 8 caracteres.');
      const { error } = await sb.auth.updateUser({ password: d.pw }); if (error) throw error;
      toast('Contraseña actualizada.');
    }
  }));
}

iniciar();

// Contador de pendientes en el menú
async function actualizarBadge() {
  if (esPortal()) return;
  try {
    const { total } = await calcularPendientes();
    const b = document.getElementById('badge'); if (!b) return;
    b.textContent = total > 99 ? '99+' : total; b.hidden = !total;
  } catch (e) { /* el contador no es crítico */ }
}

// Paleta de la agencia (claro y oscuro)
export function aplicarMarca() { aplicarPaleta(paletaDe(ctx.agencia)); }
