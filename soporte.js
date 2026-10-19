/* Nodo Sur: la burbuja de ayuda de la página (El dueño, 2026-10-17: soporte técnico que busque conversión; guión + IA; en todas
   las páginas; el objetivo es que pruebe el plan que le sirve). Lo común lo contesta el GUIÓN de acá (gratis, al instante); lo que
   no, va a /api/soporte (la IA, con lo que dice el sitio). Si la IA no está o no contesta, ofrece WhatsApp.
   Todo con textContent / createElement (nada de innerHTML). La charla vive en sessionStorage: sigue al cambiar de página y se
   borra al cerrar la pestaña. */
(function(){
  var d=document,W='https://wa.me/5492944796044',CLAVE='ns_soporte';
  if(/^\/(pagar|cuenta|ingresar|admin|negocio|unirse|vincular|descargar)(\/|$)/.test(location.pathname))return;
  var el=function(tag,cls,txt){var e=d.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e};
  var pesos=function(n){return '$ '+Math.round(n).toLocaleString('es-AR')};
  var norm=function(t){return String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[¿?¡!.,]/g,' ').replace(/\s+/g,' ').trim()};

  /* qué plan le sirve según la página donde está */
  var ruta=location.pathname;
  /* la home es la puerta de las tres ediciones: ahí no se asume ninguna. Tampoco en /bot-whatsapp/: el bot viene en Estudio y Gastro (2026-10-19) */
  var PLAN=/^\/(servicios|app-de-turnos-para-[a-z]+)\/?/.test(ruta)?'emprendedor'
    :/^\/gastro/.test(ruta)?'gastro'
    :/^\/(sistema-|como-|diferencias-)/.test(ruta)?'pos':null;
  var PLANES={ /* respaldo si /planes.js no cargó: los mismos datos */
    emprendedor:{nombre:'Nodo Estudio',precio:18000,alta:false},gastro:{nombre:'Nodo Gastro',precio:18000,alta:false},pos:{nombre:'Nodo Gestión',precio:35000,alta:false}
  };
  var plan=function(k){return (window.NS_PLANES&&window.NS_PLANES[k])||PLANES[k]};
  var cargarPlanes=function(){if(window.NS_PLANES||d.querySelector('script[src^="/planes.js"]'))return;var s=el('script');s.src='/planes.js';s.async=true;d.head.appendChild(s)};

  /* ---------- guión ---------- */
  var probar=function(k){return {txt:'Probar '+plan(k).nombre+' 7 días gratis',href:'/pagar/?plan='+k}};
  var demo={txt:'Ver la demo (sin cuenta)',href:'/demo/'};
  var whatsapp={txt:'Seguir por WhatsApp',href:W};
  var precioDe=function(k){var p=plan(k);return p.nombre+': '+pesos(p.precio)+' por mes'+(p.alta?' + alta '+pesos(70000)+' (la instalación del bot la hacemos nosotros)':', sin costo de alta')+'.'};
  var GUION=[
    {si:/\b(hola|buenas|buen dia|buenas tardes|buenas noches|que tal)\b/,no:/\b(precio|cuanto|sale|cuesta)\b/,r:function(){return {t:'¡Hola! Contame qué tenés (un salón, una barbería, una rotisería, un kiosco, un almacén…) y qué querés resolver, y te digo cómo te ayuda Nodo Sur.',ch:['¿Cuánto sale?','¿Cómo lo pruebo?','¿Anda en iPhone?']}}},
    {siempre:true,si:/\b(precio|precios|cuanto (sale|cuesta|vale)|cuesta|planes|abono|mensual|tarifa)\b/,r:function(){
      var t=PLAN?precioDe(PLAN)+' Se prueba 7 días gratis y hoy no se paga nada.':['Una app, tres ediciones:',precioDe('emprendedor')+' (uñas, peluquería, barbería, estética), con el bot incluido',precioDe('gastro')+' (rotisería y comida para llevar), con el bot incluido',precioDe('pos')+' (kiosco, almacén, comercio), con el bot incluido','Todas se prueban 7 días gratis.'].join('\n');
      return {t:t,ac:[probar(PLAN||'emprendedor')],ch:PLAN?['¿Qué incluye?','¿Cómo lo pruebo?']:['Tengo un salón o barbería','Tengo una rotisería','Tengo un kiosco o almacén']};
    }},
    {si:/\b(prueba|probar|pruebo|gratis|empezar|arrancar|contratar|suscrib|me anoto|lo quiero)\b/,r:function(){
      var k=PLAN||'emprendedor';
      return {t:'Se prueba 7 días gratis: entrás con tu cuenta de Google, elegís el plan y lo activás por Mercado Pago (hoy no se paga nada). Al terminar te aparece el botón para descargar la app en Mi cuenta.',ac:[probar(k)].concat(k==='emprendedor'?[demo]:[])};
    }},
    {si:/\b(iphone|ios|apple|mac|computadora|compu|notebook|windows|pc|android|celular|descarg|instal)\b/,r:function(){
      if(PLAN==='gastro')return {t:'Nodo Gastro anda en la compu con Windows del local o en un celular Android, y el bot de WhatsApp se vincula al número del negocio. Si querés te ayudamos a dejarlo andando.',ac:[probar('gastro')],ch:['¿Cuánto sale?']};
      if(PLAN==='pos')return {t:'Nodo Gestión se instala en la PC con Windows (la caja) y tiene app para el celular Android. La instalación la hacés vos con el botón de descarga de Mi cuenta, y si querés te ayudamos a distancia.',ac:[probar('pos')],ch:['¿Cuánto sale?']};
      return {t:'Nodo Estudio anda en Android, iPhone y compu: en Android se instala la app y en iPhone, Windows o Mac se usa desde el navegador en horsepos.com/app/, con los mismos datos. Solo el bot de WhatsApp necesita un celular Android prendido.',ac:[probar('emprendedor'),demo]};
    }},
    {si:/\b(bot|whatsapp|wpp|wsp|mensajes automaticos|responde solo)\b/,no:/\b(hablar|persona|humano)\b/,r:function(){
      return {t:'El bot de WhatsApp contesta solo: da turnos, pasa precios y toma pedidos, a toda hora. Necesita un celular Android prendido con el número del negocio. Viene incluido en todos los planes, sin alta.',ac:[probar(PLAN==='pos'?'pos':PLAN==='gastro'?'gastro':'emprendedor')],ch:['¿Cuánto sale?']};
    }},
    {si:/\b(sena|senas|mercado pago|mercadopago|qr|cobrar|cobro|tarjeta|point|debito|credito)\b/,r:function(){
      if(PLAN==='gastro')return {t:'El cliente paga como elijas: link de Mercado Pago antes de cocinar, alias o al recibir.',ac:[probar('gastro')]};
      return {t:PLAN==='pos'?'Cobrás con efectivo, QR de Mercado Pago y débito o crédito con la Point, y todo entra solo al cierre de caja.':'Las señas se cobran por Mercado Pago: el bot le manda el link a la clienta y el turno se confirma solo cuando paga. También cobrás con QR en la pantalla del celular.',ac:[probar(PLAN||'emprendedor')]};
    }},
    {siempre:true,si:/\b(factura|facturar|afip|arca|monotributo)\b/,r:function(){return {t:'La factura electrónica está en desarrollo: todavía no se puede facturar desde Nodo Sur.',ch:['¿Qué incluye?']}}},
    {siempre:true,si:/\b(hablar con|una persona|humano|asesor|llamar|telefono)\b/,r:function(){return {t:'Dale, seguí por WhatsApp y te responde una persona.',ac:[whatsapp]}}},
    {siempre:true,si:/\b(emprend\w*|en (mi )?casa|a domicilio|domicilio|independiente|por mi cuenta|trabajo sola?|soy sola?|solo yo|sola yo|particular)\b/,r:function(){
      return {t:'¡Sí! Nodo Estudio está pensado justo para eso: si das turnos desde tu casa o a domicilio, te ordena la agenda, cobra las señas por Mercado Pago y el bot de WhatsApp da los turnos solo. No hace falta local ni computadora: anda en el celular (Android o iPhone). Plan Emprendedor, '+pesos(plan('emprendedor').precio)+' por mes, sin alta.',ac:[probar('emprendedor'),demo],ch:['¿Cómo lo pruebo?','¿Anda en iPhone?']};
    }},
    {si:/\b(me sirve|sirve para|sirve si|le sirve|para mi negocio|para que sirve)\b/,r:function(){
      var k=PLAN||'emprendedor';
      return k==='gastro'?{t:'Si tenés una rotisería o un local de comida para llevar, sí: Nodo Gastro toma los pedidos por WhatsApp con tu carta, pregunta envío o retiro y los cobra. Contame qué vendés y te digo cómo te ayuda.',ac:[probar('gastro')]}
        :k==='pos'?{t:'Si tenés un kiosco, almacén o comercio, sí: Nodo Gestión te ordena la caja, el stock y la ganancia. Contame qué vendés y te digo cómo te ayuda.',ac:[probar('pos')]}
        :{t:'Si das turnos (uñas, peluquería, barbería, estética, masajes…), sí: tenés agenda, señas por Mercado Pago y el bot de WhatsApp que da los turnos solo. Contame a qué te dedicás y te digo cómo te ayuda.',ac:[probar('emprendedor'),demo]};
    }},
    {si:/\b(salon|unas|peluqueria|barberia|barbero|estetica|turnos|agenda)\b/,r:function(){return {t:'Para tu rubro está Nodo Estudio ('+pesos(plan('emprendedor').precio)+' por mes, sin alta): agenda, señas por Mercado Pago, cobro con QR y el bot de WhatsApp que da los turnos solo.',ac:[probar('emprendedor'),demo]}}},
    {si:/\b(rotiseria|rotiserias|comida|comidas|pedidos|delivery|viandas|pizzeria|empanadas|gastronomia|restaurante)\b/,r:function(){return {t:'Para tu local está Nodo Gastro ('+pesos(plan('gastro').precio)+' por mes, con el bot incluido y sin alta): el bot toma los pedidos con tu carta, pregunta envío o retiro y cobra por Mercado Pago.',ac:[probar('gastro')]}}},
    {si:/\b(kiosco|almacen|comercio|negocio|despensa|fiambreria|caja|stock)\b/,r:function(){return {t:'Para tu negocio está Nodo Gestión ('+pesos(plan('pos').precio)+' por mes, sin alta): ventas, cierre de caja, stock, proveedores y ganancia, con app para el celular.',ac:[probar('pos')],ch:['¿Anda en mi PC?','¿Cuánto sale?']}}}
  ];
  /* El guión solo toma lo corto y directo ("¿cuánto sale?", "tengo una barbería"); una pregunta de uso ("¿cómo veo los turnos de
     mañana?") o larga va a la IA, que la puede contestar de verdad. Precio, persona y factura van siempre por el guión. Si la IA no
     está, se usa el guión igual antes que mandar a WhatsApp. */
  var deGuion=function(t,cualquiera){
    var n=norm(t),corta=n.split(' ').length<=7&&!/\b(como|donde|cuando|porque|por que|se puede|puedo)\b/.test(n.replace(/^como lo pruebo$/,''));
    for(var i=0;i<GUION.length;i++){var g=GUION[i];if((corta||g.siempre||cualquiera)&&g.si.test(n)&&!(g.no&&g.no.test(n)))return g.r()}
    return null;
  };
  var EXPLICAR={'¿Qué incluye?':'¿Qué incluye el plan?','¿Anda en mi PC?':'¿En qué computadora anda?'};

  /* ---------- estado ---------- */
  var st={abierto:false,msgs:[]};
  try{var g=JSON.parse(sessionStorage.getItem(CLAVE)||'null');if(g&&Array.isArray(g.msgs))st=g}catch(e){}
  var guardar=function(){try{sessionStorage.setItem(CLAVE,JSON.stringify({abierto:st.abierto,msgs:st.msgs.slice(-30)}))}catch(e){}};

  /* ---------- interfaz ---------- */
  var raiz=el('div','sop'),boton=el('button','sop-bt'),panel=el('section','sop-pn'),log=el('div','sop-log'),form=el('form','sop-in'),campo=el('input'),enviar=el('button','sop-env','Enviar');
  boton.type='button';boton.setAttribute('aria-label','Ayuda: escribinos tu duda');boton.setAttribute('aria-expanded','false');
  boton.appendChild(el('span','sop-ic','?'));boton.appendChild(el('span','sop-tx','¿Dudas?'));
  panel.setAttribute('aria-label','Ayuda de Nodo Sur');panel.hidden=true;
  var hd=el('div','sop-hd'),av=el('span','sop-av','N'),tt=el('div'),cerrar=el('button','sop-x','×');
  tt.appendChild(el('b','','Nodo Sur'));tt.appendChild(el('span','','Te ayudamos a elegir y a usarlo'));
  cerrar.type='button';cerrar.setAttribute('aria-label','Cerrar ayuda');
  hd.appendChild(av);hd.appendChild(tt);hd.appendChild(cerrar);
  log.setAttribute('aria-live','polite');
  campo.type='text';campo.maxLength=600;campo.placeholder='Escribí tu duda…';campo.setAttribute('aria-label','Tu duda');campo.autocomplete='off';
  enviar.type='submit';form.appendChild(campo);form.appendChild(enviar);
  panel.appendChild(hd);panel.appendChild(log);panel.appendChild(form);panel.appendChild(el('p','sop-nota','No compartas contraseñas ni datos de tarjetas.'));
  raiz.appendChild(panel);raiz.appendChild(boton);

  var pintarMsg=function(m){
    var b=el('div','sop-m '+(m.rol==='yo'?'yo':'nos'));
    String(m.texto).split('\n').forEach(function(l,i){if(i)b.appendChild(el('br'));b.appendChild(d.createTextNode(l))});
    log.appendChild(b);
    if(m.ac&&m.ac.length){var f=el('div','sop-ac');m.ac.forEach(function(a){var x=el('a','btn '+(a.href===W||a.href==='/demo/'?'btn-p':'btn-a'),a.txt);x.href=a.href;if(a.href===W){x.target='_blank';x.rel='noopener'}f.appendChild(x)});log.appendChild(f)}
    if(m.ch&&m.ch.length){var c=el('div','sop-ch');m.ch.forEach(function(t){var x=el('button','',t);x.type='button';x.addEventListener('click',function(){preguntar(EXPLICAR[t]||t)});c.appendChild(x)});log.appendChild(c)}
    log.scrollTop=log.scrollHeight;
  };
  var pintar=function(){while(log.firstChild)log.removeChild(log.firstChild);st.msgs.forEach(pintarMsg)};
  var sumar=function(m){
    $$ch().forEach(function(c){c.remove()}); /* las sugerencias viejas se van: no se tocan dos veces */
    st.msgs.push(m);guardar();pintarMsg(m);
  };
  var $$ch=function(){return [].slice.call(log.querySelectorAll('.sop-ch'))};
  var bienvenida=function(){
    var t={emprendedor:'¡Hola! ¿Tenés un salón, una barbería o un espacio de estética? Preguntame lo que quieras de Nodo Estudio.',gastro:'¡Hola! ¿Tenés una rotisería o un local de comida para llevar? Preguntame lo que quieras de Nodo Gastro.',pos:'¡Hola! ¿Tenés un kiosco, almacén o comercio? Preguntame lo que quieras de Nodo Gestión.'}[PLAN]||'¡Hola! Preguntame lo que quieras de Nodo Sur: precios, cómo se usa, cómo probarlo.';
    sumar({rol:'nos',texto:t,ch:['¿Cuánto sale?','¿Cómo lo pruebo?',PLAN==='pos'?'¿Anda en mi PC?':'¿Anda en iPhone?']});
  };

  var esperando=false;
  var preguntar=function(texto){
    texto=String(texto||'').trim().slice(0,600);if(!texto||esperando)return;
    sumar({rol:'yo',texto:texto});
    var r=deGuion(texto);
    if(r){sumar({rol:'nos',texto:r.t,ac:r.ac,ch:r.ch});return}
    esperando=true;enviar.disabled=true;
    var pensando=el('div','sop-m nos sop-pens','Escribiendo…');log.appendChild(pensando);log.scrollTop=log.scrollHeight;
    var charla=st.msgs.filter(function(m){return m.rol==='yo'||m.rol==='nos'}).slice(-12).map(function(m){return {rol:m.rol==='yo'?'yo':'asistente',texto:String(m.texto).slice(0,600)}});
    fetch('/api/soporte',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'fetch'},body:JSON.stringify({mensajes:charla,pagina:location.pathname})})
      .then(function(x){return x.ok?x.json():null})
      .catch(function(){return null})
      .then(function(j){
        pensando.remove();esperando=false;enviar.disabled=false;
        if(!j||typeof j.texto!=='string'){var g=deGuion(texto,true);if(g){sumar({rol:'nos',texto:g.t,ac:(g.ac||[]).concat([whatsapp]),ch:g.ch});return}sumar({rol:'nos',texto:'Eso prefiero que te lo conteste una persona, así no te digo algo que no es. Escribinos por WhatsApp y te respondemos.',ac:[whatsapp]});return}
        var ac=[];if(j.plan&&plan(j.plan))ac.push(probar(j.plan));if(j.persona)ac.push(whatsapp);
        sumar({rol:'nos',texto:j.texto,ac:ac});
      });
  };

  var abrir=function(si){
    st.abierto=si;guardar();panel.hidden=!si;boton.setAttribute('aria-expanded',si?'true':'false');raiz.classList.toggle('abierto',si);
    if(si){cargarPlanes();if(!st.msgs.length)bienvenida();else pintar();setTimeout(function(){campo.focus()},50)}else boton.focus();
  };
  boton.addEventListener('click',function(){abrir(panel.hidden)});
  cerrar.addEventListener('click',function(){abrir(false)});
  d.addEventListener('keydown',function(e){if(e.key==='Escape'&&!panel.hidden)abrir(false)});
  form.addEventListener('submit',function(e){e.preventDefault();var t=campo.value;campo.value='';preguntar(t)});

  var montar=function(){d.body.appendChild(raiz);if(st.abierto)abrir(true)};
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',montar);else montar();
})();
