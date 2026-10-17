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

  /* chat de ejemplo: cada botón dice lo que escribe la clienta (data-dice), lo que contesta el bot (data-responde, varios
     mensajes separados por |) y a qué paso sigue (data-ir). data-elegido se recuerda y reemplaza {elegido} en lo que sigue. */
  (function(){
    var caja=$('[data-chat]');if(!caja)return;
    var log=$('.chat',caja),fases=$$('[data-fase]',caja),base=log.children.length,elegido='';
    var decir=function(quien,txt){if(txt)log.appendChild(el('div','burbuja '+quien,txt.replace(/\{elegido\}/g,elegido)))};
    var ir=function(n){fases.forEach(function(f){f.hidden=f.getAttribute('data-fase')!==String(n)})};
    $$('[data-responde]',caja).forEach(function(b){b.addEventListener('click',function(){
      if(b.hasAttribute('data-elegido'))elegido=b.getAttribute('data-elegido');
      decir('ella',b.getAttribute('data-dice'));
      b.getAttribute('data-responde').split('|').forEach(function(t){decir(t.indexOf('!aviso ')===0?'noti':'bot',t.replace(/^!aviso /,''))});
      ir(b.getAttribute('data-ir'));
    })});
    $$('[data-reiniciar]',caja).forEach(function(b){b.addEventListener('click',function(){
      while(log.children.length>base)log.removeChild(log.lastChild);
      elegido='';ir(0);var p=$('[data-fase="0"] button',caja);if(p)p.focus();
    })});
    ir(0);
  })();

  /* navegadores sin reglas de precarga (Firefox): al apuntar o tocar un link del sitio, se baja la página antes del click */
  (function(){
    if(window.HTMLScriptElement&&HTMLScriptElement.supports&&HTMLScriptElement.supports('speculationrules'))return;
    var vistos={};
    var pedir=function(e){
      var a=e.target.closest&&e.target.closest('a[href^="/"]');
      if(!a||a.target||/^\/(api|app|demo|admin)(\/|$)/.test(a.getAttribute('href')))return;
      var u=a.href.split('#')[0];
      if(vistos[u]||u===location.href.split('#')[0])return;
      vistos[u]=1;var l=d.createElement('link');l.rel='prefetch';l.href=u;d.head.appendChild(l);
    };
    d.addEventListener('pointerover',pedir,{passive:true});
    d.addEventListener('touchstart',pedir,{passive:true});
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
      var u=caja.getAttribute('data-unidad')||'turno';
      $('[data-ver=veredicto]',caja).textContent='Con recuperar '+n+' '+u+(n===1?'':'s')+' por mes, Nodo Sur se paga solo.';
    };
    $$('[data-paso]',caja).forEach(function(b){b.addEventListener('click',function(){
      var p=b.getAttribute('data-paso').split(':'),k=p[0],l=lim[k];
      v[k]=Math.min(l[1],Math.max(l[0],v[k]+(+p[1])*l[2]));pintar();
    })});
    pintar();
  })();
})();
