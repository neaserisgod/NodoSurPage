/* Partículas y rayita en las páginas internas (encabezado y cierre). Usa fx.js. */
(function(){
  var d=document,path=location.pathname.replace(/\/+$/,'');
  if(/^\/(pagar|cuenta|ingresar|vincular|admin)$/.test(path))return;
  var add=function(host,pal,cx,cy){
    if(!host||host.querySelector('canvas.particles'))return;
    var c=d.createElement('canvas');c.className='particles';c.setAttribute('aria-hidden','true');
    c.dataset.palette=pal;c.dataset.cx=cx;c.dataset.cy=cy;host.insertBefore(c,host.firstChild);
    if(window.NSFX)window.NSFX.field(c);
  };
  [].forEach.call(d.querySelectorAll('.ph:not(.ph-co)'),function(h){add(h,'hero',.78,.4);var t=h.querySelector('h1');if(t)t.classList.add('caret')});
  [].forEach.call(d.querySelectorAll('.cta-b'),function(h){add(h,'blue',.7,.45);var t=h.querySelector('h2');if(t)t.classList.add('caret')});
})();
