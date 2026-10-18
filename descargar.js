/* La descarga, dentro de Mi cuenta (2026-10-16: "hay 50 millones de descargas"). Una sola tarjeta grande con la app que le toca
   a esta persona en este dispositivo; la misma app para los otros dispositivos queda plegada abajo.
   Se muestra solo la última versión de la app elegida (y, para administración, también la última de prueba).
   Qué app le toca lo dice su plan (Nodo Estudio = servicios, Nodo Gastro = gastronomía, Nodo Gestión = almacén). Si el plan no
   lo dice (administración, cuentas eximidas, encargados, "Solo el bot"), aparece un selector de pastillas y se recuerda la elección.
   Uso: window.NS_DESCARGAS(contenedor, { app: 'almacen' | 'servicios' | 'gastro' | null, pedido }). `pedido` es el fetch de
   /api/downloads ya en curso (Mi cuenta lo larga junto con /api/me, así no espera una consulta para empezar la otra). */
(function () {
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var NAMES = { windows: 'Nodo Gestión para Windows', android: 'Nodo Gestión para Android', macos: 'Nodo Gestión para Mac', linux: 'Nodo Gestión para Linux',
    'android-servicios': 'Nodo Estudio para Android', 'windows-servicios': 'Nodo Estudio para Windows',
    'android-gastronomia': 'Nodo Gastro para Android', 'windows-gastronomia': 'Nodo Gastro para Windows' };
  var APPS = { servicios: 'Nodo Estudio', gastro: 'Nodo Gastro', almacen: 'Nodo Gestión' };
  var PLAT = { almacen: { windows: 'windows', android: 'android', macos: 'macos', linux: 'linux' }, servicios: { windows: 'windows-servicios', android: 'android-servicios' },
    gastro: { windows: 'windows-gastronomia', android: 'android-gastronomia' } };
  var MSG = {
    no_subscription: ['Todavía no tenés una suscripción activa', 'La descarga se habilita con la suscripción. Elegí tu sistema y probalo 7 días sin costo.'],
    mp_error: ['No pudimos verificar tu suscripción', 'Mercado Pago no respondió. Probá de nuevo en unos minutos.'],
    no_disponible: ['Todavía no hay una versión para descargar', 'Estamos terminando de publicarla. Escribinos por WhatsApp si la necesitás ya.']
  };
  var mb = function (n) { return (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',') + ' MB'; };
  var ver = function (r) { return r.version.split('+')[0]; };
  var url = function (r, channel) { return '/api/download?platform=' + r.platform + (channel === 'beta' ? '&channel=beta' : ''); };
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
    return (opts.pedido || pedir()).then(function (r) {
      if (r.status === 401) { location.replace('/api/auth/google'); return null; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      root.textContent = ''; // saca el esqueleto que puso Mi cuenta mientras esperaba
      if (!d.canDownload) { aviso(root, d.reason); return; }
      if (!d.releases.length && !(d.beta || []).length) { aviso(root, 'no_disponible'); return; }
      var dev = window.NS_DEVICE || { id: 'other', name: '' };
      // Solo la última de cada canal: la estable para todos y, para administración, también la de prueba.
      var de = function (lista, p) { return (lista || []).filter(function (r) { return r.platform === p; })[0] || null; };
      var estable = function (p) { return de(d.releases, p); };
      var prueba = function (p) { return d.privileged ? de(d.beta, p) : null; };
      var compilacion = function (r) { return r.version.split('+')[1] || ''; };
      var app = opts.app || guardada() || 'servicios';
      if (!APPS[app]) app = 'servicios';
      var box = el('div', 'dl-box'); root.appendChild(box);

      // Un botón grande por versión: la estable (naranja) y, si es administración, la de prueba al lado.
      function botones(hero, plat) {
        var st = estable(plat), be = prueba(plat), fila = el('div', 'dl-btns');
        if (st) { var a = el('a', 'btn', 'Descargar'); a.href = url(st); fila.appendChild(a); }
        if (be) { var b = el('a', st ? 'btn btn-w' : 'btn', st ? 'Versión de prueba' : 'Descargar la versión de prueba'); b.href = url(be, 'beta'); fila.appendChild(b); }
        hero.appendChild(fila);
        var meta = el('div', 'dl-meta');
        if (st) { meta.appendChild(el('span', null, 'Versión ' + ver(st))); meta.appendChild(el('span', null, mb(st.size))); }
        if (be) meta.appendChild(el('span', null, 'Prueba ' + ver(be) + (compilacion(be) ? ' · compilación ' + compilacion(be) : '')));
        hero.appendChild(meta);
        return st || be;
      }

      function pintar() {
        box.textContent = '';
        var hero = el('section', 'dl-hero');
        if (!opts.app) hero.appendChild(selector());
        var plats = PLAT[app] || {}, plat = plats[dev.id];
        var lista = Object.keys(plats).map(function (k) { return plats[k]; }).filter(function (p) { return estable(p) || prueba(p); });
        if (plat && (estable(plat) || prueba(plat))) {
          hero.appendChild(el('p', 'dl-detect on', 'Tu dispositivo: ' + dev.name));
          hero.appendChild(el('h2', null, NAMES[plat]));
          var r = botones(hero, plat);
          if (plat.indexOf('android') === 0) hero.appendChild(el('p', 'dl-hint', 'Al abrir el archivo, Android puede pedirte permiso para instalar desde el navegador: aceptalo y seguí.'));
          var det = el('details'); det.appendChild(el('summary', null, 'Verificar la descarga'));
          var p = el('p', 'acc-note', 'SHA-256: '); var code = el('code', null, r.sha256); code.style.overflowWrap = 'anywhere'; p.appendChild(code); det.appendChild(p);
          hero.appendChild(det);
        } else if (app === 'servicios') {
          // iPhone, Mac o una compu sin versión instalable: Nodo Estudio anda en el navegador, sin instalar nada.
          hero.appendChild(el('h2', null, 'Nodo Estudio en el navegador'));
          hero.appendChild(el('p', 'dl-hint', 'Anda en iPhone, Mac o cualquier compu, sin instalar nada. El bot de WhatsApp necesita la app de Android o de Windows.'));
          var w = el('a', 'btn', 'Abrir Nodo Estudio'); w.href = '/app/'; hero.appendChild(w);
        } else if (!lista.length) {
          hero.appendChild(el('h2', null, APPS[app] + ' está por salir'));
          hero.appendChild(el('p', 'dl-hint', 'Todavía no está publicada para descargar. Escribinos por WhatsApp y te avisamos apenas esté.'));
        } else {
          hero.appendChild(el('h2', null, 'Descargalo desde la compu del local'));
          hero.appendChild(el('p', 'dl-hint', 'Abrí esta página desde la compu con Windows o el celular Android del local y te aparece el botón. Si preferís, las tenés acá abajo.'));
        }
        box.appendChild(hero);
        var resto = lista.filter(function (p) { return p !== plat; });
        if (resto.length) box.appendChild(otras(resto, !plat || !(estable(plat) || prueba(plat))));
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

      // La misma app para los otros dispositivos (la compu y el celular), plegado; solo la última de cada canal.
      function otras(plats, abierto) {
        var det = el('details', 'acc dl-more');
        det.appendChild(el('summary', null, 'Otros dispositivos'));
        if (abierto) det.open = true;
        plats.forEach(function (p) {
          var st = estable(p), be = prueba(p);
          if (st) det.appendChild(fila(st, url(st)));
          if (be) det.appendChild(fila(be, url(be, 'beta'), 'prueba' + (compilacion(be) ? ' ' + compilacion(be) : '')));
        });
        return det;
      }

      pintar();
    }).catch(function () { root.textContent = ''; var c = el('section', 'acc acc-dl'); c.appendChild(el('h2', null, 'No pudimos cargar la descarga')); c.appendChild(el('p', 'acc-note', 'Recargá la página.')); root.appendChild(c); });
  }

  function pedir() { return fetch('/api/downloads', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }); }
  window.NS_DESCARGAS = montar;
  window.NS_DESCARGAS.pedir = pedir;
})();
