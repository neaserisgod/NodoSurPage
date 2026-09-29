(function(){
  var d=document,root=d.documentElement;
  var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  var fmt=function(n){return '$ '+Math.round(n).toLocaleString('es-AR')};
  var num=function(t){return parseInt(t.replace(/[^\d]/g,''),10)||0};
  var $=function(s,c){return (c||d).querySelector(s)},$$=function(s,c){return [].slice.call((c||d).querySelectorAll(s))};

  /* header lifts once you scroll */
  var hdr=$('header.px');
  if(hdr){var on=function(){hdr.classList.toggle('lifted',scrollY>8)};addEventListener('scroll',on,{passive:true});on()}

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
  els.forEach(function(e){io.observe(e)});

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
})();
