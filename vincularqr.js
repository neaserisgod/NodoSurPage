// /vincular/qr/?p=<pedido>: el QR que muestra Nodo Estudio en la compu, escaneado con la cámara del celular (sin la app).
// Con la sesión del sitio se confirma y la compu entra sola (`functions/api/device/qr.js`). Desde la app del celular es lo mismo
// sin pasar por acá.
(function () {
  var root = document.getElementById('vincular-qr');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function done() { root.removeAttribute('aria-busy'); root.textContent = ''; }
  function card(t) { var c = el('section', 'acc'); c.appendChild(el('h2', null, t)); return c; }
  function aviso(titulo, texto) { done(); var c = card(titulo); c.appendChild(el('p', 'acc-note', texto)); root.appendChild(c); }
  var pedido = new URLSearchParams(location.search).get('p') || '';
  if (!/^[0-9a-f]{32}$/.test(pedido)) { aviso('El código no es válido', 'Volvé a escanear el QR que muestra la compu.'); return; }
  var post = function (ruta) {
    return fetch(ruta, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ id: pedido }) });
  };
  var vencido = function () { aviso('Este código venció', 'En la compu tocá «Mostrar otro código» y escanealo de nuevo.'); };
  post('/api/device/qr/ver').then(function (r) {
    if (r.status === 401) { location.replace('/api/auth/google?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    if (r.status === 410) { vencido(); return null; }
    return r.ok ? r.json() : Promise.reject();
  }).then(function (j) {
    if (!j) return;
    done();
    var c = card('¿Entrar en la compu con tu cuenta?');
    c.appendChild(el('p', 'acc-note', 'Vas a entrar en «' + j.nombre + '» con tu cuenta, en tu negocio. Lo que se haga desde esa compu queda a tu nombre.'));
    c.appendChild(el('p', 'acc-note', 'Hacelo solo si tenés esa compu adelante y vos abriste Nodo Estudio en ella.'));
    var msg = el('p', 'login-err'); msg.setAttribute('role', 'alert');
    var acts = el('div', 'acc-actions');
    var ok = el('button', 'btn', 'Entrar'); ok.type = 'button';
    var no = el('a', 'btn btn-w', 'Cancelar'); no.href = '/cuenta/';
    acts.appendChild(ok); acts.appendChild(no); c.appendChild(acts); c.appendChild(msg); root.appendChild(c);
    ok.addEventListener('click', function () {
      ok.disabled = true; ok.textContent = 'Entrando…'; msg.textContent = '';
      post('/api/device/qr/aprobar').then(function (r) {
        if (r.status === 410) { vencido(); return; }
        if (!r.ok) throw new Error();
        aviso('Listo', 'La compu entra sola en unos segundos. Ya podés cerrar esta página.');
      }).catch(function () { ok.disabled = false; ok.textContent = 'Entrar'; msg.textContent = 'No se pudo. Probá de nuevo.'; });
    });
  }).catch(function () { aviso('No pudimos comprobar tu sesión', 'Recargá la página.'); });
})();
