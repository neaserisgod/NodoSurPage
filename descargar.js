/* La descarga, dentro de Mi cuenta (2026-10-16: "hay 50 millones de descargas"). Una sola tarjeta grande con la app que le toca
   a esta persona en este dispositivo; el resto (otros dispositivos, la otra app y, para administración, las de prueba y las
   anteriores) queda plegado abajo.
   Qué app le toca lo dice su plan (Emprendedor = Nodo Sur Servicios, Sistema POS = la de almacén). Si el plan no lo dice
   (administración, cuentas eximidas, encargados, "Solo el bot"), aparece un selector de dos pastillas y se recuerda la elección.
   Uso: window.NS_DESCARGAS(contenedor, { app: 'almacen' | 'servicios' | null }). */
(function () {
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var NAMES = { windows: 'Nodo Sur POS para Windows', android: 'Nodo Sur POS para Android', macos: 'Nodo Sur POS para Mac', linux: 'Nodo Sur POS para Linux',
    'android-servicios': 'Nodo Sur Servicios para Android', 'windows-servicios': 'Nodo Sur Servicios para Windows' };
  var APPS = { almacen: 'Almacén o kiosco', servicios: 'Servicios con turno' };
  var PLAT = { almacen: { windows: 'windows', android: 'android', macos: 'macos', linux: 'linux' }, servicios: { windows: 'windows-servicios', android: 'android-servicios' } };
  var MSG = {
    no_subscription: ['Todavía no tenés una suscripción activa', 'La descarga se habilita con la suscripción. Elegí tu sistema y probalo 7 días sin costo.'],
    mp_error: ['No pudimos verificar tu suscripción', 'Mercado Pago no respondió. Probá de nuevo en unos minutos.'],
    no_disponible: ['Todavía no hay una versión para descargar', 'Estamos terminando de publicarla. Escribime por WhatsApp si la necesitás ya.']
  };
  var mb = function (n) { return (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',') + ' MB'; };
  var ver = function (r) { return r.version.split('+')[0]; };
  var url = function (r, channel) { return '/api/download?platform=' + r.platform + (channel === 'beta' ? '&channel=beta' : '') + (channel && channel.version ? '&channel=' + channel.ch + '&version=' + encodeURIComponent(r.version) : ''); };
  var guardada = function () { try { return localStorage.getItem('ns_app'); } catch (e) { return null; } };
  var guardar = function (a) { try { localStorage.setItem('ns_app', a); } catch (e) { /* solo es comodidad */ } };

  function aviso(root, k) {
    var m = MSG[k] || MSG.mp_error, c = el('section', 'acc acc-dl');
    c.appendChild(el('h2', null, m[0])); c.appendChild(el('p', 'acc-note', m[1])); root.appendChild(c);
  }

  // Una fila compacta: nombre, versión, peso y "Descargar".
  function fila(r, href, extra) {
    var row = el('div', 'dl-row');
    row.appendChild(el('strong', null, NAMES[r.platform] || r.platform));
    var meta = el('span', 'dl-row-m', ver(r) + (extra ? ' · ' + extra : '') + ' · ' + mb(r.size)); row.appendChild(meta);
    var a = el('a', 'lnk', 'Descargar'); a.href = href; row.appendChild(a);
    return row;
  }

  function montar(root, opts) {
    opts = opts || {};
    return fetch('/api/downloads', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
      if (r.status === 401) { location.replace('/api/auth/google'); return null; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      if (!d.canDownload) { aviso(root, d.reason); return; }
      if (!d.releases.length && !(d.beta || []).length) { aviso(root, 'no_disponible'); return; }
      var dev = window.NS_DEVICE || { id: 'other', name: '' };
      var hay = function (p) { return d.releases.filter(function (r) { return r.platform === p; })[0] || null; };
      var app = opts.app || guardada() || 'almacen';
      if (!APPS[app]) app = 'almacen';
      var box = el('div', 'dl-box'); root.appendChild(box);

      function pintar() {
        box.textContent = '';
        var hero = el('section', 'dl-hero');
        if (!opts.app) hero.appendChild(selector());
        var plat = (PLAT[app] || {})[dev.id], mine = plat ? hay(plat) : null;
        if (mine) {
          hero.appendChild(el('p', 'dl-detect on', 'Tu dispositivo: ' + dev.name));
          hero.appendChild(el('h2', null, NAMES[mine.platform]));
          var meta = el('div', 'dl-meta');
          meta.appendChild(el('span', null, 'Versión ' + ver(mine))); meta.appendChild(el('span', null, mb(mine.size)));
          hero.appendChild(meta);
          var a = el('a', 'btn', 'Descargar'); a.href = url(mine); hero.appendChild(a);
          if (mine.platform.indexOf('android') === 0) hero.appendChild(el('p', 'dl-hint', 'Al abrir el archivo, Android puede pedirte permiso para instalar desde el navegador: aceptalo y seguí.'));
          var det = el('details'); det.appendChild(el('summary', null, 'Verificar la descarga'));
          var p = el('p', 'acc-note', 'SHA-256: '); var code = el('code', null, mine.sha256); code.style.overflowWrap = 'anywhere'; p.appendChild(code); det.appendChild(p);
          hero.appendChild(det);
        } else if (app === 'servicios') {
          // iPhone, Mac o una compu sin versión instalable: Nodo Sur Servicios anda en el navegador, sin instalar nada.
          hero.appendChild(el('h2', null, 'Nodo Sur Servicios en el navegador'));
          hero.appendChild(el('p', 'dl-hint', 'Anda en iPhone, Mac o cualquier compu, sin instalar nada. El bot de WhatsApp necesita la app de Android o de Windows.'));
          var w = el('a', 'btn', 'Abrir Nodo Sur Servicios'); w.href = '/app/'; hero.appendChild(w);
        } else {
          hero.appendChild(el('h2', null, 'Descargalo desde la compu del local'));
          hero.appendChild(el('p', 'dl-hint', 'Abrí esta página desde la compu con Windows o el celular Android del local y te aparece el botón. Si preferís, las tenés todas acá abajo.'));
        }
        box.appendChild(hero);
        box.appendChild(otras(mine));
      }

      function selector() {
        var s = el('div', 'dl-apps'); s.setAttribute('role', 'radiogroup'); s.setAttribute('aria-label', '¿Qué app querés?');
        Object.keys(APPS).forEach(function (k) {
          var b = el('button', null, APPS[k]); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === app));
          b.addEventListener('click', function () { if (k === app) return; app = k; guardar(k); pintar(); var n = box.querySelector('.dl-apps [aria-checked=true]'); if (n) n.focus(); });
          s.appendChild(b);
        });
        return s;
      }

      // Todo lo demás, plegado: otros dispositivos y la otra app; para administración, también las de prueba y las anteriores.
      function otras(mine) {
        var det = el('details', 'acc dl-more');
        det.appendChild(el('summary', null, d.privileged ? 'Otras descargas, de prueba y anteriores' : 'Otros dispositivos'));
        if (!mine && app !== 'servicios') det.open = true;
        d.releases.forEach(function (r) { if (r !== mine) det.appendChild(fila(r, url(r))); });
        if ((d.beta || []).length) {
          det.appendChild(el('p', 'dl-sub-t', 'De prueba (solo administración)'));
          d.beta.forEach(function (r) { det.appendChild(fila(r, url(r, 'beta'), 'compilación ' + (r.version.split('+')[1] || ''))); });
        }
        if ((d.historial || []).length) {
          det.appendChild(el('p', 'dl-sub-t', 'Anteriores, para volver atrás'));
          det.appendChild(el('p', 'acc-note', 'Una versión nueva puede haber cambiado la base: antes de volver atrás, hacé una copia de seguridad.'));
          d.historial.forEach(function (r) { det.appendChild(fila(r, url(r, { ch: r.channel, version: true }), (r.channel === 'beta' ? 'prueba ' : '') + (r.version.split('+')[1] || ''))); });
        }
        return det;
      }

      pintar();
    }).catch(function () { var c = el('section', 'acc acc-dl'); c.appendChild(el('h2', null, 'No pudimos cargar la descarga')); c.appendChild(el('p', 'acc-note', 'Recargá la página.')); root.appendChild(c); });
  }

  window.NS_DESCARGAS = montar;
})();
