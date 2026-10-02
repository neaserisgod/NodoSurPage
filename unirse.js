(function () {
  var root = document.getElementById('unirse');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function card(t) { var c = el('section', 'acc'); c.appendChild(el('h2', null, t)); return c; }
  function show(c) { root.removeAttribute('aria-busy'); root.textContent = ''; root.appendChild(c); }
  function link(href, txt, cls) { var a = el('a', cls || 'btn', txt); a.href = href; return a; }
  var ROLE = { manager: 'encargado', employee: 'empleado' };
  var HDR = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };

  // El token viaja en la dirección; se guarda en memoria y se saca de la barra para que no quede en el historial
  // ni se copie sin querer al compartir la pantalla.
  var token = new URLSearchParams(location.search).get('t') || '';
  var propio = '/unirse/?t=' + token;
  function limpiarDireccion() { try { history.replaceState(null, '', '/unirse/'); } catch (e) { /* sin historial: no pasa nada */ } }

  function problema(titulo, texto, acciones) {
    var c = card(titulo); c.appendChild(el('p', 'acc-note', texto));
    if (acciones && acciones.length) { var a = el('div', 'acc-actions'); acciones.forEach(function (x) { a.appendChild(x); }); c.appendChild(a); }
    show(c);
  }

  if (!/^[0-9a-f]{64}$/.test(token)) {
    problema('Invitación no válida', 'El link está incompleto. Abrilo de nuevo desde el mail o pedile al dueño del negocio que te mande otro.', [link('/cuenta/', 'Ir a mi cuenta', 'btn btn-w')]);
    return;
  }

  function aceptar(btn, msg) {
    btn.disabled = true; btn.textContent = 'Uniéndome…'; msg.textContent = '';
    fetch('/api/org/accept', { method: 'POST', credentials: 'same-origin', headers: HDR, body: JSON.stringify({ token: token }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        if (x.status === 200) {
          var c = card('¡Listo! Ya sos parte de ' + x.j.orgName);
          c.appendChild(el('p', 'acc-note', 'Te sumaste como ' + (ROLE[x.j.role] || x.j.role) + '. Desde tu cuenta ves el negocio y tus sucursales.'));
          var a = el('div', 'acc-actions'); a.appendChild(link('/negocio/?org=' + encodeURIComponent(x.j.orgId), 'Ir a mi negocio')); c.appendChild(a); show(c); return;
        }
        btn.disabled = false; btn.textContent = 'Unirme';
        msg.textContent = x.j.error === 'already_member' ? 'Ya sos parte de este negocio.'
          : x.j.error === 'branches_unavailable' ? 'Las sucursales de esta invitación ya no están disponibles. Pedile al dueño que te invite de nuevo.'
          : x.status === 410 ? 'Esta invitación ya se usó o venció. Pedile al dueño que te mande otra.'
          : 'No pudimos sumarte. Probá de nuevo.';
      }).catch(function () { btn.disabled = false; btn.textContent = 'Unirme'; msg.textContent = 'Error de conexión. Probá de nuevo.'; });
  }

  fetch('/api/org/invitation?t=' + token, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
    .then(function (x) {
      if (x.status === 401) { location.replace('/ingresar/?next=' + encodeURIComponent(propio)); return; }
      limpiarDireccion();
      if (x.status === 200) {
        var d = x.j, c = card('Te invitaron a ' + d.org.name);
        c.appendChild(el('p', 'acc-note', 'Vas a sumarte como ' + (ROLE[d.role] || d.role) + (d.allBranches ? ' en todas las sucursales' : ' en: ' + d.branches.join(', ')) + '. Ingresaste con ' + d.email + '.'));
        c.appendChild(el('p', 'acc-note', 'Si no conocés este negocio, no aceptes: cerrá esta página y no pasa nada.'));
        var msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
        var a = el('div', 'acc-actions'), ok = el('button', 'btn', 'Unirme'); ok.type = 'button';
        ok.addEventListener('click', function () { aceptar(ok, msg); });
        a.appendChild(ok); a.appendChild(link('/cuenta/', 'Ahora no', 'btn btn-w')); c.appendChild(a); c.appendChild(msg); show(c);
      } else if (x.status === 403) {
        var b = el('button', 'btn', 'Ingresar con otro mail'); b.type = 'button';
        b.addEventListener('click', function () {
          b.disabled = true;
          fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
            .then(function () { location.replace('/ingresar/?next=' + encodeURIComponent(propio)); })
            .catch(function () { location.replace('/ingresar/?next=' + encodeURIComponent(propio)); });
        });
        problema('Esta invitación es para otro mail', 'Fue enviada a ' + (x.j.hint || 'otro mail') + ' y vos ingresaste con una cuenta distinta. Ingresá con el mail al que te llegó la invitación.', [b, link('/cuenta/', 'Volver a mi cuenta', 'btn btn-w')]);
      } else if (x.status === 410) {
        problema('Esta invitación ya no sirve', 'Ya se usó o venció (duran 7 días). Pedile al dueño del negocio que te mande una nueva.', [link('/cuenta/', 'Ir a mi cuenta', 'btn btn-w')]);
      } else {
        problema('No encontramos la invitación', 'Puede que el dueño la haya cancelado o que el link esté incompleto. Pedile que te mande otra.', [link('/cuenta/', 'Ir a mi cuenta', 'btn btn-w')]);
      }
    }).catch(function () { problema('No pudimos cargar la invitación', 'Revisá tu conexión y recargá la página.'); });
})();
