// Centro de notificaciones (campana) y avisos en el dispositivo
import { sb, ctx, q } from './db.js';
import { esc, toast } from './ui.js';
import * as cfg from './config.js';

let timer = null, vistos = new Set(), primera = true, canal = null;
const ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
export const botonCampana = () => `<button type="button" class="campana" id="campana" aria-label="Notificaciones" aria-expanded="false" aria-controls="nPanel">${ICO}<span class="nbadge" id="nBadge" hidden></span></button>`;
const hace = f => { const m = Math.round((Date.now() - new Date(f)) / 60000); return m < 1 ? 'Ahora' : m < 60 ? `Hace ${m} min` : m < 1440 ? `Hace ${Math.round(m / 60)} h` : `Hace ${Math.round(m / 1440)} d`; };

async function cargar() {
  const lista = await q(sb.from('notificaciones').select('*').order('creado_en', { ascending: false }).limit(30));
  const sinLeer = lista.filter(n => !n.leida);
  const b = document.getElementById('nBadge');
  if (b) { b.textContent = sinLeer.length > 9 ? '9+' : sinLeer.length; b.hidden = !sinLeer.length; }
  // Aviso del sistema para lo nuevo (si la persona lo permitió y la app no está a la vista)
  if (!primera && 'Notification' in window && Notification.permission === 'granted')
    sinLeer.filter(n => !vistos.has(n.id)).slice(0, 3).forEach(n => { if (document.hidden) try { new Notification(n.titulo, { body: n.cuerpo || '', tag: n.id }); } catch (e) { /* sin permiso */ } });
  lista.forEach(n => vistos.add(n.id)); primera = false;
  return lista;
}

export function iniciarNotificaciones() {
  const btn = document.getElementById('campana'); if (!btn) return;
  clearInterval(timer); vistos = new Set(); primera = true;
  cargar().catch(() => {});
  timer = setInterval(() => cargar().catch(() => {}), 45000);
  // En la versión real, además, llegan al instante
  if (!sb.demo && sb.channel && !canal) {
    try { canal = sb.channel('notif-' + ctx.perfil.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `perfil_id=eq.${ctx.perfil.id}` }, () => cargar().catch(() => {})).subscribe(); } catch (e) { canal = null; }
  }
  btn.onclick = async e => {
    e.stopPropagation();
    let p = document.getElementById('nPanel');
    if (p) { p.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    const lista = await cargar();
    p = document.createElement('div'); p.id = 'nPanel'; p.className = 'npanel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notificaciones');
    const permiso = 'Notification' in window ? Notification.permission : 'unsupported';
    p.innerHTML = `<div class="nph"><b>Notificaciones</b>${lista.some(n => !n.leida) ? '<button type="button" class="linkbtn small" id="nTodas">Marcar todas como leídas</button>' : ''}</div>
      <div class="nlist">${lista.map(n => `<button type="button" class="nitem${n.leida ? '' : ' nueva'}" data-n="${n.id}"><span class="ntit">${esc(n.titulo)}</span>${n.cuerpo ? `<span class="ncue">${esc(n.cuerpo)}</span>` : ''}<span class="nhace">${hace(n.creado_en)}</span></button>`).join('') || '<p class="muted small" style="padding:12px">No tiene notificaciones.</p>'}</div>
      ${permiso === 'default' ? '<div class="npf"><button type="button" class="btn sm" id="nPermiso">Avisarme en este dispositivo</button></div>' : ''}`;
    document.body.appendChild(p); btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    if (innerWidth > 820) { p.style.left = Math.min(r.right + 8, innerWidth - 370) + 'px'; p.style.bottom = Math.max(12, innerHeight - r.bottom - 10) + 'px'; }
    else { p.style.right = '8px'; p.style.top = (r.bottom + 8) + 'px'; }
    p.querySelector('#nTodas')?.addEventListener('click', async () => {
      await q(sb.from('notificaciones').update({ leida: true }).eq('leida', false)); p.remove(); cargar();
    });
    p.querySelector('#nPermiso')?.addEventListener('click', activarEnDispositivo);
    p.querySelectorAll('[data-n]').forEach(x => x.onclick = async () => {
      const n = lista.find(z => z.id === x.dataset.n);
      if (!n.leida) await q(sb.from('notificaciones').update({ leida: true }).eq('id', n.id));
      p.remove(); btn.setAttribute('aria-expanded', 'false'); cargar();
      if (n.enlace) location.hash = n.enlace;
    });
    const fuera = ev => { if (!p.contains(ev.target) && ev.target !== btn) { p.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', fuera); } };
    setTimeout(() => document.addEventListener('click', fuera), 0);
    p.addEventListener('keydown', ev => { if (ev.key === 'Escape') { p.remove(); btn.focus(); } });
  };
}

// Permiso del navegador y, en la versión real, suscripción a notificaciones push (llegan aunque la app esté cerrada)
export async function activarEnDispositivo() {
  try {
    const r = await Notification.requestPermission();
    if (r !== 'granted') return toast('Sin permiso, los avisos solo se verán en la campana.', true);
    const llave = cfg.VAPID_PUBLIC_KEY;
    if (!sb.demo && llave && 'serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const b = atob(llave.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - llave.length % 4) % 4));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(b, c => c.charCodeAt(0)) });
      const j = sub.toJSON();
      await q(sb.from('push_suscripciones').insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, dispositivo: navigator.userAgent.slice(0, 120) }));
    }
    toast('Listo. Le avisaremos en este dispositivo.');
    document.getElementById('nPanel')?.remove();
  } catch (e) { toast('Este navegador no permite avisos: ' + e.message, true); }
}
