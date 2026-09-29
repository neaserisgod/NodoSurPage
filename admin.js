(function () {
  var root = document.getElementById('admin');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var money = function (n) { return '$ ' + Math.round(n || 0).toLocaleString('es-AR'); };
  var dt = function (s) { if (!s) return '—'; var d = new Date(s * 1000); return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }); };
  var ago = function (s) { var d = Math.floor((Date.now() / 1000 - s) / 86400); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días'; };
  var ST = { authorized: ['Activa', 'ok'], pending: ['Pendiente', 'wait'], paused: ['Pausada', 'wait'], cancelled: ['Cancelada', 'bad'], canceled: ['Cancelada', 'bad'] };
  var HDR = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
  var target = null;

  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: HDR, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  function load() {
    return fetch('/api/admin/overview', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
      if (r.status === 401) { location.replace('/ingresar/'); return null; }
      if (r.status === 403) { root.textContent = ''; root.appendChild(el('p', 'acc-note', 'Esta sección es solo para el administrador.')); return null; }
      if (r.status === 503) { root.textContent = ''; root.appendChild(el('p', 'acc-note', 'Falta conectar la base de datos (D1). Mirá el README.')); return null; }
      return r.json();
    });
  }
  function chip(text, cls) { return el('span', 'chip ' + cls, text); }

  function render(d) {
    root.textContent = '';
    var k = d.kpis, cfg = d.config;

    var kp = el('div', 'kpis');
    [['Usuarios', k.users], ['Nuevos (7 días)', k.new7d], ['Activos (7 días)', k.active7d], ['Suscripciones activas', k.activeSubs], ['Ingreso mensual', money(k.mrr)], ['En aviso de borrado', k.inNotice]].forEach(function (x) {
      var c = el('div', 'kpi'); c.appendChild(el('span', null, x[0])); c.appendChild(el('strong', null, String(x[1]))); kp.appendChild(c);
    });
    root.appendChild(kp);

    var cf = el('div', 'acc-actions');
    cf.appendChild(chip('Mercado Pago: ' + (cfg.mp ? 'conectado' : 'sin conexión'), cfg.mp ? 'ok' : 'bad'));
    cf.appendChild(chip('Avisos por mail: ' + (cfg.notifier ? 'activos' : 'sin configurar'), cfg.notifier ? 'ok' : 'wait'));
    cf.appendChild(chip('Borrado automático: ' + (cfg.autoDelete ? 'ACTIVADO' : 'apagado (solo simula)'), cfg.autoDelete ? 'bad' : 'wait'));
    root.appendChild(cf);
    if (d.mpError && d.mpDetail) {
      var md = d.mpDetail, why = md.reason === 'no_token' ? 'Falta la variable MP_ACCESS_TOKEN en Cloudflare.' :
        (md.status === 401 ? 'Mercado Pago rechazó el token (401): revisá que sea el Access Token de producción, completo y sin espacios.' :
         md.status === 403 ? 'Mercado Pago no autorizó la consulta (403): el token no tiene permiso para suscripciones.' :
         'Mercado Pago respondió con error' + (md.status ? ' ' + md.status : '') + (md.message ? ': ' + md.message : '') + '.');
      cf.after(el('p', 'login-err', why));
    }

    var s1 = el('section', 'acc'); s1.appendChild(el('h2', null, 'Clientes'));
    var wrap = el('div', 'tbl'); var t = el('table');
    var thead = el('thead'), hr = el('tr');
    ['Cliente', 'Alta', 'Último uso', 'Ingresos', 'Suscripción', 'Estado', ''].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    d.users.forEach(function (u) {
      var tr = el('tr');
      var c1 = el('td'); c1.appendChild(el('strong', null, u.name || u.email)); c1.appendChild(document.createElement('br')); c1.appendChild(el('small', null, u.email)); tr.appendChild(c1);
      tr.appendChild(el('td', null, dt(u.createdAt)));
      tr.appendChild(el('td', null, ago(u.lastSeen)));
      tr.appendChild(el('td', null, String(u.logins)));
      var cs = el('td');
      if (u.subscription) { var st = ST[u.subscription.status] || [u.subscription.status, 'wait']; cs.appendChild(chip(st[0], st[1])); cs.appendChild(document.createTextNode(' ' + u.subscription.plan)); }
      else cs.appendChild(el('small', null, 'Sin suscripción'));
      tr.appendChild(cs);
      var ce = el('td');
      if (u.isAdmin) ce.appendChild(chip('Administrador', 'ok'));
      else if (u.exempt) ce.appendChild(chip('Eximido', 'ok'));
      else if (u.deleteAfter) ce.appendChild(chip('Se borra el ' + dt(u.deleteAfter), 'bad'));
      tr.appendChild(ce);
      var ca = el('td', 'acts');
      if (!u.isAdmin) {
        var b1 = el('button', 'lnk', u.exempt ? 'Quitar exención' : 'Eximir'); b1.type = 'button';
        b1.addEventListener('click', function () { post('/api/admin/user', { id: u.id, action: u.exempt ? 'unexempt' : 'exempt' }).then(refresh); });
        ca.appendChild(b1);
        if (u.deleteAfter) { var b2 = el('button', 'lnk', 'Quitar aviso'); b2.type = 'button'; b2.addEventListener('click', function () { post('/api/admin/user', { id: u.id, action: 'clear_notice' }).then(refresh); }); ca.appendChild(b2); }
        var b3 = el('button', 'lnk danger', 'Eliminar'); b3.type = 'button';
        b3.addEventListener('click', function () { target = u; document.getElementById('del-who').textContent = u.email; document.getElementById('del-err').textContent = ''; var dlg = document.getElementById('borrar'); dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', ''); });
        ca.appendChild(b3);
      }
      tr.appendChild(ca); tb.appendChild(tr);
    });
    if (!d.users.length) { var er = el('tr'); var ec = el('td', null, 'Todavía no hay clientes registrados.'); ec.colSpan = 7; er.appendChild(ec); tb.appendChild(er); }
    t.appendChild(tb); wrap.appendChild(t); s1.appendChild(wrap); root.appendChild(s1);

    if (d.subscribersWithoutAccount.length) {
      var s2 = el('section', 'acc'); s2.appendChild(el('h2', null, 'Suscriptores sin cuenta en el sitio'));
      s2.appendChild(el('p', 'acc-note', 'Pagaron en Mercado Pago pero todavía no ingresaron con Google (o usaron otro mail).'));
      var ul = el('ul', 'pays');
      d.subscribersWithoutAccount.forEach(function (x) { var li = el('li'); li.appendChild(el('span', null, x.email)); li.appendChild(el('span', null, x.plan + ' · ' + (x.status || ''))); li.appendChild(el('strong', null, money(x.amount))); ul.appendChild(li); });
      s2.appendChild(ul); root.appendChild(s2);
    }

    var s3 = el('section', 'acc'); s3.appendChild(el('h2', null, 'Limpieza automática'));
    var r = d.rules;
    s3.appendChild(el('p', 'acc-note', 'Se avisa y, a los ' + r.noticeDays + ' días, se elimina la cuenta que no tenga suscripción vigente, lleve ' + r.inactiveDays + ' días sin uso y tenga más de ' + r.graceDays + ' días de antigüedad. Nunca se elimina al administrador ni a los eximidos. Si el aviso no se pudo enviar, no se elimina.'));
    var sb = el('button', 'btn btn-w', 'Simular limpieza ahora'); sb.type = 'button'; s3.appendChild(sb);
    var out = el('div', 'sim'); s3.appendChild(out);
    sb.addEventListener('click', function () {
      sb.disabled = true; out.textContent = 'Simulando…';
      post('/api/admin/sweep', {}).then(function (x) {
        sb.disabled = false; out.textContent = '';
        if (!x.ok || !x.j.ok) { out.appendChild(el('p', 'login-err', 'No se pudo simular (¿Mercado Pago sin conexión?).')); return; }
        if (!x.j.actions.length) { out.appendChild(el('p', 'acc-note', 'Nada para hacer: ninguna cuenta cumple las reglas.')); return; }
        var L = { send_notice: 'Se le enviaría el aviso', needs_notice: 'Cumple las reglas pero NO hay servicio de mail: no se le puede avisar (no se borra)', waiting: 'Avisada, esperando los 3 días', delete: 'Se eliminaría', clear_notice: 'Se le quitaría el aviso (volvió a estar al día)' };
        var u2 = el('ul', 'pays');
        x.j.actions.forEach(function (a) { var li = el('li'); li.appendChild(el('span', null, a.email)); li.appendChild(el('span', null, L[a.action] || a.action)); li.appendChild(el('strong', null, '')); u2.appendChild(li); });
        out.appendChild(u2);
      });
    });
    root.appendChild(s3);
  }

  function refresh() { return load().then(function (d) { if (d) render(d); }); }

  var dlg = document.getElementById('borrar');
  document.getElementById('del-no').addEventListener('click', function () { dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
  document.getElementById('del-si').addEventListener('click', function () {
    if (!target) return;
    post('/api/admin/user', { id: target.id, action: 'delete' }).then(function (x) {
      if (!x.ok) { document.getElementById('del-err').textContent = 'No se pudo eliminar.'; return; }
      dlg.close ? dlg.close() : dlg.removeAttribute('open'); refresh();
    });
  });
  refresh();
})();
