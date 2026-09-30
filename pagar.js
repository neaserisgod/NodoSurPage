/* Pasos de pago: plan → precio de fundador → resumen con el precio final. */
(function(){
  'use strict';
  /* La promo se activa o desactiva desde el panel de administración (/api/promo). */
  var MESES=6;
  var PLANES=window.NS_PLANES;if(!PLANES)return;
  var d=document,$=function(i){return d.getElementById(i)};
  var promo=$('promo');if(!promo)return;
  var fmt=function(n){return '$ '+n.toLocaleString('es-AR')};
  var radios=[].slice.call(d.querySelectorAll('input[name=plan]'));
  var q=new URLSearchParams(location.search);

  var activa=true;
  var hint=(d.cookie.match(/(?:^|; )ns_hint=([^;]*)/)||[])[1],logged=Boolean(hint),nombre='';
  try{nombre=decodeURIComponent(hint||'')}catch(e){}
  var saved=(d.cookie.match(/(?:^|; )ns_plan=([^;]*)/)||[])[1];

  function render(){
    var k=(radios.filter(function(r){return r.checked})[0]||{}).value||'pos',p=PLANES[k],on=promo.checked&&activa;
    $('r-plan').textContent=p.nombre;
    var old=$('r-old');
    if(on){
      old.hidden=false;old.textContent=fmt(p.precio);
      $('r-price').textContent=fmt(p.promo);
      var n=$('r-note');n.hidden=false;
      n.textContent='Precio de fundador: '+fmt(p.promo)+' por mes durante '+MESES+' meses. Antes de que termine te aviso y pasás al plan normal de '+fmt(p.precio)+' por mes.';
    }else{
      old.hidden=true;$('r-price').textContent=fmt(p.precio);$('r-note').hidden=true;
    }
    $('r-alta-row').hidden=!p.alta;
    /* Los pagos pasan siempre por /api/checkout: si no ingresó, lo manda a Google y recuerda el plan. */
    var alta=$('alta');alta.hidden=!p.alta;alta.href='/api/checkout?item=alta&plan='+k;alta.textContent='Pagar el alta de $ 70.000';
    var b=$('pagar');
    b.href='/api/checkout?plan='+k+(on?'&promo=1':'');
    b.textContent=!logged?'Ingresar con Google para continuar':on?'Pedir mi precio de fundador por WhatsApp':'Pagar con Mercado Pago';
    var ac=$('pg-acct');
    if(ac)ac.textContent=logged
      ?'Ingresaste como '+nombre+'. En Mercado Pago usá el mismo mail de tu cuenta de Google para ver tu suscripción en Mi cuenta.'
      :'Antes de pagar ingresás con Google, así tu suscripción queda asociada a tu cuenta. Tu plan queda elegido.';
    [].forEach.call(d.querySelectorAll('.pg-opt'),function(l){l.classList.toggle('sel',l.querySelector('input').checked)});
    d.querySelector('.pg-promo').classList.toggle('sel',promo.checked);
  }

  radios.forEach(function(r){r.addEventListener('change',render)});
  promo.addEventListener('change',render);
  var pre=q.get('plan')||saved;if(pre&&PLANES[pre]){radios.forEach(function(r){r.checked=r.value===pre})}
  if(q.get('promo')==='1')promo.checked=true;
  render();
  fetch('/api/promo',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
    if(!j||j.activa!==false)return;
    activa=false;promo.checked=false;promo.disabled=true;
    $('cupos').textContent='Por ahora el precio de fundador no está disponible.';
    render();
  }).catch(function(){});
})();
