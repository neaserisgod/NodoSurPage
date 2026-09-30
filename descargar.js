(function () {
  var root = document.getElementById('descargar');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var NAMES = { windows: ['Windows', 'La versión para la compu del local.'], macos: ['macOS', 'Para Mac.'], linux: ['Linux', 'Para Linux.'], android: ['Android', 'La app para el celular.'] };
  var MSG = {
    no_subscription: ['Todavía no tenés una suscripción activa.', 'La descarga está disponible para quienes ya tienen su suscripción. Elegí tu sistema y probalo 7 días sin costo.'],
    mp_error: ['No pudimos verificar tu suscripción en este momento.', 'Mercado Pago no respondió. Probá de nuevo en unos minutos.'],
    no_disponible: ['Todavía no hay una versión para descargar.', 'Estamos terminando de publicarla. Escribime por WhatsApp si la necesitás ya.']
  };
  var mb = function (n) { return (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',') + ' MB'; };
  var date = function (s) { return new Date(s * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }); };
  function card(t) { var c = el('section', 'acc'); c.appendChild(el('h2', null, t)); return c; }
  function done() { root.removeAttribute('aria-busy'); root.textContent = ''; }
  function note(c, t) { c.appendChild(el('p', 'acc-note', t)); }

  function render(d, err) {
    done();
    var c;
    if (!d.canDownload) {
      var m = MSG[err || d.reason] || MSG.mp_error;
      c = card(m[0]); note(c, m[1]);
      var acts = el('div', 'acc-actions');
      var a1 = el('a', 'btn', d.reason === 'no_subscription' ? 'Elegir mi sistema' : 'Ir a Mi cuenta'); a1.href = '/cuenta/'; acts.appendChild(a1);
      var a2 = el('a', 'btn btn-w', 'Escribime por WhatsApp'); a2.rel = 'noopener'; a2.href = 'https://wa.me/5492944796044?text=' + encodeURIComponent('Hola, quiero descargar el sistema'); acts.appendChild(a2);
      c.appendChild(acts); root.appendChild(c); return;
    }
    var betas = d.beta || [];
    if (!d.releases.length && !betas.length) { c = card(MSG.no_disponible[0]); note(c, MSG.no_disponible[1]); root.appendChild(c); return; }
    betas.forEach(function (r) { root.appendChild(releaseCard(r, true)); });
    d.releases.forEach(function (r) { root.appendChild(releaseCard(r, false)); });
  }

  // Una tarjeta por versión. La de prueba (beta) solo la reciben las cuentas de administrador.
  function releaseCard(r, beta) {
    var n = NAMES[r.platform] || [r.platform, ''], c;
    c = card(beta ? n[0] + ' · versión de prueba (beta)' : n[0]);
    if (beta) note(c, 'Solo la ves vos, como administrador: sirve para probar antes de liberarla a los clientes.');
    note(c, n[1] + ' Versión ' + r.version.split('+')[0] + (r.version.indexOf('+') > 0 ? ' (compilación ' + r.version.split('+')[1] + ')' : '') + ' · ' + mb(r.size) + ' · publicada el ' + date(r.publishedAt) + '.');
    if (r.notes) c.appendChild(el('p', 'acc-note', r.notes));
    var a = el('a', 'btn', beta ? 'Descargar la beta para ' + n[0] : 'Descargar para ' + n[0]); a.href = '/api/download?platform=' + r.platform + (beta ? '&channel=beta' : ''); a.style.alignSelf = 'flex-start'; c.appendChild(a);
    var det = el('details'); det.appendChild(el('summary', null, 'Verificar la descarga'));
    var p = el('p', 'acc-note', 'SHA-256: '); var code = el('code', null, r.sha256); code.style.overflowWrap = 'anywhere'; p.appendChild(code); det.appendChild(p);
    c.appendChild(det);
    return c;
  }

  var err = new URLSearchParams(location.search).get('e');
  fetch('/api/downloads', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
    if (r.status === 401) { location.replace('/ingresar/'); return null; }
    return r.json();
  }).then(function (d) { if (d) render(d, err); }).catch(function () {
    done(); var c = card('No pudimos cargar la descarga'); note(c, 'Recargá la página.'); root.appendChild(c);
  });
})();
