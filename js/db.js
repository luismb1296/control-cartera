import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configurado = !SUPABASE_URL.startsWith('PEGAR');
export const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Datos de la sesión: perfil del usuario, agencia y catálogos
export const ctx = { perfil: null, agencia: null, aseguradoras: [], productos: [], perfiles: [], accesosPortal: [], tc: {}, plantillas: [], logoUrl: null };

// Ejecuta una consulta y lanza error legible si falla
export async function q(promesa) {
  const { data, error } = await promesa;
  if (error) throw new Error(traducirError(error));
  return data;
}

function traducirError(e) {
  const m = e.message || String(e);
  if (/row-level security/i.test(m)) return 'No tiene permiso para esta acción.';
  if (/duplicate key/i.test(m)) return 'Ese registro ya existe.';
  if (/violates foreign key.*polizas/i.test(m)) return 'No se puede borrar: tiene pólizas registradas.';
  if (/fin_vigencia/i.test(m)) return 'El fin de vigencia debe ser posterior al inicio.';
  if (/Invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Failed to fetch/i.test(m)) return 'Sin conexión con el servidor. Revise su internet.';
  return m;
}

export async function cargarContexto(userId) {
  ctx.perfil = await q(sb.from('perfiles').select('*').eq('id', userId).maybeSingle());
  if (!ctx.perfil) return false;
  await recargarCatalogos();
  return true;
}

export async function recargarCatalogos() {
  ctx.aseguradoras = await q(sb.from('aseguradoras').select('*').order('nombre'));
  ctx.productos = await q(sb.from('productos').select('*').order('nombre'));
  // Equipo de la agencia por un lado y accesos al portal de clientes por otro
  const todos = await q(sb.from('perfiles').select('id,nombre,rol,email,activo,cliente_id,pct_agente').order('nombre'));
  ctx.perfiles = todos.filter(p => p.rol !== 'cliente');
  ctx.accesosPortal = todos.filter(p => p.rol === 'cliente');
  ctx.plantillas = await q(sb.from('plantillas').select('*').order('nombre'));
  ctx.agencia = await q(sb.from('agencias').select('*').eq('id', ctx.perfil.agencia_id).maybeSingle());
  // Tipo de cambio: el más reciente de Banxico; si no hay, el que capturó la agencia
  ctx.tc = {};
  try {
    const tcs = await q(sb.from('tipos_cambio').select('*').order('fecha', { ascending: false }).limit(40));
    ['USD', 'UDI'].forEach(m => { const x = tcs.find(t => t.moneda === m); if (x) ctx.tc[m] = { valor: Number(x.valor), fecha: x.fecha, fuente: x.fuente || 'Banxico' }; });
  } catch (e) { /* sin tabla todavía */ }
  const man = ctx.agencia?.tipo_cambio_manual || {};
  ['USD', 'UDI'].forEach(m => { if (Number(man[m]) > 0 && (!ctx.tc[m] || man.preferir)) ctx.tc[m] = { valor: Number(man[m]), fecha: man.fecha || null, fuente: 'Capturado por la agencia' }; });
  ctx.logoUrl = null;
  if (ctx.agencia?.logo_ruta) {
    const { data } = await sb.storage.from('documentos').createSignedUrl(ctx.agencia.logo_ruta, 60 * 60 * 24 * 7);
    ctx.logoUrl = data?.signedUrl || null;
  }
}

export const puedeAdministrar = () => ['admin', 'operaciones'].includes(ctx.perfil?.rol);

// Convierte a pesos con el tipo de cambio vigente (null si no hay tipo de cambio para esa moneda)
export function enPesos(monto, moneda = 'MXN') {
  if (!moneda || moneda === 'MXN') return Number(monto || 0);
  const t = ctx.tc[moneda]; return t ? Math.round(Number(monto || 0) * t.valor * 100) / 100 : null;
}
// Copia de la póliza con primas en pesos (para sumar carteras con varias monedas)
export function aPesos(p) {
  if (!p || !p.moneda || p.moneda === 'MXN') return p;
  return { ...p, prima_total: enPesos(p.prima_total, p.moneda) ?? 0, prima_neta: enPesos(p.prima_neta, p.moneda) ?? 0, moneda: 'MXN', moneda_original: p.moneda };
}
