(function () {
  var root = document.getElementById('vincular');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function done() { root.removeAttribute('aria-busy'); root.textContent = ''; }
  function card(t) { var c = el('section', 'acc'); c.appendChild(el('h2', null, t)); return c; }
  var q = new URLSearchParams(location.search);
  var port = parseInt(q.get('port'), 10), state = q.get('state') || '', challenge = q.get('challenge') || '', device = q.get('device') || '';
  // `tipo=celular`: lo abre la app del celular. Ahí no se vincula "la PC del dueño": cada persona (dueño, encargado o empleado)
  // entra con SU cuenta y el celular queda con su perfil, sin selector.
  var celular = q.get('tipo') === 'celular';
  // `tipo=bot`: lo abre el instalador del bot de WhatsApp (un celular con Termux). Lo vincula el dueño o un encargado.
  var bot = q.get('tipo') === 'bot';
  var name = (q.get('name') || (bot ? 'Bot de WhatsApp' : celular ? 'Mi celular' : 'Mi PC')).slice(0, 60);
  var valido = port >= 1024 && port <= 65535 && /^[A-Za-z0-9_-]{16,128}$/.test(state) && /^[A-Za-z0-9_-]{43}$/.test(challenge) && /^[A-Za-z0-9_-]{16,64}$/.test(device);

  function error(msg) { done(); var c = card('No se pudo vincular'); c.appendChild(el('p', 'acc-note', msg)); root.appendChild(c); }
  if (!valido) { error('El enlace no es válido. Volvé a abrir la vinculación desde la app.'); return; }

  fetch('/api/device/whoami' + (bot ? '?tipo=bot' : celular ? '?tipo=celular' : ''), { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
    if (r.status === 401) { location.replace('/ingresar/?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    return r.ok ? r.json() : Promise.reject();
  }).then(function (u) {
    if (!u) return;
    done();
    if (u.canLink === false) {
      var nc = card(bot ? 'Solo el dueño o un encargado pueden vincular el bot' : celular ? 'Todavía no tenés una sucursal asignada' : 'Solo el dueño puede vincular un dispositivo');
      nc.appendChild(el('p', 'acc-note', bot
        ? 'Ingresaste como ' + u.email + ', que no es dueño ni encargado de un negocio en Nodo Sur. Entrá con la cuenta del dueño.'
        : celular
        ? 'Ingresaste como ' + u.email + ', pero ese mail todavía no tiene una sucursal donde trabajar. Pedile al dueño que te la asigne en Mi negocio.'
        : 'Ingresaste como ' + u.email + ', que es parte de un negocio pero no es su dueño. Pedile al dueño que vincule el dispositivo con su cuenta.'));
      var na = el('a', 'btn btn-w', 'Ir a mi cuenta'); na.href = '/cuenta/'; nc.appendChild(na); root.appendChild(nc); return;
    }
    var orgs = u.orgs || [];
    var c = card(bot ? '¿Vincular el bot de WhatsApp a tu negocio?' : celular ? '¿Entrar en este celular con tu cuenta?' : '¿Vincular este dispositivo a tu cuenta?');
    c.appendChild(el('p', 'acc-note', bot
      ? 'Vas a vincular «' + name + '» como el bot de WhatsApp de tu negocio, con la cuenta ' + u.email + '. Va a atender con la configuración que cargues en la app de Nodo Sur.'
      : celular
      ? 'Vas a entrar en «' + name + '» como ' + (u.name || u.email) + ' (' + u.email + '). Lo que hagas desde este celular queda a tu nombre, y no se puede cambiar de perfil desde acá.'
      : 'Vas a vincular «' + name + '» con la cuenta ' + u.email + '. Desde ahí la app puede guardar copias de tu base y, si reinstalás, recuperarlas entrando con esta cuenta.'));
    // Si tiene más de un negocio o más de una sucursal, elige a cuál pertenece este dispositivo.
    var selOrg = null, selBr = null;
    if (orgs.length) {
      var frm = el('div', 'frm');
      function opciones(sel, items) { sel.textContent = ''; items.forEach(function (x) { var o = el('option', null, x.name); o.value = String(x.id); sel.appendChild(o); }); }
      if (orgs.length > 1) { var l1 = el('label', null, 'Negocio'); selOrg = el('select'); opciones(selOrg, orgs); l1.appendChild(selOrg); frm.appendChild(l1); }
      var l2 = el('label', null, 'Sucursal'); selBr = el('select'); l2.appendChild(selBr);
      var actual = function () { return orgs.filter(function (o) { return !selOrg || String(o.id) === selOrg.value; })[0] || orgs[0]; };
      opciones(selBr, actual().branches);
      if (selOrg) selOrg.addEventListener('change', function () { opciones(selBr, actual().branches); l2.hidden = actual().branches.length < 2; });
      l2.hidden = actual().branches.length < 2; frm.appendChild(l2);
      if (orgs.length > 1 || orgs[0].branches.length > 1) {
        c.appendChild(frm);
        // La sincronización entre dispositivos es por sucursal: la PC y el celular tienen que quedar en la misma para verse.
        c.appendChild(el('p', 'acc-note', bot
          ? 'Elegí la sucursal que va a atender el bot: usa sus productos, sus precios y sus pedidos.'
          : 'Para que la PC y el celular se sincronicen entre sí, vinculá los dos a la misma sucursal.'));
      }
    }
    c.appendChild(el('p', 'acc-note', 'Si no abriste esto desde la app de Nodo Sur POS (en tu PC o en tu celular), cerrá esta página.'));
    var msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
    var acts = el('div', 'acc-actions');
    var ok = el('button', 'btn', celular ? 'Entrar' : 'Vincular'); ok.type = 'button';
    var no = el('a', 'btn btn-w', 'Cancelar'); no.href = '/cuenta/';
    acts.appendChild(ok); acts.appendChild(no); c.appendChild(acts); c.appendChild(msg); root.appendChild(c);
    ok.addEventListener('click', function () {
      ok.disabled = true; ok.textContent = celular ? 'Entrando…' : 'Vinculando…'; msg.textContent = '';
      fetch('/api/device/authorize', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify(Object.assign({ port: port, state: state, challenge: challenge, deviceId: device, name: name }, bot ? { tipo: 'bot' } : celular ? { tipo: 'celular' } : {},
          orgs.length ? { orgId: parseInt(selOrg ? selOrg.value : orgs[0].id, 10), branchId: parseInt(selBr.value, 10) } : {})) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok || typeof x.j.redirect !== 'string' || x.j.redirect.indexOf('http://127.0.0.1:' + port + '/') !== 0) throw new Error();
          location.href = x.j.redirect;
        }).catch(function () { ok.disabled = false; ok.textContent = celular ? 'Entrar' : 'Vincular'; msg.textContent = 'No se pudo vincular. Probá de nuevo.'; });
    });
  }).catch(function () { error('No pudimos comprobar tu sesión. Recargá la página.'); });
})();
