// Pantalla de ingreso: mensaje de error de Google y plan elegido. Es un archivo aparte (y no un <script> en la página) para que la
// política de contenido pueda prohibir los scripts en línea: ver `_headers`.
(function(){var m={cancelado:"Cancelaste el ingreso. Podés intentarlo de nuevo.",sesion:"La sesión de ingreso venció. Probá de nuevo.",google:"Google no pudo confirmar tu cuenta. Probá de nuevo."};var q=new URLSearchParams(location.search);var e=q.get("error");var n=document.getElementById("login-error");if(e&&n){n.textContent=m[e]||"No pudimos ingresarte. Probá de nuevo.";n.hidden=false}
var P=window.NS_PLANES||{},k=q.get("plan"),pl=document.getElementById("login-plan"),g=document.querySelector(".gbtn");
if(k&&P[k]&&pl&&g){var pr=q.get("promo")==="1";
pl.textContent="Elegiste "+P[k].nombre+" ("+(pr?"precio de fundador: $ "+P[k].promo.toLocaleString("es-AR"):"$ "+P[k].precio.toLocaleString("es-AR"))+" por mes). Ingresá con Google para continuar al pago: tu elección queda guardada.";pl.hidden=false;
g.href="/api/auth/google?plan="+k+(pr?"&promo=1":"")}
var nx=q.get("next");if(nx&&g&&/^\/vincular\/\?[A-Za-z0-9_%=&.~+-]*$/.test(nx)){g.href="/api/auth/google?next="+encodeURIComponent(nx)}
else if(nx&&g&&/^\/unirse\/\?t=[0-9a-f]{64}$/.test(nx)){g.href="/api/auth/google?next="+encodeURIComponent(nx);if(pl){pl.textContent="Ingresá con el mismo mail al que te llegó la invitación para sumarte al negocio.";pl.hidden=false}}})();
