(function(){
  var d=document,reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  var $=function(s){return d.querySelector(s)},$$=function(s){return [].slice.call(d.querySelectorAll(s))};

  /* carrusel de pantallas */
  var car=$('.car-t');
  if(car){
    var prev=$('.car-b[data-d="-1"]'),next=$('.car-b[data-d="1"]');
    var step=function(){var s=car.querySelector('.slide');return s?s.getBoundingClientRect().width+24:300};
    var sync=function(){prev.disabled=car.scrollLeft<8;next.disabled=car.scrollLeft+car.clientWidth>=car.scrollWidth-8};
    [prev,next].forEach(function(b){b.addEventListener('click',function(){car.scrollBy({left:step()*(+b.dataset.d),behavior:reduce?'auto':'smooth'})})});
    car.addEventListener('scroll',sync,{passive:true});addEventListener('resize',sync);sync();
    car.addEventListener('keydown',function(e){
      if(e.key==='ArrowRight'){e.preventDefault();next.click()}else if(e.key==='ArrowLeft'){e.preventDefault();prev.click()}
    });
  }

  if(reduce)return;

  /* el producto del hero arranca inclinado y se endereza al scrollear */
  var st=$('.stage');
  if(st){
    var tick=false,upd=function(){
      tick=false;var r=st.getBoundingClientRect(),vh=innerHeight;
      var p=Math.min(1,Math.max(0,(vh-r.top)/(vh*.75)));
      st.style.setProperty('--p',p.toFixed(3));
    };
    var req=function(){if(!tick){tick=true;requestAnimationFrame(upd)}};
    addEventListener('scroll',req,{passive:true});addEventListener('resize',req);upd();
  }

  /* titular de "quién está detrás": las palabras se encienden de a una */
  var h=$('.quien-h');
  if(h){
    var words=h.textContent.trim().split(/\s+/);
    h.setAttribute('aria-label',words.join(' '));
    h.innerHTML=words.map(function(w){return '<span class="w" aria-hidden="true">'+w+'</span>'}).join(' ');
    var ws=$$('.quien-h .w'),t2=false;
    var run=function(){
      t2=false;var r=h.getBoundingClientRect(),vh=innerHeight;
      var p=Math.min(1,Math.max(0,(vh*.85-r.top)/(vh*.5+r.height*.4)));
      var n=Math.round(p*ws.length);
      ws.forEach(function(w,i){w.classList.toggle('on',i<n)});
    };
    var rq=function(){if(!t2){t2=true;requestAnimationFrame(run)}};
    addEventListener('scroll',rq,{passive:true});addEventListener('resize',rq);run();
  }
})();
