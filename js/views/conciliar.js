// Conciliación del estado de cuenta de comisiones de una aseguradora contra los recibos pagados
import { sb, ctx, q } from '../db.js';
import { esc, money, fdate, modal, toast, hoyISO, diasDesde, optsList , numRecibo } from '../ui.js';
import { leerArchivo, norm } from './importar.js';
import { leerPdf, extraerConIA, INSTRUCCION_ESTADO_CUENTA } from '../ia.js';

const COLS = {
  poliza: ['poliza', 'no poliza', 'no. poliza', 'numero de poliza', 'num poliza', 'poliza no'],
  comision: ['comision', 'importe comision', 'comision neta', 'importe', 'monto', 'total comision', 'comision pagada'],
  fecha: ['fecha', 'fecha de pago', 'fecha aplicacion', 'fecha de aplicacion', 'fecha movimiento'],
  recibo: ['recibo', 'no recibo', 'serie', 'num recibo', 'folio recibo'],
  prima: ['prima', 'prima neta', 'prima pagada'],
};
const numero = v => { if (typeof v === 'number') return v; const x = Number(String(v ?? '').replace(/[$,\s]/g, '')); return isNaN(x) ? null : x; };
const fechaIso = v => {
  if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const soloNum = v => String(v || '').replace(/[^0-9a-z]/gi, '').toUpperCase();

async function leerMovimientos(file) {
  if (/\.pdf$/i.test(file.name)) {
    const r = await extraerConIA(INSTRUCCION_ESTADO_CUENTA, await leerPdf(file, { maxPaginas: 20 }));
    return (r?.movimientos || r || []).map(m => ({ poliza: String(m.poliza || ''), recibo: m.recibo ? String(m.recibo) : null, prima: numero(m.prima), comision: numero(m.comision), fecha: fechaIso(m.fecha) }));
  }
  const filas = await leerArchivo(file);
  const iEnc = filas.findIndex(r => r.some(x => COLS.poliza.includes(norm(x))));
  if (iEnc < 0) throw new Error('No encontré la columna de número de póliza en el archivo.');
  const enc = filas[iEnc].map(norm), idx = {};
  Object.entries(COLS).forEach(([k, al]) => { const i = enc.findIndex(x => al.includes(x)); if (i >= 0) idx[k] = i; });
  if (idx.comision == null) throw new Error('No encontré la columna del importe de comisión.');
  return filas.slice(iEnc + 1).map(r => ({ poliza: String(r[idx.poliza] ?? '').trim(), recibo: idx.recibo != null ? String(r[idx.recibo] ?? '').trim() || null : null,
    prima: idx.prima != null ? numero(r[idx.prima]) : null, comision: numero(r[idx.comision]), fecha: idx.fecha != null ? fechaIso(r[idx.fecha]) : null }))
    .filter(m => m.poliza && m.comision);
}

// Empareja cada movimiento con un recibo pagado de esa póliza que aún no tenga comisión registrada
export function emparejar(movs, recibos) {
  const libres = recibos.filter(r => r.comision_recibida == null).map(r => ({ ...r }));
  return movs.map(m => {
    const cand = libres.filter(r => !r.usado && soloNum(r.numero_poliza) && (soloNum(r.numero_poliza) === soloNum(m.poliza) || soloNum(r.numero_poliza).endsWith(soloNum(m.poliza)) || soloNum(m.poliza).endsWith(soloNum(r.numero_poliza))));
    if (!cand.length) return { ...m, estado: 'sin_recibo' };
    let elegido = m.recibo ? cand.find(r => String(r.numero) === String(m.recibo).replace(/\D/g, '') || String(m.recibo).endsWith(`${numRecibo(r)}`)) : null;
    if (!elegido) elegido = [...cand].sort((a, b) => Math.abs(a.comision_esperada - m.comision) - Math.abs(b.comision_esperada - m.comision) || String(a.fecha_limite).localeCompare(String(b.fecha_limite)))[0];
    elegido.usado = true;
    const dif = Math.round((m.comision - Number(elegido.comision_esperada)) * 100) / 100;
    return { ...m, recibo_id: elegido.id, rec: elegido, dif, estado: Math.abs(dif) <= 1 ? 'conciliado' : 'diferencia' };
  });
}

export async function conciliarEstadoCuenta(alTerminar) {
  const [recibos, polizas] = await Promise.all([
    q(sb.from('v_recibos').select('*').eq('estatus', 'pagado').order('fecha_limite')),
    q(sb.from('polizas').select('id,aseguradora_id')),
  ]);
  const asegDe = Object.fromEntries(polizas.map(p => [p.id, p.aseguradora_id]));
  let res = [], asegSel = '';
  const dlg = modal({
    titulo: 'Conciliar estado de cuenta de comisiones', boton: 'Registrar comisiones',
    cuerpo: `<p style="margin-top:0">Suba el estado de cuenta de comisiones que le envía la aseguradora (Excel, CSV o PDF). Lo comparo contra los recibos pagados y registro las comisiones que coinciden.</p>
      <div class="form-grid">
        <div class="field"><label for="cAs">Aseguradora</label><select id="cAs"><option value="">Seleccione…</option>${optsList(ctx.aseguradoras, '')}</select></div>
        <div class="field"><label for="cFi">Estado de cuenta</label><input id="cFi" type="file" accept=".xlsx,.xls,.csv,.pdf" disabled></div>
      </div>
      <div id="cRes" style="margin-top:16px"></div>`,
    onOpen: f => {
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      f.querySelector('#cAs').onchange = e => { asegSel = e.target.value; f.querySelector('#cFi').disabled = !asegSel; };
      f.querySelector('#cFi').onchange = async e => {
        const box = f.querySelector('#cRes'); btn.disabled = true;
        box.innerHTML = `<p class="muted">${/\.pdf$/i.test(e.target.files[0]?.name) ? 'Leyendo el PDF con lectura automática… puede tardar.' : 'Leyendo el archivo…'}</p>`;
        try {
          const movs = await leerMovimientos(e.target.files[0]);
          if (!movs.length) throw new Error('No encontré comisiones en el archivo.');
          const deAseg = recibos.filter(r => asegDe[r.poliza_id] === asegSel);
          res = emparejar(movs, deAseg);
          const usados = new Set(res.map(r => r.recibo_id).filter(Boolean));
          const adeudo = deAseg.filter(r => r.comision_recibida == null && !usados.has(r.id) && Number(r.comision_esperada) > 0 && diasDesde(r.fecha_pago) > 45);
          const ok = res.filter(r => r.estado === 'conciliado'), dif = res.filter(r => r.estado === 'diferencia'), sin = res.filter(r => r.estado === 'sin_recibo');
          const total = res.reduce((a, r) => a + (r.comision || 0), 0);
          box.innerHTML = `
            <div class="chips"><span class="pill p-blue">${res.length} comisiones · ${money(total)}</span><span class="pill p-ok">${ok.length} coinciden</span>
              ${dif.length ? `<span class="pill p-warn">${dif.length} con diferencia</span>` : ''}${sin.length ? `<span class="pill p-bad">${sin.length} sin recibo en el sistema</span>` : ''}</div>
            <div class="tbl-wrap" style="margin-top:12px;max-height:300px;overflow:auto"><table>
              <thead><tr><th></th><th>Póliza</th><th>Cliente / recibo</th><th class="num">Esperada</th><th class="num">Pagada</th><th>Resultado</th></tr></thead>
              <tbody>${res.map((r, i) => `<tr><td>${r.recibo_id ? `<label class="sr" for="cc${i}">Registrar</label><input type="checkbox" id="cc${i}" data-i="${i}" ${r.estado === 'conciliado' ? 'checked' : ''} style="width:auto;min-height:0">` : ''}</td>
                <td class="nw">${esc(r.poliza)}</td><td>${r.rec ? `${esc(r.rec.cliente_nombre)}<div class="muted small">Recibo ${numRecibo(r.rec)} · pagado ${fdate(r.rec.fecha_pago)}</div>` : '<span class="muted">—</span>'}</td>
                <td class="num">${r.rec ? money(r.rec.comision_esperada) : '—'}</td><td class="num">${money(r.comision)}</td>
                <td>${r.estado === 'conciliado' ? '<span class="pill p-ok">Coincide</span>' : r.estado === 'diferencia' ? `<span class="pill p-warn">${r.dif > 0 ? '+' : ''}${money(r.dif)}</span>` : '<span class="pill p-bad">No encontrado</span>'}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small">Las que coinciden ya están marcadas. Revise las que tienen diferencia y márquelas si las acepta. Las "no encontradas" son pólizas que no están en el sistema o recibos que aún no se marcan como pagados.</p>
            ${adeudo.length ? `<div class="card" style="margin-top:12px;border-color:var(--warn-line);background:var(--warn-bg)"><b>Posibles comisiones que la aseguradora le debe (${adeudo.length})</b>
              <p class="small" style="margin:4px 0 8px">Recibos pagados hace más de 45 días cuya comisión no viene en este estado de cuenta ni está registrada:</p>
              <div class="list small">${adeudo.slice(0, 12).map(r => `<div class="li"><span>${esc(r.cliente_nombre)} · ${esc(r.numero_poliza || '')} · recibo ${numRecibo(r)}</span><span class="num">${money(r.comision_esperada)}</span></div>`).join('')}</div>
              ${adeudo.length > 12 ? `<p class="small">Y ${adeudo.length - 12} más.</p>` : ''}</div>` : ''}`;
          btn.disabled = !res.some(r => r.recibo_id);
        } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      };
    },
    onSubmit: async (_d, f) => {
      const marcados = [...f.querySelectorAll('[data-i]:checked')].map(c => res[Number(c.dataset.i)]);
      if (!marcados.length) throw new Error('Marque al menos una comisión para registrar.');
      for (const r of marcados) await q(sb.from('recibos').update({ comision_recibida: r.comision, fecha_comision: r.fecha || hoyISO() }).eq('id', r.recibo_id));
      toast(`${marcados.length} comisiones registradas.`);
      alTerminar?.();
    }
  });
  return dlg;
}
