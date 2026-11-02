// =====================================================================
//  CONFIGURACIÓN — los dos datos de su proyecto de Supabase
//  Se encuentran en Supabase > Project Settings > API (o botón "Connect")
//   - Project URL           → SUPABASE_URL
//   - anon / public key     → SUPABASE_ANON_KEY
//  La llave "anon" es pública por diseño: la seguridad la dan las reglas
//  de la base de datos. NUNCA ponga aquí la llave "service_role".
// =====================================================================
export const SUPABASE_URL = 'https://jobhosawtxvtbaqussbm.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_n4Gpz9E20QTeUD8o0yOXOA_WWpN8-UQ';   // llave publicable (sb_publishable_…)

// Llave pública para notificaciones push (opcional). Se genera con: npx web-push generate-vapid-keys
export const VAPID_PUBLIC_KEY = '';
