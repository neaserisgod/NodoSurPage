/* partículas compartidas (index y páginas internas) */
(function(){
  var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  /* campo de partículas: puntos y rayitas que giran despacio alrededor de un centro */
  var PAL={
    hero:['#4f7cff','#8a5cf6','#d36bb5','#9aa3b5','#9aa3b5','#c9cfdb'],
    blue:['#4f7cff','#4f7cff','#7da0ff','#3a4a78','#2a3350']
  };
  function field(cv){
    var ctx=cv.getContext('2d'),cols=PAL[cv.dataset.palette]||PAL.hero,W=0,H=0,dpr=1,ps=[],raf=0,on=true,mx=-1e4,my=-1e4;
    function build(){
      var r=cv.getBoundingClientRect();W=r.width;H=r.height;dpr=Math.min(devicePixelRatio||1,2);
      cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
      var n=Math.round(Math.min(420,Math.max(120,W*H/3200)));ps=[];
      var cx=W*parseFloat(cv.dataset.cx||(cv.dataset.palette==='blue'?.62:.2)),cy=H*parseFloat(cv.dataset.cy||.45),R=Math.hypot(W,H)*.6;
      for(var i=0;i<n;i++){
        var a=Math.random()*Math.PI*2,rad=Math.pow(Math.random(),.7)*R;
        ps.push({cx:cx,cy:cy,a:a,r:rad,w:(Math.random()-.5)*.00022,len:Math.random()<.4?4+Math.random()*4:1.2+Math.random(),
          col:cols[Math.floor(Math.random()*cols.length)],al:.25+Math.random()*.7,ph:Math.random()*6.28,ox:0,oy:0});
      }
    }
    function draw(t){
      ctx.clearRect(0,0,W,H);
      for(var i=0;i<ps.length;i++){
        var p=ps[i],a=p.a+p.w*t,rr=p.r+Math.sin(t*.0006+p.ph)*6;
        var x=p.cx+Math.cos(a)*rr,y=p.cy+Math.sin(a)*rr*.72;
        var dx=x-mx,dy=y-my,dd=dx*dx+dy*dy;
        if(dd<14400){var f=(1-Math.sqrt(dd)/120)*28,l=Math.sqrt(dd)||1;p.ox+=((dx/l)*f-p.ox)*.12;p.oy+=((dy/l)*f-p.oy)*.12}
        else{p.ox*=.9;p.oy*=.9}
        x+=p.ox;y+=p.oy;
        if(x<-10||y<-10||x>W+10||y>H+10)continue;
        ctx.globalAlpha=p.al;ctx.strokeStyle=p.col;ctx.lineWidth=1.6;ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*p.len,y+Math.sin(a)*p.len*.72);ctx.stroke();
      }
    }
    function loop(t){if(on)draw(t);raf=requestAnimationFrame(loop)}
    build();draw(0);
    if(reduce)return;
    new ResizeObserver(function(){build();draw(0)}).observe(cv);
    new IntersectionObserver(function(es){on=es[0].isIntersecting}).observe(cv);
    cv.parentElement.addEventListener('pointermove',function(e){var r=cv.getBoundingClientRect();mx=e.clientX-r.left;my=e.clientY-r.top});
    cv.parentElement.addEventListener('pointerleave',function(){mx=my=-1e4});
    raf=requestAnimationFrame(loop);
  }

  window.NSFX={field:field};
  [].slice.call(document.querySelectorAll('canvas.particles')).forEach(field);
})();
