(function(){
  var d=document,reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  var $=function(s){return d.querySelector(s)},$$=function(s){return [].slice.call(d.querySelectorAll(s))};
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

  /* brillo que sigue al cursor en las tarjetas */
  $$('.feat').forEach(function(c){
    c.addEventListener('pointermove',function(e){
      var r=c.getBoundingClientRect();
      c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px');
    });
  });

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
