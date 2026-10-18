/* Pasos de pago: plan → resumen con el precio. */
(function(){
  'use strict';
  var PLANES=window.NS_PLANES;if(!PLANES)return;
  var d=document,$=function(i){return d.getElementById(i)};
  var fmt=function(n){return '$ '+n.toLocaleString('es-AR')};
  var radios=[].slice.call(d.querySelectorAll('input[name=plan]'));
  if(!radios.length)return;
  var q=new URLSearchParams(location.search);

  var hint=(d.cookie.match(/(?:^|; )ns_hint=([^;]*)/)||[])[1],logged=Boolean(hint),nombre='';
  try{nombre=decodeURIComponent(hint||'')}catch(e){}
  var saved=(d.cookie.match(/(?:^|; )ns_plan=([^;]*)/)||[])[1];

  function render(){
    var k=(radios.filter(function(r){return r.checked})[0]||{}).value||'emprendedor',p=PLANES[k];
    $('r-plan').textContent=p.nombre;
    $('r-price').textContent=fmt(p.precio);
    $('r-alta-row').hidden=!p.alta;
    /* Los pagos pasan siempre por /api/checkout: si no ingresó, lo manda a Google y recuerda el plan. */
    var alta=$('alta');alta.hidden=!p.alta;alta.href='/api/checkout?item=alta&plan='+k;alta.textContent='Pagar el alta de $ 70.000';
    var b=$('pagar');
    b.href='/api/checkout?plan='+k;
    b.textContent=p.wa?(logged?'Pedir la prueba por WhatsApp':'Ingresar con Google y pedir la prueba'):(logged?'Empezar la prueba en Mercado Pago':'Ingresar con Google para empezar');
    var ac=$('pg-acct');
    if(ac)ac.textContent=logged
      ?'Ingresaste como '+nombre+'. En Mercado Pago usá el mismo mail de tu cuenta de Google para ver tu suscripción en Mi cuenta.'
      :p.wa?'Ingresás con Google y se abre WhatsApp con el pedido escrito: la prueba se activa desde ahí.'
      :(p.alta?'Antes de pagar ingresás con Google, así tu suscripción queda asociada a tu cuenta. Tu plan queda elegido.'
        /* Sin alta, después de Google se sigue derecho a Mercado Pago: el aviso del mail tiene que verse antes. */
        :'Ingresás con Google y seguís directo a Mercado Pago. Usá el mismo mail en los dos, así ves tu suscripción y la descarga en Mi cuenta.');
    [].forEach.call(d.querySelectorAll('.pg-opt'),function(l){l.classList.toggle('sel',l.querySelector('input').checked)});
  }

  radios.forEach(function(r){r.addEventListener('change',render)});
  var pre=q.get('plan')||saved;if(pre&&PLANES[pre]){radios.forEach(function(r){r.checked=r.value===pre})}
  render();
})();
