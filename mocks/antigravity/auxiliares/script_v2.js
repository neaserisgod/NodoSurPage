class Component extends DCLogic {
  state = {
    scr: 'pair', manual: false, user: '',
    cart: [], desc: false, step: 'cart', medio: 'efectivo', paga: 20000, mixEf: 'Mitad', q: '', scanN: 0,
    qp: '', psel: '',
    cash: { tipo: 'Gasto', caja: 'Cajón normal', monto: '', motivo: '', saved: false },
    prices: {}, stocks: {}, provOv: {}, extra: [], provSel: 'Todos', qprod: '', editId: '', editVal: '',
    histMedio: 'Todos', openSale: '', delSale: '', delMotivo: '', voided: {},
    sepVista: 'Qué separar', sepDone: {},
    page: '', pback: 'mgmt', modal: '', toast: '',
    cajaOpen: true, offline: false, fondo: '30000',
    closing: { efec: '', mp: '', lata: '', nota: '', stage: 'count' },
    arq: { efec: '', mp: '', lata: '' },
    selMode: false, sel: {},
    bulk: { op: 'Subió el precio', mode: 'Sumar %', val: '', prov: 'Del Sur', stage: 'edit' },
    conteo: { prov: 'Todos', vals: {}, onlySin: false },
    days: [
      { id: 'd1', fecha: 'Dom 28 sep', vendido: 312400, ganancia: 104800, n: 41 },
      { id: 'd2', fecha: 'Sáb 27 sep', vendido: 398900, ganancia: 131200, n: 55 }
    ],
    newday: { fecha: 'Lun 29 sep', medio: 'Efectivo', efec: '', items: [], q: '' },
    delDay: '',
    cfg: {
      redondeo: '$ 50', a1: '2800', a2: '2400', suelto: '350', vuelto: 'Caramelos surtidos',
      pagos: { Efectivo: true, QR: true, Débito: true, Mixto: true },
      cats: { Bebidas: 40, Almacén: 35, Fiambres: 45, Golosinas: 50 },
      users: { Ana: true, 'Martín': true, 'Lucía': true }, newUser: ''
    },
    form: { id: '', name: '', cod: '', price: '', cost: '', peso: false, stock: '', cat: 'Sin categoría', prov: 'Sin proveedor', activo: true },
    posnet: 'wait', upd: 'ask', updAvail: true
  };

  renderVals() {
    const s = this.state;
    const fmt = (n) => '$ ' + Math.round(n).toLocaleString('es-AR');
    const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const num = (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0;
    const go = (scr, extra) => this.setState({ scr, modal: '', ...(extra || {}) });
    const openPage = (page, back) => this.setState({ scr: 'page', page, pback: back || s.scr, modal: '' });
    const openModal = (modal) => this.setState({ modal });
    const closeModal = () => this.setState({ modal: '' });
    const toast = (msg) => {
      this.setState({ toast: msg });
      setTimeout(() => this.setState({ toast: '' }), 2600);
    };
    const patch = (key, v) => this.setState({ [key]: { ...this.state[key], ...v } });

    // ------------------------------------------------ catálogo
    const BASE = [
      { id: 'cerveza', name: 'Cerveza lata 473 ml', price: 2100, prov: 'Del Sur', stock: 48 },
      { id: 'gaseosa', name: 'Gaseosa cola 2,25 L', price: 2900, prov: 'Del Sur', stock: 4 },
      { id: 'agua', name: 'Agua mineral 1,5 L', price: 1200, prov: 'Del Sur', stock: 30 },
      { id: 'yogur', name: 'Yogur bebible 1 L', price: 2200, prov: 'Del Sur', stock: 15 },
      { id: 'leche', name: 'Leche entera 1 L', price: 1600, prov: 'Del Sur', stock: 22 },
      { id: 'facturas', name: 'Facturas (docena)', price: 6500, prov: 'La Espiga', stock: 9 },
      { id: 'pan', name: 'Pan lactal grande', price: 2800, prov: 'La Espiga', stock: 14 },
      { id: 'jamon', name: 'Jamón cocido', price: 14600, prov: 'Don Julio', kg: true, stock: 3200 },
      { id: 'queso', name: 'Queso de máquina', price: 11800, prov: 'Don Julio', kg: true, stock: 2100 },
      { id: 'papel', name: 'Papel higiénico x4', price: 2900, prov: 'Limpieza Total', stock: 14 },
      { id: 'detergente', name: 'Detergente 750 ml', price: 3100, prov: 'Limpieza Total', stock: 17 },
      { id: 'yerba', name: 'Yerba 1 kg', price: 4600, prov: 'Del Sur', stock: 20 }
    ];
    const P = BASE.concat(s.extra).map((p) => ({
      ...p,
      prov: s.provOv[p.id] || p.prov,
      price: s.prices[p.id] !== undefined ? s.prices[p.id] : p.price,
      stock: s.stocks[p.id] !== undefined ? s.stocks[p.id] : p.stock
    }));
    const byId = {};
    P.forEach((p) => { byId[p.id] = p; });
    const prTxt = (p) => (p.kg ? fmt(p.price) + '/kg' : fmt(p.price));
    const sub = (l) => { const p = byId[l.id]; return p.kg ? (p.price * l.qty) / 1000 : p.price * l.qty; };
    const PROVS = ['Del Sur', 'La Espiga', 'Don Julio', 'Limpieza Total'];

    // ------------------------------------------------ helpers de UI genérica
    const pill = (on) => 'height:42px;padding:0 18px;border-radius:999px;border:0;font-size:15px;font-weight:600;flex-shrink:0;white-space:nowrap;' + (on ? 'background:#121317;color:#fff' : 'background:#f3f4f7;color:#121317');
    const track = (on) => 'width:56px;height:32px;border-radius:999px;flex-shrink:0;padding:3px;box-sizing:border-box;display:flex;align-items:center;justify-content:' + (on ? 'flex-end' : 'flex-start') + ';background:' + (on ? '#121317' : '#d3d7df');
    const B = {
      hero: (label, big, sub) => ({ isHero: true, label, big, sub }),
      field: (label, value, onChange, ph, big) => ({ isField: true, label, value, onChange, ph: ph || '', fstyle: 'height:' + (big ? '54px' : '32px') + ';border:0;padding:0;background:transparent;color:#121317;font-size:' + (big ? '40px' : '20px') + ';font-weight:' + (big ? '400' : '500') + ';letter-spacing:' + (big ? '-0.05em' : '-0.02em') }),
      toggle: (label, desc, on, pick) => ({ isToggle: true, label, desc, track: track(on), knob: 'width:26px;height:26px;border-radius:50%;background:#fff', pick }),
      chips: (label, opts) => ({ isChips: true, label, opts: opts.map((o) => ({ label: o.label, style: pill(o.on), pick: o.pick })) }),
      row: (name, meta, right, pick, on) => ({ isRow: true, name, meta, right, pick: pick || (() => {}), rstyle: 'display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;flex-shrink:0;padding:16px 22px;box-sizing:border-box;border:0;border-radius:28px;text-align:left;' + (on ? 'background:#121317;color:#fff' : 'background:#f3f4f7;color:#121317') }),
      kv: (k, v, tone) => ({ isKv: true, k, v, vstyle: 'font-size:19px;font-weight:500;letter-spacing:-0.03em;font-variant-numeric:tabular-nums;color:' + (tone === 'good' ? '#0b7a5e' : tone === 'bad' ? '#b3261e' : '#121317') }),
      section: (text) => ({ isSection: true, text }),
      info: (text, tone) => ({ isInfo: true, text, istyle: 'padding:14px 18px;border-radius:22px;font-size:14px;line-height:1.4;' + (tone === 'warn' ? 'background:#fdecd6;color:#9a4a06' : tone === 'good' ? 'background:#e3f6ef;color:#0b7a5e' : 'background:#f3f4f7;color:#566070') }),
      stepper: (name, meta, qty, minus, plus) => ({ isStepper: true, name, meta, qty, minus, plus }),
      btn: (label, pick, kind) => ({ isBtn: true, label, pick, bstyle: 'flex-shrink:0;height:52px;border-radius:999px;border:0;font-size:16px;font-weight:600;' + (kind === 'dark' ? 'background:#121317;color:#fff' : kind === 'danger' ? 'background:#fbe0de;color:#b3261e' : 'background:#f3f4f7;color:#121317') })
    };
    const F = (key, k) => (e) => patch(key, { [k]: e.target.value });
    const prim = (label, pick, ok) => ({ label, pick, style: 'height:60px;border-radius:999px;border:0;font-size:17px;font-weight:600;' + (ok === false ? 'background:#f3f4f7;color:#9aa1ae;cursor:default' : 'background:#121317;color:#fff') });
    const sec2 = (label, pick, danger) => ({ label, pick, style: 'height:54px;border-radius:999px;border:0;font-size:16px;font-weight:600;' + (danger ? 'background:#fbe0de;color:#b3261e' : 'background:#f3f4f7;color:#121317') });

    // ------------------------------------------------ cierre / arqueo (constantes del día)
    const EXP = { ef: 186400, mp: 250800, lata: 42000 };
    const SEP = [['Distribuidora Del Sur', 84200], ['Panadería La Espiga', 31500], ['Fiambres Don Julio', 46800], ['Limpieza Total', 18900]];
    const diffTone = (d) => (d === 0 ? 'good' : 'bad');
    const diffTxt = (d) => (d === 0 ? 'Cuadró' : (d > 0 ? 'Sobran ' : 'Faltan ') + fmt(Math.abs(d)));

    // ------------------------------------------------ definición de páginas
    const pageDef = () => {
      const pg = s.page;
      if (pg === 'cierre') {
        const c = s.closing;
        if (c.stage === 'count') {
          const ok = c.efec !== '' && c.mp !== '' && c.lata !== '';
          return {
            title: 'Cerrar caja', blocks: [
              B.info('Contá el efectivo del cajón, cigarrillos incluidos, antes de ver la diferencia.'),
              B.field('Efectivo contado', c.efec, F('closing', 'efec'), '$ 0', true),
              B.field('MP contado (según la app de Mercado Pago)', c.mp, F('closing', 'mp'), '$ 0'),
              B.field('Lata contada', c.lata, F('closing', 'lata'), '$ 0'),
              B.field('Nota (opcional)', c.nota, F('closing', 'nota'), 'Ej: faltó cambio')
            ],
            buttons: [prim('Confirmar conteo', () => { if (ok) patch('closing', { stage: 'result' }); else toast('Falta el efectivo contado, el MP contado o la lata contada'); }, ok)]
          };
        }
        const de = num(c.efec) - EXP.ef, dm = num(c.mp) - EXP.mp, dl = num(c.lata) - EXP.lata;
        const all = de === 0 && dm === 0 && dl === 0;
        return {
          title: 'Caja cerrada', blocks: [
            B.hero(all ? 'Todo cuadró' : 'Revisá la diferencia', all ? 'Cuadró' : fmt(Math.abs(de) + Math.abs(dm) + Math.abs(dl)), all ? 'El conteo coincide con lo esperado.' : 'Es la suma de las diferencias de abajo.'),
            B.section('Efectivo'), B.kv('Caja esperada', fmt(EXP.ef)), B.kv('Efectivo contado', fmt(num(c.efec))), B.kv('Diferencia', diffTxt(de), diffTone(de)),
            B.section('Mercado Pago'), B.kv('MP esperado', fmt(EXP.mp)), B.kv('MP contado', fmt(num(c.mp))), B.kv('Diferencia', diffTxt(dm), diffTone(dm)),
            B.section('Lata de cigarrillos'), B.kv('Lata esperada', fmt(EXP.lata)), B.kv('Lata contada', fmt(num(c.lata))), B.kv('Diferencia', diffTxt(dl), diffTone(dl)),
            B.section('A separar por proveedor')
          ].concat(SEP.map(([n, a]) => B.row(n, '', fmt(a)))).concat([
            B.info('Reserva diaria de fijos: sin cargar los fijos de este mes.')
          ]),
          buttons: [prim('Listo', () => this.setState({ cajaOpen: false, scr: 'home', page: '', closing: { efec: '', mp: '', lata: '', nota: '', stage: 'count' } }))]
        };
      }
      if (pg === 'arqueo') {
        return {
          title: 'Arqueo', blocks: [
            B.hero('Efectivo esperado ahora', fmt(EXP.ef), 'Sin contar nada a mano — son los montos esperados según lo cargado hasta ahora.'),
            B.kv('Mercado Pago', fmt(EXP.mp)), B.kv('Lata de cigarrillos', fmt(EXP.lata)),
            B.kv('Vendido', fmt(482300)), B.kv('Ganancia', fmt(168900), 'good'),
            B.kv('Arrastrada de antes de hoy', fmt(0)), B.kv('Redondeo acumulado (ya incluido arriba)', fmt(350)),
            B.section('Separar (costo real) · por proveedor')
          ].concat(SEP.map(([n, a]) => B.row(n, '', fmt(a)))),
          buttons: [prim('Hacer arqueo con conteo', () => openModal('arqueo')), sec2('Volver', () => go('mgmt', { page: '' }))]
        };
      }
      if (pg === 'conteo') {
        const c = s.conteo;
        const list = P.filter((p) => (c.prov === 'Todos' || p.prov === c.prov) && (!c.onlySin || (c.vals[p.id] !== undefined ? c.vals[p.id] : p.stock) <= 0));
        const val = (p) => (c.vals[p.id] !== undefined ? c.vals[p.id] : p.stock);
        const changed = P.filter((p) => c.vals[p.id] !== undefined && c.vals[p.id] !== p.stock).length;
        return {
          title: 'Conteo de stock', blocks: [
            B.chips('Proveedor', [{ label: 'Todos juntos', on: c.prov === 'Todos', pick: () => patch('conteo', { prov: 'Todos' }) }].concat(PROVS.map((v) => ({ label: v, on: c.prov === v, pick: () => patch('conteo', { prov: v }) })))),
            B.chips('Filtro', [{ label: 'Todos', on: !c.onlySin, pick: () => patch('conteo', { onlySin: false }) }, { label: 'Sin stock', on: c.onlySin, pick: () => patch('conteo', { onlySin: true }) }])
          ].concat(list.map((p) => {
            const st = p.kg ? 100 : 1;
            return B.stepper(p.name, 'Sistema: ' + (p.kg ? p.stock + ' g' : p.stock + ' u.'), p.kg ? val(p) + ' g' : String(val(p)),
              () => patch('conteo', { vals: { ...c.vals, [p.id]: Math.max(0, val(p) - st) } }),
              () => patch('conteo', { vals: { ...c.vals, [p.id]: val(p) + st } }));
          })).concat(list.length ? [] : [B.info('Nada sin stock — todo contado')]),
          buttons: [prim('Guardar conteo', () => {
            if (!changed) { toast('No había nada para guardar'); return; }
            this.setState({ stocks: { ...s.stocks, ...Object.fromEntries(Object.entries(c.vals)) }, conteo: { ...c, vals: {} } });
            toast('Conteo guardado · ' + changed + (changed === 1 ? ' producto ajustado' : ' productos ajustados'));
          }, changed > 0), sec2('Volver', () => go('mgmt', { page: '' }))]
        };
      }
      if (pg === 'hist') {
        return {
          title: 'Días históricos', blocks: [
            B.info('Cargá días anteriores para tener los números completos.')
          ].concat(s.days.length ? s.days.map((d) => B.row(d.fecha, d.n + ' ventas · ganancia ' + fmt(d.ganancia), fmt(d.vendido), () => this.setState({ delDay: d.id, modal: 'delday' }))) : [B.info('Todavía no cargaste ningún día — tocá "Nuevo día"')]),
          buttons: [prim('Nuevo día', () => openPage('newday', 'hist')), sec2('Volver', () => go('mgmt', { page: '' }))]
        };
      }
      if (pg === 'newday') {
        const n = s.newday;
        const q = norm(n.q.trim());
        const found = q ? P.filter((p) => norm(p.name).includes(q)).slice(0, 4) : [];
        const tot = n.items.reduce((a, it) => a + (byId[it.id].kg ? (byId[it.id].price * it.qty) / 1000 : byId[it.id].price * it.qty), 0);
        const DAYS = ['Lun 29 sep', 'Dom 28 sep', 'Sáb 27 sep', 'Vie 26 sep', 'Jue 25 sep'];
        return {
          title: 'Nuevo día', blocks: [
            B.chips('Elegir la fecha de este día', DAYS.map((d) => ({ label: d, on: n.fecha === d, pick: () => patch('newday', { fecha: d }) }))),
            B.chips('Medio de pago', ['Efectivo', 'Mercado Pago', 'Mixto'].map((m) => ({ label: m, on: n.medio === m, pick: () => patch('newday', { medio: m }) }))),
            B.field('Buscá y tocá los productos de esta venta', n.q, F('newday', 'q'), 'Buscar producto vendido ese día')
          ].concat(found.map((p) => B.row(p.name, 'Tocá para agregar', prTxt(p), () => patch('newday', { items: n.items.concat([{ id: p.id, qty: p.kg ? 250 : 1 }]), q: '' }))))
            .concat(n.items.length ? [B.section('Ventas cargadas')] : [B.info('Sin ventas — buscá productos para cargar')])
            .concat(n.items.map((it, i) => B.stepper(byId[it.id].name, '', byId[it.id].kg ? it.qty + ' g' : String(it.qty),
              () => patch('newday', { items: n.items.map((x, j) => (j === i ? { ...x, qty: x.qty - (byId[x.id].kg ? 50 : 1) } : x)).filter((x) => x.qty > 0) }),
              () => patch('newday', { items: n.items.map((x, j) => (j === i ? { ...x, qty: x.qty + (byId[x.id].kg ? 50 : 1) } : x)) }))))
            .concat(n.medio === 'Mixto' ? [B.field('Monto en efectivo', n.efec, F('newday', 'efec'), '$ 0')] : [])
            .concat([B.kv('Vendido', fmt(tot))]),
          buttons: [prim('Guardar día', () => {
            if (!n.items.length) { toast('Agregá al menos un producto'); return; }
            this.setState({ days: [{ id: 'd' + (s.days.length + 3), fecha: n.fecha, vendido: tot, ganancia: Math.round(tot * 0.32), n: n.items.length }].concat(s.days), newday: { fecha: 'Lun 29 sep', medio: 'Efectivo', efec: '', items: [], q: '' }, scr: 'page', page: 'hist' });
            toast('Día guardado');
          }, n.items.length > 0), sec2('Cancelar', () => openPage('hist', 'mgmt'))]
        };
      }
      if (pg === 'config') {
        const c = s.cfg;
        const setC = (v) => patch('cfg', v);
        return {
          title: 'Configuración', blocks: [
            B.section('Caja'),
            B.chips('Redondeo en efectivo', ['Sin redondeo', '$ 50', '$ 100'].map((o) => ({ label: o, on: c.redondeo === o, pick: () => setC({ redondeo: o }) }))),
            B.section('Recargo de cigarrillos'),
            B.field('Primer atado', c.a1, F('cfg', 'a1'), '$ 0'), B.field('Atado adicional', c.a2, F('cfg', 'a2'), '$ 0'), B.field('Cigarrillo suelto', c.suelto, F('cfg', 'suelto'), '$ 0'),
            B.section('Producto de vuelto'),
            B.row(c.vuelto || 'Sin configurar', c.vuelto ? 'Se usa cuando falta cambio' : 'Elegí un producto', c.vuelto ? 'Quitar' : 'Elegir', () => setC({ vuelto: c.vuelto ? '' : 'Caramelos surtidos' })),
            B.section('Medios de pago')
          ].concat(Object.keys(c.pagos).map((k) => B.toggle(k, c.pagos[k] ? 'Activo' : 'Inactivo', c.pagos[k], () => setC({ pagos: { ...c.pagos, [k]: !c.pagos[k] } }))))
            .concat([B.section('Categorías (ganancia de referencia sobre el precio)')])
            .concat(Object.keys(c.cats).map((k) => B.stepper(k, 'Ganancia de referencia', c.cats[k] + ' %', () => setC({ cats: { ...c.cats, [k]: Math.max(0, c.cats[k] - 5) } }), () => setC({ cats: { ...c.cats, [k]: Math.min(99, c.cats[k] + 5) } }))))
            .concat([B.section('Usuarios')])
            .concat(Object.keys(c.users).map((k) => B.toggle(k, c.users[k] ? 'Activo' : 'Inactivo', c.users[k], () => setC({ users: { ...c.users, [k]: !c.users[k] } }))))
            .concat([B.btn('+ Agregar usuario', () => openModal('newuser'))]),
          buttons: [prim('Guardar', () => { toast('Configuración guardada'); }), sec2('Volver', () => go('mgmt', { page: '' }))]
        };
      }
      if (pg === 'cierres') {
        return {
          title: 'Cierres anteriores', blocks: [
            B.row('Ayer · cerró Ana', 'Efectivo ' + fmt(171200) + ' · MP ' + fmt(233400) + ' · Lata ' + fmt(40800), 'Cuadró'),
            B.row('Domingo · cerró Martín', 'Efectivo ' + fmt(142900) + ' · MP ' + fmt(188700) + ' · Lata ' + fmt(41900), 'Faltan $ 400'),
            B.row('Sábado · cerró Ana', 'Efectivo ' + fmt(205100) + ' · MP ' + fmt(301600) + ' · Lata ' + fmt(39500), 'Cuadró'),
            B.row('Viernes · cerró Lucía', 'Efectivo ' + fmt(158300) + ' · MP ' + fmt(219900) + ' · Lata ' + fmt(40100), 'Sobran $ 150')
          ],
          buttons: [sec2('Volver', () => go('mgmt', { page: '' }))]
        };
      }
      if (pg === 'form') {
        const f = s.form;
        const setF = (v) => patch('form', v);
        const price = num(f.price), cost = num(f.cost);
        const cats = ['Sin categoría', 'Bebidas', 'Almacén', 'Fiambres', 'Golosinas', 'Limpieza'];
        const isNew = !f.id;
        return {
          title: isNew ? 'Nuevo producto' : 'Editar producto', blocks: [
            B.section('Datos básicos'),
            B.field('Nombre', f.name, F('form', 'name'), 'Ej: Alfajor triple'),
            B.field('Código de barras (opcional)', f.cod, F('form', 'cod'), 'Escribilo o escaneá'),
            B.btn('Escanear código', () => setF({ cod: '7790895001234' })),
            B.toggle('Se vende pesado (por kilo)', f.peso ? 'El precio y el stock van por kilo y gramos' : 'Se vende por unidad', f.peso, () => setF({ peso: !f.peso })),
            B.field(f.peso ? 'Precio/kilo' : 'Precio', f.price, F('form', 'price'), '$ 0', true),
            B.field(f.peso ? 'Costo/kilo' : 'Costo', f.cost, F('form', 'cost'), '$ 0')
          ].concat(price > 0 && cost > price ? [B.info('El precio no cubre el costo', 'warn')] : [])
            .concat([
              B.field(f.peso ? 'Stock (gramos)' : 'Stock (unidades)', f.stock, F('form', 'stock'), '0'),
              B.section('Organización'),
              B.chips('Categoría', cats.map((c) => ({ label: c, on: f.cat === c, pick: () => setF({ cat: c }) }))),
              B.chips('Proveedor', ['Sin proveedor'].concat(PROVS).map((c) => ({ label: c, on: f.prov === c, pick: () => setF({ prov: c }) }))),
              B.toggle('Activo (se puede vender)', f.activo ? 'Aparece en la venta' : 'Oculto en la venta', f.activo, () => setF({ activo: !f.activo }))
            ]),
          buttons: [prim(isNew ? 'Dar de alta' : 'Guardar cambios', () => {
            if (!f.name.trim()) { toast('Falta el nombre'); return; }
            if (!price) { toast(f.peso ? 'Un producto pesable necesita precio por kilo' : 'Precio, costo o stock inválido'); return; }
            if (isNew) {
              const id = 'x' + (s.extra.length + 1);
              this.setState({ extra: s.extra.concat([{ id, name: f.name.trim(), price, prov: f.prov === 'Sin proveedor' ? 'Sin proveedor' : f.prov, kg: f.peso, stock: num(f.stock) }]), scr: 'prod', page: '' });
              toast('Producto dado de alta');
            } else {
              this.setState({ prices: { ...s.prices, [f.id]: price }, stocks: { ...s.stocks, [f.id]: num(f.stock) }, provOv: f.prov === 'Sin proveedor' ? s.provOv : { ...s.provOv, [f.id]: f.prov }, scr: 'prod', page: '' });
              toast('Cambios guardados');
            }
          }), sec2('Cancelar', () => go('prod', { page: '' }))]
        };
      }
      return { title: '', blocks: [], buttons: [] };
    };

    // ------------------------------------------------ definición de modales
    const modalDef = () => {
      const m = s.modal;
      const cancel = (label) => sec2(label || 'Cancelar', closeModal);
      if (m === 'arqueo') {
        const a = s.arq;
        const ok = a.efec !== '' && a.mp !== '' && a.lata !== '';
        return {
          title: 'Arqueo obligatorio', text: 'Contá el efectivo del cajón, cigarrillos incluidos. Lo que cuentes queda precargado en el cierre.', blocks: [
            B.kv('Caja esperada', fmt(EXP.ef)), B.kv('MP esperado', fmt(EXP.mp)), B.kv('Lata esperada', fmt(EXP.lata)),
            B.field('Efectivo contado', a.efec, F('arq', 'efec'), '$ 0'), B.field('MP contado (según la app de Mercado Pago)', a.mp, F('arq', 'mp'), '$ 0'), B.field('Lata contada', a.lata, F('arq', 'lata'), '$ 0')
          ].concat(ok ? [B.kv('Diferencia en efectivo', diffTxt(num(a.efec) - EXP.ef), diffTone(num(a.efec) - EXP.ef))] : []),
          buttons: [prim('Confirmar arqueo', () => {
            if (!ok) { toast('Contá el efectivo y anotalo antes de confirmar'); return; }
            this.setState({ closing: { ...s.closing, efec: a.efec, mp: a.mp, lata: a.lata }, modal: '' });
            toast('Arqueo guardado');
          }, ok), cancel()]
        };
      }
      if (m === 'abrir') {
        return {
          title: 'Abrir caja', text: 'No hay caja abierta en la PC ahora mismo.', blocks: [
            B.field('Fondo inicial (caja normal)', s.fondo, (e) => this.setState({ fondo: e.target.value }), '$ 0', true)
          ],
          buttons: [prim('Abrir caja y vender', () => { this.setState({ cajaOpen: true, modal: '', scr: 'sale', step: 'cart' }); toast('Caja abierta con ' + fmt(num(s.fondo))); }), cancel()]
        };
      }
      if (m === 'posnet') {
        if (s.posnet === 'wait') {
          return {
            title: 'Cobrando en la terminal', text: 'Pedile al cliente que acerque la tarjeta o escanee el QR. Esperando la confirmación de Mercado Pago…', blocks: [B.hero('Total a cobrar', fmt(total0()), 'Esperando el pago')],
            buttons: [prim('Simular pago aprobado', () => this.setState({ modal: '', step: 'done' })), sec2('Simular pago rechazado', () => this.setState({ posnet: 'fail' })), cancel('Cancelar cobro')]
          };
        }
        return {
          title: 'El pago no se aprobó', text: 'El pago no se aprobó en la terminal. Cancelala a mano en la terminal si sigue esperando el pago.', blocks: [B.info('No se cobró nada todavía.', 'warn')],
          buttons: [prim('Reintentar', () => this.setState({ posnet: 'wait' })), sec2('Cobrar a mano', () => this.setState({ modal: '', step: 'done' })), cancel('Cancelar')]
        };
      }
      if (m === 'delday') {
        const d = s.days.find((x) => x.id === s.delDay);
        return {
          title: 'Borrar día completo', text: d ? '¿Borrar el ' + d.fecha + ' con sus ' + d.n + ' ventas? No se puede deshacer.' : '', blocks: [],
          buttons: [sec2('Borrar día completo', () => { this.setState({ days: s.days.filter((x) => x.id !== s.delDay), modal: '' }); toast('Día borrado'); }, true), cancel('Cancelar')]
        };
      }
      if (m === 'newuser') {
        return {
          title: 'Agregar usuario', text: '', blocks: [B.field('Nombre', s.cfg.newUser, F('cfg', 'newUser'), 'Escribí un nombre', true)],
          buttons: [prim('Agregar', () => {
            const nm = s.cfg.newUser.trim();
            if (!nm) { toast('Escribí un nombre'); return; }
            this.setState({ cfg: { ...s.cfg, users: { ...s.cfg.users, [nm]: true }, newUser: '' }, modal: '' });
          }), cancel()]
        };
      }
      if (m === 'update') {
        if (s.upd === 'ask') {
          return { title: 'Hay una versión nueva', text: 'La 1.0.1 ya está lista: mejoras en el cobro y en el historial.', blocks: [B.info('Versión instalada: 1.0.0')], buttons: [prim('Descargar', () => this.setState({ upd: 'ready' })), cancel('Después')] };
        }
        return { title: 'Lista para instalar', text: 'Se descargó y se verificó que el archivo coincide con el publicado.', blocks: [B.info('Al instalar, la app se cierra y se vuelve a abrir.', 'good')], buttons: [prim('Instalar ahora', () => { this.setState({ modal: '', updAvail: false, upd: 'ask' }); toast('Instalando la 1.0.1…'); }), cancel('Después')] };
      }
      if (m === 'bulk') {
        const b = s.bulk;
        const n = Object.keys(s.sel).filter((k) => s.sel[k]).length;
        const val = num(b.val);
        const ops = ['Subió el precio', 'Recibí un pedido', 'Asignar proveedor'];
        const head = B.chips('¿Qué querés hacer?', ops.map((o) => ({ label: o, on: b.op === o, pick: () => patch('bulk', { op: o, stage: 'edit' }) })));
        const summary = b.op === 'Subió el precio' ? (b.mode === 'Sumar %' ? 'Sumar ' + val + ' % al precio de venta' : 'Sumar ' + fmt(val) + ' al precio de venta') : b.op === 'Recibí un pedido' ? 'Sumar ' + val + ' unidades al stock' : 'Asignar el proveedor ' + b.prov;
        if (b.stage === 'edit') {
          const extra = b.op === 'Subió el precio'
            ? [B.chips('Cómo', ['Sumar %', 'Sumar monto'].map((o) => ({ label: o, on: b.mode === o, pick: () => patch('bulk', { mode: o }) }))), B.field(b.mode === 'Sumar %' ? 'Porcentaje a sumar' : 'Monto a sumar', b.val, F('bulk', 'val'), '0', true), B.info('Se aplica al precio de venta de cada producto marcado.')]
            : b.op === 'Recibí un pedido'
              ? [B.field('Unidades a sumar', b.val, F('bulk', 'val'), '0', true)]
              : [B.chips('Proveedor', PROVS.map((o) => ({ label: o, on: b.prov === o, pick: () => patch('bulk', { prov: o }) }))), B.info('El proveedor elegido reemplaza el actual en los productos marcados.')];
          const ok = b.op === 'Asignar proveedor' || val > 0;
          return { title: n + (n === 1 ? ' producto seleccionado' : ' productos seleccionados'), text: '', blocks: [head].concat(extra), buttons: [prim('Revisar', () => { if (ok) patch('bulk', { stage: 'review' }); else toast('Valor inválido'); }, ok), cancel()] };
        }
        return {
          title: 'Vas a aplicar esto:', text: '', blocks: [B.hero(n + (n === 1 ? ' producto' : ' productos'), summary, b.op === 'Subió el precio' && b.mode === 'Sumar %' && val > 50 ? 'Revisá: puede que te haya sobrado un dígito.' : '')],
          buttons: [prim('Sí, aplicar', () => {
            const ids = Object.keys(s.sel).filter((k) => s.sel[k]);
            if (b.op === 'Subió el precio') {
              const np = { ...s.prices };
              ids.forEach((id) => { const p = byId[id]; np[id] = b.mode === 'Sumar %' ? Math.round(p.price * (1 + val / 100)) : p.price + val; });
              this.setState({ prices: np });
            } else if (b.op === 'Recibí un pedido') {
              const ns = { ...s.stocks };
              ids.forEach((id) => { ns[id] = byId[id].stock + val * (byId[id].kg ? 1000 : 1); });
              this.setState({ stocks: ns });
            } else {
              const no = { ...s.provOv };
              ids.forEach((id) => { no[id] = b.prov; });
              this.setState({ provOv: no });
            }
            this.setState({ modal: '', selMode: false, sel: {}, bulk: { ...b, stage: 'edit', val: '' } });
            toast('Cambios aplicados a ' + ids.length + (ids.length === 1 ? ' producto' : ' productos'));
          }), sec2('Volver', () => patch('bulk', { stage: 'edit' }))]
        };
      }
      return { title: '', text: '', blocks: [], buttons: [] };
    };

    // totales de la venta (necesarios en modales)
    const subtotal = s.cart.reduce((a, l) => a + sub(l), 0);
    const descMonto = s.desc ? Math.round(subtotal * 0.1) : 0;
    const total = subtotal - descMonto;
    function total0() { return total; }
    const n = s.cart.length;
    const canPay = n > 0;

    const addTo = (id) => {
      const p = byId[id]; const st = p.kg ? 250 : 1;
      const cart = this.state.cart.map((l) => ({ ...l }));
      const f = cart.find((l) => l.id === id);
      if (f) f.qty += st; else cart.push({ id, qty: st });
      this.setState({ cart, step: 'cart' });
    };

    // ---- carrito ----
    const q = norm(s.q.trim());
    const matches = q ? P.filter((p) => norm(p.name).includes(q)).slice(0, 4) : [];
    const results = matches.map((p) => ({ name: p.name, price: prTxt(p), pick: () => { addTo(p.id); this.setState({ q: '' }); } }));
    const lines = s.cart.map((l) => {
      const p = byId[l.id]; const st = p.kg ? 50 : 1;
      return {
        name: p.name, qty: p.kg ? l.qty + ' g' : String(l.qty), sub: fmt(sub(l)),
        minus: () => this.setState({ cart: s.cart.map((x) => (x.id === l.id ? { ...x, qty: x.qty - st } : x)).filter((x) => x.qty > 0) }),
        plus: () => this.setState({ cart: s.cart.map((x) => (x.id === l.id ? { ...x, qty: x.qty + st } : x)) }),
        del: () => this.setState({ cart: s.cart.filter((x) => x.id !== l.id) })
      };
    });
    const MEDIOS = [['efectivo', 'Efectivo'], ['qr', 'QR de Mercado Pago'], ['debito', 'Tarjeta de débito'], ['mixto', 'Pago mixto']];
    const medios = MEDIOS.map(([id, label]) => {
      const on = id === s.medio;
      return {
        label,
        style: 'display:flex;align-items:center;justify-content:space-between;height:58px;padding:0 22px;border-radius:999px;color:#121317;background:#f3f4f7;flex-shrink:0;border:2px solid ' + (on ? '#121317' : 'transparent'),
        radio: 'width:22px;height:22px;box-sizing:border-box;border-radius:50%;border:2px solid ' + (on ? '#121317' : '#c4c9d4') + ';background:' + (on ? 'radial-gradient(#121317 0 45%, #f3f4f7 50%)' : '#f3f4f7'),
        pick: () => this.setState({ medio: id })
      };
    });
    const pagaVal = s.paga === null ? total : s.paga;
    const vuelto = pagaVal - total;
    const pagaChips = [['Justo', null], ['$ 20.000', 20000], ['$ 50.000', 50000]].map(([label, v]) => ({
      label,
      style: 'height:40px;padding:0 18px;border-radius:999px;border:0;font-size:15px;font-weight:600;' + (s.paga === v ? 'background:#121317;color:#fff' : 'background:#fff;color:#121317'),
      pick: () => this.setState({ paga: v })
    }));
    const mixVal = s.mixEf === 'Mitad' ? Math.round(total / 2) : Math.min(num(s.mixEf), total);
    const mixChips = ['Mitad', '$ 10.000', '$ 20.000'].map((label) => ({
      label,
      style: 'height:40px;padding:0 18px;border-radius:999px;border:0;font-size:15px;font-weight:600;' + (s.mixEf === label ? 'background:#121317;color:#fff' : 'background:#fff;color:#121317'),
      pick: () => this.setState({ mixEf: label })
    }));
    const medioNombre = Object.fromEntries(MEDIOS)[s.medio];

    // ---- precio ----
    const qp = norm(s.qp.trim());
    const pList = qp ? P.filter((p) => norm(p.name).includes(qp)) : P.slice(0, 6);
    const priceResults = pList.map((p) => ({ name: p.name, price: prTxt(p), pick: () => this.setState({ psel: p.id }) }));
    const ps = byId[s.psel];

    // ---- caja ----
    const cashTipos = ['Gasto', 'Ingreso'].map((t) => ({
      label: t,
      style: 'flex:1;height:48px;border-radius:999px;border:0;font-size:16px;font-weight:600;' + (s.cash.tipo === t ? 'background:#121317;color:#fff' : 'background:transparent;color:#121317'),
      pick: () => this.setState({ cash: { ...s.cash, tipo: t, saved: false } })
    }));
    const cashCajas = ['Cajón normal', 'Mercado Pago'].map((t) => ({
      label: t,
      style: 'flex:1;height:52px;border-radius:999px;border:0;font-size:15px;font-weight:600;' + (s.cash.caja === t ? 'background:#121317;color:#fff' : 'background:#f3f4f7;color:#121317'),
      pick: () => this.setState({ cash: { ...s.cash, caja: t, saved: false } })
    }));

    // ---- productos ----
    const provs = ['Todos'].concat(PROVS).map((p) => ({ label: p, style: pill(s.provSel === p), pick: () => this.setState({ provSel: p }) }));
    const qpr = norm(s.qprod.trim());
    const selCount = Object.keys(s.sel).filter((k) => s.sel[k]).length;
    const prodRows = P.filter((p) => (s.provSel === 'Todos' || p.prov === s.provSel) && (!qpr || norm(p.name).includes(qpr))).map((p) => {
      const on = Boolean(s.sel[p.id]);
      return {
        name: p.name, prov: p.prov + ' · ' + (p.kg ? (p.stock / 1000).toLocaleString('es-AR') + ' kg' : p.stock + ' en stock'), price: prTxt(p),
        check: s.selMode, mark: on ? '✓' : '',
        checkStyle: 'width:26px;height:26px;border-radius:50%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;' + (on ? 'background:#121317;color:#fff' : 'background:#fff;border:2px solid #c4c9d4'),
        rowStyle: 'display:flex;align-items:center;gap:12px;width:100%;padding:16px 22px;box-sizing:border-box;border:0;border-radius:28px;text-align:left;flex-shrink:0;color:#121317;background:#f3f4f7;' + (on ? 'outline:2px solid #121317' : ''),
        pick: () => (s.selMode ? this.setState({ sel: { ...s.sel, [p.id]: !on } }) : this.setState({ editId: p.id, editVal: String(p.price) }))
      };
    });
    const ed = byId[s.editId];

    // ---- historial ----
    const SALES = [
      ['0143', '20:12', 'Efectivo', [['cerveza', 2], ['jamon', 250], ['facturas', 1]]],
      ['0142', '19:48', 'QR', [['yerba', 1], ['yogur', 2]]],
      ['0141', '19:20', 'Débito', [['gaseosa', 1], ['agua', 2]]],
      ['0140', '18:55', 'Efectivo', [['leche', 2], ['facturas', 1]]],
      ['0139', '18:31', 'Mixto', [['queso', 300], ['papel', 1]]],
      ['0138', '17:40', 'QR', [['cerveza', 6]]]
    ].map((r) => {
      const ls = r[3].map(([id, qty]) => { const p = byId[id]; return { name: p.name, q: p.kg ? qty + ' g' : String(qty), sub: p.kg ? (p.price * qty) / 1000 : p.price * qty }; });
      return { id: r[0], time: r[1], medio: r[2], lines: ls, total: ls.reduce((a, l) => a + l.sub, 0) };
    });
    const hm = s.histMedio;
    const hList = SALES.filter((x) => hm === 'Todos' || x.medio === hm);
    const hValid = hList.filter((x) => !s.voided[x.id]);
    const sales = hList.map((x) => {
      const v = Boolean(s.voided[x.id]); const open = s.openSale === x.id;
      return {
        id: x.id, time: x.time, medio: v ? 'Eliminada' : x.medio, total: fmt(x.total), open: open && !v,
        totalStyle: 'font-size:22px;letter-spacing:-0.04em;font-variant-numeric:tabular-nums;' + (v ? 'text-decoration:line-through;opacity:0.5' : ''),
        box: 'flex-shrink:0;border-radius:28px;' + (open && !v ? 'background:#121317;color:#fff' : 'background:#f3f4f7;color:#121317'),
        lines: x.lines.map((l) => ({ name: l.name, q: l.q, sub: fmt(l.sub) })),
        delTxt: 'Eliminar venta',
        pick: () => this.setState({ openSale: open ? '' : x.id }),
        del: () => this.setState({ delSale: x.id, delMotivo: '' })
      };
    });
    const histMedios = ['Todos', 'Efectivo', 'QR', 'Débito', 'Mixto'].map((m) => ({
      label: m === 'Todos' ? 'Todos los medios' : m, style: pill(hm === m), pick: () => this.setState({ histMedio: m, openSale: '' })
    }));

    // ---- gestión ----
    const mgmtTiles = [
      { label: 'Conteo de stock', hint: 'Por proveedor', pick: () => openPage('conteo', 'mgmt') },
      { label: 'Carga histórica', hint: 'Días anteriores', pick: () => openPage('hist', 'mgmt') },
      { label: 'Arqueo', hint: '¿Cómo vamos?', pick: () => openPage('arqueo', 'mgmt') },
      { label: 'Separaciones', hint: 'Qué separar hoy', pick: () => go('sep') },
      { label: 'Cierres anteriores', hint: 'Cómo cerró cada día', pick: () => openPage('cierres', 'mgmt') },
      { label: 'Cambiar usuario', hint: 'Elegir otra persona', pick: () => go('user') },
      { label: 'Configuración', hint: 'Reglas del negocio', pick: () => openPage('config', 'mgmt') },
      { label: 'Actualización', hint: s.updAvail ? 'Hay una versión nueva' : 'Estás al día', pick: () => (s.updAvail ? openModal('update') : toast('Ya tenés la última versión')) }
    ];

    // ---- separaciones ----
    const sepAll = s.sepVista === 'Qué separar';
    const sepTotal = SEP.reduce((a, r) => a + r[1], 0);
    const sepEf = 115700;
    const sepRows = SEP.map(([name, amount]) => {
      const on = Boolean(s.sepDone[name]);
      return {
        name, amount: fmt(amount), mark: on ? '✓' : '',
        check: 'width:30px;height:30px;border-radius:50%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;' + (on ? 'background:#121317;color:#fff' : 'background:#fff;border:2px solid #c4c9d4'),
        style: 'display:flex;align-items:center;gap:14px;width:100%;padding:16px 20px;box-sizing:border-box;border:0;border-radius:999px;background:#f3f4f7;color:#121317;flex-shrink:0;' + (on ? 'opacity:0.55' : ''),
        pick: () => this.setState({ sepDone: { ...s.sepDone, [name]: !on } })
      };
    });
    const sepHechas = SEP.filter((r) => s.sepDone[r[0]]).length;

    const TABS = [['home', 'Inicio'], ['prod', 'Productos'], ['hist', 'Historial'], ['mgmt', 'Gestión']];
    const tabs = TABS.map(([id, label]) => ({
      label,
      style: 'flex:1;border-radius:999px;border:0;font-size:14px;font-weight:600;' + (s.scr === (id === 'hist' ? 'histTab' : id) ? 'background:#fff;color:#121317' : 'background:transparent;color:rgba(255,255,255,0.7)'),
      pick: () => go(id === 'hist' ? 'histTab' : id, { openSale: '', selMode: false, sel: {} })
    }));

    const USERS = Object.keys(s.cfg.users).filter((u) => s.cfg.users[u]);
    const pdef = s.scr === 'page' ? pageDef() : { title: '', blocks: [], buttons: [] };
    const mdef = s.modal ? modalDef() : { title: '', text: '', blocks: [], buttons: [] };

    return {
      scrPair: s.scr === 'pair', manual: s.manual, notManual: !s.manual,
      pairScan: () => go('user', { manual: false }),
      goManual: () => this.setState({ manual: true }),
      goScan: () => this.setState({ manual: false }),
      scrUser: s.scr === 'user',
      users: USERS.map((u) => ({ name: u, initial: u[0], pick: () => go('home', { user: u }) })),
      scrHome: s.scr === 'home', userName: s.user || 'Ana',
      statusTxt: s.offline ? 'Sin conexión con la PC' : 'Conectado a la PC',
      statusDot: 'width:8px;height:8px;border-radius:50%;background:' + (s.offline ? '#e08a1e' : '#18a37f'),
      toggleOffline: () => this.setState({ offline: !s.offline }),
      offline: s.offline,
      showUpd: s.updAvail, openUpd: () => openModal('update'),
      heroLabel: s.cajaOpen ? 'Caja abierta' : 'Caja cerrada',
      heroTitle: s.cajaOpen ? 'Vender' : 'Abrir caja',
      cartHint: !s.cajaOpen ? 'Tocá para abrirla' : n ? n + (n === 1 ? ' producto en el carrito' : ' productos en el carrito') : 'Buscar y cobrar',
      goSale: () => (s.cajaOpen ? go('sale', { step: 'cart' }) : openModal('abrir')),
      goPrice: () => go('price'), goCash: () => go('cash', { cash: { ...s.cash, saved: false } }),
      goHome: () => go('home'),
      scrSale: s.scr === 'sale', inCart: s.step === 'cart', inPay: s.step === 'pay', inDone: s.step === 'done',
      q: s.q, onQ: (e) => this.setState({ q: e.target.value }),
      showDrop: Boolean(q), results, noResults: Boolean(q) && matches.length === 0,
      scanAdd: () => { const order = ['yerba', 'agua', 'gaseosa', 'leche']; addTo(order[s.scanN % order.length]); this.setState({ scanN: s.scanN + 1 }); },
      lines, emptyCart: n === 0,
      descTxt: s.desc ? 'Descuento 10 %' : '+ Descuento',
      descStyle: 'height:40px;padding:0 18px;border-radius:999px;border:0;font-size:14px;font-weight:600;' + (s.desc ? 'background:#121317;color:#fff' : 'background:#f3f4f7;color:#121317'),
      toggleDesc: () => this.setState({ desc: !s.desc }),
      itemsTxt: n + (n === 1 ? ' producto' : ' productos'),
      total: fmt(total),
      payBtnStyle: 'position:relative;height:54px;padding:0 28px;border-radius:999px;border:0;font-size:17px;font-weight:600;' + (canPay ? 'background:#fff;color:#121317' : 'background:rgba(255,255,255,0.16);color:rgba(255,255,255,0.5);cursor:default'),
      goPay: () => { if (canPay) this.setState({ step: 'pay' }); },
      backCart: () => this.setState({ step: 'cart' }),
      medios, isEfectivo: s.medio === 'efectivo', isMixto: s.medio === 'mixto', pagaChips, mixChips,
      mixTxt: 'El resto, ' + fmt(total - mixVal) + ', va por QR o débito.',
      vueltoTxt: vuelto >= 0 ? 'Vuelto ' + fmt(vuelto) : 'Falta ' + fmt(-vuelto),
      confirm: () => {
        if (s.medio === 'efectivo') { if (vuelto >= 0) this.setState({ step: 'done' }); }
        else if (s.medio === 'mixto' && total - mixVal <= 0) this.setState({ step: 'done' });
        else this.setState({ modal: 'posnet', posnet: 'wait' });
      },
      doneMedio: medioNombre + ' · ' + n + (n === 1 ? ' producto' : ' productos'),
      doneVuelto: s.medio === 'efectivo' ? 'Vuelto ' + fmt(vuelto) : 'Cobro registrado en la caja',
      printTicket: () => (s.offline ? toast('Para imprimir hace falta estar emparejado con la PC.') : toast('Ticket enviado a la impresora')),
      newSale: () => this.setState({ cart: [], desc: false, step: 'cart', medio: 'efectivo', paga: 20000, mixEf: 'Mitad', scr: 'home' }),
      scrPrice: s.scr === 'price', qp: s.qp, onQp: (e) => this.setState({ qp: e.target.value, psel: '' }),
      scanPrice: () => this.setState({ psel: 'yerba', qp: '' }),
      priceResults, hasPriceSel: Boolean(ps),
      psName: ps ? ps.name : '', psPrice: ps ? fmt(ps.price) : '', psMeta: ps ? (ps.kg ? 'Por kilo · ' : '') + ps.prov : '',
      psAdd: () => { if (ps) { addTo(ps.id); go('sale', { step: 'cart' }); } },
      scrCash: s.scr === 'cash', cashTipos, cashCajas,
      cashMonto: s.cash.monto, cashMotivo: s.cash.motivo, cashSaved: s.cash.saved,
      onMonto: (e) => this.setState({ cash: { ...s.cash, monto: e.target.value, saved: false } }),
      onMotivo: (e) => this.setState({ cash: { ...s.cash, motivo: e.target.value, saved: false } }),
      saveCash: () => { if (num(s.cash.monto)) this.setState({ cash: { ...s.cash, monto: '', motivo: '', saved: true } }); },
      scrProd: s.scr === 'prod', provs, prodRows, qprod: s.qprod, onQprod: (e) => this.setState({ qprod: e.target.value }),
      newProd: () => { this.setState({ form: { id: '', name: '', cod: '', price: '', cost: '', peso: false, stock: '', cat: 'Sin categoría', prov: 'Sin proveedor', activo: true } }); openPage('form', 'prod'); },
      selTxt: s.selMode ? 'Cancelar' : 'Seleccionar',
      toggleSel: () => this.setState({ selMode: !s.selMode, sel: {} }),
      bulkBar: s.selMode, selCountTxt: selCount + (selCount === 1 ? ' seleccionado' : ' seleccionados'),
      bulkStyle: 'height:48px;padding:0 24px;border-radius:999px;border:0;font-size:15px;font-weight:600;' + (selCount ? 'background:#fff;color:#121317' : 'background:rgba(255,255,255,0.16);color:rgba(255,255,255,0.5);cursor:default'),
      openBulk: () => { if (selCount) { patch('bulk', { stage: 'edit', val: '' }); openModal('bulk'); } },
      showEdit: Boolean(ed), editName: ed ? ed.name : '', editProv: ed ? ed.prov : '', editVal: s.editVal,
      onEditVal: (e) => this.setState({ editVal: e.target.value }),
      editCancel: () => this.setState({ editId: '' }),
      editSave: () => { if (ed && num(s.editVal)) this.setState({ prices: { ...s.prices, [ed.id]: num(s.editVal) }, editId: '' }); },
      editFull: () => {
        if (!ed) return;
        this.setState({ form: { id: ed.id, name: ed.name, cod: '', price: String(ed.price), cost: String(Math.round(ed.price * 0.7)), peso: Boolean(ed.kg), stock: String(ed.stock), cat: 'Sin categoría', prov: ed.prov, activo: true }, editId: '' });
        openPage('form', 'prod');
      },
      scrHist: s.scr === 'histTab', sales, histMedios,
      histSummary: hValid.length + (hValid.length === 1 ? ' venta' : ' ventas') + ' · ' + fmt(hValid.reduce((a, x) => a + x.total, 0)),
      showDel: Boolean(s.delSale), delId: s.delSale, delMotivo: s.delMotivo,
      onDelMotivo: (e) => this.setState({ delMotivo: e.target.value }),
      delCancel: () => this.setState({ delSale: '' }),
      delConfirm: () => { this.setState({ voided: { ...s.voided, [s.delSale]: true }, delSale: '', openSale: '' }); toast('Venta eliminada'); },
      scrMgmt: s.scr === 'mgmt', mgmtTiles,
      closeCaja: () => (s.cajaOpen ? openPage('cierre', 'mgmt') : toast('La caja ya está cerrada')),
      closeHint: s.cajaOpen ? 'Contar y cerrar el turno' : 'Caja cerrada',
      disconnect: () => go('pair', { cart: [], user: '' }),
      scrSep: s.scr === 'sep', backMgmt: () => go('mgmt'),
      sepVistas: ['Qué separar', 'Lo vendido'].map((v) => ({
        label: v,
        style: 'flex:1;height:46px;border-radius:999px;border:0;font-size:15px;font-weight:600;' + (s.sepVista === v ? 'background:#121317;color:#fff' : 'background:transparent;color:#121317'),
        pick: () => this.setState({ sepVista: v })
      })),
      sepTitle: sepAll ? 'Separar para proveedores · hoy' : 'Vendido hoy',
      sepTotal: fmt(sepAll ? sepTotal : 482300),
      sepEf: fmt(sepAll ? sepEf : 231500), sepMp: fmt(sepAll ? sepTotal - sepEf : 250800),
      sepProgress: sepHechas + ' de ' + SEP.length + ' separados',
      sepRows: sepAll ? sepRows : [],
      showNav: ['home', 'prod', 'hist', 'mgmt', 'histTab'].includes(s.scr) && !s.selMode, tabs,
      // páginas y modales genéricos
      scrPage: s.scr === 'page', pageTitle: pdef.title, pageBlocks: pdef.blocks, pageButtons: pdef.buttons,
      hasModal: Boolean(s.modal), modalTitle: mdef.title, modalText: mdef.text, hasModalText: Boolean(mdef.text), modalBlocks: mdef.blocks, modalButtons: mdef.buttons,
      closeModal,
      hasToast: Boolean(s.toast), toastTxt: s.toast
    };
  }
}
