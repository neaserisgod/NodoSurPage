# Cómo mostrar Nodo Estudio (en persona y por videollamada)

Para cuando una emprendedora dice "dale, mostrame". Dura **15 minutos** y termina con la prueba de 7 días activada en el
momento. Los mensajes que llevan hasta acá están en [`mensajes-directos.md`](./mensajes-directos.md).

## Las tres cosas que se muestran

| Pieza | Qué es | Para qué sirve en la demo |
|---|---|---|
| **El número de demo** | Un WhatsApp con el bot de verdad, atendiendo como "Estudio Demo". | Lo que más vende: ella le escribe **desde su propio celular** y le dan un turno. Siente lo que van a sentir sus clientas. |
| **horsepos.com/demo/** | La app con un negocio de ejemplo cargado (uñas, peluquería, barbería o estética). Sin cuenta, se reinicia sola. | La agenda, los turnos del bot esperando la seña, cobrar con QR, la caja del día. |
| **El simulador del bot** | `npm run probar` en la compu (repo `botdemo`): un chat en el navegador con el bot, como clienta o como dueña. | Plan B si el número de demo no anda, y para compartir pantalla cuando ella no quiere escribir desde su celular. |

## El número de demo (hay que armarlo una vez)

Hace falta un **Android viejo prendido y enchufado** y un **chip prepago** solo para esto (no el WhatsApp de Nodo Sur: si
algo sale mal, que no se caiga el de soporte).

1. En el chip nuevo, instalar **WhatsApp Business** y ponerle de nombre "Estudio Demo · Nodo Estudio", con la foto de
   la marca y en la descripción: "Esto es una demo: escribí *hola* y pedí un turno como si fueras clienta".
2. En el Android viejo, instalar el bot como dice el README de `botdemo` ("Instalar en el celu, con un comando"), **sin
   vincularlo a Nodo Sur**, y contestar:
   - rubro: `unas` (la mayoría de los prospectos);
   - nombre: `Estudio Demo`;
   - número del bot: el del chip nuevo;
   - **número de la dueña: el tuyo**. Así, en la demo, a vos te llegan los avisos de "turno nuevo" y "seña a revisar" y se
     los mostrás: es el lado de la dueña.
3. Probarlo desde otro celular: "hola", pedir un semipermanente, elegir día y hora, dar un nombre. Tiene que llegar el
   aviso a tu WhatsApp.
4. Cargar el número en la cola de envío ("Tus datos para los mensajes › Número de demo"): desde ahí sale solo en el
   mensaje 2.

Las señas del número de demo son por transferencia al alias de ejemplo (`unas.brc.demo`). Si la persona manda cualquier foto
como comprobante, a vos te llega "seña a revisar" y la aprobás con `!ok N` (N es el número de turno del aviso): a ella le
llega "Turno confirmado". Es el mejor momento de la demo, porque ve las dos puntas.

Mantenimiento: un turno de prueba ocupa el horario de verdad en esa agenda. Una vez por semana, `!hoy` y `!semana` para
ver qué quedó y `!anular N` para liberar.

## En persona (15 minutos)

Llevar: tu celular, el número de demo andando, la compu o tablet con `horsepos.com/demo/` abierta en el rubro de ella.

1. **Preguntar antes de mostrar (3 min).** "¿Cómo das los turnos hoy?", "¿cuántas veces por semana te plantan?", "¿cuánto
   tardás en contestar cuando estás atendiendo?". Anotar los números: son los que se usan en el cierre. Si las respuestas
   son "nunca me plantan" y "contesto al toque", se le agradece y no se le vende.
2. **Que ella sea la clienta (4 min).** "Agarrá tu celular y escribile *hola* a este número, como si quisieras turno." Que pida
   el servicio que ella hace, en sus palabras ("tenés para esculpidas el jueves?"). Mientras, mostrale tu celular: te llega
   el aviso como a la dueña. Si pide seña, que mande cualquier foto y la aprobás vos: le llega la confirmación.
3. **Lo que ve la dueña (4 min).** En `horsepos.com/demo/`: la agenda del día con los huecos, un turno del bot esperando
   la seña, cobrar un turno con QR (aprueba solo a los 3 segundos), la caja del día. No mostrar todo: agenda, cobrar y listo.
4. **Cerrar (4 min).** Volver a sus números: "Me dijiste que te plantan dos por semana a $ 15.000: son $ 120.000 por mes.
   Esto sale $ 18.000 y los primeros 7 días no pagás nada." Proponer arrancar ahí mismo:
   - entra a `horsepos.com/servicios/` › Probar 7 días gratis, con su cuenta de Google;
   - en la app, cargan juntos sus 4 o 5 servicios con precio, duración y seña;
   - el bot se deja andando ese día o al siguiente (necesita un Android prendido; si ella tiene iPhone, uno viejo del negocio).

## Por videollamada (Meet o videollamada de WhatsApp, 15 minutos)

Lo mismo, con dos cambios:

- **Paso 2**: ella escribe al número de demo desde su celular mientras la llamada sigue (si está en la compu) o le
  pedís que lo haga después de cortar y te cuente. Si no puede, compartís pantalla con el **simulador** (`npm run probar`
  en la compu, rubro de ella) y le preguntás qué escribiría una clienta: lo tipeás vos y lo ve contestar.
- **Paso 3**: compartís pantalla con `horsepos.com/demo/`. Mejor todavía: le pasás el link por el chat y lo toca ella
  mientras le vas diciendo dónde.

## Antes de cada demo (2 minutos)

- [ ] Escribirle "hola" al número de demo desde tu celular: contesta.
- [ ] `horsepos.com/demo/` abre y está en el rubro de ella.
- [ ] Los números de su negocio a mano (lo que te contó en el chat).
- [ ] Si es por videollamada: el simulador abierto en otra pestaña, por las dudas.

## Si dice que lo tiene que pensar

"Dale. ¿Qué es lo que te hace dudar?" y responder eso (tabla de objeciones en `mensajes-directos.md`). Si sigue en duda:
"Los 7 días no se cobran: si no te sirvió, la cancelás desde Mercado Pago antes y no pagás nada." Marcarla en la cola como
**Vio la demo** y escribirle a los 2 días.
