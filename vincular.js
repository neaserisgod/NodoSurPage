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
    var c = card('¿Vincular esta PC a tu cuenta?');
    c.appendChild(el('p', 'acc-note', 'Vas a vincular «' + name + '» con la cuenta ' + u.email + '. Desde ahí la app puede guardar copias de tu base y, si reinstalás, recuperarlas entrando con esta cuenta.'));
    c.appendChild(el('p', 'acc-note', 'Si no abriste esto desde la app de Nodo Sur POS en tu PC, cerrá esta página.'));
    var msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
    var acts = el('div', 'acc-actions');
    var ok = el('button', 'btn', 'Vincular'); ok.type = 'button';
    var no = el('a', 'btn btn-w', 'Cancelar'); no.href = '/cuenta/';
    acts.appendChild(ok); acts.appendChild(no); c.appendChild(acts); c.appendChild(msg); root.appendChild(c);
    ok.addEventListener('click', function () {
      ok.disabled = true; ok.textContent = 'Vinculando…'; msg.textContent = '';
      fetch('/api/device/authorize', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ port: port, state: state, challenge: challenge, deviceId: device, name: name }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok || typeof x.j.redirect !== 'string' || x.j.redirect.indexOf('http://127.0.0.1:' + port + '/') !== 0) throw new Error();
          location.href = x.j.redirect;
        }).catch(function () { ok.disabled = false; ok.textContent = 'Vincular'; msg.textContent = 'No se pudo vincular. Probá de nuevo.'; });
    });
  }).catch(function () { error('No pudimos comprobar tu sesión. Recargá la página.'); });
})();
