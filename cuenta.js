(function () {
  var root = document.getElementById('cuenta');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var money = function (n) { return '$ ' + Math.round(n).toLocaleString('es-AR'); };
  var date = function (s) { var d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }); };
  var STATUS = { authorized: ['Activa', 'ok'], paused: ['Pausada', 'wait'], cancelled: ['Cancelada', 'bad'], canceled: ['Cancelada', 'bad'], pending: ['Pendiente', 'wait'] };
  var PAY = { processed: 'Cobrado', scheduled: 'Programado', recycling: 'Reintentando', cancelled: 'Cancelado', canceled: 'Cancelado' };
  var WA = 'https://wa.me/5492944796044?text=';
  var pending = null;

  function load() {
    return fetch('/api/me', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
      if (r.status === 401) { location.replace('/ingresar/'); return null; }
      return r.json();
    });
  }

  function card(title) { var c = el('section', 'acc'); c.appendChild(el('h2', null, title)); return c; }

  function render(d) {
    root.textContent = '';
    var u = d.user;
    var p = card('Tu cuenta');
    var row = el('div', 'acc-user');
    row.appendChild(el('span', 'avatar', (u.name || u.email).trim().charAt(0).toUpperCase()));
    var who = el('div', 'acc-who');
    who.appendChild(el('strong', null, u.name));
    who.appendChild(el('span', null, u.email));
    if (u.since) who.appendChild(el('small', null, 'Sesión iniciada el ' + date(u.since * 1000)));
    row.appendChild(who);
    p.appendChild(row);
    var out = el('form', 'acc-out'); out.method = 'post'; out.action = '/api/auth/logout';
    var ob = el('button', 'btn btn-w', 'Cerrar sesión'); ob.type = 'submit'; out.appendChild(ob);
    p.appendChild(out);
    if (d.isAdmin) { var ad = el('a', 'btn', 'Ir al panel de administración'); ad.href = '/admin/'; ad.style.alignSelf = 'flex-start'; p.appendChild(ad); }
    root.appendChild(p);

    if (d.notice) {
      var nb = el('div', 'login-err'); nb.setAttribute('role', 'alert');
      nb.textContent = 'Tu cuenta figura sin suscripción ni uso reciente y se eliminaría el ' + date(d.notice.deleteAfter * 1000) + '. Al haber ingresado hoy, el aviso se canceló.';
      root.appendChild(nb);
    }

    var s = card('Tu suscripción');
    if (!d.mpConfigured) {
      s.appendChild(el('p', 'acc-note', 'Muy pronto vas a ver acá el estado de tu suscripción.'));
    } else if (d.mpError) {
      s.appendChild(el('p', 'acc-note', 'No pudimos consultar Mercado Pago en este momento. Probá de nuevo en unos minutos.'));
    } else if (!d.subscriptions || !d.subscriptions.length) {
      s.appendChild(el('p', 'acc-note', 'No encontramos una suscripción asociada a ' + u.email + '.'));
      s.appendChild(el('p', 'acc-note', 'Si pagaste con otro mail de Mercado Pago, escribime y la vinculamos a mano. Si todavía no te suscribiste, podés hacerlo desde la página de pago.'));
      var acts = el('div', 'acc-actions');
      var a1 = el('a', 'btn', 'Ir a pagar'); a1.href = '/pagar/'; acts.appendChild(a1);
      var a2 = el('a', 'btn btn-w', 'Escribime por WhatsApp'); a2.rel = 'noopener'; a2.href = WA + encodeURIComponent('Hola, ingresé con ' + u.email + ' y no veo mi suscripción'); acts.appendChild(a2);
      s.appendChild(acts);
    } else {
      d.subscriptions.forEach(function (sub) { s.appendChild(subCard(sub)); });
    }
    root.appendChild(s);
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
    root.textContent = ''; root.appendChild(el('p', 'acc-note', 'No pudimos cargar tu cuenta. Recargá la página.'));
  });
})();
