/* Píxel de Meta (Facebook / Instagram) para medir los anuncios. Apagado mientras PIXEL_ID esté vacío: no carga nada.
   Para prenderlo: poner el ID (Administrador de eventos de Meta → Orígenes de datos → el píxel, un número de 15–16 cifras),
   correr `node scripts/versionar-estaticos.mjs --escribir` y sumar el aviso en /privacidad/ (ver CONTEXTO.md, "Píxel de Meta").
   Eventos: PageView en cada página; Lead al tocar un link de WhatsApp; InitiateCheckout al ir a pagar. No se manda ningún
   dato de la persona (ni mail ni nombre): solo qué página y qué botón. */
(function () {
  var PIXEL_ID = '';
  if (!/^\d{10,20}$/.test(PIXEL_ID)) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  // El cargador oficial de Meta, sin el <script> en línea (la política de contenido no lo deja): la cola fbq guarda los
  // eventos hasta que llega fbevents.js.
  var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
  if (!window._fbq) window._fbq = n;
  n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
  var s = document.createElement('script'); s.async = true; s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);

  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var h = a.getAttribute('href');
    if (/^https:\/\/wa\.me\//.test(h)) window.fbq('track', 'Lead', { content_name: location.pathname });
    else if (/^\/(api\/checkout|pagar\/)/.test(h)) window.fbq('track', 'InitiateCheckout', { content_name: location.pathname });
  }, { capture: true, passive: true });
})();
