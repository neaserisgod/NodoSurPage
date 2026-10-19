# Plan: primeros clientes que pagan antes del 31/10/2026

Escrito el 2026-10-19. Hoy hay **0 clientes pagos** y quedan **12 días**. No se publica (`marketing/` está en
`.assetsignore`). Los mensajes en frío y la cola siguen en [`mensajes-directos.md`](./mensajes-directos.md); la demo, en
[`demo.md`](./demo.md). Este plan dice **qué se hace primero y qué se deja**.

## Lo primero: la cuenta honesta

- **La prueba dura 7 días.** Quien activa la prueba el 25/10 recién paga el 1/11. Para que alguien **pague en octubre**
  tiene que activar la prueba **antes del jueves 23/10**, o pagar sin prueba (ver "Oferta de fundador").
- Con solo mensajes en frío (25 por día × 10 días = 250): 15 % responde → ~37; 30 % ve la demo → ~11; la mitad
  prueba → ~5; pagan **2 o 3**. Prometerse 10 en frío es irreal.
- Lo que cambia la cuenta: **gente que ya te conoce** (almacén, proveedores, vecinos) y **la puerta del local de al
  lado**. Ahí se cierra 1 de cada 3 o 4, no 1 de cada 100.

**Meta realista: 5 negocios con la prueba activada antes del 23/10 y 3 pagando el 31/10.** Con 3 clientes reales hay
testimonios, capturas y boca en boca para noviembre, que es lo que de verdad vale.

## Foco: dos cosas, nada más

| Producto | A quién | Por qué ahora |
|---|---|---|
| **Nodo Estudio** ($ 18.000) | Uñas, pestañas, peluquería, barbería de Bariloche primero, después Patagonia | Está terminado, tiene demo sin cuenta, plan en Mercado Pago y mensajes probados |
| **Nodo Gastro** ($ 18.000) | Rotiserías, pizzerías y viandas **de Bariloche, en persona** | El dolor es diario (pedidos por WhatsApp a la hora pico) y se puede ir caminando |

**Nodo Gestión ($ 35.000) queda para noviembre**, salvo que alguien lo pida: necesita PC, instalación y carga de
productos, el ciclo de venta es largo y no llega a cobrarse en octubre. Si un almacenero conocido se interesa, se le da la
prueba y se acompaña, pero no se sale a buscarlo.

## Bloqueos que se sacan HOY (antes de mandar un solo mensaje)

1. **Crear el plan de Nodo Gastro en Mercado Pago** (Suscripciones → Crear plan, $ 18.000, 7 días de prueba, retorno
   `https://horsepos.com/cuenta/`). Sin eso, el link de prueba del panel exime la cuenta **y nunca cobra**: todo
   rotisero que pruebe en octubre sería gratis para siempre hasta que se lo cambie a mano. Pasarle el link a Claude y lo
   cablea (`functions/_lib/plans.js`, `mp.js`, botones de `/gastro/` y la home).
2. **Video de 1 minuto** de un turno de punta a punta (grabar pantalla del celu con el bot de demo). Sin voz, con texto.
   Sin video, el mensaje 2 no tiene qué mandar. Uno igual para Gastro: un pedido de dos milanesas con envío.
3. **Número de demo** andando (pasos en `demo.md`). Si no llega hoy, se usa `horsepos.com/demo/` y el simulador, y se
   sigue: no frenar la venta por esto.
4. **Perfil de `@nodosur.brc`** con la bio y el link de `mensajes-directos.md`, el video fijado y 3 publicaciones (las
   capturas de `img/` sirven). Un perfil vacío mata la respuesta a los mensajes.

## Oferta de fundador (para cerrar en octubre)

El que duda "lo pruebo y veo" se va a noviembre. Para los **primeros 10 negocios**:

- **Precio congelado: $ 18.000 para siempre** (sin aumentos por inflación mientras siga suscripto). Cuesta poco hoy y
  pesa mucho en Argentina.
- **Te lo dejo andando yo**: carga de servicios o de la carta y el bot instalado, sin cargo.
- Vence el **31/10**: "son los 10 primeros; después el precio se actualiza".

Se mantiene la prueba de 7 días (es lo que baja el miedo). Lo que se agrega es la fecha: el que activa antes del 23/10
entra como fundador. **No regalar meses gratis**: el gratis no valida que alguien pague, y eso es lo único que hay que
probar este mes.

> Decisión del dueño: si querés que el congelado sea real, hay que anotarlo (planilla de fundadores con fecha) y respetarlo
> cuando suba el precio. Si no estás dispuesto a sostenerlo, se usa solo "te lo dejo andando yo" y la fecha.

## Los cinco canales, en orden

### 1. Tu gente (hoy y mañana, 1 hora) — el que más rinde

En el almacén entra gente todo el día. Muchos tienen un negocio o conocen a alguien que da turnos.

- **Mostrador**: un cartel chico al lado de la caja, con QR a `horsepos.com/servicios/`:
  "¿Das turnos por WhatsApp? Este almacén usa su propio sistema. Preguntá por la app de turnos con bot."
  Y la pregunta de 5 segundos al cobrar: "¿Vos tenés negocio? ¿Conocés a alguien que dé turnos de uñas o peluquería?"
- **Estado de WhatsApp** del almacén y el tuyo, 3 días seguidos: el video del turno y "Hice una app que da los turnos por
  WhatsApp sola. Busco 10 negocios de Bariloche para arrancar. ¿Conocés a alguien?". Los estados los ven tus contactos,
  que ya confían en vos.
- **Mensaje directo a 20 contactos** que tengan o conozcan un negocio (ver mensaje abajo).

> Hola {nombre}! Te cuento algo: además del almacén armé una app para negocios que dan turnos o toman pedidos por
> WhatsApp (uñas, peluquería, rotiserías). Contesta el WhatsApp sola, da el turno o toma el pedido y cobra la seña.
> Busco los primeros 10 negocios de Bariloche. ¿Conocés a alguien que le sirva? Si me pasás el contacto, le escribo yo
> de tu parte 🙏

**Pedir el nombre, no "pasale el dato"**: "le escribo yo de tu parte" convierte 5 veces más que esperar que el otro lo
reenvíe. Y al escribirle: "Me pasó tu número {quien}, que es cliente del almacén".

### 2. Puerta a puerta en Bariloche (3 tardes, 1 hora cada una) — Gastro y Estudio

A la hora muerta (15 a 18 hs), cuando no están a full. Llevar el celu con la demo abierta.

- **Rotiserías y pizzerías** del barrio y del centro: 10 por tarde.
  "Hola, soy {nombre}, del almacén La Plazoleta. ¿Los pedidos por WhatsApp los contestás vos? ¿Qué pasa a las 21 cuando
  te entran 15 a la vez?" Mostrar el bot tomando un pedido (simulador o número de demo), y cerrar con la oferta de
  fundador: "Te lo dejo andando yo esta semana".
- **Peluquerías y barberías** a la calle (uñas suele ser home studio: esas van por Instagram).
- Anotar cada visita en la cola (`cola.html`, "Uno a mano") para el seguimiento.

Meta: 30 visitas → 8 a 10 que quieren verlo → 3 pruebas. Es el canal con más cierre porque **sos de acá** y eso la
competencia (Gendu, AgendaPro) no lo tiene.

### 3. Mensajes en frío (todos los días, 30 minutos) — ya está armado

Seguir `mensajes-directos.md` y la cola, sin cambios, con dos ajustes por la fecha:

- **Bariloche y Alto Valle primero** (se puede ir a la demo en persona y cierra más).
- Al mensaje 2 sumarle la línea de fundador: "Si arrancás antes del jueves entrás como fundadora: el precio te queda
  congelado y te lo dejo andando yo."

25 por día, no más (Instagram bloquea). Seguimiento a las 48 hs, uno solo.

### 4. Grupos de Facebook y WhatsApp locales (una vez, 30 minutos)

"Emprendedoras de Bariloche", "Compra venta Bariloche", grupos de rotiserías y de manicuras de la zona. **Una**
publicación por grupo, no spam, contada como historia:

> Soy {nombre}, del almacén La Plazoleta del barrio {barrio}. Programé mi propio sistema para el almacén y ahora hice una
> app para los que dan turnos o toman pedidos por WhatsApp: contesta sola, da el turno o toma el pedido, y cobra la seña.
> Busco 10 negocios de Bariloche para arrancar, con precio de fundador y te la dejo andando yo. Si te interesa, comentá
> o escribime. [video]

La historia "el almacenero que programó su sistema" es el mejor gancho que tiene Nodo Sur: es verdad, es local y nadie
más la puede contar. Va en todo.

### 5. Referidos (desde el primer cliente)

A cada uno que active la prueba, al día 3, cuando ya le dio un turno o un pedido:

> ¿Cómo viene? Una pregunta: ¿conocés a otra chica del rubro que le sirva? Si se suma, a vos te bonifico el mes que viene.

Un mes bonificado ($ 18.000) por cliente que pague es barato contra cualquier publicidad. Anotarlo a mano.

## Qué NO se hace este mes

- **Publicidad paga (Meta Ads)**: con 12 días, sin video probado y con la prueba de 7 días, se gasta y no llega a
  cobrarse. El píxel se prende en noviembre, con un video que ya haya funcionado en orgánico.
- **Funciones nuevas en las apps.** Hasta el primer pago, todo lo que no destrabe una venta concreta espera (ya está en
  `CONTEXTO.md` §2). Si un prospecto pide algo chico para firmar, se evalúa ese caso.
- **SEO y páginas nuevas**: rinde en meses, no en días.
- **Envío masivo automático**: se pierde el número (ver `prospectar/LEEME.md`).
- **Nodo Gestión** salvo que llegue solo.

## Calendario

| Día | Qué |
|---|---|
| **Lun 20** | Bloqueos: plan de Gastro en MP, video, perfil. Cartel en el mostrador. Estado de WhatsApp. Mensaje a 20 contactos |
| **Mar 21** | Puerta a puerta (rotiserías). 25 DMs. Seguimiento a los contactos que pasaron nombres |
| **Mié 22** | Grupos de Facebook. 25 DMs. Demos con los que respondieron |
| **Jue 23** | **Último día para entrar a la prueba y pagar en octubre.** Puerta a puerta (peluquerías). Llamar a todo el que dijo "lo pienso" |
| Vie 24 | Revisión: % de respuesta por canal y por gancho (`mensajes-directos.md`, "Números"). Lo que no anda se cambia |
| Sáb 25 – Jue 30 | Seguir el ritmo; acompañar a los que prueban (día 1: cargar servicios; día 3: ¿anduvo el primer turno?; día 6: aviso de que mañana se cobra) |
| **Vie 31** | Cierre: cuántos pagaron, cuál canal trajo a cada uno, qué objeción se repitió. Eso define noviembre |

## Acompañar la prueba (donde se pierde la venta)

La mayoría de las pruebas que no pagan es porque **nunca la configuraron**. A cada uno que activa:

- **Día 0**: videollamada o visita de 20 min y le dejás los servicios (o la carta) cargados y el bot andando.
- **Día 2 o 3**: "¿Te entró algún turno por el bot?". Si no, ver qué pasa ese mismo día.
- **Día 6**: "Mañana se activa el cobro de $ 18.000. ¿Seguimos?". Mejor que se entere por vos que por Mercado Pago:
  evita que cancele por sorpresa y te da la chance de resolver la duda.

## Cómo se mide

Una sola planilla (la que exporta la cola), con columna **canal**: contactos, mostrador, puerta a puerta, DM, grupos,
referido. El viernes 24 y el 31 se mira: cuántos contactados, cuántos respondieron, cuántos vieron la demo, cuántos
probaron, cuántos pagaron. Para noviembre se dobla el canal que trajo más pagos y se corta el que no trajo ninguno.
