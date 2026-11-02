// Tema (claro / oscuro / automático) y paleta de colores de la agencia.
// La paleta se guarda en la agencia; el tema lo elige cada persona en su navegador.

export const PALETAS = {
  maya:      { nombre: 'Azul maya', principal: '#0F6E86', secundario: '#F2A541', menu: '#0B2A33' },
  oceano:    { nombre: 'Océano',    principal: '#1D5FAF', secundario: '#F2A541', menu: '#0C1E3A' },
  esmeralda: { nombre: 'Esmeralda', principal: '#0B7A5A', secundario: '#E9B949', menu: '#0A2B22' },
  indigo:    { nombre: 'Índigo',    principal: '#4B4FC4', secundario: '#F0A43A', menu: '#161838' },
  vino:      { nombre: 'Vino',      principal: '#8E2C48', secundario: '#E6A23C', menu: '#2A0F18' },
  olivo:     { nombre: 'Olivo',     principal: '#5B6B1F', secundario: '#D9A441', menu: '#1E2410' },
  grafito:   { nombre: 'Grafito',   principal: '#2F5168', secundario: '#F28F3B', menu: '#161C22' },
};
export const PALETA_BASE = PALETAS.maya;

// ---------------------------------------------------------------- Utilidades de color
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const aHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export const mezclar = (a, b, t) => { const x = hex(a), y = hex(b); return aHex(x.map((v, i) => v + (y[i] - v) * t)); };   // t = cuánto de b
const lum = h => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// Acerca el color hacia "hacia" (negro o blanco) hasta que se lea sobre "fondo"
function legible(color, fondo, ratio, hacia) {
  for (let t = 0; t <= 1.0001; t += 0.04) { const c = mezclar(color, hacia, t); if (contraste(c, fondo) >= ratio) return c; }
  return hacia;
}
const valido = c => /^#[0-9a-f]{6}$/i.test(c || '');

// Lee la paleta guardada en la agencia (compatible con el campo "color" anterior)
export function paletaDe(ag) {
  const p = ag?.paleta || {};
  const principal = valido(ag?.color) && !['#1f4e79'].includes(ag.color.toLowerCase()) ? ag.color : PALETA_BASE.principal;
  return { principal, secundario: valido(p.secundario) ? p.secundario : PALETA_BASE.secundario, menu: valido(p.menu) ? p.menu : PALETA_BASE.menu };
}

// Variables de color para tema claro y oscuro, cuidando que los textos se lean.
// Superficies neutras (sin teñir); el color de la agencia solo marca acentos.
export function variables({ principal: P, secundario: S, menu: M }) {
  const W = '#FFFFFF', K = '#000000';
  const acento = legible(P, W, 4.5, K);
  const sec = S, secL = legible(S, W, 1.8, K), secTxt = contraste(secL, '#1A1205') >= contraste(secL, W) ? '#1A1205' : W;
  const navClaro = mezclar('#EFF1F1', M, 0.05);
  const claro = {
    '--bg': '#F6F7F7', '--surface': W, '--surface-2': '#F8F9F9', '--hover': '#F1F3F3',
    '--border': '#E2E5E6', '--line': '#ECEEEF', '--control': '#D5D9DB', '--control-hi': '#B4BBBE',
    '--ink': '#17191A', '--muted': '#61686B',
    '--nav': navClaro, '--nav-2': navClaro, '--nav-ink': '#3A4043', '--nav-fg': '#17191A', '--nav-muted': legible('#71787B', navClaro, 4.5, K),
    '--nav-hi': W, '--nav-line': 'rgba(0,0,0,.07)', '--avatar': mezclar(acento, K, 0.1),
    '--accent': acento, '--accent-dk': mezclar(acento, K, 0.22), '--accent-bg': mezclar(P, W, 0.9), '--accent-hi': acento, '--on-accent': W,
    '--orange': secL, '--on-orange': secTxt, '--toast-bg': '#17191A', '--toast-fg': W,
  };
  const dSurf = '#17191B', dAcento = legible(mezclar(P, W, 0.15), dSurf, 5, W), navOsc = mezclar('#131516', M, 0.08);
  const oscuro = {
    '--bg': '#111314', '--surface': dSurf, '--surface-2': '#141618', '--hover': '#1E2123',
    '--border': '#272A2D', '--line': '#1F2225', '--control': '#33373A', '--control-hi': '#4A4F53',
    '--ink': '#E8EAEB', '--muted': legible('#979EA2', dSurf, 4.6, W),
    '--nav': navOsc, '--nav-2': navOsc, '--nav-ink': '#C4C9CC', '--nav-fg': '#F2F4F5', '--nav-muted': legible('#868D91', navOsc, 4.5, W),
    '--nav-hi': '#202326', '--nav-line': 'rgba(255,255,255,.07)', '--avatar': mezclar(dAcento, K, 0.45),
    '--accent': dAcento, '--accent-dk': mezclar(dAcento, W, 0.25), '--accent-bg': mezclar(dSurf, P, 0.28), '--accent-hi': dAcento, '--on-accent': '#0B0D0E',
    '--orange': legible(sec, dSurf, 3, W), '--on-orange': '#1A1205', '--toast-bg': '#E8EAEB', '--toast-fg': '#111314',
  };
  return { claro, oscuro, ajustado: acento.toUpperCase() !== P.toUpperCase() };
}

export function cssDePaleta(paleta) {
  const { claro, oscuro } = variables(paleta);
  const txt = o => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');
  return `:root{${txt(claro)}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${txt(oscuro)}}}:root[data-theme="dark"]{${txt(oscuro)}}`;
}

// Aplica una paleta a toda la app (también sirve como vista previa)
export function aplicarPaleta(paleta) {
  let st = document.getElementById('marca');
  if (!st) { st = document.createElement('style'); st.id = 'marca'; }
  document.body.appendChild(st);   // al final, para que tenga prioridad sobre los estilos base
  st.textContent = cssDePaleta(paleta);
}

// ---------------------------------------------------------------- Modo claro / oscuro
const LLAVE = 'cc-tema';
export const MODOS = { auto: 'Automático', claro: 'Claro', oscuro: 'Oscuro' };
export function modoActual() { try { return localStorage.getItem(LLAVE) || 'auto'; } catch (e) { return 'auto'; } }
export function aplicarModo(m = modoActual()) {
  const r = document.documentElement;
  if (m === 'claro') r.dataset.theme = 'light'; else if (m === 'oscuro') r.dataset.theme = 'dark'; else delete r.dataset.theme;
}
export function cambiarModo(m) { try { localStorage.setItem(LLAVE, m); } catch (e) { /* sin almacenamiento: solo esta sesión */ } aplicarModo(m); }
