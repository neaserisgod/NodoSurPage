/* Pasos de pago: plan → precio de fundador → resumen con el precio final. */
(function(){
  'use strict';
  /* Para pausar la promo poné CUPOS en 0; para cambiar los lugares, el número. */
  var CUPOS=5,MESES=6,ALTA='https://mpago.la/2UnGAqA';
  var WA='https://wa.me/5492944796044?text=';
  /* promoHref: link de la suscripción con el precio de fundador (vacío = se pide por WhatsApp). */
  var PLANES={
    'pos':{nombre:'Sistema POS',precio:35000,promo:24500,alta:false,
      href:'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=6fe282d944ef4c018cb7904ce9e122f8',promoHref:''},
    'pos-bot':{nombre:'Sistema + Bot',precio:60000,promo:42000,alta:true,
      href:'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=7652202c076c4cc180c72ade28d52924',promoHref:''},
    'bot':{nombre:'Solo el bot',precio:35000,promo:24500,alta:true,
      href:'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=e37aac4650334685873aa8e3920de4c0',promoHref:''}
  };
  var d=document,$=function(i){return d.getElementById(i)};
  var promo=$('promo');if(!promo)return;
  var fmt=function(n){return '$ '+n.toLocaleString('es-AR')};
  var radios=[].slice.call(d.querySelectorAll('input[name=plan]'));
  var q=new URLSearchParams(location.search);

  if(CUPOS<=0){promo.disabled=true;promo.checked=false;$('cupos').textContent='Los lugares de fundador ya se completaron.'}
  else $('cupos').textContent='Quedan '+CUPOS+' lugares.';

  function render(){
    var k=(radios.filter(function(r){return r.checked})[0]||{}).value||'pos',p=PLANES[k],on=promo.checked&&CUPOS>0;
    $('r-plan').textContent=p.nombre;
    var old=$('r-old');
    if(on){
      old.hidden=false;old.textContent=fmt(p.precio);
      $('r-price').textContent=fmt(p.promo);
      var n=$('r-note');n.hidden=false;
      n.textContent='Precio de fundador: '+fmt(p.promo)+' por mes durante '+MESES+' meses. Después, '+fmt(p.precio)+' por mes.';
    }else{
      old.hidden=true;$('r-price').textContent=fmt(p.precio);$('r-note').hidden=true;
    }
    $('r-alta-row').hidden=!p.alta;
    var alta=$('alta');alta.hidden=!p.alta;alta.href=ALTA;
    var b=$('pagar');
    if(on&&!p.promoHref){
      b.href=WA+encodeURIComponent('Hola, quiero el precio de fundador con el plan '+p.nombre+' ('+fmt(p.promo)+' por mes durante '+MESES+' meses).');
      b.textContent='Pedir mi precio de fundador por WhatsApp';
    }else{
      b.href=on?p.promoHref:p.href;b.textContent='Pagar con Mercado Pago';
    }
    [].forEach.call(d.querySelectorAll('.pg-opt'),function(l){l.classList.toggle('sel',l.querySelector('input').checked)});
    d.querySelector('.pg-promo').classList.toggle('sel',promo.checked);
  }

  radios.forEach(function(r){r.addEventListener('change',render)});
  promo.addEventListener('change',render);
  var pre=q.get('plan');if(pre&&PLANES[pre]){radios.forEach(function(r){r.checked=r.value===pre})}
  if(q.get('promo')==='1'&&CUPOS>0)promo.checked=true;
  render();
})();
