// Link de prueba que manda el dueño (ver functions/_lib/pilotos.js): ingresa con Google, la cuenta queda habilitada y pasa a
// Mi cuenta, donde ya aparece la descarga de su app.
(function () {
  var root = document.getElementById('invitado');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function link(href, txt, cls) { var a = el('a', cls || 'btn', txt); a.href = href; return a; }
  function tarjeta(titulo, texto, acciones) {
    var c = el('section', 'acc'); c.appendChild(el('h2', null, titulo)); c.appendChild(el('p', 'acc-note', texto));
    if (acciones.length) { var a = el('div', 'acc-actions'); acciones.forEach(function (x) { a.appendChild(x); }); c.appendChild(a); }
    root.removeAttribute('aria-busy'); root.textContent = ''; root.appendChild(c);
  }
  var WA = 'https://wa.me/5492944796044?text=' + encodeURIComponent('Hola, tengo un problema con mi link de prueba de Nodo Gastro.');
  var ayuda = function () { return link(WA, 'Escribinos por WhatsApp', 'btn btn-w'); };
  var token = new URLSearchParams(location.search).get('t') || '';
  if (!/^[0-9a-f]{64}$/.test(token)) {
    tarjeta('El link no está completo', 'Abrilo de nuevo desde el mensaje que te llegó, o pedinos otro.', [ayuda()]);
    return;
  }
  var propio = '/invitado/?t=' + token;
  var ERR = {
    usado: ['Este link ya se usó', 'Sirve para una sola cuenta y ya lo activó otra persona. Si fuiste vos con otro mail, ingresá con ese. Si no, pedinos uno nuevo.'],
    vencido: ['Este link venció', 'Los links de prueba duran 7 días. Pedinos uno nuevo y te lo mandamos.'],
    no_valido: ['Este link no es válido', 'Revisá que esté completo o pedinos uno nuevo.']
  };
  fetch('/api/invitado', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ token: token }) })
    .then(function (r) {
      if (r.status === 401) {
        tarjeta('Te invitamos a probar Nodo Gastro', 'Ingresá con tu cuenta de Google y te llevamos directo a descargar la app. No pagás nada durante la prueba.',
          [link('/api/auth/google?next=' + encodeURIComponent(propio), 'Ingresar con Google')]);
        return null;
      }
      return r.json().then(function (j) {
        if (j.ok) { tarjeta('Listo, tu prueba está activa', 'Te llevamos a descargar la app…', []); location.replace('/cuenta/'); return; }
        var m = ERR[j.error] || ['No pudimos activar la prueba', 'Probá de nuevo en un rato o escribinos.'];
        tarjeta(m[0], m[1], [ayuda()]);
      });
    })
    .catch(function () { tarjeta('No pudimos activar la prueba', 'Revisá tu conexión y recargá la página.', [ayuda()]); });
})();
