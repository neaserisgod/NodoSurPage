(function () {
  var root = document.getElementById('cuenta');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var money = function (n) { return '$ ' + Math.round(n).toLocaleString('es-AR'); };
  var date = function (s) { var d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }); };
  var STATUS = { authorized: ['Activa', 'ok'], paused: ['Pausada', 'wait'], cancelled: ['Cancelada', 'bad'], canceled: ['Cancelada', 'bad'], pending: ['Pendiente', 'wait'] };
  var PAY = { processed: 'Cobrado', scheduled: 'Programado', recycling: 'Reintentando', cancelled: 'Cancelado', canceled: 'Cancelado' };
  var ROL = { owner: 'Dueño', manager: 'Encargado', employee: 'Empleado' };
  var WA = 'https://wa.me/5492944796044?text=';
  var pending = null;

  function load() {
    return fetch('/api/me', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
      if (r.status === 401) { location.replace('/ingresar/'); return null; }
      return r.json();
    });
  }

  function card(title) { var c = el('section', 'acc'); c.appendChild(el('h2', null, title)); return c; }

  var first = true;
  function done() {
    root.removeAttribute('aria-busy');
    if (!first) return;
    first = false;
    root.classList.add('acc-in');
    setTimeout(function () { root.classList.remove('acc-in'); }, 800);
  }

  // Mi cuenta es la única página después de ingresar (2026-10-16): arriba lo que la persona vino a hacer (descargar, o elegir su
  // sistema si todavía no tiene), después su negocio y su suscripción, y al final, chico, quién está ingresado.
  var ERR = { no_subscription: 'Para descargar hace falta una suscripción activa.', mp_error: 'Mercado Pago no respondió: probá de nuevo en unos minutos.', no_disponible: 'Esa versión todavía no está publicada.' };
  function render(d) {
    root.textContent = '';
    done();
    var u = d.user;
    var e = new URLSearchParams(location.search).get('e');
    if (e && ERR[e]) { var eb0 = el('p', 'login-err', ERR[e]); eb0.setAttribute('role', 'alert'); root.appendChild(eb0); }
    if (d.notice) {
      var nb = el('div', 'login-err'); nb.setAttribute('role', 'alert');
      nb.textContent = 'Tu cuenta figura sin suscripción ni uso reciente y se eliminaría el ' + date(d.notice.deleteAfter * 1000) + '. Al haber ingresado hoy, el aviso se canceló.';
      root.appendChild(nb);
    }
    var activa = (d.subscriptions || []).some(function (x) { return x.status === 'authorized'; });
    // Quien solo es encargado o empleado no paga nada: la suscripción es del negocio, así que no se le muestra ni se le ofrece.
    var empleado = d.billing === false;
    var puede = d.isAdmin || d.exempt || activa || d.covered || (empleado && d.orgs.some(function (o) { return o.can && o.can.descargar; }));
    var ofrecer = !empleado && !d.mpError && !activa && !d.isAdmin && !d.exempt && !d.covered;

    if (puede) {
      var dl = el('div', 'acc-dl'); root.appendChild(dl);
      if (window.NS_DESCARGAS) window.NS_DESCARGAS(dl, { app: appDelPlan(d) });
    } else if (ofrecer) {
      root.appendChild(offerCard(d));
    }

    if (d.orgs && d.orgs.length) {
      var nc = card(d.orgs.length === 1 ? 'Tu negocio' : 'Tus negocios');
      var nl = el('ul', 'pays');
      d.orgs.forEach(function (o) {
        var li = el('li'); li.appendChild(el('span', null, o.name));
        li.appendChild(el('span', null, ROL[o.role] || o.role));
        var oa = el('a', 'lnk', 'Abrir'); oa.href = '/negocio/?org=' + encodeURIComponent(o.id); li.appendChild(oa); nl.appendChild(li);
      });
      nc.appendChild(nl);
      if (empleado) nc.appendChild(el('p', 'acc-note', 'Tu acceso lo da el negocio: la suscripción la maneja el dueño.'));
      root.appendChild(nc);
    }

    if (!empleado) {
      // Propuestas de transferencia de propiedad que le mandaron: se avisan arriba de todo porque es lo primero que ve al entrar.
      if (d.orgs && d.orgs.length) {
        fetch('/api/org/transfer', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
          if (!j || !j.incoming || !j.incoming.length) return;
          var tc = card('Te quieren transferir un negocio');
          j.incoming.forEach(function (i) { tc.appendChild(el('p', 'acc-note', (i.fromName || i.fromEmail) + ' quiere transferirte «' + i.orgName + '». Podés aceptar o rechazar desde Mi negocio.')); var ta = el('a', 'btn', 'Ver la propuesta'); ta.href = '/negocio/?org=' + encodeURIComponent(i.orgId); ta.style.alignSelf = 'flex-start'; tc.appendChild(ta); });
          root.insertBefore(tc, root.firstChild);
        }).catch(function () { /* es solo un aviso */ });
      }
      // La suscripción: solo si hay algo que mostrar. Administración y eximidas no pagan (lo dice la tarjeta de la cuenta).
      if (d.mpError) {
        var se = card('Tu suscripción'); se.appendChild(el('p', 'acc-note', 'No pudimos consultar Mercado Pago en este momento. Probá de nuevo en unos minutos.')); root.appendChild(se);
      } else if (d.subscriptions && d.subscriptions.length) {
        var s = card(d.subscriptions.length > 1 ? 'Tus suscripciones' : 'Tu suscripción');
        d.subscriptions.forEach(function (sub) { s.appendChild(subCard(sub)); });
        root.appendChild(s);
      } else if (d.covered) {
        var sc = card('Tu suscripción'); sc.appendChild(el('p', 'acc-note', 'Tu negocio está cubierto por la suscripción de otra persona. Revisá la facturación en Mi negocio.')); root.appendChild(sc);
      }
    }

    // Quién está ingresado, al final y compacto.
    var p = el('section', 'acc acc-me');
    var row = el('div', 'acc-user');
    row.appendChild(el('span', 'avatar', (u.name || u.email).trim().charAt(0).toUpperCase()));
    var who = el('div', 'acc-who');
    who.appendChild(el('strong', null, u.name));
    who.appendChild(el('span', null, u.email));
    if (d.isAdmin || d.exempt) who.appendChild(el('small', null, d.isAdmin ? 'Administración · sin vencimiento' : 'Cuenta sin vencimiento'));
    row.appendChild(who);
    p.appendChild(row);
    var acts = el('div', 'acc-actions');
    if (d.isAdmin) { var ad = el('a', 'btn btn-w', 'Panel de administración'); ad.href = '/admin/'; acts.appendChild(ad); }
    var out = el('form', 'acc-out'); out.method = 'post'; out.action = '/api/auth/logout';
    var ob = el('button', 'btn btn-w', 'Cerrar sesión'); ob.type = 'submit'; out.appendChild(ob); acts.appendChild(out);
    p.appendChild(acts);
    root.appendChild(p);
  }

  // Qué app le toca por su plan: Emprendedor = Nodo Sur Servicios; Sistema POS o Sistema + Bot = la de almacén. Con los dos, o
  // sin plan propio (administración, eximidas, encargados, "Solo el bot"), null: elige con el selector de la descarga.
  function appDelPlan(d) {
    if (d.isAdmin || d.exempt || d.billing === false) return null;
    var planes = (d.subscriptions || []).filter(function (x) { return x.status === 'authorized'; }).map(function (x) { return x.plan; });
    if (!planes.length && d.intent) planes = [{ emprendedor: 'Emprendedor', pos: 'Sistema POS', 'pos-bot': 'Sistema + Bot' }[d.intent.plan]];
    var serv = planes.indexOf('Emprendedor') >= 0, alm = planes.indexOf('Sistema POS') >= 0 || planes.indexOf('Sistema + Bot') >= 0;
    return serv === alm ? null : serv ? 'servicios' : 'almacen';
  }
  // Sin suscripción: si ya eligió un plan, solo ese, con un botón para seguir (y "Cambiar de plan"); si no, los planes.
  function offerCard(d) {
    var P = window.NS_PLANES || {};
    var chosen = d.intent && P[d.intent.plan] ? d.intent.plan : null;
    var c = card(chosen ? 'Seguí con tu prueba gratis' : 'Elegí tu sistema');
    c.classList.add('acc-offer');
    c.appendChild(el('p', 'acc-note', chosen
      ? 'Elegiste ' + P[chosen].nombre + ' (' + money(P[chosen].precio) + ' por mes). Los primeros 7 días no pagás nada y cancelás cuando quieras.'
      : 'Probalo 7 días sin costo; después seguís por Mercado Pago y cancelás cuando quieras.'));
    if (chosen) {
      var acts = el('div', 'acc-actions');
      var go = el('a', 'btn', 'Empezar la prueba en Mercado Pago'); go.href = '/api/checkout?plan=' + chosen; acts.appendChild(go);
      var ch = el('a', 'btn btn-w', 'Cambiar de plan'); ch.href = '/pagar/?plan=' + chosen; acts.appendChild(ch);
      c.appendChild(acts);
    } else {
      var grid = el('div', 'offer');
      Object.keys(P).forEach(function (k) {
        var p = P[k];
        var it = el('div', 'offer-i');
        it.appendChild(el('strong', null, p.nombre));
        var pr = el('span', 'of-p');
        pr.appendChild(document.createTextNode(money(p.precio)));
        pr.appendChild(document.createTextNode(' /mes'));
        it.appendChild(pr);
        it.appendChild(el('small', null, p.desc));
        var a = el('a', 'btn btn-w', 'Probar 7 días gratis');
        a.href = '/api/checkout?plan=' + k;
        it.appendChild(a);
        grid.appendChild(it);
      });
      c.appendChild(grid);
    }
    var nota = el('p', 'acc-note', 'En Mercado Pago usá el mismo mail (' + d.user.email + '). ¿Ya pagaste con otro? ');
    var wa = el('a', null, 'Escribime y lo vinculo'); wa.rel = 'noopener'; wa.href = WA + encodeURIComponent('Hola, ingresé con ' + d.user.email + ' y no veo mi suscripción'); nota.appendChild(wa);
    c.appendChild(nota);
    return c;
  }


  function subCard(sub) {
    var st = STATUS[sub.status] || [sub.status || 'Desconocido', 'wait'];
    var c = el('article', 'subc');
    var head = el('div', 'subc-h');
    head.appendChild(el('h3', null, sub.plan));
    head.appendChild(el('span', 'chip ' + st[1], st[0]));
    c.appendChild(head);
    var per = sub.frequencyType === 'months' ? (sub.frequency > 1 ? 'cada ' + sub.frequency + ' meses' : 'por mes') : '';
    if (sub.amount != null) c.appendChild(el('p', 'subc-price', money(sub.amount) + ' ' + per));
    var dl = el('dl', 'subc-dl');
    function kv(k, v) { if (!v) return; dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    kv('Suscripta el', sub.since && date(sub.since));
    if (sub.status === 'authorized') kv('Próximo cobro', sub.nextPayment && date(sub.nextPayment));
    c.appendChild(dl);
    if (sub.payments && sub.payments.length) {
      c.appendChild(el('h4', null, 'Últimos cobros'));
      var ul = el('ul', 'pays');
      sub.payments.forEach(function (p) {
        var li = el('li');
        li.appendChild(el('span', null, date(p.date)));
        li.appendChild(el('span', null, PAY[p.status] || p.status));
        li.appendChild(el('strong', null, p.amount != null ? money(p.amount) : ''));
        ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    if (sub.status === 'authorized' || sub.status === 'paused' || sub.status === 'pending') {
      var b = el('button', 'btn-danger', 'Cancelar suscripción'); b.type = 'button';
      b.addEventListener('click', function () { openDialog(sub); });
      c.appendChild(b);
    }
    return c;
  }

  var dlg = document.getElementById('cancelar');
  function openDialog(sub) {
    pending = sub;
    document.getElementById('cancelar-plan').textContent = sub.plan;
    document.getElementById('cancelar-err').textContent = '';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  document.getElementById('cancelar-no').addEventListener('click', function () { dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
  document.getElementById('cancelar-si').addEventListener('click', function () {
    if (!pending) return;
    var btn = this; btn.disabled = true; btn.textContent = 'Cancelando…';
    fetch('/api/subscription/cancel', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ id: pending.id })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        btn.disabled = false; btn.textContent = 'Sí, cancelar';
        if (!r.ok) { document.getElementById('cancelar-err').textContent = 'No pudimos cancelarla. Probá de nuevo o escribime por WhatsApp.'; return; }
        dlg.close ? dlg.close() : dlg.removeAttribute('open');
        return load().then(function (d) { if (d) render(d); });
      }).catch(function () { btn.disabled = false; btn.textContent = 'Sí, cancelar'; document.getElementById('cancelar-err').textContent = 'Error de conexión. Probá de nuevo.'; });
  });

  load().then(function (d) { if (d) render(d); }).catch(function () {
    root.removeAttribute('aria-busy'); root.textContent = ''; root.appendChild(el('p', 'acc-note', 'No pudimos cargar tu cuenta. Recargá la página.'));
  });
})();
