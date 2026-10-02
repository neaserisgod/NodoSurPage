(function () {
  var root = document.getElementById('vincular');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function done() { root.removeAttribute('aria-busy'); root.textContent = ''; }
  function card(t) { var c = el('section', 'acc'); c.appendChild(el('h2', null, t)); return c; }
  var q = new URLSearchParams(location.search);
  var port = parseInt(q.get('port'), 10), state = q.get('state') || '', challenge = q.get('challenge') || '', device = q.get('device') || '';
  var name = (q.get('name') || 'Mi PC').slice(0, 60);
  var valido = port >= 1024 && port <= 65535 && /^[A-Za-z0-9_-]{16,128}$/.test(state) && /^[A-Za-z0-9_-]{43}$/.test(challenge) && /^[A-Za-z0-9_-]{16,64}$/.test(device);

  function error(msg) { done(); var c = card('No se pudo vincular'); c.appendChild(el('p', 'acc-note', msg)); root.appendChild(c); }
  if (!valido) { error('El enlace no es válido. Volvé a abrir la vinculación desde la app.'); return; }

  fetch('/api/device/whoami', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
    if (r.status === 401) { location.replace('/ingresar/?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    return r.ok ? r.json() : Promise.reject();
  }).then(function (u) {
    if (!u) return;
    done();
    if (u.canLink === false) {
      var nc = card('Solo el dueño puede vincular una PC');
      nc.appendChild(el('p', 'acc-note', 'Ingresaste como ' + u.email + ', que es parte de un negocio pero no es su dueño. Pedile al dueño que vincule la PC con su cuenta.'));
      var na = el('a', 'btn btn-w', 'Ir a mi cuenta'); na.href = '/cuenta/'; nc.appendChild(na); root.appendChild(nc); return;
    }
    var orgs = u.orgs || [];
    var c = card('¿Vincular esta PC a tu cuenta?');
    c.appendChild(el('p', 'acc-note', 'Vas a vincular «' + name + '» con la cuenta ' + u.email + '. Desde ahí la app puede guardar copias de tu base y, si reinstalás, recuperarlas entrando con esta cuenta.'));
    // Si tiene más de un negocio o más de una sucursal, elige a cuál pertenece esta PC.
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
      if (orgs.length > 1 || orgs[0].branches.length > 1) c.appendChild(frm);
    }
    c.appendChild(el('p', 'acc-note', 'Si no abriste esto desde la app de Nodo Sur POS en tu PC, cerrá esta página.'));
    var msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
    var acts = el('div', 'acc-actions');
    var ok = el('button', 'btn', 'Vincular'); ok.type = 'button';
    var no = el('a', 'btn btn-w', 'Cancelar'); no.href = '/cuenta/';
    acts.appendChild(ok); acts.appendChild(no); c.appendChild(acts); c.appendChild(msg); root.appendChild(c);
    ok.addEventListener('click', function () {
      ok.disabled = true; ok.textContent = 'Vinculando…'; msg.textContent = '';
      fetch('/api/device/authorize', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify(Object.assign({ port: port, state: state, challenge: challenge, deviceId: device, name: name },
          orgs.length ? { orgId: parseInt(selOrg ? selOrg.value : orgs[0].id, 10), branchId: parseInt(selBr.value, 10) } : {})) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok || typeof x.j.redirect !== 'string' || x.j.redirect.indexOf('http://127.0.0.1:' + port + '/') !== 0) throw new Error();
          location.href = x.j.redirect;
        }).catch(function () { ok.disabled = false; ok.textContent = 'Vincular'; msg.textContent = 'No se pudo vincular. Probá de nuevo.'; });
    });
  }).catch(function () { error('No pudimos comprobar tu sesión. Recargá la página.'); });
})();
