// Importar clientes y pólizas desde Excel (.xlsx) o CSV
import { sb, ctx, q, puedeAdministrar, recargarCatalogos } from '../db.js';
import { esc, money, modal, toast, iso, hoyISO, parseD, addMonths, RAMOS, FORMAS } from '../ui.js';

// Nombres de columna que se reconocen (incluye los que suelen usar SIGA y otros sistemas de agentes)
const COLUMNAS = {
  cliente: ['cliente', 'nombre', 'contratante', 'nombre del cliente', 'razon social', 'asegurado titular', 'nombre contratante', 'nombre del contratante', 'asegurado', 'nombre asegurado', 'nombre completo'],
  rfc: ['rfc', 'r.f.c.', 'rfc contratante'],
  telefono: ['telefono', 'tel', 'celular', 'movil', 'whatsapp', 'telefono celular', 'tel. celular', 'tel celular', 'telefono 1', 'telefono particular'],
  email: ['correo', 'email', 'e-mail', 'correo electronico', 'e mail', 'mail', 'correo contratante'],
  fecha_nacimiento: ['fecha de nacimiento', 'nacimiento', 'f. nacimiento', 'cumpleanos', 'fecha nacimiento', 'f. nac.', 'fec. nac.'],
  aseguradora: ['aseguradora', 'compania', 'cia', 'cia.', 'cia aseguradora', 'compania aseguradora', 'institucion', 'aseguradora/compania'],
  ramo: ['ramo', 'tipo de seguro', 'tipo', 'subramo', 'ramo/subramo', 'linea', 'linea de negocio'],
  producto: ['producto', 'plan', 'paquete', 'nombre del plan'],
  numero_poliza: ['poliza', 'numero de poliza', 'no. poliza', 'no poliza', 'num poliza', 'num. poliza', 'n° poliza', 'no. de poliza', 'poliza no', 'num. de poliza', 'numero poliza', 'no.poliza', 'poliza/endoso'],
  inicio: ['inicio', 'inicio de vigencia', 'vigencia desde', 'desde', 'fecha de inicio', 'vig. desde', 'vigencia inicial', 'inicio vigencia', 'ini. vigencia', 'vig desde'],
  fin: ['fin', 'fin de vigencia', 'vigencia hasta', 'hasta', 'vencimiento', 'fecha de vencimiento', 'vig. hasta', 'vigencia final', 'fin vigencia', 'fin. vigencia', 'vig hasta'],
  forma_pago: ['forma de pago', 'frecuencia', 'frecuencia de pago', 'pago', 'forma pago', 'f. pago', 'periodicidad', 'periodicidad de pago'],
  moneda: ['moneda', 'divisa', 'mon.'],
  prima_neta: ['prima neta', 'neta', 'prima neta anual'],
  prima_total: ['prima total', 'prima', 'importe', 'prima anual', 'total', 'importe total', 'prima total anual'],
  pct_comision: ['comision', '% comision', 'porcentaje de comision', '% de comision', 'comision %', 'pct comision'],
  agente: ['agente', 'vendedor', 'ejecutivo', 'nombre agente', 'agente responsable'],
  estatus: ['estatus', 'status', 'situacion', 'estado', 'estado de la poliza', 'estatus poliza'],
};
export const CAMPOS_IMPORTAR = { cliente: 'Cliente (contratante) *', rfc: 'RFC', telefono: 'Teléfono', email: 'Correo', fecha_nacimiento: 'Fecha de nacimiento', aseguradora: 'Aseguradora',
  ramo: 'Ramo', producto: 'Producto o plan', numero_poliza: 'Número de póliza', inicio: 'Inicio de vigencia', fin: 'Fin de vigencia', forma_pago: 'Forma de pago', moneda: 'Moneda',
  prima_neta: 'Prima neta', prima_total: 'Prima total', pct_comision: '% de comisión', agente: 'Agente', estatus: 'Estatus (cancelada)' };
export const COLUMNAS_PLANTILLA = ['Cliente', 'RFC', 'Teléfono', 'Correo', 'Fecha de nacimiento', 'Aseguradora', 'Ramo', 'Producto', 'Póliza', 'Inicio de vigencia', 'Fin de vigencia', 'Forma de pago', 'Prima neta', 'Prima total', '% comisión'];

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function leerRamo(v) {
  const t = norm(v);
  if (!t) return null;
  if (/gmm|medic|salud/.test(t)) return 'gmm';
  if (/vida/.test(t)) return 'vida';
  if (/auto|vehic|flotilla|moto|camion/.test(t)) return 'auto';
  if (/hogar|casa/.test(t)) return 'hogar';
  if (/dano|empres|negocio|incendio|responsab/.test(t)) return 'danos';
  if (/viaj/.test(t)) return 'viaje';
  return 'otro';
}
function leerForma(v) {
  const t = norm(v);
  if (/mens/.test(t)) return 'mensual';
  if (/trim/.test(t)) return 'trimestral';
  if (/sem/.test(t)) return 'semestral';
  return 'contado';
}
function leerNumero(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[$,\s]/g, '').replace('%', ''));
  return isNaN(n) ? null : n;
}
function leerFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return iso(new Date(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return 'invalida';
}

// CSV sencillo con comillas; detecta coma o punto y coma
function parseCSV(texto) {
  const sep = (texto.split('\n')[0].match(/;/g) || []).length > (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c; }
    else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(x => String(x).trim()));
}

export function cargarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => ok(window.XLSX); s.onerror = () => mal(new Error('No se pudo cargar el lector de Excel. Guarde el archivo como CSV e inténtelo de nuevo.'));
    document.head.appendChild(s);
  });
}

export async function leerArchivo(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCSV(await file.text());
  const XLSX = await cargarSheetJS();
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
}

// Convierte filas crudas en registros validados
// Fila de encabezados: la primera que tenga al menos 3 columnas reconocidas (SIGA a veces pone títulos arriba)
const sinSignos = t => norm(t).replace(/[.\/_\-°#:()]/g, ' ').replace(/\s+/g, ' ').trim();
const coincide = (h, alias) => { const x = sinSignos(h); return alias.some(a => sinSignos(a) === x); };
export function filaEncabezados(filas) {
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const enc = filas[i]; let n = 0;
    Object.values(COLUMNAS).forEach(al => { if (enc.some(h => coincide(h, al))) n++; });
    if (n >= 3) return i;
  }
  return 0;
}
export function adivinarMapa(encabezados) {
  const enc = encabezados, mapa = {}, usadas = new Set();
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const i = enc.findIndex((h, k) => !usadas.has(k) && coincide(h, alias));
    if (i >= 0) { mapa[campo] = i; usadas.add(i); }
  }
  return mapa;
}
const leerMoneda = v => { const t = norm(v); return /usd|dol|dll|us\$/.test(t) ? 'USD' : /udi/.test(t) ? 'UDI' : 'MXN'; };

export function interpretar(filas, existentes = new Set(), mapa = null, inicio = null) {
  const h0 = inicio ?? filaEncabezados(filas);
  if (filas.length < h0 + 2) throw new Error('El archivo no tiene filas de datos.');
  const idx = mapa || adivinarMapa(filas[h0]);
  if (idx.cliente == null) throw new Error('No encontré la columna del nombre del cliente. Elíjala en "Emparejar columnas".');
  filas = [filas[h0], ...filas.slice(h0 + 1).filter(f => f.some(x => String(x ?? '').trim()))];
  const vistos = new Set();
  return filas.slice(1).map((f, n) => {
    const v = k => (idx[k] != null ? f[idx[k]] : '');
    const r = {
      fila: h0 + n + 2, cliente: String(v('cliente') || '').trim(), rfc: String(v('rfc') || '').trim().toUpperCase() || null,
      telefono: String(v('telefono') || '').trim() || null, email: String(v('email') || '').trim() || null,
      fecha_nacimiento: leerFecha(v('fecha_nacimiento')), aseguradora: String(v('aseguradora') || '').trim(), ramo: leerRamo(v('ramo')),
      producto: String(v('producto') || '').trim() || null, numero_poliza: String(v('numero_poliza') || '').trim() || null,
      inicio: leerFecha(v('inicio')), fin: leerFecha(v('fin')), forma_pago: leerForma(v('forma_pago')),
      prima_neta: leerNumero(v('prima_neta')), prima_total: leerNumero(v('prima_total')), pct_comision: leerNumero(v('pct_comision')),
      moneda: idx.moneda != null ? leerMoneda(v('moneda')) : 'MXN', agente: String(v('agente') || '').trim() || null, cancelada: /cancel|anulad|baja/.test(norm(v('estatus'))),
      errores: [], soloCliente: false
    };
    if (!r.cliente) r.errores.push('sin nombre');
    if (r.fecha_nacimiento === 'invalida') { r.fecha_nacimiento = null; }
    const tienePoliza = r.aseguradora || r.numero_poliza || r.inicio;
    if (!tienePoliza) r.soloCliente = true;
    else {
      if (!r.aseguradora) r.errores.push('falta aseguradora');
      if (!r.inicio || r.inicio === 'invalida') r.errores.push('inicio de vigencia inválido');
      if (r.fin === 'invalida') r.errores.push('fin de vigencia inválido');
      if (!r.fin && r.inicio && r.inicio !== 'invalida') r.fin = iso(addMonths(parseD(r.inicio), 12));
      if (r.inicio && r.fin && r.fin <= r.inicio) r.errores.push('el fin es anterior al inicio');
      if (!r.ramo) r.ramo = 'otro';
      if (r.prima_total == null && r.prima_neta != null) r.prima_total = Math.round(r.prima_neta * 1.16 * 100) / 100;
      if (r.prima_neta == null && r.prima_total != null) r.prima_neta = Math.round(r.prima_total / 1.16 * 100) / 100;
      if (r.prima_total == null) r.errores.push('falta prima');
      if (r.numero_poliza && (existentes.has(norm(r.numero_poliza)) || vistos.has(norm(r.numero_poliza)))) r.errores.push('la póliza ya existe');
      if (r.numero_poliza) vistos.add(norm(r.numero_poliza));
    }
    return r;
  });
}

const LLAVE_MAPEO = 'cc-mapeos-importar';
const firma = enc => enc.map(norm).join('|');
const mapeoGuardado = enc => { try { return JSON.parse(localStorage.getItem(LLAVE_MAPEO) || '{}')[firma(enc)] || null; } catch (e) { return null; } };
const guardarMapeo = (enc, m) => { try { const d = JSON.parse(localStorage.getItem(LLAVE_MAPEO) || '{}'); d[firma(enc)] = m; localStorage.setItem(LLAVE_MAPEO, JSON.stringify(d)); } catch (e) { /* sin almacenamiento */ } };

export async function abrirImportador(alTerminar) {
  const existentes = new Set((await q(sb.from('polizas').select('numero_poliza'))).map(p => norm(p.numero_poliza)).filter(Boolean));
  let registros = [], filas = [], h0 = 0, mapa = {};
  const dlg = modal({
    titulo: 'Importar o migrar cartera',
    boton: 'Importar',
    cuerpo: `
      <p style="margin-top:0">Suba la exportación de SIGA u otro sistema, o cualquier Excel o CSV con una fila por póliza. Después revise cómo se emparejaron las columnas.</p>
      <div class="field"><label for="impF">Archivo</label><input id="impF" type="file" accept=".xlsx,.xls,.csv"></div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="impPag" checked style="width:auto;min-height:0">
        Marcar como pagados los recibos cuya fecha límite ya pasó (cartera al corriente)</label>
      <div id="impMap" style="margin-top:16px"></div>
      <div id="impPrev" style="margin-top:16px"></div>`,
    onOpen: f => {
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      const prev = f.querySelector('#impPrev'), boxMap = f.querySelector('#impMap');
      const pintarPrevia = () => {
        try {
          registros = interpretar(filas, existentes, mapa, h0);
          const ok = registros.filter(r => !r.errores.length), mal = registros.filter(r => r.errores.length);
          const nClientes = new Set(ok.map(r => r.rfc || norm(r.cliente))).size;
          prev.innerHTML = `
            <div class="chips"><span class="pill p-ok">${ok.length} filas listas</span><span class="pill p-blue">${nClientes} clientes</span>
              <span class="pill p-blue">${ok.filter(r => !r.soloCliente).length} pólizas</span>${mal.length ? `<span class="pill p-bad">${mal.length} con errores (se omitirán)</span>` : ''}</div>
            <div class="tbl-wrap" style="margin-top:12px;max-height:300px;overflow:auto"><table>
              <thead><tr><th>Fila</th><th>Cliente</th><th>Aseguradora</th><th>Ramo</th><th>Póliza</th><th>Vigencia</th><th>Pago</th><th class="num">Prima total</th><th>Revisión</th></tr></thead>
              <tbody>${registros.slice(0, 200).map(r => `<tr><td>${r.fila}</td><td>${esc(r.cliente)}</td><td>${esc(r.aseguradora || '—')}</td>
                <td>${r.soloCliente ? '—' : esc(RAMOS[r.ramo])}</td><td>${esc(r.numero_poliza || '—')}</td>
                <td class="nw">${r.soloCliente ? '—' : `${esc(r.inicio)} a ${esc(r.fin || '')}`}</td><td>${r.soloCliente ? '—' : FORMAS[r.forma_pago]}</td>
                <td class="num">${r.prima_total != null ? money(r.prima_total) + (r.moneda !== 'MXN' ? ' ' + r.moneda : '') : '—'}</td>
                <td>${r.errores.length ? `<span class="pill p-bad">${esc(r.errores.join(', '))}</span>` : r.soloCliente ? '<span class="pill p-gray">Solo cliente</span>' : r.cancelada ? '<span class="pill p-gray">Cancelada</span>' : '<span class="pill p-ok">Lista</span>'}</td></tr>`).join('')}</tbody></table></div>`;
          btn.disabled = !ok.length;
        } catch (err) { prev.innerHTML = `<p class="error">${esc(err.message)}</p>`; btn.disabled = true; }
      };
      const pintarMapa = () => {
        const enc = filas[h0] || [], faltan = !('cliente' in mapa);
        const ejemplo = i => { const fx = filas.slice(h0 + 1).find(fl => String(fl[i] ?? '').trim()); const v = fx ? fx[i] : ''; return v instanceof Date ? iso(v) : String(v ?? '').slice(0, 24); };
        const reconocidas = Object.keys(mapa).length;
        boxMap.innerHTML = `<details class="mapeo"${faltan ? ' open' : ''}><summary><b>Emparejar columnas</b> <span class="muted small">· ${reconocidas} de ${Object.keys(CAMPOS_IMPORTAR).length} campos reconocidos${h0 ? ` · encabezados en la fila ${h0 + 1}` : ''}</span></summary>
          <div class="form-grid" style="margin-top:12px">${Object.entries(CAMPOS_IMPORTAR).map(([k, l]) => `<div class="field"><label for="mp-${k}">${esc(l)}</label>
            <select id="mp-${k}" data-campo="${k}"><option value="">— No importar —</option>${enc.map((h, i) => `<option value="${i}"${mapa[k] === i ? ' selected' : ''}>${esc(String(h || `Columna ${i + 1}`))}${ejemplo(i) ? ` · ej. ${esc(ejemplo(i))}` : ''}</option>`).join('')}</select></div>`).join('')}</div>
          <p class="muted small">La app recuerda este emparejamiento para la próxima vez que suba un archivo con las mismas columnas.</p></details>`;
        boxMap.querySelectorAll('[data-campo]').forEach(sel => sel.onchange = () => {
          if (sel.value === '') delete mapa[sel.dataset.campo]; else mapa[sel.dataset.campo] = Number(sel.value);
          guardarMapeo(filas[h0], mapa); pintarPrevia();
          boxMap.querySelector('summary .muted').textContent = `· ${Object.keys(mapa).length} de ${Object.keys(CAMPOS_IMPORTAR).length} campos reconocidos`;
        });
      };
      f.querySelector('#impF').onchange = async e => {
        btn.disabled = true; prev.innerHTML = '<p class="muted">Leyendo archivo…</p>'; boxMap.innerHTML = '';
        try {
          filas = await leerArchivo(e.target.files[0]);
          h0 = filaEncabezados(filas);
          mapa = mapeoGuardado(filas[h0] || []) || adivinarMapa(filas[h0] || []);
          pintarMapa(); pintarPrevia();
        } catch (err) { prev.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      };
    },
    onSubmit: async (_d, f) => {
      const marcarPagados = f.querySelector('#impPag').checked;
      const listos = registros.filter(r => !r.errores.length);
      const btn = f.querySelector('[type=submit]');
      const clientes = await q(sb.from('clientes').select('id,nombre,rfc'));
      const porClave = new Map(clientes.map(c => [c.rfc || norm(c.nombre), c.id]));
      clientes.forEach(c => porClave.set(norm(c.nombre), c.id));
      const agenteDe = n => { const t = norm(n); if (!t) return null; return ctx.perfiles.find(p => norm(p.nombre) === t || norm(p.nombre).startsWith(t) || t.startsWith(norm(p.nombre)))?.id || null; };
      let nC = 0, nP = 0;
      for (const [i, r] of listos.entries()) {
        btn.textContent = `Importando ${i + 1} de ${listos.length}…`;
        const agente_id = agenteDe(r.agente);
        let cid = porClave.get(r.rfc) || porClave.get(norm(r.cliente));
        if (!cid) {
          const c = await q(sb.from('clientes').insert({ nombre: r.cliente, rfc: r.rfc, telefono: r.telefono, whatsapp: r.telefono, email: r.email,
            fecha_nacimiento: r.fecha_nacimiento, tipo_persona: /\b(s\.?a\.?|s\.?c\.?|s\. de r\.l\.|sapi|a\.c\.)\b/i.test(r.cliente) ? 'moral' : 'fisica', ...(agente_id ? { agente_id } : {}) }).select().single());
          cid = c.id; nC++; if (r.rfc) porClave.set(r.rfc, cid); porClave.set(norm(r.cliente), cid);
        }
        if (r.soloCliente) continue;
        let aseg = ctx.aseguradoras.find(a => norm(a.nombre) === norm(r.aseguradora) || norm(r.aseguradora).startsWith(norm(a.nombre)));
        if (!aseg) {
          if (!puedeAdministrar()) throw new Error(`La aseguradora "${r.aseguradora}" no existe; pida a un administrador que la dé de alta.`);
          aseg = await q(sb.from('aseguradoras').insert({ nombre: r.aseguradora }).select().single());
          await recargarCatalogos();
        }
        const pr = ctx.productos.find(x => x.aseguradora_id === aseg.id && x.ramo === r.ramo && norm(x.nombre) === norm(r.producto));
        const p = await q(sb.from('polizas').insert({ cliente_id: cid, aseguradora_id: aseg.id, producto_id: pr?.id || null, ramo: r.ramo, producto: r.producto, numero_poliza: r.numero_poliza,
          inicio_vigencia: r.inicio, fin_vigencia: r.fin, forma_pago: r.forma_pago, prima_neta: r.prima_neta ?? 0, prima_total: r.prima_total ?? 0, moneda: r.moneda,
          pct_comision: r.pct_comision ?? 0, ...(agente_id ? { agente_id } : {}) }).select().single());
        nP++;
        if (r.cancelada) await q(sb.from('polizas').update({ estatus: 'cancelada' }).eq('id', p.id));
        else if (marcarPagados) {
          const rec = await q(sb.from('recibos').select('id,fecha_limite').eq('poliza_id', p.id).lt('fecha_limite', hoyISO()));
          for (const x of rec) await q(sb.from('recibos').update({ estatus: 'pagado', fecha_pago: x.fecha_limite }).eq('id', x.id));
        }
      }
      toast(`Importación terminada: ${nC} clientes nuevos y ${nP} pólizas.`);
      alTerminar?.();
    }
  });
  return dlg;
}
