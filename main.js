(function(){
  var d=document,root=d.documentElement;
  var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  var fmt=function(n){return '$ '+Math.round(n).toLocaleString('es-AR')};
  var num=function(t){return parseInt(t.replace(/[^\d]/g,''),10)||0};
  var $=function(s,c){return (c||d).querySelector(s)},$$=function(s,c){return [].slice.call((c||d).querySelectorAll(s))};

  /* header lifts once you scroll */
  var hdr=$('header.px');
  if(hdr){var on=function(){hdr.classList.toggle('lifted',scrollY>8)};addEventListener('scroll',on,{passive:true});on()}

  /* signed-in hint: swap "Ingresar" for the customer's account link (cookie is display-only, not auth) */
  var hm=document.cookie.match(/(?:^|; )ns_hint=([^;]*)/);
  if(hm){
    var nm='';try{nm=decodeURIComponent(hm[1])}catch(e){}
    var lg=$('.nav .login');
    if(lg&&nm){lg.href='/cuenta/';lg.textContent=nm.charAt(0).toUpperCase()+nm.slice(1);lg.classList.add('in');lg.title='Mi cuenta'}
    var ml=$('.mp-login');if(ml){ml.href='/cuenta/';ml.textContent='Mi cuenta'}
  }

  /* recorrido por pantallas: pestañas accesibles (funciona también con movimiento reducido) */
  var tl=$('.tabs[role=tablist]');
  if(tl){
    root.classList.add('t-on');
    var tabs=$$('[role=tab]',tl),panels=tabs.map(function(t){return d.getElementById(t.getAttribute('aria-controls'))});
    var pick=function(i,focus){
      tabs.forEach(function(t,k){var on=k===i;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;panels[k].hidden=!on});
      if(focus)tabs[i].focus();
    };
    tabs.forEach(function(t,i){
      t.addEventListener('click',function(){pick(i)});
      t.addEventListener('keydown',function(e){
        var n=null;
        if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;
        else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;
        if(n!==null){e.preventDefault();pick(n,true)}
      });
    });
    pick(0);
  }

  if(reduce||!('IntersectionObserver' in window))return;
  root.classList.add('js');

  /* scroll reveal with stagger inside grids */
  var sel='.head,.prod,.feat,.chips,.chat,.fl li,.ck li,.tog,.q,.step,.plan,.found,.cta-b,.rel a,.prose>*,.ph>*,.tbl';
  var els=$$(sel);
  els.forEach(function(e){
    e.classList.add('rv');
    var p=e.parentElement,i=[].indexOf.call(p.children,e);
    e.style.setProperty('--d',Math.min(i,5)*70+'ms');
  });
  var io=new IntersectionObserver(function(es){es.forEach(function(x){
    if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:.12,rootMargin:'0px 0px -6% 0px'});
  /* bloques más altos que la pantalla: nunca llegan al 12 % visible, así que aparecen apenas entran */
  var ioTall=new IntersectionObserver(function(es){es.forEach(function(x){
    if(x.isIntersecting){x.target.classList.add('in');ioTall.unobserve(x.target)}})},{threshold:0,rootMargin:'0px 0px -6% 0px'});
  els.forEach(function(e){(e.offsetHeight>innerHeight*.8?ioTall:io).observe(e)});

  /* hero: numbers count up, then the day keeps selling */
  var today=$('.today .big');
  if(today){
    var efEl=$('.mix .cash strong'),mpEl=$('.mix .mp strong'),totEl=$('.sep .tot strong');
    var rows=$$('.sep .row:not(.tot) strong');
    var ef=num(efEl.textContent),mp=num(mpEl.textContent),rv=rows.map(function(r){return num(r.textContent)});
    var lastTick=0;
    var paint=function(){
      today.textContent=fmt(ef+mp);efEl.textContent=fmt(ef);mpEl.textContent=fmt(mp);
      rows.forEach(function(r,i){r.textContent=fmt(rv[i])});
      totEl.textContent=fmt(rv.reduce(function(a,b){return a+b},0));
    };
    var flash=function(el){el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop')};
    var start={ef:ef,mp:mp,rv:rv.slice()},T=1100,t0;
    ef=mp=0;rv=rv.map(function(){return 0});paint();
    var step=function(t){
      t0=t0||t;var k=Math.min((t-t0)/T,1),e=1-Math.pow(1-k,3);
      ef=start.ef*e;mp=start.mp*e;rv=start.rv.map(function(v){return v*e});paint();
      if(k<1)requestAnimationFrame(step);else{ef=start.ef;mp=start.mp;rv=start.rv;paint();live()}
    };
    var vis=false,ho=new IntersectionObserver(function(es){vis=es[0].isIntersecting;
      if(vis&&!t0){requestAnimationFrame(step)}},{threshold:.3});
    ho.observe($('.dash'));
    var live=function(){
      var n=0;
      var tick=function(){
        if(vis&&!d.hidden&&n<60){
          var sale=Math.round((1500+Math.random()*7500)/100)*100;
          var cash=Math.random()<.45;
          if(cash){ef+=sale;flash(efEl)}else{mp+=sale;flash(mpEl)}
          var i=Math.floor(Math.random()*rv.length);rv[i]+=Math.round(sale*.7/100)*100;
          paint();flash(today);flash(rows[i]);flash(totEl);n++;
        }
        setTimeout(tick,2600+Math.random()*2200);
      };
      setTimeout(tick,2200);
    };
  }

  /* bars fill when seen */
  $$('.bar i b').forEach(function(b){
    var w=b.style.width;b.style.width='0';
    new IntersectionObserver(function(es,o){if(es[0].isIntersecting){requestAnimationFrame(function(){b.style.width=w});o.disconnect()}},{threshold:.6}).observe(b);
  });

  /* chat plays itself once */
  var chat=$('.chat');
  if(chat){
    var msgs=$$('.m,.alert',chat);msgs.forEach(function(m){m.classList.add('hid')});
    var typing=d.createElement('div');typing.className='typing';typing.setAttribute('aria-hidden','true');typing.innerHTML='<i></i><i></i><i></i>';
    new IntersectionObserver(function(es,o){if(!es[0].isIntersecting)return;o.disconnect();
      var i=0;(function next(){
        if(i>=msgs.length){typing.remove();return}
        var m=msgs[i],out=m.classList.contains('out')||m.classList.contains('alert');
        typing.className='typing '+(out?'r':'l');m.before(typing);
        setTimeout(function(){typing.remove();m.classList.remove('hid');i++;setTimeout(next,650)},out?1100:700);
      })();
    },{threshold:.5}).observe(chat);
  }
  /* botón fijo de WhatsApp en celulares (solo en las páginas comerciales) */
  (function(){
    var path=location.pathname.replace(/\/+$/,'')||'/';
    var skip=['/pagar','/ingresar','/cuenta','/admin','/privacidad'];
    if(skip.indexOf(path)>-1||!matchMedia('(max-width:719px)').matches)return;
    var a=d.createElement('a');a.className='sticky-cta';
    a.href='https://wa.me/5492944796044?text='+encodeURIComponent('Hola, quiero probar el sistema');
    a.rel='noopener';a.textContent='Probalo 7 días gratis · WhatsApp';
    d.body.appendChild(a);d.body.classList.add('has-sticky');
    var on=false,t=$('#contacto');
    function upd(){
      var y=scrollY>520,near=false;
      if(t){var r=t.getBoundingClientRect();near=r.top<innerHeight&&r.bottom>0}
      var want=y&&!near;
      if(want!==on){on=want;a.classList.toggle('on',on)}
    }
    addEventListener('scroll',upd,{passive:true});upd();
  })();
  /* precio de fundador: si el administrador lo desactivó, se oculta el bloque */
  (function(){
    var fs=$$('.found,.js-promo');if(!fs.length)return;
    fetch('/api/promo',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
      if(j&&j.activa===false)fs.forEach(function(f){f.hidden=true});
    }).catch(function(){});
  })();

  /* compartir: botón nativo del celular (si existe) y copiar el link */
  (function(){
    var box=$('.share');if(!box)return;
    var live=$('[role=status]',box),nat=$('.sh-native',box),cp=$('.sh-copy',box);
    var say=function(t){if(live)live.textContent=t};
    if(nat&&navigator.share){nat.hidden=false;nat.addEventListener('click',function(){
      navigator.share({title:nat.dataset.title,url:nat.dataset.url}).catch(function(){});
    })}
    if(cp)cp.addEventListener('click',function(){
      var u=cp.dataset.url,old=cp.textContent;
      var ok=function(){cp.textContent='¡Link copiado!';say('Link copiado');setTimeout(function(){cp.textContent=old},2000)};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(ok).catch(function(){prompt('Copiá el link:',u)})}
      else prompt('Copiá el link:',u);
    });
  })();
})();
