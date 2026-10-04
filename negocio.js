(function () {
  var root = document.getElementById('negocio');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var HDR = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
  var ROLE = { owner: 'Dueño', manager: 'Encargado', employee: 'Empleado' };
  var ERR = {
    bad_email: 'Revisá el mail: no parece válido.', bad_role: 'Elegí un rol válido.', bad_branches: 'Elegí al menos una sucursal que esté activa.',
    already_member: 'Esa persona ya es parte del negocio.', too_many_pending: 'Hay demasiadas invitaciones pendientes. Cancelá algunas.',
    owner_immutable: 'Al dueño no se lo puede cambiar ni quitar desde acá.', name_taken: 'Ya hay una sucursal con ese nombre.', bad_name: 'Poné un nombre para la sucursal.',
    last_branch: 'No se puede cerrar la última sucursal activa.', has_devices: 'Esa sucursal tiene dispositivos vinculados (PC o celulares). Primero desvinculalos.', too_many: 'Llegaste al máximo de sucursales.',
    self: 'No podés transferirte el negocio a vos mismo.', stale: 'La propuesta ya no es válida: el negocio cambió de dueño.', not_member: 'Esa persona ya no es parte del negocio.',
    expired: 'La propuesta venció.', accepted: 'Esa propuesta ya se resolvió.', declined: 'Esa propuesta ya se resolvió.', cancelled: 'Esa propuesta ya se resolvió.',
    no_subscription: 'Tu mail no tiene una suscripción vigente. Suscribite primero.', mp_error: 'No pudimos consultar Mercado Pago. Probá de nuevo en unos minutos.', not_configured: 'La facturación todavía no está disponible.',
    mp_no_conectado: 'Primero conectá tu cuenta de Mercado Pago.', mp_sin_terminal: 'Esa sucursal todavía no tiene una terminal elegida.', mp_rechazo: 'Mercado Pago rechazó el pedido.', mp_error: 'No pudimos consultar Mercado Pago. Probá de nuevo en unos minutos.', mp_no_configurado: 'La conexión con Mercado Pago todavía no está configurada.', terminal_desconocida: 'Esa terminal no es de tu cuenta de Mercado Pago.', bad_branch: 'Esa sucursal ya no existe.',
    not_found: 'Ya no existe: recargá la página.', forbidden: 'No tenés permiso para hacer esto.', no_session: 'Tu sesión venció. Volvé a ingresar.'
  };
  var msgError = function (j) { return (j && ERR[j.error]) || ('No se pudo completar' + (j && j.error ? ' (' + j.error + ')' : '') + '. Probá de nuevo.'); };
  // Lo que respondió Mercado Pago tal cual (código y motivo), para que un rechazo se pueda diagnosticar en vez de ser un "no se pudo".
  var msgMp = function (j) { return j && j.mensaje ? 'Mercado Pago respondió' + (j.status ? ' (' + j.status + ')' : '') + ': ' + j.mensaje : msgError(j); };
  var dt = function (s) { if (!s) return '—'; return new Date(s * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }); };
  var ago = function (s) { if (!s) return 'nunca'; var d = Math.floor((Date.now() / 1000 - s) / 86400); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días'; };
  var size = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };

  // Todo pedido a la API pasa por acá: devuelve { ok, status, j } y manda a ingresar si la sesión venció.
  function api(method, url, body) {
    var opt = { method: method, credentials: 'same-origin', headers: method === 'GET' ? { 'X-Requested-With': 'fetch' } : HDR };
    if (body !== undefined) opt.body = JSON.stringify(body);
    return fetch(url, opt).then(function (r) {
      if (r.status === 401) { location.replace('/ingresar/'); return new Promise(function () {}); }
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: {} }; });
    });
  }
  function card(title) { var c = el('section', 'acc'); if (title) c.appendChild(el('h2', null, title)); return c; }
  function note(txt) { return el('p', 'acc-note', txt); }
  function chip(text, cls) { return el('span', 'chip ' + cls, text); }
  function button(txt, cls, fn) { var b = el('button', cls || 'btn btn-w', txt); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function lnk(txt, fn, danger) { return button(txt, 'lnk' + (danger ? ' danger' : ''), fn); }
  function labelCells(t) {
    var hs = [].map.call(t.querySelectorAll('thead th'), function (h) { return h.textContent; });
    [].forEach.call(t.querySelectorAll('tbody tr'), function (tr) { [].forEach.call(tr.children, function (td, i) { if (hs[i]) td.setAttribute('data-l', hs[i]); }); });
  }
  function table(heads) {
    var wrap = el('div', 'tbl adm-tbl'), t = el('table'), th = el('thead'), hr = el('tr');
    heads.forEach(function (h) { hr.appendChild(el('th', null, h)); }); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody'); t.appendChild(tb); wrap.appendChild(t);
    return { wrap: wrap, table: t, body: tb, done: function () { labelCells(t); } };
  }
  function empty(tb, cols, txt) { var tr = el('tr'), td = el('td', null, txt); td.colSpan = cols; tr.appendChild(td); tb.appendChild(tr); }

  // ---- diálogo único: confirmar, editar un miembro, renombrar una sucursal
  var dlg = document.getElementById('dlg');
  function abrir(o) {
    document.getElementById('dlg-t').textContent = o.titulo;
    var body = document.getElementById('dlg-body'); body.textContent = ''; if (o.cuerpo) body.appendChild(o.cuerpo);
    var err = document.getElementById('dlg-err'), si = document.getElementById('dlg-si'), no = document.getElementById('dlg-no');
    err.textContent = ''; si.textContent = o.boton || 'Aceptar'; si.disabled = false; si.className = o.peligro ? 'btn-danger solid' : 'btn';
    no.onclick = function () { cerrar(); };
    si.onclick = function () {
      si.disabled = true; err.textContent = '';
      Promise.resolve(o.accion()).then(function (r) {
        si.disabled = false;
        if (r && r.error) { err.textContent = r.error; return; }
        cerrar(); if (o.despues) o.despues();
      }).catch(function () { si.disabled = false; err.textContent = 'Error de conexión. Probá de nuevo.'; });
    };
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function cerrar() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  function confirmar(titulo, texto, boton, accion, despues) { abrir({ titulo: titulo, cuerpo: note(texto), boton: boton, peligro: true, accion: accion, despues: despues }); }

  // ---- selector de sucursales: "todas" o una lista
  function selectorSucursales(sucursales, seleccion) {
    var box = el('fieldset'); box.appendChild(el('legend', null, 'Sucursales'));
    var todas = el('label', 'chk'), cbT = document.createElement('input'); cbT.type = 'checkbox'; cbT.checked = !!seleccion.all;
    todas.appendChild(cbT); todas.appendChild(document.createTextNode('Todas las sucursales')); box.appendChild(todas);
    var cbs = sucursales.filter(function (b) { return b.active !== false; }).map(function (b) {
      var l = el('label', 'chk'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = String(b.id);
      cb.checked = !seleccion.all && (seleccion.ids || []).indexOf(b.id) >= 0; l.appendChild(cb); l.appendChild(document.createTextNode(b.name)); box.appendChild(l);
      return cb;
    });
    function sync() { cbs.forEach(function (cb) { cb.disabled = cbT.checked; if (cbT.checked) cb.checked = false; }); }
    cbT.addEventListener('change', sync); sync();
    return { nodo: box, valor: function () { return cbT.checked ? { allBranches: true } : { allBranches: false, branchIds: cbs.filter(function (c) { return c.checked; }).map(function (c) { return parseInt(c.value, 10); }) }; } };
  }
  function campo(label, ctrl) { var l = el('label', null, label); l.appendChild(ctrl); return l; }
  function selectRol() { var s = el('select'); [['employee', 'Empleado'], ['manager', 'Encargado']].forEach(function (r) { var o = el('option', null, r[1]); o.value = r[0]; s.appendChild(o); }); return s; }

  var trans = { incoming: [], outgoing: [] };
  var me = null, orgId = null, datos = null, ultimo = null; // `ultimo`: el link de la última invitación, que sobrevive a recargar la lista
  var org = function () { return me.orgs.filter(function (o) { return o.id === orgId; })[0]; };
  function guardarOrg() { try { sessionStorage.setItem('ns_org', String(orgId)); } catch (e) { /* sin almacenamiento: no pasa nada */ } }

  // ---- arranque
  var primero = true;
  function listo() { root.removeAttribute('aria-busy'); if (!primero) return; primero = false; root.classList.add('acc-in'); setTimeout(function () { root.classList.remove('acc-in'); }, 800); }

  api('GET', '/api/me').then(function (r) {
    if (!r.ok) throw new Error();
    me = r.j; listo();
    if (!me.orgs.length) { sinNegocio(); return; }
    var pedido = parseInt(new URLSearchParams(location.search).get('org'), 10), guardado = NaN;
    try { guardado = parseInt(sessionStorage.getItem('ns_org'), 10); } catch (e) { /* idem */ }
    var ids = me.orgs.map(function (o) { return o.id; });
    orgId = ids.indexOf(pedido) >= 0 ? pedido : ids.indexOf(guardado) >= 0 ? guardado : ids[0];
    return cargarTraspasos().then(render);
  }).catch(function () { listo(); root.textContent = ''; root.appendChild(note('No pudimos cargar tu negocio. Recargá la página.')); });

  // ---- transferencia de propiedad: lo que me propusieron y lo que propuse
  function cargarTraspasos() { return api('GET', '/api/org/transfer').then(function (r) { trans = r.ok ? r.j : { incoming: [], outgoing: [] }; }); }
  var pendienteDe = function (id) { return trans.outgoing.filter(function (x) { return x.orgId === id; })[0]; };
  function avisos() {
    trans.incoming.forEach(function (i) {
      var quien = i.fromName || i.fromEmail, c = card('Te quieren transferir «' + i.orgName + '»'); c.classList.add('neg-aviso');
      c.appendChild(note(quien + ' (' + i.fromEmail + ') quiere que seas quien administra este negocio. Si aceptás, pasás a ser dueño (equipo, sucursales y facturación quedan a tu cargo) y ' + quien + ' queda como encargado.'));
      c.appendChild(note('La facturación sigue a nombre de ' + quien + ' hasta que pases el cobro a tu propia suscripción. La propuesta vence el ' + dt(i.exp) + '. Si no la esperabas, rechazala.'));
      var a = el('div', 'acc-actions');
      a.appendChild(button('Aceptar', 'btn', function () {
        abrir({ titulo: '¿Aceptar «' + i.orgName + '»?', cuerpo: note('Vas a ser quien administra el negocio. Apenas entres, revisá la Facturación: el cobro sigue a nombre de ' + quien + ' hasta que lo pases a tu suscripción.'), boton: 'Sí, aceptar',
          accion: function () { return api('POST', '/api/org/transfer/accept', { transferId: i.id }).then(function (r) { return r.ok ? {} : { error: msgError(r.j) }; }); },
          despues: function () { location.href = '/negocio/?org=' + i.orgId; } });
      }));
      a.appendChild(button('Rechazar', 'btn btn-w', function () {
        confirmar('¿Rechazar la propuesta?', quien + ' sigue siendo el dueño de «' + i.orgName + '» y no cambia nada.', 'Sí, rechazar',
          function () { return api('POST', '/api/org/transfer/decline', { transferId: i.id }).then(function (r) { return r.ok ? {} : { error: msgError(r.j) }; }); }, function () { cargarTraspasos().then(render); });
      }));
      c.appendChild(a); root.appendChild(c);
    });
  }
  function proponer(o, m) {
    var quien = m.name || m.email, cuerpo = el('div', 'dlg-body');
    ['Le mandamos una propuesta. Hasta que la acepte, seguís siendo el dueño y no cambia nada.',
     'Si acepta, pasa a ser quien administra el negocio (equipo, sucursales y facturación) y vos quedás como encargado.',
     'Tus dispositivos siguen funcionando. El cobro sigue a tu nombre hasta que la persona pase el cobro a su propia suscripción: si cancelás la tuya antes, el negocio se queda sin cobertura.',
     'La propuesta vence en 7 días y la podés retirar cuando quieras.'].forEach(function (x) { cuerpo.appendChild(note(x)); });
    abrir({ titulo: '¿Transferir «' + o.name + '» a ' + quien + '?', cuerpo: cuerpo, boton: 'Sí, proponer la transferencia',
      accion: function () { return api('POST', '/api/org/transfer', { orgId: o.id, memberId: m.id }).then(function (r) { return r.ok ? {} : { error: msgError(r.j) }; }); },
      despues: function () { cargarTraspasos().then(render); } });
  }

  function sinNegocio() {
    root.textContent = '';
    var c = card('Todavía no tenés un negocio');
    c.appendChild(note('Tu negocio se crea cuando vinculás el primer dispositivo (la PC del local o el celular) con el sistema POS. Si te invitaron a uno, abrí el link de la invitación que te llegó por mail.'));
    var a = el('div', 'acc-actions'); var l = el('a', 'btn', 'Ir a mi cuenta'); l.href = '/cuenta/'; a.appendChild(l); c.appendChild(a); root.appendChild(c);
  }

  function render() {
    guardarOrg(); root.textContent = '';
    avisos();
    var o = org(), c = card(o.name); c.classList.add('neg-head');
    var fila = el('div', 'prow'); fila.appendChild(chip(ROLE[o.role] || o.role, o.role === 'owner' ? 'ok' : 'wait'));
    if (me.orgs.length > 1) {
      var s = el('select'); s.setAttribute('aria-label', 'Elegir negocio');
      me.orgs.forEach(function (x) { var op = el('option', null, x.name + ' · ' + (ROLE[x.role] || x.role)); op.value = String(x.id); if (x.id === orgId) op.selected = true; s.appendChild(op); });
      s.addEventListener('change', function () { orgId = parseInt(s.value, 10); ultimo = null; render(); });
      var f = el('div', 'frm'); f.appendChild(s); fila.appendChild(f);
    }
    c.appendChild(fila);
    var saliente = pendienteDe(o.id);
    if (saliente) {
      c.appendChild(note('Transferencia pendiente: le propusiste el negocio a ' + saliente.toEmail + ' (vence el ' + dt(saliente.exp) + '). Hasta que acepte, seguís siendo el dueño.'));
      c.appendChild(button('Retirar la propuesta', 'btn btn-w', function () {
        api('POST', '/api/org/transfer/cancel', { orgId: o.id }).then(function () { cargarTraspasos().then(render); });
      }));
    }
    root.appendChild(c);

    if (o.can.facturacion) facturacion(o);
    if (o.can.mercadopago) mercadopago(o);
    if (o.can.miembros) { owner(o); }
    else {
      var t = card('Tu lugar de trabajo');
      t.appendChild(note(o.role === 'employee' ? 'Sos empleado de este negocio: operás el sistema POS en la PC del local o en tu celular, entrando con tu cuenta. Si necesitás algo, hablá con el dueño.' : 'Sos encargado de este negocio.'));
      t.appendChild(note('Tus sucursales: ' + (o.branches.length ? o.branches.map(function (b) { return b.name; }).join(', ') : 'ninguna asignada todavía') + '.'));
      root.appendChild(t);
    }
    if (o.can.copias) copias(o);
    if (o.can.descargar) {
      var d = card('Descargá el sistema'); d.appendChild(note('Instalador para la PC del local y app del celular.'));
      var dl = el('a', 'btn', 'Ir a las descargas'); dl.href = '/descargar/'; dl.style.alignSelf = 'flex-start'; d.appendChild(dl); root.appendChild(d);
    }
  }

  // ---- dueño: cobros con SU cuenta de Mercado Pago (la conexión y el token viven en el servidor; acá solo se conecta y se elige la terminal)
  var MP_AVISO = {
    ok: ['ok', 'Listo: tu cuenta de Mercado Pago quedó conectada.'],
    cancelado: ['wait', 'No se conectó: cancelaste la autorización en Mercado Pago.'],
    sin_permiso: ['wait', 'No se conectó: Mercado Pago no dio el permiso para renovar la conexión solo. Probá de nuevo y aceptá todo lo que pide.'],
    error: ['wait', 'No se pudo completar la conexión (el enlace venció o no era tuyo). Probá de nuevo.'],
    sin_sesion: ['wait', 'Tu sesión venció antes de volver de Mercado Pago. Ingresá de nuevo y reintentá.'],
    no_configurado: ['wait', 'La conexión con Mercado Pago todavía no está configurada en el servidor.']
  };
  var avisoMp = (function () { var v = new URLSearchParams(location.search).get('mp'); if (v && MP_AVISO[v]) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* sin historial */ } return MP_AVISO[v]; } return null; })();
  function mercadopago(o) {
    var c = card('Cobros con Mercado Pago'); c.appendChild(note('Cargando…')); root.appendChild(c); refrescarMp(o, c);
  }
  function refrescarMp(o, c) {
    return api('GET', '/api/mp/estado?org=' + o.id).then(function (r) {
      if (orgId !== o.id) return;
      c.textContent = ''; c.appendChild(el('h2', null, 'Cobros con Mercado Pago'));
      if (avisoMp) { var a = note(avisoMp[1]); a.setAttribute('role', 'status'); c.appendChild(a); avisoMp = null; }
      if (r.status === 503) { c.appendChild(note('La conexión con Mercado Pago todavía no está configurada en el servidor.')); return; }
      if (!r.ok) { c.appendChild(note('No pudimos consultar el estado. Recargá la página.')); return; }
      var e = r.j, msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
      var conectar = function (txt) { return button(txt, 'btn', function () {
        msg.textContent = ''; api('POST', '/api/mp/conectar', { orgId: o.id }).then(function (x) { if (x.ok && /^https:\/\/auth\.mercadopago\.com\//.test(x.j.url || '')) location.href = x.j.url; else msg.textContent = msgError(x.j); });
      }); };
      if (!e.connected) {
        c.appendChild(note(e.needsReconnect ? 'La conexión con tu cuenta de Mercado Pago se cortó (la revocaste o venció). Reconectala para seguir cobrando con la terminal.'
          : 'Conectá tu cuenta de Mercado Pago para cobrar con la terminal Point (QR y débito) desde la PC y el celular, sin depender de que la PC esté prendida. El dinero va a tu cuenta; no guardamos tu usuario ni tu contraseña.'));
        c.appendChild(conectar(e.needsReconnect ? 'Reconectar Mercado Pago' : 'Conectar Mercado Pago')); c.appendChild(msg); return;
      }
      var t = el('p'); t.appendChild(chip('Conectada', 'ok')); t.appendChild(document.createTextNode(' Cuenta de Mercado Pago N° ' + e.mpUserId + ' · desde el ' + dt(e.connectedAt))); c.appendChild(t);
      c.appendChild(note('Elegí qué terminal usa cada sucursal. Si la terminal todavía no está en modo PDV (el que permite cobrar desde el sistema) se la pasa; si ya lo estaba, no se le toca nada.'));
      var ul = el('ul', 'pays');
      (e.branches || []).forEach(function (b) {
        var li = el('li'), n = el('span'); n.appendChild(el('strong', null, b.name)); n.appendChild(document.createTextNode(' · ' + (b.terminalId ? 'terminal ' + b.terminalId : 'sin terminal')));
        if (b.terminalId && b.terminalMode === 'STANDALONE') { n.appendChild(document.createTextNode(' ')); n.appendChild(chip('Autónoma', 'wait')); }
        li.appendChild(n); var ac = el('span', 'acts');
        if (b.terminalId) ac.appendChild(lnk('Probar cobro de $100', function () {
          msg.textContent = ''; api('POST', '/api/mp/probar', { orgId: o.id, branchId: b.id }).then(function (x) {
            if (!x.ok) { msg.textContent = msgMp(x.j); return; }
            abrir({ titulo: 'Cobro de prueba enviado', cuerpo: note('Mirá la terminal de «' + b.name + '»: tendría que mostrar un cobro de $100,00. Si querés, pagalo para ver que todo anda; si no, cancelalo ahora.'),
              boton: 'Cancelar la prueba', accion: function () { return api('POST', '/api/mp/probar/cancelar', { orgId: o.id, id: x.j.id }).then(function (y) { return y.ok ? {} : { error: 'No se pudo cancelar desde acá: cancelalo en la terminal.' }; }); } });
          });
        }));
        // Modo autónomo (etapa C): por si la PC o la app fallan, la terminal cobra sola; después se vuelve al modo del sistema.
        if (b.terminalId && b.terminalMode) {
          var autonoma = b.terminalMode === 'STANDALONE';
          ac.appendChild(lnk(autonoma ? 'Volver a cobrar desde el sistema' : 'Pasar a modo autónomo', function () {
            confirmar(autonoma ? '¿Volver a cobrar desde el sistema?' : '¿Pasar la terminal a modo autónomo?',
              autonoma ? 'La terminal de «' + b.name + '» vuelve a recibir los cobros de la PC y los celulares. Lo que cobraste mientras estuvo autónoma no está en el sistema: cargalo a mano si hace falta.'
                : 'La terminal de «' + b.name + '» va a cobrar sola, como un posnet común, y el sistema NO le va a poder mandar cobros hasta que la vuelvas al modo del sistema. Usalo si la PC o la app fallan.',
              autonoma ? 'Sí, volver' : 'Sí, pasar a autónomo',
              function () { return api('POST', '/api/mp/terminal/modo', { orgId: o.id, branchId: b.id, modo: autonoma ? 'PDV' : 'STANDALONE' }).then(function (y) { return y.ok ? {} : { error: msgError(y.j) }; }); },
              function () { refrescarMp(o, c); });
          }));
        }
        ac.appendChild(lnk(b.terminalId ? 'Cambiar terminal' : 'Elegir terminal', function () {
          api('GET', '/api/mp/terminales?org=' + o.id).then(function (x) {
            if (!x.ok) { msg.textContent = msgError(x.j); return; }
            if (!x.j.terminals.length) { msg.textContent = 'No encontramos terminales Point en tu cuenta de Mercado Pago.'; return; }
            var sel = el('select'); x.j.terminals.forEach(function (tt) { var op = el('option', null, tt.id + (tt.mode === 'PDV' ? ' (modo PDV)' : '')); op.value = tt.id; if (tt.id === b.terminalId) op.selected = true; sel.appendChild(op); });
            var f = el('div', 'frm'); f.appendChild(campo('Terminal para «' + b.name + '»', sel));
            abrir({ titulo: 'Elegir terminal', cuerpo: f, boton: 'Usar esta terminal', despues: function () { refrescarMp(o, c); }, accion: function () {
              return api('POST', '/api/mp/terminal', { orgId: o.id, branchId: b.id, terminalId: sel.value }).then(function (y) { return y.ok ? {} : { error: msgError(y.j) }; }); } });
          });
        }));
        li.appendChild(ac); ul.appendChild(li);
      });
      c.appendChild(ul);
      var fin = el('div', 'acc-actions');
      fin.appendChild(lnk('Desconectar Mercado Pago', function () {
        confirmar('¿Desconectar Mercado Pago?', 'La PC y los celulares dejan de poder cobrar con la terminal hasta que vuelvas a conectar. No se toca nada de tu cuenta de Mercado Pago ni los cobros ya hechos.', 'Sí, desconectar',
          function () { return api('POST', '/api/mp/desconectar', { orgId: o.id }).then(function (y) { return y.ok ? {} : { error: msgError(y.j) }; }); }, function () { refrescarMp(o, c); });
      }, true));
      c.appendChild(fin); c.appendChild(msg);
      actividadMp(o, c);
    });
  }
  // Últimos cobros, cancelaciones e impresiones que el servidor hizo con la terminal: así se ve de dónde salió cada uno.
  function actividadMp(o, c) {
    var box = el('div'); box.appendChild(el('h3', null, 'Últimos movimientos por el servidor')); c.appendChild(box);
    var ACC = { orden: 'Cobro', cancelar: 'Cancelación', imprimir: 'Ticket' }, CAN = { qr: 'QR', debit_card: 'Débito' };
    api('GET', '/api/mp/actividad?org=' + o.id + '&limit=20').then(function (r) {
      if (!r.ok) { box.appendChild(note('No pudimos cargar el registro.')); return; }
      if (!r.j.items.length) { box.appendChild(note('Todavía no hay movimientos: aparecen acá cuando un dispositivo cobra o imprime por Nodo Sur.')); return; }
      var ul = el('ul', 'pays');
      r.j.items.forEach(function (i) {
        var li = el('li'), t = (ACC[i.action] || i.action) + (i.channel ? ' ' + (CAN[i.channel] || i.channel) : '') + (i.amountCents != null ? ' · $' + (i.amountCents / 100).toLocaleString('es-AR') : '');
        li.appendChild(el('span', null, new Date(i.at * 1000).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + t + (i.device ? ' · ' + i.device : '')));
        li.appendChild(chip(i.result === 'ok' ? 'Aceptado' : 'Rechazado', i.result === 'ok' ? 'ok' : 'bad'));
        if (i.result !== 'ok' && i.detail) li.appendChild(el('span', null, i.detail));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
  }

  // ---- dueño: equipo, sucursales y PC
  function owner(o) {
    var eq = card('Equipo'), su = card('Sucursales'), pc = card('Dispositivos vinculados');
    [eq, su, pc].forEach(function (k) { k.appendChild(note('Cargando…')); root.appendChild(k); });
    refrescarDueno(o, eq, su, pc);
  }
  function refrescarDueno(o, eq, su, pc) {
    return Promise.all([api('GET', '/api/org/members?org=' + o.id), api('GET', '/api/org/branches?org=' + o.id), api('GET', '/api/devices')]).then(function (rs) {
      if (orgId !== o.id) return; // mientras cargaba se cambió de negocio
      if (!rs[0].ok || !rs[1].ok) { [eq, su, pc].forEach(function (k) { k.textContent = ''; k.appendChild(note('No pudimos cargar los datos. Recargá la página.')); }); return; }
      datos = { team: rs[0].j, branches: rs[1].j.branches, devices: rs[2].ok ? rs[2].j.devices.filter(function (d) { return d.orgId === o.id; }) : [] };
      var recargar = function () { refrescarDueno(o, eq, su, pc); };
      pintarEquipo(o, eq, recargar); pintarSucursales(o, su, recargar); pintarPc(o, pc, recargar);
    });
  }
  var nombresRamas = function (ids) { return ids.map(function (id) { var b = datos.team.branches.filter(function (x) { return x.id === id; })[0]; return b ? b.name : '?'; }).join(', '); };

  function pintarEquipo(o, c, recargar) {
    var t = datos.team; c.textContent = ''; c.appendChild(el('h2', null, 'Equipo'));
    c.appendChild(note('Las personas entran con su propio mail de Google. El dueño es quien paga; los empleados y encargados no ven la facturación.'));
    if (t.overSoftCap) c.appendChild(note('Tu negocio superó las ' + t.softCap + ' personas. Más adelante podría tener un costo adicional; por ahora no pasa nada.'));
    var tb = table(['Persona', 'Rol', 'Sucursales', '']);
    t.members.forEach(function (m) {
      var tr = el('tr'), c1 = el('td'); c1.appendChild(el('strong', null, m.name || m.email));
      if (m.isYou) { c1.appendChild(document.createTextNode(' ')); c1.appendChild(chip('Vos', 'ok')); }
      c1.appendChild(document.createElement('br')); c1.appendChild(el('small', null, m.email)); tr.appendChild(c1);
      tr.appendChild(el('td', null, ROLE[m.role] || m.role));
      tr.appendChild(el('td', null, m.allBranches ? 'Todas' : nombresRamas(m.branchIds) || '—'));
      var ac = el('td', 'acts');
      if (m.role !== 'owner') {
        ac.appendChild(lnk('Editar', function () { editarMiembro(o, m, recargar); }));
        if (o.can.transferir && !pendienteDe(o.id)) ac.appendChild(lnk('Hacer dueño', function () { proponer(o, m); }));
        ac.appendChild(lnk('Quitar', function () { quitarMiembro(o, m, recargar); }, true));
      }
      tr.appendChild(ac); tb.body.appendChild(tr);
    });
    tb.done(); c.appendChild(tb.wrap);

    if (t.invitations.length) {
      c.appendChild(el('h3', null, 'Invitaciones pendientes'));
      var ul = el('ul', 'pays');
      t.invitations.forEach(function (i) {
        var li = el('li'); li.appendChild(el('span', null, i.email));
        li.appendChild(el('span', null, (ROLE[i.role] || i.role) + ' · vence el ' + dt(i.exp)));
        var ac = el('span', 'acts');
        ac.appendChild(lnk('Reenviar', function () { enviar(o, { email: i.email, role: i.role, allBranches: i.allBranches, branchIds: i.branchIds }, resultado, recargar); }));
        ac.appendChild(lnk('Cancelar', function () { api('POST', '/api/org/invite/revoke', { orgId: o.id, invitationId: i.id }).then(recargar); }, true));
        li.appendChild(ac); ul.appendChild(li);
      });
      c.appendChild(ul);
    }

    c.appendChild(el('h3', null, 'Invitar a alguien'));
    var f = el('form', 'frm'); f.noValidate = false;
    var mail = el('input'); mail.type = 'email'; mail.required = true; mail.autocomplete = 'off'; mail.placeholder = 'nombre@gmail.com'; mail.maxLength = 254;
    var rol = selectRol(), sel = selectorSucursales(t.branches, { all: false, ids: [] });
    var msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
    var resultado = el('div', 'inv-res'); resultado.setAttribute('aria-live', 'polite'); if (ultimo) resultado.appendChild(ultimo);
    var go = el('button', 'btn', 'Enviar invitación'); go.type = 'submit';
    f.appendChild(campo('Mail de la persona', mail)); f.appendChild(campo('Rol', rol)); f.appendChild(sel.nodo); f.appendChild(go); f.appendChild(msg); f.appendChild(resultado);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); msg.textContent = '';
      var v = sel.valor(); if (!v.allBranches && !v.branchIds.length) { msg.textContent = ERR.bad_branches; return; }
      go.disabled = true;
      enviar(o, { email: mail.value, role: rol.value, allBranches: v.allBranches, branchIds: v.branchIds }, resultado, recargar, msg).then(function () { go.disabled = false; });
    });
    c.appendChild(f);
  }

  // Crea la invitación y muestra el link (siempre): si el mail salió, avisa; si no, el dueño lo copia y lo manda.
  function enviar(o, cuerpo, resultado, despues, msg) {
    cuerpo.orgId = o.id; resultado.textContent = ''; ultimo = null;
    return api('POST', '/api/org/invite', cuerpo).then(function (r) {
      if (!r.ok) { (msg || resultado).textContent = msgError(r.j); (msg || resultado).className = 'login-err'; return; }
      var box = el('div', 'acc-note');
      box.appendChild(el('strong', null, r.j.emailed ? 'Le mandamos la invitación a ' + r.j.invitation.email + '.' : 'Invitación creada, pero no pudimos mandar el mail.'));
      box.appendChild(el('p', null, 'Podés mandarle este link vos (por WhatsApp, por ejemplo). Funciona una sola vez, vence en 7 días y solo sirve con el mail ' + r.j.invitation.email + '.'));
      var lb = el('div', 'linkbox'), inp = el('input'); inp.type = 'text'; inp.readOnly = true; inp.value = r.j.link; inp.setAttribute('aria-label', 'Link de la invitación');
      var cp = button('Copiar', 'btn btn-w', function () {
        var ok = function () { cp.textContent = '¡Copiado!'; setTimeout(function () { cp.textContent = 'Copiar'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(ok, function () { inp.select(); });
        else { inp.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* queda seleccionado para copiar a mano */ } }
      });
      lb.appendChild(inp); lb.appendChild(cp); box.appendChild(lb); resultado.textContent = ''; resultado.appendChild(box);
      ultimo = box; // al recargar el equipo, el link se vuelve a mostrar
      if (despues) despues();
    });
  }

  function editarMiembro(o, m, recargar) {
    var cuerpo = el('div', 'frm'), rol = selectRol(); rol.value = m.role;
    var sel = selectorSucursales(datos.team.branches, { all: m.allBranches, ids: m.branchIds });
    cuerpo.appendChild(el('p', 'acc-note', m.name ? m.name + ' · ' + m.email : m.email)); cuerpo.appendChild(campo('Rol', rol)); cuerpo.appendChild(sel.nodo);
    abrir({ titulo: 'Editar persona', cuerpo: cuerpo, boton: 'Guardar', despues: recargar, accion: function () {
      var v = sel.valor(); if (!v.allBranches && !v.branchIds.length) return { error: ERR.bad_branches };
      v.orgId = o.id; v.memberId = m.id; v.role = rol.value;
      return api('POST', '/api/org/member/update', v).then(function (r) { return r.ok ? {} : { error: msgError(r.j) }; });
    } });
  }
  function quitarMiembro(o, m, recargar) {
    confirmar('¿Quitar a ' + (m.name || m.email) + '?', 'Pierde el acceso al negocio y los dispositivos que vinculó (PC o celular) dejan de funcionar. Sus ventas anteriores conservan su nombre. Podés invitarla de nuevo cuando quieras.', 'Sí, quitar',
      function () { return api('POST', '/api/org/member/remove', { orgId: o.id, memberId: m.id }).then(function (r) { return r.ok ? {} : { error: msgError(r.j) }; }); }, recargar);
  }

  function pintarSucursales(o, c, recargar) {
    c.textContent = ''; c.appendChild(el('h2', null, 'Sucursales'));
    c.appendChild(note('Cada dispositivo (PC o celular) pertenece a una sucursal, y los de una misma sucursal se sincronizan entre sí. Cada persona ve solo las suyas. El negocio paga una vez, sin importar cuántas sucursales tenga.'));
    var ul = el('ul', 'pays');
    datos.branches.forEach(function (b) {
      var li = el('li'), n = el('span'); n.appendChild(el('strong', null, b.name)); n.appendChild(document.createTextNode(' ')); n.appendChild(chip(b.active ? 'Activa' : 'Cerrada', b.active ? 'ok' : 'wait'));
      li.appendChild(n); li.appendChild(el('span', null, b.devices === 1 ? '1 dispositivo' : b.devices + ' dispositivos'));
      var ac = el('span', 'acts');
      ac.appendChild(lnk('Renombrar', function () {
        var inp = el('input'); inp.type = 'text'; inp.value = b.name; inp.maxLength = 60; var f = el('div', 'frm'); f.appendChild(campo('Nombre', inp));
        abrir({ titulo: 'Renombrar sucursal', cuerpo: f, boton: 'Guardar', despues: recargar, accion: function () {
          return api('POST', '/api/org/branch/update', { orgId: o.id, branchId: b.id, name: inp.value }).then(function (r) { return r.ok ? {} : { error: msgError(r.j) }; }); } });
      }));
      ac.appendChild(lnk(b.active ? 'Cerrar' : 'Reabrir', function () {
        api('POST', '/api/org/branch/update', { orgId: o.id, branchId: b.id, active: !b.active }).then(function (r) { if (r.ok) recargar(); else { msg.textContent = msgError(r.j); } });
      }, b.active));
      li.appendChild(ac); ul.appendChild(li);
    });
    c.appendChild(ul);
    var f = el('form', 'frm'), inp = el('input'); inp.type = 'text'; inp.maxLength = 60; inp.placeholder = 'Ej.: Barrio Norte'; inp.required = true;
    var go = el('button', 'btn btn-w', 'Agregar sucursal'); go.type = 'submit'; var msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
    f.appendChild(campo('Nueva sucursal', inp)); f.appendChild(go); f.appendChild(msg);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); msg.textContent = ''; go.disabled = true;
      api('POST', '/api/org/branch', { orgId: o.id, name: inp.value }).then(function (r) { go.disabled = false; if (r.ok) recargar(); else msg.textContent = msgError(r.j); });
    });
    c.appendChild(f);
  }

  function pintarPc(o, c, recargar) {
    c.textContent = ''; c.appendChild(el('h2', null, 'Dispositivos vinculados'));
    var ramas = {}; datos.branches.forEach(function (b) { ramas[b.id] = b.name; });
    if (!datos.devices.length) { c.appendChild(note('Todavía no hay ningún dispositivo vinculado. Abrí el sistema POS en la PC del local (o en el celular) y elegí «Vincular con mi cuenta».')); return; }
    var ul = el('ul', 'pays');
    datos.devices.forEach(function (d) {
      var li = el('li'), n = el('span'); n.appendChild(el('strong', null, d.name || 'Dispositivo')); n.appendChild(document.createTextNode(' · ' + (ramas[d.branchId] || 'Sin sucursal')));
      li.appendChild(n); li.appendChild(el('span', null, (d.version ? 'v' + d.version + ' · ' : '') + 'visto ' + ago(d.lastSeen)));
      var ac = el('span', 'acts');
      ac.appendChild(lnk('Desvincular', function () {
        confirmar('¿Desvincular «' + (d.name || 'dispositivo') + '»?', 'Ese dispositivo deja de poder subir copias y sincronizar con la cuenta. Sus datos locales no se tocan. Podés volver a vincularlo cuando quieras.', 'Sí, desvincular',
          function () { return api('POST', '/api/device/revoke', { id: d.id }).then(function (r) { return r.ok ? {} : { error: msgError(r.j) }; }); }, recargar);
      }, true));
      li.appendChild(ac); ul.appendChild(li);
    });
    c.appendChild(ul);
  }

  // ---- facturación (solo el dueño): quién paga y cómo pasar el cobro a la suscripción propia
  function facturacion(o) {
    var c = card('Facturación'); c.appendChild(note('Cargando…')); root.appendChild(c);
    function cargar() {
      api('GET', '/api/org/billing?org=' + o.id).then(function (r) {
        c.textContent = ''; c.appendChild(el('h2', null, 'Facturación'));
        if (!r.ok) { c.appendChild(note('No pudimos cargar la facturación.')); return; }
        var d = r.j, ST = { authorized: ['Activa', 'ok'], inactive: ['Sin suscripción vigente', 'bad'], none: ['Sin suscripción', 'bad'], unknown: ['No se pudo verificar', 'wait'] }[d.status] || ['—', 'wait'];
        var fila = el('div', 'prow'); fila.appendChild(chip(ST[0], ST[1])); c.appendChild(fila);
        if (d.mpError) c.appendChild(note('No pudimos consultar Mercado Pago en este momento. Probá de nuevo en unos minutos.'));
        c.appendChild(note(d.mine
          ? 'El negocio se cobra con tu suscripción (' + d.billingEmail + '). Podés verla y cancelarla desde Mi cuenta.'
          : 'El negocio se cobra con la suscripción de ' + d.billingEmail + '. Está a nombre de otra persona: solo ella puede cancelarla, y si lo hace el negocio se queda sin cobertura.'));
        if (d.subscriptions && d.subscriptions.length) {
          var ul = el('ul', 'pays');
          d.subscriptions.forEach(function (x) { var li = el('li'); li.appendChild(el('span', null, x.plan)); li.appendChild(el('span', null, { authorized: 'Activa', paused: 'Pausada', cancelled: 'Cancelada', canceled: 'Cancelada', pending: 'Pendiente' }[x.status] || x.status)); li.appendChild(el('strong', null, x.amount != null ? '$ ' + Math.round(x.amount).toLocaleString('es-AR') : '')); ul.appendChild(li); });
          c.appendChild(ul);
        }
        if (d.mine) { var l = el('a', 'btn btn-w', 'Ir a Mi cuenta'); l.href = '/cuenta/'; l.style.alignSelf = 'flex-start'; c.appendChild(l); return; }
        if (d.ownHasSubscription) {
          c.appendChild(note('Tenés una suscripción activa con tu mail. Podés usarla para este negocio: deja de depender de la de ' + d.billingEmail + ', que puede cancelar la suya sin que el negocio se corte.'));
          c.appendChild(button('Usar mi suscripción para este negocio', 'btn', function () {
            abrir({ titulo: '¿Cobrar el negocio con tu suscripción?', cuerpo: note('Desde ahora «' + o.name + '» se cubre con tu suscripción y deja de depender de la de ' + d.billingEmail + '.'), boton: 'Sí, usar la mía',
              accion: function () { return api('POST', '/api/org/billing', { orgId: o.id, action: 'use_mine' }).then(function (x) { return x.ok ? {} : { error: msgError(x.j) }; }); }, despues: cargar });
          }));
        } else {
          c.appendChild(note('Para que el cobro quede a tu cargo, suscribite con tu mail y después volvé acá a pasar el negocio a tu suscripción.'));
          var p = el('a', 'btn', 'Suscribirme'); p.href = '/pagar/'; p.style.alignSelf = 'flex-start'; c.appendChild(p);
        }
      });
    }
    cargar();
  }

  // ---- copias de seguridad (dueño y encargado, de sus sucursales)
  function copias(o) {
    var c = card('Copias de seguridad'); c.appendChild(note('Cargando…')); root.appendChild(c);
    function cargar() {
      api('GET', '/api/backups?org=' + o.id).then(function (r) {
        c.textContent = ''; c.appendChild(el('h2', null, 'Copias de seguridad'));
        if (r.status === 503) { c.appendChild(note(r.j && r.j.error === 'mp_error' ? 'No pudimos verificar la suscripción en este momento. Probá de nuevo en unos minutos.' : 'Las copias todavía no están disponibles.')); return; }
        if (!r.ok) { c.appendChild(note('No pudimos cargar las copias.')); return; }
        c.appendChild(note('La app del local sube una copia cifrada de tu base de datos; se conservan las últimas ' + r.j.max + ' por sucursal. Si reinstalás, las recuperás entrando con tu cuenta.'));
        if (!r.j.restore) { c.appendChild(note('Para ver y restaurar tus copias hace falta una suscripción vigente.')); return; }
        if (!r.j.upload) c.appendChild(note('La suscripción no está activa: podés restaurar copias, pero no se suben nuevas.'));
        if (!r.j.backups.length) { c.appendChild(note('Todavía no hay copias.')); return; }
        var ul = el('ul', 'pays');
        r.j.backups.forEach(function (b) {
          var li = el('li'); li.appendChild(el('span', null, dt(b.createdAt) + (b.deviceName ? ' · ' + b.deviceName : ''))); li.appendChild(el('span', null, size(b.size)));
          var ac = el('span', 'acts'), a = el('a', 'lnk', 'Descargar'); a.href = '/api/backup?id=' + b.id + '&org=' + o.id; ac.appendChild(a);
          ac.appendChild(lnk('Eliminar', function () {
            confirmar('¿Eliminar esta copia?', 'Se borra del servidor y no se puede recuperar.', 'Sí, eliminar',
              function () { return api('DELETE', '/api/backup', { id: b.id, org: o.id }).then(function (x) { return x.ok ? {} : { error: msgError(x.j) }; }); }, cargar);
          }, true));
          li.appendChild(ac); ul.appendChild(li);
        });
        c.appendChild(ul);
      });
    }
    cargar();
  }
})();
