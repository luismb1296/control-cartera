// Formularios compartidos: cliente, póliza, pago de recibo, documento
import { sb, ctx, q } from '../db.js';
import { leerPdf, extraerConIA, INSTRUCCION_POLIZA } from '../ia.js';
import {
  esc, modal, input, select, textarea, opts, optsList, RAMOS, FORMAS, CONDUCTOS, CAMPOS_RAMO, DOCS, DOCS_CLIENTE,
  num, txt, toast, parseD, iso, addMonths, hoyISO, money, fdate, TIPOS_MOV, EST_MOV, pill
, numRecibo, pctSugerido, ORIGEN_COMISION } from '../ui.js';

// ---------------------------------------------------------------- Cliente
export function formCliente(cliente, alGuardar) {
  const c = cliente || { tipo_persona: 'fisica' };
  const agentes = ctx.perfiles.filter(p => p.activo);
  modal({
    titulo: cliente ? 'Editar cliente' : 'Nuevo cliente',
    cuerpo: `<div class="form-grid">
      ${input('Nombre completo o razón social', 'nombre', { value: c.nombre, req: true, wide: true })}
      ${select('Tipo de persona', 'tipo_persona', opts({ fisica: 'Persona física', moral: 'Persona moral' }, c.tipo_persona))}
      ${input('RFC', 'rfc', { value: c.rfc, attrs: 'style="text-transform:uppercase"' })}
      ${input('CURP', 'curp', { value: c.curp, attrs: 'style="text-transform:uppercase"' })}
      ${input('Fecha de nacimiento / constitución', 'fecha_nacimiento', { type: 'date', value: c.fecha_nacimiento })}
      ${input('Teléfono', 'telefono', { type: 'tel', value: c.telefono })}
      ${input('WhatsApp', 'whatsapp', { type: 'tel', value: c.whatsapp })}
      ${input('Correo', 'email', { type: 'email', value: c.email })}
      ${input('Calle y número', 'calle', { value: c.calle, wide: true })}
      ${input('Colonia', 'colonia', { value: c.colonia })}
      ${input('Código postal', 'codigo_postal', { value: c.codigo_postal })}
      ${input('Ciudad', 'ciudad', { value: c.ciudad })}
      ${input('Estado', 'estado', { value: c.estado })}
      ${select('Agente responsable', 'agente_id', optsList(agentes, c.agente_id || ctx.perfil.id))}
      ${input('Banco (para reembolsos)', 'banco', { value: c.banco })}
      ${input('CLABE interbancaria', 'clabe', { value: c.clabe, attrs: 'inputmode="numeric" maxlength="18" pattern="[0-9]{18}"' })}
      ${input('Titular de la cuenta', 'cuenta_titular', { value: c.cuenta_titular })}
      ${textarea('Notas', 'notas', c.notas)}
    </div>`,
    onSubmit: async d => {
      const fila = {
        nombre: txt(d.nombre), tipo_persona: d.tipo_persona, rfc: txt(d.rfc)?.toUpperCase() ?? null,
        curp: txt(d.curp)?.toUpperCase() ?? null, fecha_nacimiento: txt(d.fecha_nacimiento), telefono: txt(d.telefono),
        whatsapp: txt(d.whatsapp), email: txt(d.email), calle: txt(d.calle), colonia: txt(d.colonia),
        codigo_postal: txt(d.codigo_postal), ciudad: txt(d.ciudad), estado: txt(d.estado),
        agente_id: d.agente_id || ctx.perfil.id, notas: txt(d.notas),
        banco: txt(d.banco), clabe: txt(d.clabe)?.replace(/\D/g, '') || null, cuenta_titular: txt(d.cuenta_titular)
      };
      if (fila.clabe && fila.clabe.length !== 18) throw new Error('La CLABE debe tener 18 dígitos.');
      let r;
      if (cliente) r = await q(sb.from('clientes').update(fila).eq('id', cliente.id).select().single());
      else r = await q(sb.from('clientes').insert(fila).select().single());
      toast(cliente ? 'Cliente actualizado.' : 'Cliente registrado.');
      alGuardar?.(r);
    }
  });
}

// ---------------------------------------------------------------- Póliza
// modo: 'nueva' | 'editar' | 'renovar'
export async function formPoliza({ poliza, clienteId, modo = 'nueva', alGuardar, prefill }) {
  const base = poliza ? { ...poliza } : { ramo: 'gmm', forma_pago: 'contado', moneda: 'MXN', conducto_cobro: 'agente', datos_ramo: {}, ...(prefill || {}) };
  let asegurados = [];
  if (poliza) {
    asegurados = await q(sb.from('asegurados').select('*').eq('poliza_id', poliza.id).order('nombre'));
  }
  if (modo === 'renovar') {
    const ini = parseD(poliza.fin_vigencia);
    base.inicio_vigencia = iso(ini);
    base.fin_vigencia = iso(addMonths(ini, 12));
    base.numero_poliza = '';
    base.poliza_anterior_id = poliza.id;
  }
  const clientes = clienteId || poliza ? [] : await q(sb.from('clientes').select('id,nombre,rfc').eq('activo', true).order('nombre'));
  let pdfPoliza = null;
  const aseg = ctx.aseguradoras.filter(a => a.activa || a.id === base.aseguradora_id);
  const agentes = ctx.perfiles.filter(p => p.activo || p.id === base.agente_id);
  const texAseg = asegurados.filter(a => a.tipo === 'asegurado').map(a => [a.nombre, a.parentesco || '', a.fecha_nacimiento || '', a.asegurado_desde || ''].join(', ').replace(/(, )+$/, '')).join('\n');
  const texBenef = asegurados.filter(a => a.tipo === 'beneficiario').map(a => [a.nombre, a.parentesco, a.porcentaje != null ? a.porcentaje + '%' : ''].filter(Boolean).join(', ')).join('\n');
  const titulo = { nueva: 'Nueva póliza', editar: 'Editar póliza', renovar: 'Registrar renovación' }[modo];

  if (!aseg.length) { toast('Primero dé de alta al menos una aseguradora en Configuración.', true); return; }

  modal({
    titulo,
    cuerpo: `
    <div class="pdf-box"><div><b>¿Tiene el PDF de la póliza?</b><div class="muted small">Súbalo y los datos se llenan solos; usted solo revisa y guarda. El PDF queda guardado en los documentos.</div></div>
      <label class="btn sm primary" for="polPdf" style="cursor:pointer">Leer PDF de la póliza</label><input type="file" id="polPdf" class="sr" accept="application/pdf,.pdf"></div>
    <p id="polPdfMsg" class="small" role="status" style="margin:0 0 12px"></p>
    ${modo === 'renovar' ? `<p class="muted small" style="margin-top:0">Se creará una póliza nueva ligada a la anterior (${esc(poliza.numero_poliza || 's/n')}), que quedará como "Renovada". Ajuste prima y número de la nueva póliza.</p>` : ''}
    <div class="form-grid">
      ${clientes.length ? select('Cliente (contratante)', 'cliente_id', '<option value="">Seleccione…</option>' + optsList(clientes, ''), { req: true, wide: true }) : ''}
      ${select('Aseguradora', 'aseguradora_id', '<option value="">Seleccione…</option>' + optsList(aseg, base.aseguradora_id), { req: true })}
      ${select('Ramo', 'ramo', opts(RAMOS, base.ramo), { req: true, attrs: 'data-ramo' })}
      ${select('Producto del catálogo', 'producto_id', '', { attrs: 'data-prod' })}
      ${input('Nombre del producto / plan', 'producto', { value: base.producto })}
      ${input('Número de póliza', 'numero_poliza', { value: base.numero_poliza })}
      ${input('Inicio de vigencia', 'inicio_vigencia', { type: 'date', value: base.inicio_vigencia, req: true, attrs: 'data-ini' })}
      ${input('Fin de vigencia', 'fin_vigencia', { type: 'date', value: base.fin_vigencia, req: true, attrs: 'data-fin' })}
      ${select('Forma de pago', 'forma_pago', opts(FORMAS, base.forma_pago))}
      ${select('Conducto de cobro', 'conducto_cobro', opts(CONDUCTOS, base.conducto_cobro))}
      ${select('Moneda', 'moneda', opts({ MXN: 'Pesos (MXN)', USD: 'Dólares (USD)', UDI: 'UDIS' }, base.moneda))}
      ${input('Prima neta anual', 'prima_neta', { type: 'number', value: base.prima_neta, req: true, attrs: 'step="0.01" min="0"' })}
      ${input('Prima total anual', 'prima_total', { type: 'number', value: base.prima_total, req: true, attrs: 'step="0.01" min="0"' })}
      ${input('% de comisión', 'pct_comision', { type: 'number', value: base.pct_comision ?? '', attrs: 'step="0.01" min="0" max="100"' })}
      <p class="muted small wide" id="comNota" role="status" style="margin:0"></p>
      ${input('Días para pagar el primer recibo', 'dias_primer_pago', { type: 'number', value: base.dias_primer_pago, attrs: 'min="0" data-d1' })}
      ${input('Días para pagar los siguientes recibos', 'dias_gracia', { type: 'number', value: base.dias_gracia, attrs: 'min="0" data-d2' })}
      <p class="muted small wide" id="plazoNota" style="margin:0"></p>
      ${select('Agente', 'agente_id', optsList(agentes, base.agente_id || ctx.perfil.id))}
    </div>
    <h3 style="font-size:15px;margin:22px 0 10px">Datos del ramo</h3>
    <div class="form-grid" id="datosRamo"></div>
    <h3 style="font-size:15px;margin:22px 0 10px">Personas</h3>
    <div class="form-grid">
      ${textarea('Asegurados (uno por renglón: Nombre, parentesco, fecha de nacimiento AAAA-MM-DD y, si se conoce, asegurado desde AAAA-MM-DD)', 'asegurados', texAseg)}
      ${textarea('Beneficiarios (uno por renglón: Nombre, parentesco, %)', 'beneficiarios', texBenef)}
      ${textarea('Notas', 'notas', base.notas)}
    </div>
    ${modo === 'editar' ? '<p class="muted small">Si cambia fechas, prima o forma de pago, los recibos se recalculan (solo si aún no hay recibos pagados).</p>' : ''}`,
    onOpen: form => {
      const pintar = () => {
        const campos = CAMPOS_RAMO[form.ramo.value] || [];
        form.querySelector('#datosRamo').innerHTML = campos.map(([k, l]) =>
          input(l, 'dr_' + k, { value: (base.datos_ramo || {})[k] ?? '' })).join('');
      };
      // Productos de la aseguradora y ramo elegidos; al elegir uno se llenan plazos y comisión
      const sP = form.producto_id, nota = form.querySelector('#plazoNota');
      const plazos = () => {
        const a = ctx.aseguradoras.find(x => x.id === form.aseguradora_id.value), pr = ctx.productos.find(x => x.id === sP.value);
        return { d1: pr?.dias_primer_pago ?? a?.dias_primer_pago ?? 30, d2: pr?.dias_pago_subsecuente ?? a?.dias_pago_subsecuente ?? 30, origen: pr ? 'del producto' : a ? 'de la aseguradora' : 'por omisión', pr };
      };
      const llenarPlazos = forzar => {
        const x = plazos();
        if (forzar || !form.dias_primer_pago.value) form.dias_primer_pago.value = x.d1;
        if (forzar || !form.dias_gracia.value) form.dias_gracia.value = x.d2;
        nota.textContent = `Plazos ${x.origen}: ${x.d1} días el primer recibo y ${x.d2} días los siguientes. Puede cambiarlos para esta póliza.`;
      };
      const productos = () => {
        const lista = ctx.productos.filter(x => x.aseguradora_id === form.aseguradora_id.value && x.ramo === form.ramo.value && (x.activo || x.id === base.producto_id));
        sP.innerHTML = `<option value="">${lista.length ? '— Elegir producto —' : 'Sin productos en el catálogo'}</option>` +
          lista.map(x => `<option value="${x.id}"${x.id === base.producto_id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('');
        sP.disabled = !lista.length;
      };
      // Comisión: se calcula con el producto (tabla por edad, primer año o renovación) mientras no se escriba a mano
      let comTocada = modo === 'editar', origenCom = modo === 'editar' ? (base.comision_origen || null) : null;
      const comNota = form.querySelector('#comNota');
      const sugerir = () => {
        const pr = ctx.productos.find(x => x.id === sP.value);
        const personas = lineas(form.asegurados.value).map(p => ({ nombre: p[0], parentesco: p[1], fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(p[2] || '') ? p[2] : null }));
        const sg = pctSugerido(pr, personas, form.inicio_vigencia.value || hoyISO(), modo === 'renovar' || !!base.poliza_anterior_id);
        const actual = form.pct_comision.value === '' ? null : Number(form.pct_comision.value);
        if (sg && !comTocada) { form.pct_comision.value = sg.pct; origenCom = sg.origen; }
        if (!sg) { comNota.innerHTML = origenCom ? `Comisión ${esc(ORIGEN_COMISION[origenCom] || origenCom)}.` : ''; return; }
        const difiere = comTocada && actual !== sg.pct;
        comNota.innerHTML = `${esc(sg.texto)}${difiere ? ` Esta póliza tiene ${actual ?? 0}%${origenCom ? ` (${esc(ORIGEN_COMISION[origenCom] || origenCom)})` : ''}. <button type="button" class="linkbtn small" id="comUsar">Usar ${sg.pct}%</button>` : ''}`;
        comNota.querySelector('#comUsar')?.addEventListener('click', () => { form.pct_comision.value = sg.pct; origenCom = sg.origen; comTocada = false; sugerir(); });
      };
      form.pct_comision.addEventListener('input', () => { comTocada = true; origenCom = 'manual'; sugerir(); });
      form.asegurados.addEventListener('input', sugerir);
      form.inicio_vigencia.addEventListener('change', sugerir);
      sP.onchange = () => {
        const x = plazos(); llenarPlazos(true);
        if (x.pr) form.producto.value = x.pr.nombre;
        sugerir();
      };
      form._sugerirComision = sugerir; form._origenCom = () => origenCom;
      form.aseguradora_id.onchange = () => { productos(); llenarPlazos(true); };
      productos(); llenarPlazos(false);
      form.ramo.onchange = () => { base.datos_ramo = leerDatosRamo(form); pintar(); productos(); llenarPlazos(true); sugerir(); };
      pintar(); sugerir();
      // Lectura automática del PDF de la póliza
      const msg = form.querySelector('#polPdfMsg');
      form.querySelector('#polPdf').onchange = async e => {
        const file = e.target.files[0]; if (!file) return;
        msg.style.color = ''; msg.textContent = 'Leyendo la póliza… puede tardar unos segundos.';
        try {
          const contenido = await leerPdf(file);
          const x = await extraerConIA(INSTRUCCION_POLIZA, contenido);
          const avisos = aplicarDatosPoliza(form, x, { clientes, clienteId, poliza });
          pdfPoliza = file; form._sugerirComision?.();
          msg.style.color = 'var(--ok)'; msg.innerHTML = `Datos leídos del PDF. <b>Revíselos antes de guardar.</b>${avisos.length ? '<br>' + avisos.map(esc).join('<br>') : ''}`;
          const crear = form.querySelector('#crearDesdePdf');
          if (crear) crear.onclick = async () => {
            try {
              const c = x.contratante || {};
              const nuevo = await q(sb.from('clientes').insert({ nombre: c.nombre, rfc: txt(c.rfc)?.toUpperCase() ?? null, curp: txt(c.curp), fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(c.fecha_nacimiento || '') ? c.fecha_nacimiento : null,
                calle: txt(c.calle), colonia: txt(c.colonia), codigo_postal: txt(c.codigo_postal), ciudad: txt(c.ciudad), estado: txt(c.estado), telefono: txt(c.telefono), whatsapp: txt(c.telefono), email: txt(c.email),
                tipo_persona: /\b(s\.?a\.?|s\.? de r\.?l|s\.?c\.?|a\.?c\.?)\b/i.test(c.nombre || '') ? 'moral' : 'fisica' }).select().single());
              form.cliente_id.insertAdjacentHTML('beforeend', `<option value="${nuevo.id}">${esc(nuevo.nombre)}</option>`); form.cliente_id.value = nuevo.id;
              crear.remove(); toast('Cliente creado con los datos del PDF.');
            } catch (err) { toast(err.message, true); }
          };
        } catch (err) { msg.style.color = 'var(--bad)'; msg.textContent = err.message; }
      };
      // Al poner inicio, sugiere fin a un año
      form.inicio_vigencia.onchange = () => {
        if (!form.fin_vigencia.value && form.inicio_vigencia.value) form.fin_vigencia.value = iso(addMonths(parseD(form.inicio_vigencia.value), 12));
      };
    },
    onSubmit: async (d, form) => {
      if (d.fin_vigencia <= d.inicio_vigencia) throw new Error('El fin de vigencia debe ser posterior al inicio.');
      const fila = {
        aseguradora_id: d.aseguradora_id, ramo: d.ramo, producto: txt(d.producto), numero_poliza: txt(d.numero_poliza),
        inicio_vigencia: d.inicio_vigencia, fin_vigencia: d.fin_vigencia, forma_pago: d.forma_pago,
        conducto_cobro: d.conducto_cobro, moneda: d.moneda, prima_neta: num(d.prima_neta) ?? 0,
        prima_total: num(d.prima_total) ?? 0, pct_comision: num(d.pct_comision) ?? 0,
        producto_id: d.producto_id || null, dias_primer_pago: num(d.dias_primer_pago), dias_gracia: num(d.dias_gracia), agente_id: d.agente_id || ctx.perfil.id,
        datos_ramo: leerDatosRamo(form), notas: txt(d.notas)
      };
      // De dónde salió el % (si la base aún no tiene la columna del ajuste 19, se guarda sin ella)
      const origen = form.querySelector('#comNota') ? (Number(fila.pct_comision) === Number(poliza?.pct_comision) && modo === 'editar' ? (poliza.comision_origen ?? null) : null) : null;
      const conOrigen = async op => { try { return await op({ ...fila, comision_origen: form._origenCom?.() ?? origen }); } catch (e) { if (/comision_origen/.test(e.message)) return op(fila); throw e; } };
      let guardada;
      if (modo === 'editar') {
        guardada = await conOrigen(f => q(sb.from('polizas').update(f).eq('id', poliza.id).select().single()));
        const cambio = ['inicio_vigencia', 'fin_vigencia', 'forma_pago', 'prima_neta', 'prima_total', 'pct_comision', 'dias_gracia', 'dias_primer_pago']
          .some(k => String(fila[k]) !== String(poliza[k]));
        if (cambio) {
          const { error } = await sb.rpc('regenerar_recibos', { p_poliza: poliza.id });
          if (error) {
            // Con pagos no se regeneran, pero la comisión esperada sí se actualiza en los recibos cuya comisión no ha llegado
            if (Number(fila.pct_comision) !== Number(poliza.pct_comision)) await sb.rpc('ajustar_comision', { p_poliza: poliza.id, p_pct: fila.pct_comision, p_origen: form._origenCom?.() || 'manual' });
            toast('Póliza guardada. Los recibos no se recalcularon porque ya hay pagos; ajústelos en Cobranza.', true);
          }
        }
        await q(sb.from('asegurados').delete().eq('poliza_id', poliza.id));
      } else {
        fila.cliente_id = clienteId || poliza?.cliente_id || d.cliente_id;
        if (modo === 'renovar') fila.poliza_anterior_id = poliza.id;
        guardada = await conOrigen(f => q(sb.from('polizas').insert(f).select().single()));
      }
      const personas = [
        ...lineas(d.asegurados).map(p => ({ tipo: 'asegurado', nombre: p[0], parentesco: p[1] || null, fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(p[2] || '') ? p[2] : null,
          // La antigüedad se conserva al editar o renovar (sirve para los periodos de espera)
          asegurado_desde: /^\d{4}-\d{2}-\d{2}$/.test(p[3] || '') ? p[3] : (modo !== 'renovar' || fila.aseguradora_id === poliza?.aseguradora_id) ? (asegurados.find(a => a.tipo === 'asegurado' && a.nombre.trim().toLowerCase() === String(p[0]).trim().toLowerCase())?.asegurado_desde || null) : null })),
        ...lineas(d.beneficiarios).map(p => ({ tipo: 'beneficiario', nombre: p[0], parentesco: p[1] || null, porcentaje: num((p[2] || '').replace('%', '')) }))
      ].map(p => ({ ...p, poliza_id: guardada.id }));
      if (personas.length) await q(sb.from('asegurados').insert(personas));
      if (pdfPoliza) {
        try {
          const ruta = await subirArchivo(pdfPoliza, guardada.cliente_id, 'polizas');
          await q(sb.from('documentos').insert({ cliente_id: guardada.cliente_id, poliza_id: guardada.id, tipo: 'poliza', nombre_archivo: pdfPoliza.name, ruta }));
        } catch (e) { toast('La póliza se guardó, pero el PDF no: ' + e.message, true); }
      }
      toast({ nueva: 'Póliza registrada. Sus recibos se generaron automáticamente.', editar: 'Póliza actualizada.', renovar: 'Renovación registrada.' }[modo]);
      alGuardar?.(guardada);
      if (modo === 'renovar') setTimeout(() => import('./renovaciones.js').then(m => m.revisarRenovacion(poliza, guardada)).catch(() => {}), 450);
    }
  });
}

function leerDatosRamo(form) {
  const o = {};
  form.querySelectorAll('#datosRamo input').forEach(i => { const v = txt(i.value); if (v) o[i.name.slice(3)] = v; });
  return o;
}
function lineas(t) {
  return String(t || '').split('\n').map(l => l.split(',').map(s => s.trim())).filter(p => p[0]);
}

// ---------------------------------------------------------------- Pago de recibo
export function formPago(recibo, alGuardar) {
  modal({
    titulo: `Registrar pago · recibo ${numRecibo(recibo)}`,
    boton: 'Marcar como pagado',
    cuerpo: `<p class="muted" style="margin-top:0">${esc(recibo.cliente_nombre || '')} · ${esc(recibo.numero_poliza || '')} · ${money(recibo.prima_total)}</p>
      <div class="form-grid">
        ${input('Fecha de pago', 'fecha_pago', { type: 'date', value: hoyISO(), req: true })}
        ${input('Importe pagado', 'prima_total', { type: 'number', value: recibo.prima_total, attrs: 'step="0.01" min="0"' })}
        <div class="field wide"><label for="comp">Comprobante (opcional)</label><input id="comp" name="archivo" type="file" accept=".pdf,image/*"></div>
      </div>
      <div id="pgTarde" class="small" role="status" style="margin-top:12px"></div>`,
    onOpen: form => {
      const aviso = () => {
        const fp = form.fecha_pago.value, box = form.querySelector('#pgTarde');
        if (!fp || !recibo.fecha_limite || fp <= recibo.fecha_limite || Number(recibo.prima_total) < 0) { box.innerHTML = ''; return; }
        const desde = iso(new Date(parseD(recibo.fecha_limite).getTime() + 864e5)), n = Math.round((parseD(fp) - parseD(recibo.fecha_limite)) / 864e5);
        box.innerHTML = `<div style="border-left:4px solid var(--warn);padding:8px 12px;background:var(--surface-2)"><b>Pago fuera de plazo (fecha límite ${fdate(recibo.fecha_limite)}).</b>
          La póliza se rehabilita, pero queda <b>al descubierto del ${fdate(desde)} al ${fdate(fp)}</b> (${n} día${n === 1 ? '' : 's'}): lo que ocurra o se diagnostique en esas fechas no tiene cobertura.
          Se registra en la póliza y se avisa en los siniestros que caigan en ese periodo.</div>`;
      };
      form.fecha_pago.addEventListener('input', aviso); form.fecha_pago.addEventListener('change', aviso); aviso();
    },
    onSubmit: async (d, form) => {
      const cambios = { estatus: 'pagado', fecha_pago: d.fecha_pago };
      const imp = num(d.prima_total); if (imp != null) cambios.prima_total = imp;
      const f = form.archivo.files[0];
      if (f) cambios.comprobante_ruta = await subirArchivo(f, recibo.cliente_id, 'recibos');
      const r = await q(sb.from('recibos').update(cambios).eq('id', recibo.id).select().single());
      toast(r?.descubierto_desde ? `Pago registrado. Periodo al descubierto: ${fdate(r.descubierto_desde)} al ${fdate(r.descubierto_hasta)}.` : 'Pago registrado.', !!r?.descubierto_desde);
      alGuardar?.();
    }
  });
}

// ---------------------------------------------------------------- Documentos
export async function subirArchivo(file, clienteId, sub = '') {
  if (file.size > 15 * 1024 * 1024) throw new Error('El archivo pesa más de 15 MB.');
  const limpio = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');
  const ruta = [ctx.perfil.agencia_id, clienteId, sub, `${Date.now()}-${limpio}`].filter(Boolean).join('/');
  const { error } = await sb.storage.from('documentos').upload(ruta, file, { upsert: false });
  if (error) throw new Error('No se pudo subir el archivo: ' + error.message);
  return ruta;
}

export async function abrirArchivo(ruta) {
  if (sb.demo) return sb.demo.verArchivo(ruta);
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from('documentos').createSignedUrl(ruta, 120);
  if (error) { w?.close(); toast('No se pudo abrir el archivo.', true); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

export function formDocumento(clienteId, polizas, alGuardar) {
  modal({
    titulo: 'Subir documento', boton: 'Subir',
    cuerpo: `<div class="form-grid">
      ${select('Tipo de documento', 'tipo', opts(Object.fromEntries(DOCS_CLIENTE.map(k => [k, DOCS[k]])), 'ine'), { req: true })}
      ${select('Relacionado con póliza', 'poliza_id', '<option value="">— Ninguna (documento del cliente) —</option>' +
        optsList(polizas, '', p => `${p.numero_poliza || 's/n'} · ${p.aseguradora_nombre}`))}
      ${input('Vigente hasta (opcional)', 'vigente_hasta', { type: 'date' })}
      <div class="field wide"><label for="arch">Archivo *</label><input id="arch" name="archivo" type="file" required accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"></div>
    </div>`,
    onSubmit: async (d, form) => {
      const f = form.archivo.files[0];
      if (!f) throw new Error('Seleccione un archivo.');
      const ruta = await subirArchivo(f, clienteId);
      await q(sb.from('documentos').insert({
        cliente_id: clienteId, poliza_id: d.poliza_id || null, tipo: d.tipo,
        nombre_archivo: f.name, ruta, vigente_hasta: txt(d.vigente_hasta)
      }));
      toast('Documento guardado.');
      alGuardar?.();
    }
  });
}

// ---------------------------------------------------------------- No renueva
export function marcarNoRenueva(poliza, alGuardar, alCancelar) {
  const dlg = modal({
    titulo: 'La póliza no se renovará', boton: 'Guardar',
    cuerpo: `<p class="muted" style="margin-top:0">${esc(poliza.numero_poliza || '')} · ${esc(poliza.cliente_nombre || '')}. Dejará de aparecer en renovaciones pendientes.</p>
      ${input('Motivo', 'motivo', { req: true, wide: true, attrs: 'placeholder="Ej. Vendió el vehículo, se cambió de agente, precio…"' })}`,
    onSubmit: async d => {
      await q(sb.from('polizas').update({ seguimiento: 'no_renueva', motivo_no_renovacion: txt(d.motivo) }).eq('id', poliza.id));
      guardado = true; toast('Registrado: no se renovará.'); alGuardar?.();
    }
  });
  let guardado = false;
  dlg.addEventListener('close', () => { if (!guardado) alCancelar?.(); }, { once: true });
}

// ---------------------------------------------------------------- Endosos de una póliza
export async function verMovimientos(poliza, alCambiar) {
  const { formEndoso, endosoAtrasado, endosoPorAplicar } = await import('./endosos.js');
  const lista = await q(sb.from('movimientos').select('*').eq('poliza_id', poliza.id).order('creado_en', { ascending: false }));
  const dlg = modal({
    titulo: `Endosos · ${poliza.numero_poliza || 's/n'}`,
    cuerpo: `
      <div class="filters" style="margin-bottom:14px;justify-content:space-between"><p class="muted small" style="margin:0">Cada endoso guarda qué cambia, su avance con la aseguradora y cómo afecta la prima.</p>
        <button type="button" class="btn primary" id="mvNuevo">+ Nuevo endoso</button></div>
      ${lista.length ? `<div class="list">${lista.map(m => `<a class="li" href="#/endoso/${m.id}" style="border-bottom:1px solid var(--line);padding-bottom:10px">
        <div style="min-width:0"><b>${esc(TIPOS_MOV[m.tipo] || m.tipo)}</b>${m.folio_endoso ? ` <span class="muted small">· ${esc(m.folio_endoso)}</span>` : ''}
          <div class="muted small">${esc(m.descripcion || '')}${m.fecha_efecto ? ' · efecto ' + fdate(m.fecha_efecto) : ''}</div>
          ${endosoAtrasado(m) ? '<div class="small" style="color:var(--bad)">Sin movimiento</div>' : ''}${endosoPorAplicar(m) ? '<div class="small" style="color:var(--warn)">Falta aplicar a la póliza</div>' : ''}</div>
        <div style="text-align:right">${pill(EST_MOV, m.estatus)}<div class="small num" style="margin-top:4px">${m.importe != null ? money(m.importe) : ''}</div></div></a>`).join('')}</div>`
        : '<div class="empty">Esta póliza no tiene endosos registrados.</div>'}`
  });
  dlg.querySelector('#mvNuevo').onclick = () => { dlg.close(); formEndoso({ polizaId: poliza.id, alGuardar: m => { location.hash = '#/endoso/' + m.id; } }); };
}

// Llena el formulario de póliza con lo que leyó la IA; regresa avisos para el usuario
function aplicarDatosPoliza(form, x, { clientes, clienteId, poliza }) {
  const n = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const avisos = [];
  const fecha = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';
  const pon = (campo, v) => { if (v != null && v !== '' && form[campo]) form[campo].value = v; };
  // Aseguradora y ramo (disparan productos y plazos)
  const aseg = ctx.aseguradoras.find(a => n(x.aseguradora) && (n(x.aseguradora).includes(n(a.nombre)) || n(a.nombre).includes(n(x.aseguradora)) || n(a.nombre).replace(/ /g, '') === n(x.aseguradora).replace(/ /g, '')));
  if (aseg) { form.aseguradora_id.value = aseg.id; form.aseguradora_id.onchange(); } else if (x.aseguradora) avisos.push(`La aseguradora "${x.aseguradora}" no está en su catálogo; elíjala o agréguela en Configuración.`);
  if (RAMOS[x.ramo]) { form.ramo.value = x.ramo; form.ramo.onchange(); }
  const prod = aseg && ctx.productos.find(p => p.aseguradora_id === aseg.id && p.ramo === form.ramo.value && n(x.producto) && (n(x.producto).includes(n(p.nombre)) || n(p.nombre).includes(n(x.producto))));
  if (prod) { form.producto_id.value = prod.id; form.producto_id.onchange(); } else pon('producto', x.producto);
  pon('numero_poliza', x.numero_poliza);
  pon('inicio_vigencia', fecha(x.inicio_vigencia)); pon('fin_vigencia', fecha(x.fin_vigencia));
  if (FORMAS[x.forma_pago]) form.forma_pago.value = x.forma_pago;
  if (['MXN', 'USD', 'UDI'].includes(x.moneda)) form.moneda.value = x.moneda;
  if (Number(x.prima_neta) > 0) form.prima_neta.value = Number(x.prima_neta);
  if (Number(x.prima_total) > 0) form.prima_total.value = Number(x.prima_total);
  Object.entries(x.datos_ramo || {}).forEach(([k, v]) => { if (v != null && v !== '' && form['dr_' + k]) form['dr_' + k].value = v; });
  if (Array.isArray(x.asegurados) && x.asegurados.length) form.asegurados.value = x.asegurados.filter(a => a?.nombre).map(a => [a.nombre, a.parentesco || '', fecha(a.fecha_nacimiento)].join(', ').replace(/(, )+$/, '')).join('\n');
  if (Array.isArray(x.beneficiarios) && x.beneficiarios.length) form.beneficiarios.value = x.beneficiarios.filter(b => b?.nombre).map(b => [b.nombre, b.parentesco || '', b.porcentaje != null ? b.porcentaje + '%' : ''].join(', ').replace(/(, )+$/, '')).join('\n');
  // Contratante
  const c = x.contratante || {};
  if (form.cliente_id && c.nombre) {
    const hallado = clientes.find(k => (c.rfc && k.rfc && n(k.rfc) === n(c.rfc)) || n(k.nombre) === n(c.nombre));
    if (hallado) { form.cliente_id.value = hallado.id; avisos.push(`Contratante encontrado: ${hallado.nombre}.`); }
    else {
      avisos.push(`El contratante "${c.nombre}" no está registrado.`);
      form.querySelector('#polPdfMsg').insertAdjacentHTML('afterend', `<button type="button" class="btn sm" id="crearDesdePdf" style="margin:-4px 0 12px">Crear cliente "${esc(c.nombre)}" con los datos del PDF</button>`);
    }
  } else if (c.nombre && (clienteId || poliza)) {
    const actual = poliza?.cliente_nombre;
    if (actual && n(actual) !== n(c.nombre)) avisos.push(`Atención: el contratante del PDF es "${c.nombre}" y la póliza se registrará a nombre de "${actual}".`);
  }
  if (poliza && x.numero_poliza && poliza.numero_poliza && n(x.numero_poliza) === n(poliza.numero_poliza) && form.numero_poliza.value === poliza.numero_poliza)
    avisos.push('El número de póliza es el mismo que el de la póliza anterior; verifique que sea la renovación.');
  return avisos;
}

// ---------------------------------------------------------------- % de comisión real de una póliza
export async function ajustarComision(p, alGuardar) {
  const [asegurados, recibos] = await Promise.all([
    q(sb.from('asegurados').select('nombre,parentesco,fecha_nacimiento,tipo').eq('poliza_id', p.id)),
    q(sb.from('recibos').select('id,comision_recibida,estatus').eq('poliza_id', p.id)),
  ]);
  const pr = ctx.productos.find(x => x.id === p.producto_id);
  const sg = pctSugerido(pr, asegurados.filter(a => a.tipo !== 'beneficiario'), p.inicio_vigencia, !!p.poliza_anterior_id);
  const n = recibos.filter(r => r.comision_recibida == null && r.estatus !== 'cancelado').length;
  modal({
    titulo: `Comisión de la póliza ${p.numero_poliza || 's/n'}`, boton: 'Guardar',
    cuerpo: `<p style="margin-top:0">Hoy: <b>${Number(p.pct_comision)}%</b>${p.comision_origen ? ` <span class="muted">(${esc(ORIGEN_COMISION[p.comision_origen] || p.comision_origen)})</span>` : ''}.</p>
      ${sg ? `<p class="small">${esc(sg.texto)}${Number(sg.pct) !== Number(p.pct_comision) ? ` <button type="button" class="linkbtn small" id="acUsar">Usar ${sg.pct}%</button>` : ''}</p>` : ''}
      <div class="form-grid">${input('% de comisión real de esta póliza', 'pct', { type: 'number', value: Number(p.pct_comision), req: true, attrs: 'step="0.01" min="0" max="100"' })}</div>
      <p class="muted small" style="margin-bottom:0">Se actualiza la comisión esperada de ${n} recibo${n === 1 ? '' : 's'} cuya comisión aún no llega (aunque el cliente ya haya pagado). Las comisiones ya registradas no cambian. Tip: al conciliar el estado de cuenta de la aseguradora, la app le propone el % real de cada póliza.</p>`,
    onOpen: f => { f.querySelector('#acUsar')?.addEventListener('click', () => { f.pct.value = sg.pct; f.pct.dataset.origen = sg.origen; }); f.pct.addEventListener('input', () => { delete f.pct.dataset.origen; }); },
    onSubmit: async (d, f) => {
      const { error } = await sb.rpc('ajustar_comision', { p_poliza: p.id, p_pct: num(d.pct), p_origen: f.pct.dataset.origen || 'manual' });
      if (error) throw new Error(/ajustar_comision/.test(error.message) ? 'Falta actualizar la base de datos: corra el archivo 19_tableros_comisiones.sql en Supabase.' : error.message);
      toast('Comisión actualizada.'); alGuardar?.();
    }
  });
}
