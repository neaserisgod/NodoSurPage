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
    var dev = window.NS_DEVICE || { id: 'other', name: '' };
    var mine = null;
    d.releases.forEach(function (r) { if (!mine && r.platform === dev.id) mine = r; });
    var rest = d.releases.filter(function (r) { return r !== mine; });
    if (mine) {
      root.appendChild(heroCard(mine, dev));
    } else if (dev.id !== 'other' && d.releases.length) {
      root.appendChild(el('p', 'dl-detect', 'Estás en ' + dev.name + ' y todavía no hay una versión para ese dispositivo. Estas son las disponibles:'));
    }
    if (rest.length) {
      if (mine) root.appendChild(el('p', 'dl-sep', 'Para otros dispositivos'));
      var grid = el('div', 'dl-grid');
      rest.forEach(function (r) { grid.appendChild(releaseCard(r, false)); });
      root.appendChild(grid);
    }
    if (betas.length) {
      root.appendChild(el('p', 'dl-sep', 'Versiones de prueba: solo las ves vos, como administrador, para probar antes de liberarlas a los clientes.'));
      var g2 = el('div', 'dl-grid');
      betas.forEach(function (r) { g2.appendChild(releaseCard(r, true)); });
      root.appendChild(g2);
    }
    if (d.historial && d.historial.length) root.appendChild(historyBlock(d.historial));
  }

  // Volver atrás: todas las versiones recientes de los dos canales, para reinstalar una anterior si una beta sale mal.
  function historyBlock(h) {
    var box = el('div', 'acc');
    box.appendChild(el('h2', null, 'Volver a una versión anterior'));
    box.appendChild(el('p', 'acc-note', 'Si una versión de prueba anda mal, instalá encima la estable que tenías. Ojo: una versión nueva puede haber cambiado la base de datos, y una más vieja no siempre la entiende. Antes de volver atrás, hacé una copia de seguridad y, si algo no abre, restaurala desde Configuración.'));
    Object.keys(NAMES).forEach(function (pl) {
      var rows = h.filter(function (r) { return r.platform === pl; });
      if (!rows.length) return;
      var det = el('details'); det.appendChild(el('summary', null, NAMES[pl][0] + ' (' + rows.length + ')'));
      rows.forEach(function (r) {
        var row = el('div', 'dl-meta');
        row.appendChild(el('strong', null, r.version.split('+')[0]));
        if (r.version.indexOf('+') > 0) row.appendChild(el('span', null, 'Compilación ' + r.version.split('+')[1]));
        row.appendChild(el('span', 'chip ' + (r.channel === 'beta' ? 'wait' : 'ok'), r.channel === 'beta' ? 'Prueba' : 'Estable'));
        row.appendChild(el('span', null, mb(r.size)));
        row.appendChild(el('span', null, date(r.publishedAt)));
        var a = el('a', 'btn btn-w', 'Descargar'); a.href = '/api/download?platform=' + r.platform + '&channel=' + r.channel + '&version=' + encodeURIComponent(r.version);
        row.appendChild(a); det.appendChild(row);
      });
      box.appendChild(det);
    });
    return box;
  }

  // Íconos simples por plataforma (decorativos).
  var ICON = {
    windows: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/></svg>',
    android: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 9.5h12v8a1.5 1.5 0 0 1-1.5 1.5H15v2.5a1.2 1.2 0 0 1-2.4 0V19h-1.2v2.5a1.2 1.2 0 0 1-2.4 0V19H7.5A1.5 1.5 0 0 1 6 17.5zM3.7 9.7a1.2 1.2 0 0 1 2.4 0v5.6a1.2 1.2 0 0 1-2.4 0zm14.2 0a1.2 1.2 0 0 1 2.4 0v5.6a1.2 1.2 0 0 1-2.4 0zM6.2 8.5a5.8 5.8 0 0 1 11.6 0zM9.6 6.3h.01M14.4 6.3h.01" stroke="currentColor" stroke-width=".01"/></svg>',
    macos: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    linux: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>'
  };

  // Tarjeta grande para el dispositivo de quien visita (detectado por el navegador).
  function heroCard(r, dev) {
    var n = NAMES[r.platform] || [r.platform, ''];
    var c = el('article', 'dl-hero');
    c.appendChild(el('p', 'dl-detect on', 'Detectamos tu dispositivo: ' + dev.name));
    c.appendChild(el('h2', null, 'Descargar para ' + n[0]));
    var meta = el('div', 'dl-meta');
    meta.appendChild(el('span', null, 'Versión ' + r.version.split('+')[0]));
    meta.appendChild(el('span', null, mb(r.size)));
    meta.appendChild(el('span', null, 'Publicada el ' + date(r.publishedAt)));
    c.appendChild(meta);
    var a = el('a', 'btn', 'Descargar para ' + n[0]);
    a.href = '/api/download?platform=' + r.platform;
    c.appendChild(a);
    if (r.platform === 'android') c.appendChild(el('p', 'dl-hint', 'Al abrir el archivo, Android puede pedirte permiso para instalar desde este navegador: aceptalo y seguí.'));
    var det = el('details'); det.appendChild(el('summary', null, 'Verificar la descarga'));
    var p = el('p', 'acc-note', 'SHA-256: '); var code = el('code', null, r.sha256); code.style.overflowWrap = 'anywhere'; p.appendChild(code); det.appendChild(p);
    c.appendChild(det);
    return c;
  }

  // Una tarjeta por versión. La de prueba (beta) solo la reciben las cuentas de administrador.
  function releaseCard(r, beta) {
    var n = NAMES[r.platform] || [r.platform, ''];
    var c = el('article', 'acc dl' + (beta ? ' beta' : ''));
    var head = el('div', 'dl-h');
    var ic = el('span', 'dl-ic'); ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = ICON[r.platform] || ICON.linux;
    head.appendChild(ic);
    var t = el('div'); t.appendChild(el('h2', null, n[0])); t.appendChild(el('p', 'dl-sub', n[1])); head.appendChild(t);
    if (beta) head.appendChild(el('span', 'chip wait', 'Versión de prueba'));
    c.appendChild(head);
    c.appendChild(el('p', 'dl-v', r.version.split('+')[0]));
    var meta = el('div', 'dl-meta');
    if (r.version.indexOf('+') > 0) meta.appendChild(el('span', null, 'Compilación ' + r.version.split('+')[1]));
    meta.appendChild(el('span', null, mb(r.size)));
    meta.appendChild(el('span', null, 'Publicada el ' + date(r.publishedAt)));
    c.appendChild(meta);
    if (r.notes) c.appendChild(el('p', 'acc-note', r.notes));
    var a = el('a', 'btn', beta ? 'Descargar la beta para ' + n[0] : 'Descargar para ' + n[0]);
    a.href = '/api/download?platform=' + r.platform + (beta ? '&channel=beta' : '');
    c.appendChild(a);
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
