(function () {
  var root = document.getElementById('admin');
  if (!root) return;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var money = function (n) { return '$ ' + Math.round(n || 0).toLocaleString('es-AR'); };
  var dt = function (s) { if (!s) return '—'; var d = new Date(s * 1000); return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }); };
  var ago = function (s) { var d = Math.floor((Date.now() / 1000 - s) / 86400); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días'; };
  var ST = { authorized: ['Activa', 'ok'], pending: ['Pendiente', 'wait'], paused: ['Pausada', 'wait'], cancelled: ['Cancelada', 'bad'], canceled: ['Cancelada', 'bad'] };
  var HDR = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
  var PLAN_NAMES = { pos: 'Sistema POS', 'pos-bot': 'Sistema + Bot', bot: 'Solo el bot' };
  var ACTIVE = { authorized: 1, paused: 1, pending: 1 };
  var target = null, bajaTarget = null;

  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: HDR, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  function load() {
    return fetch('/api/admin/overview', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) {
      if (r.status === 401) { location.replace('/ingresar/'); return null; }
      if (r.status === 403) { root.removeAttribute('aria-busy'); root.textContent = ''; root.appendChild(el('p', 'acc-note', 'Esta sección es solo para el administrador.')); return null; }
      if (r.status === 503) { root.removeAttribute('aria-busy'); root.textContent = ''; root.appendChild(el('p', 'acc-note', 'Falta conectar la base de datos (D1). Mirá el README.')); return null; }
      return r.json();
    });
  }
  function chip(text, cls) { return el('span', 'chip ' + cls, text); }
  // Cada celda lleva el título de su columna (data-l): en el celular la tabla se muestra como tarjetas.
  function labelCells(t) {
    var hs = [].map.call(t.querySelectorAll('thead th'), function (h) { return h.textContent; });
    [].forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
      [].forEach.call(tr.children, function (td, i) { if (hs[i]) td.setAttribute('data-l', hs[i]); });
    });
  }

  var first = true;
  function done() {
    root.removeAttribute('aria-busy');
    if (!first) return;
    first = false;
    root.classList.add('acc-in');
    setTimeout(function () { root.classList.remove('acc-in'); }, 800);
  }

  function render(d) {
    root.textContent = '';
    done();
    var k = d.kpis, cfg = d.config;

    var kp = el('div', 'kpis');
    [['Usuarios', k.users], ['Negocios', k.orgs == null ? '—' : k.orgs], ['Nuevos (7 días)', k.new7d], ['Activos (7 días)', k.active7d], ['Suscripciones activas', k.activeSubs], ['Ingreso mensual', money(k.mrr)], ['Registrados sin pagar', k.unpaid == null ? '—' : k.unpaid], ['En aviso de borrado', k.inNotice]].forEach(function (x) {
      var c = el('div', 'kpi'); c.appendChild(el('span', null, x[0])); c.appendChild(el('strong', null, String(x[1]))); kp.appendChild(c);
    });
    root.appendChild(kp);

    var sp = el('section', 'acc'); sp.appendChild(el('h2', null, 'Precio de fundador'));
    var on = !d.promo || d.promo.activa;
    sp.appendChild(el('p', 'acc-note', 'Controla si en la página de pago y en la home se ofrece el precio de fundador (30 % menos durante 6 meses). Al desactivarlo, la opción desaparece de inmediato para los clientes nuevos.'));
    var prow = el('div', 'prow'); prow.appendChild(chip(on ? 'Activa' : 'Desactivada', on ? 'ok' : 'bad')); prow.appendChild(document.createTextNode(' '));
    var pb = el('button', 'btn btn-w', on ? 'Desactivar el precio de fundador' : 'Activar el precio de fundador'); pb.type = 'button';
    pb.addEventListener('click', function () {
      pb.disabled = true;
      post('/api/admin/promo', { activa: !on }).then(function (x) {
        if (!x.ok) { pb.disabled = false; pb.textContent = 'No se pudo cambiar, probá de nuevo'; return; }
        refresh();
      });
    });
    prow.appendChild(pb); sp.appendChild(prow); root.appendChild(sp);

    var cf = el('div', 'acc-actions');
    cf.appendChild(chip('Mercado Pago: ' + (cfg.mp ? 'conectado' : 'sin conexión'), cfg.mp ? 'ok' : 'bad'));
    cf.appendChild(chip('Avisos por mail: ' + (cfg.notifier ? 'activos' : 'sin configurar'), cfg.notifier ? 'ok' : 'wait'));
    cf.appendChild(chip('Borrado automático: ' + (cfg.autoDelete ? 'ACTIVADO' : 'apagado (solo simula)'), cfg.autoDelete ? 'bad' : 'wait'));
    root.appendChild(cf);
    if (d.mpStale) cf.after(el('p', 'acc-note', 'Mercado Pago pidió esperar: los datos de suscripciones son de hace unos minutos.'));
    if (d.mpError && d.mpDetail) {
      var md = d.mpDetail, why = md.reason === 'no_token' ? 'Falta la variable MP_ACCESS_TOKEN en Cloudflare.' :
        (md.status === 401 ? 'Mercado Pago rechazó el token (401): revisá que sea el Access Token de producción, completo y sin espacios.' :
         md.status === 429 ? 'Mercado Pago pidió esperar (demasiadas consultas seguidas). Probá de nuevo en un minuto. Si se repite, usá un token exclusivo para el sitio (otra aplicación), distinto del que usa el POS.' :
         md.status === 403 ? 'Mercado Pago no autorizó la consulta (403): el token no tiene permiso para suscripciones.' :
         'Mercado Pago respondió con error' + (md.status ? ' ' + md.status : '') + (md.message ? ': ' + md.message : '') + '.');
      cf.after(el('p', 'login-err', why));
    }

    var s1 = el('section', 'acc'); s1.appendChild(el('h2', null, 'Clientes'));
    var wrap = el('div', 'tbl adm-tbl'); var t = el('table');
    var thead = el('thead'), hr = el('tr');
    ['Cliente', 'Alta', 'Último uso', 'Ingresos', 'Plan elegido', 'Suscripción', 'Estado', ''].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    d.users.forEach(function (u) {
      var tr = el('tr');
      var c1 = el('td'); c1.appendChild(el('strong', null, u.name || u.email)); c1.appendChild(document.createElement('br')); c1.appendChild(el('small', null, u.email)); tr.appendChild(c1);
      tr.appendChild(el('td', null, dt(u.createdAt)));
      tr.appendChild(el('td', null, ago(u.lastSeen)));
      tr.appendChild(el('td', null, String(u.logins)));
      var cp = el('td');
      if (u.plan) { cp.appendChild(document.createTextNode((PLAN_NAMES[u.plan] || u.plan) + (u.promo ? ' · fundador' : ''))); if (u.chosenAt) { cp.appendChild(document.createElement('br')); cp.appendChild(el('small', null, ago(u.chosenAt))); } }
      else cp.appendChild(el('small', null, '—'));
      tr.appendChild(cp);
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
      if (u.subscription && ACTIVE[u.subscription.status]) ca.appendChild(bajaBtn(u.subscription, u.email));
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
    if (!d.users.length) { var er = el('tr'); var ec = el('td', null, 'Todavía no hay clientes registrados.'); ec.colSpan = 8; er.appendChild(ec); tb.appendChild(er); }
    t.appendChild(tb); labelCells(t); wrap.appendChild(t); s1.appendChild(wrap); root.appendChild(s1);

    // Negocios (solo lectura): cada dueño administra el suyo desde /negocio/; acá solo se miran los números.
    var sn = el('section', 'acc'); sn.appendChild(el('h2', null, 'Negocios'));
    sn.appendChild(el('p', 'acc-note', 'Cada negocio es un cliente que paga una vez, con sus sucursales y su equipo. Esto es solo para mirar: el dueño administra el suyo desde Mi negocio.'));
    var nw = el('div', 'tbl adm-tbl'), nt = el('table'), nh = el('thead'), nr = el('tr');
    ['Negocio', 'Dueño', 'Suscripción', 'Equipo', 'Sucursales', 'PC', 'Último uso'].forEach(function (h) { nr.appendChild(el('th', null, h)); });
    nh.appendChild(nr); nt.appendChild(nh);
    var nb = el('tbody');
    (d.orgs || []).forEach(function (o) {
      var tr = el('tr'), c1 = el('td'); c1.appendChild(el('strong', null, o.name)); c1.appendChild(document.createElement('br')); c1.appendChild(el('small', null, 'desde ' + dt(o.createdAt))); tr.appendChild(c1);
      var c2 = el('td'); c2.appendChild(document.createTextNode(o.ownerEmail || '—'));
      if (o.billingEmail && o.billingEmail !== o.ownerEmail) { c2.appendChild(document.createElement('br')); c2.appendChild(el('small', null, 'cobra: ' + o.billingEmail)); }
      tr.appendChild(c2);
      var cs = el('td');
      if (o.subscription) { var st = ST[o.subscription.status] || [o.subscription.status, 'wait']; cs.appendChild(chip(st[0], st[1])); cs.appendChild(document.createTextNode(' ' + o.subscription.plan)); }
      else cs.appendChild(el('small', null, 'Sin suscripción'));
      tr.appendChild(cs);
      var ce = el('td'); ce.appendChild(document.createTextNode(String(o.members))); if (o.overSoftCap) { ce.appendChild(document.createTextNode(' ')); ce.appendChild(chip('Pasó el tope', 'wait')); } tr.appendChild(ce);
      tr.appendChild(el('td', null, String(o.branches))); tr.appendChild(el('td', null, String(o.devices))); tr.appendChild(el('td', null, o.lastSeen ? ago(o.lastSeen) : '—'));
      nb.appendChild(tr);
    });
    if (!(d.orgs || []).length) { var ne = el('tr'), nc = el('td', null, 'Todavía no hay negocios: se crean cuando un cliente vincula su primera PC.'); nc.colSpan = 7; ne.appendChild(nc); nb.appendChild(ne); }
    nt.appendChild(nb); labelCells(nt); nw.appendChild(nt); sn.appendChild(nw); root.appendChild(sn);

    if (d.subscribersWithoutAccount.length) {
      var s2 = el('section', 'acc'); s2.appendChild(el('h2', null, 'Suscriptores sin cuenta en el sitio'));
      s2.appendChild(el('p', 'acc-note', 'Pagaron en Mercado Pago pero todavía no ingresaron con Google (o usaron otro mail).'));
      var ul = el('ul', 'pays');
      d.subscribersWithoutAccount.forEach(function (x) { var li = el('li'); li.appendChild(el('span', null, x.email)); li.appendChild(el('span', null, x.plan + ' · ' + (x.status || ''))); li.appendChild(el('strong', null, money(x.amount))); if (ACTIVE[x.status]) li.appendChild(bajaBtn(x, x.email)); ul.appendChild(li); });
      s2.appendChild(ul); root.appendChild(s2);
    }

    versiones(root);

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

  // Versiones del sistema POS: estado, despliegue gradual, bloqueo y retiro (rollback). Se publican con scripts/publicar-release.mjs.
  var PLAT = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android' };
  function versiones(host) {
    var sec = el('section', 'acc'); sec.appendChild(el('h2', null, 'Versiones del sistema'));
    var body = el('div'); body.appendChild(el('div', 'sk sk-block')); sec.appendChild(body); host.appendChild(sec);
    fetch('/api/admin/releases', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      body.textContent = '';
      if (!d) { body.appendChild(el('p', 'acc-note', 'No se pudieron cargar las versiones.')); return; }
      if (!d.r2) body.appendChild(el('p', 'login-err', 'Falta el bucket de R2 «nodosur-releases» (ver README, «Descargas y actualizaciones»).'));
      if (!d.releases.length) { body.appendChild(el('p', 'acc-note', 'Todavía no se publicó ninguna versión. Publicá la primera con scripts/publicar-release.mjs (ver README).')); return; }
      var wrap = el('div', 'tbl adm-tbl'), t = el('table'), hr = el('tr');
      ['Versión', 'Canal', 'Plataforma', 'Peso', 'Estado', 'Liberada a', 'Descargas', ''].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      var th = el('thead'); th.appendChild(hr); t.appendChild(th);
      var tb = el('tbody');
      d.releases.forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('td', null, r.version));
        tr.appendChild(el('td', null, r.channel === 'beta' ? 'Beta' : 'Estable'));
        tr.appendChild(el('td', null, PLAT[r.platform] || r.platform));
        tr.appendChild(el('td', null, (r.size / 1048576).toFixed(1).replace('.', ',') + ' MB'));
        var ce = el('td');
        if (r.blocked) ce.appendChild(chip('Bloqueada', 'bad')); else if (!r.active) ce.appendChild(chip('Retirada', 'wait')); else ce.appendChild(chip('Publicada', 'ok'));
        if (r.mandatory) ce.appendChild(document.createTextNode(' Obligatoria'));
        tr.appendChild(ce);
        var cr = el('td'), inp = el('input'); inp.type = 'number'; inp.min = 0; inp.max = 100; inp.value = r.rollout; inp.style.width = '64px'; inp.setAttribute('aria-label', 'Porcentaje liberado');
        var sv = el('button', 'lnk', '% Guardar'); sv.type = 'button';
        sv.addEventListener('click', function () { post('/api/admin/releases', { action: 'rollout', id: r.id, rollout: parseInt(inp.value, 10) }).then(refresh); });
        cr.appendChild(inp); cr.appendChild(document.createTextNode(' ')); cr.appendChild(sv); tr.appendChild(cr);
        tr.appendChild(el('td', null, String(r.downloads)));
        var ca = el('td', 'acts');
        var act = function (label, action, cls) { var b = el('button', 'lnk' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', function () { post('/api/admin/releases', { action: action, id: r.id }).then(refresh); }); ca.appendChild(b); };
        if (r.blocked) act('Desbloquear', 'unblock'); else act('Bloquear', 'block', 'danger');
        if (r.active) act('Retirar', 'retire'); else act('Restaurar', 'restore');
        tr.appendChild(ca); tb.appendChild(tr);
      });
      t.appendChild(tb); labelCells(t); wrap.appendChild(t); body.appendChild(wrap);
      body.appendChild(el('p', 'acc-note', 'Retirar una versión es volver atrás: pasa a ser la vigente la anterior. Bloquear la deja de entregar por completo.'));
    }).catch(function () { body.textContent = ''; body.appendChild(el('p', 'acc-note', 'No se pudieron cargar las versiones.')); });
  }

  // Baja de una suscripción (corta los cobros en Mercado Pago). Pide confirmación.
  function bajaBtn(sub, who) {
    var b = el('button', 'lnk danger', 'Dar de baja'); b.type = 'button';
    b.addEventListener('click', function () {
      bajaTarget = sub;
      document.getElementById('baja-who').textContent = who;
      document.getElementById('baja-plan').textContent = sub.plan;
      document.getElementById('baja-err').textContent = '';
      var bd = document.getElementById('baja'); bd.showModal ? bd.showModal() : bd.setAttribute('open', '');
    });
    return b;
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
  var bd = document.getElementById('baja');
  document.getElementById('baja-no').addEventListener('click', function () { bd.close ? bd.close() : bd.removeAttribute('open'); });
  document.getElementById('baja-si').addEventListener('click', function () {
    if (!bajaTarget) return;
    var btn = this; btn.disabled = true; btn.textContent = 'Dando de baja…';
    post('/api/admin/subscription', { id: bajaTarget.id }).then(function (x) {
      btn.disabled = false; btn.textContent = 'Sí, dar de baja';
      if (!x.ok) { document.getElementById('baja-err').textContent = x.j && x.j.error === 'not_found' ? 'No encontramos esa suscripción.' : 'No se pudo dar de baja (Mercado Pago no respondió). Probá de nuevo.'; return; }
      bd.close ? bd.close() : bd.removeAttribute('open'); refresh();
    }).catch(function () { btn.disabled = false; btn.textContent = 'Sí, dar de baja'; document.getElementById('baja-err').textContent = 'Error de conexión. Probá de nuevo.'; });
  });
  refresh();
})();
