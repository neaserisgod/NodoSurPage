/* Nodo Sur: comportamiento compartido del sitio nuevo. Todo con textContent / createElement (nada de innerHTML). */
(function(){
  var d=document;
  var $=function(s,c){return (c||d).querySelector(s)},$$=function(s,c){return [].slice.call((c||d).querySelectorAll(s))};
  var galleta=function(n){var m=d.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));if(!m)return '';try{return decodeURIComponent(m[1])}catch(e){return ''}};
  var pesos=function(n){return '$ '+Math.round(n).toLocaleString('es-AR')};
  var el=function(tag,cls,txt){var e=d.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e};

  /* quien ya ingresó: "Ingresar" pasa a su nombre y lleva a Mi cuenta (la galleta es solo para mostrar, no autentica) */
  var nombre=galleta('ns_hint');
  if(nombre){
    $$('a.ingresar').forEach(function(a){a.href='/cuenta/';a.textContent=nombre.charAt(0).toUpperCase()+nombre.slice(1);a.title='Mi cuenta'});
  }

  /* aviso "elegí tu sistema": ingresó y todavía no tiene suscripción (galletas de solo lectura que pone /api/me) */
  (function(){
    var hd=$('.hd');
    if(!hd||!nombre||galleta('ns_sub')!=='0')return;
    if(/^\/(pagar|cuenta|ingresar|admin|negocio|unirse|vincular|descargar)(\/|$)/.test(location.pathname))return;
    try{if(sessionStorage.getItem('ns_offer_x'))return}catch(e){}
    var plan=galleta('ns_plan');
    var caja=el('div','aviso'),w=el('div','wrap');caja.setAttribute('role','region');caja.setAttribute('aria-label','Elegí tu sistema');
    w.appendChild(el('span','','Hola '+nombre+', '+(plan?'tu plan quedó elegido.':'elegí tu sistema y probalo 7 días sin costo.')));
    var a=el('a','',plan?'Seguir con el pago':'Elegir mi plan');a.href='/pagar/'+(/^[a-z-]+$/.test(plan)?'?plan='+plan:'');w.appendChild(a);
    var x=el('button','','×');x.type='button';x.setAttribute('aria-label','Cerrar aviso');
    x.addEventListener('click',function(){caja.remove();try{sessionStorage.setItem('ns_offer_x','1')}catch(e){}});
    w.appendChild(x);caja.appendChild(w);hd.insertAdjacentElement('afterend',caja);
  })();

  /* barra fija del celular: se esconde mientras se ve otro botón de probar (el del hero, el del cierre) */
  (function(){
    var barra=$('.barra'),tapan=$$('[data-sin-barra]');
    if(!barra||!tapan.length||!('IntersectionObserver' in window))return;
    var vistos=new Set();
    var io=new IntersectionObserver(function(es){
      es.forEach(function(x){if(x.isIntersecting)vistos.add(x.target);else vistos.delete(x.target)});
      barra.classList.toggle('fuera',vistos.size>0);
    },{threshold:.15});
    tapan.forEach(function(t){io.observe(t)});
  })();

  /* chat de ejemplo: la visitante elige horario, paga la seña y ve el turno confirmado */
  (function(){
    var caja=$('[data-chat]');if(!caja)return;
    var log=$('.chat',caja),fases=$$('[data-fase]',caja),base=log.children.length,hora='';
    var decir=function(quien,txt){log.appendChild(el('div','burbuja '+quien,txt))};
    var ir=function(n){fases.forEach(function(f){f.hidden=f.getAttribute('data-fase')!==String(n)})};
    $$('[data-hora]',caja).forEach(function(b){b.addEventListener('click',function(){
      hora=b.getAttribute('data-hora');
      decir('ella','A las '+hora);
      decir('bot','Te reservo el jueves a las '+hora+'. La seña es de $ 5.400 por Mercado Pago (el link vence en 30 minutos).');
      ir(1);
    })});
    $$('[data-pagar]',caja).forEach(function(b){b.addEventListener('click',function(){
      decir('bot','Seña recibida. Turno confirmado: jueves '+hora+'. Te mando el comprobante.');
      ir(2);
    })});
    $$('[data-reiniciar]',caja).forEach(function(b){b.addEventListener('click',function(){
      while(log.children.length>base)log.removeChild(log.lastChild);
      ir(0);var p=$('[data-hora]',caja);if(p)p.focus();
    })});
    ir(0);
  })();

  /* calculadora: precio del servicio × turnos perdidos, y cuántos turnos pagan el plan */
  (function(){
    var caja=$('[data-calc]');if(!caja)return;
    var plan=+caja.getAttribute('data-plan')||18000;
    var v={precio:+caja.getAttribute('data-precio')||20000,turnos:+caja.getAttribute('data-turnos')||3};
    var lim={precio:[4000,80000,2000],turnos:[1,40,1]};
    var pintar=function(){
      $('[data-ver=precio]',caja).textContent=pesos(v.precio);
      $('[data-ver=turnos]',caja).textContent=String(v.turnos);
      $('[data-ver=perdida]',caja).textContent=pesos(v.precio*v.turnos);
      var n=Math.ceil(plan/v.precio);
      $('[data-ver=veredicto]',caja).textContent='Con recuperar '+n+(n===1?' turno':' turnos')+' por mes, Nodo Sur se paga solo.';
    };
    $$('[data-paso]',caja).forEach(function(b){b.addEventListener('click',function(){
      var p=b.getAttribute('data-paso').split(':'),k=p[0],l=lim[k];
      v[k]=Math.min(l[1],Math.max(l[0],v[k]+(+p[1])*l[2]));pintar();
    })});
    pintar();
  })();
})();
