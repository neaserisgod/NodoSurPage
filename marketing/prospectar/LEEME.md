# Prospectar: de dónde salen los contactos y cómo se manda rápido

Esta carpeta no se publica (`marketing/` está en `.assetsignore`). **Las listas reales no se suben**: el repo es público y
`.gitignore` deja afuera todo CSV que no sea `ejemplo.csv`.

## La cola de envío (`cola.html`)

Una página que se abre en el celular o en la compu. Por cada prospecto muestra el mensaje en frío ya armado (los de
[`../mensajes-directos.md`](../mensajes-directos.md)) y un botón:

- **Instagram**: "Copiar y abrir Instagram" copia el mensaje y abre el chat con esa cuenta (`ig.me/m/cuenta`). Pegás y mandás.
- **WhatsApp**: "Abrir WhatsApp con el mensaje" abre el chat con el texto ya escrito (`wa.me/549…?text=…`). Tocás enviar.

No deja mandar mientras el mensaje tenga `[algo de su cuenta]`: hay que abrir el perfil y poner algo real (esa línea es
la que hace que contesten). Después se marca qué pasó: **Lo mandé**, **Respondió**, **Vio la demo**, **Pagó**,
**No le interesa**. Solo:

- reparte los ganchos A y B y muestra cuál responde más;
- a las 48 horas sin respuesta pasa el prospecto a **Seguimiento**, con el mensaje 3 listo;
- al marcar **Respondió** deja el mensaje 2 listo (con el video y el número de demo de "Tus datos para los mensajes");
- exporta la planilla para la revisión del viernes.

Hay una copia viva en claude.ai (privada, guarda en su propia base y se ve igual en el celular y la compu):
https://claude.ai/artifact/CnZG8GaFdtxwTWD7nCLZuX. Abriendo este archivo directo en el navegador también anda, pero guarda
solo en ese navegador.

Ritmo: **25 por día** en 30 a 40 minutos (abrir perfil, poner el detalle, mandar, marcar). Más de eso por Instagram
desde una cuenta nueva es pedir que la frenen.

## Por qué uno por uno y no envío automático

Se pidió "lo más automático posible". Lo más automático que no te hace perder la cuenta es esto: **la lista se arma
sola y el mensaje sale armado, pero el último toque es tuyo**.

- **Instagram** frena o bloquea las cuentas que mandan DMs con programas (Jarvee, bots de "mass DM", extensiones). Con
  `@nodosur.brc` recién arrancada, el bloqueo llega en días, y es la cuenta que muestra el producto.
- **WhatsApp** banea el número que manda el mismo mensaje a muchos desconocidos (los marcan como spam y con pocas denuncias
  alcanza). La API oficial de WhatsApp Business **no permite** escribirle primero a alguien que no te dio su número, y las
  plantillas de marketing en frío las rechaza Meta. Herramientas tipo "WA Sender" usan WhatsApp Web por atrás: mismo baneo.
- Y si se cae el número de Nodo Sur, se cae también el de soporte de los clientes que ya pagan.

Lo que sí se puede automatizar sin riesgo, y ya está hecho o explicado acá: encontrar las cuentas, filtrarlas, armar cada
mensaje, acordarse de los seguimientos y medir qué gancho anda.

## De dónde salen los prospectos

La cola acepta un CSV con cualquiera de estas columnas (en cualquier orden, con nombres en castellano o los que exporta
Apify): `instagram`, `nombre`, `telefono`, `rubro`, `ciudad`, `seguidores`, `bio`, `detalle`, `nota`. Ver `ejemplo.csv`.
Se saltean solos los repetidos, los de menos de 300 o más de 10.000 seguidores y los que tienen link a otra app de turnos.

### 1. A mano desde Instagram (gratis, el mejor prospecto)

Buscar `nails` o `studio` + código de ciudad (`nqn`, `cipo`, `roca`, `brc`, `mdp`, `cba`) o el hashtag `#uñasneuquen`,
`#barberiacipolletti`, etc. En la cola: "Agregar prospectos › Uno a mano". Ya cargando el detalle ("esculpidas") el mensaje
queda listo.

### 2. Google Maps (da el WhatsApp del negocio)

Buscar "manicura Neuquén", "barbería Cipolletti", "peluquería General Roca". Los que tienen celular (empieza con 15 o con
9 después del código de área) suelen ser el WhatsApp. Automático: el actor **Google Maps Scraper** de Apify
(`compass/crawler-google-places`) con esas búsquedas, exportado en CSV, se sube tal cual a la cola (toma `title`, `phone`,
`city`, `categoryName`, `website`). Unos USD 2 a 4 cada 1.000 lugares; Apify regala USD 5 por mes.

### 3. Perfiles de Instagram en tanda (Apify)

Con una lista de cuentas (de búsquedas o de los seguidos de una cuenta grande del rubro de la zona), el actor
**Instagram Profile Scraper** (`apify/instagram-profile-scraper`) devuelve seguidores y bio. Su CSV entra directo:
la cola usa `username`, `fullName`, `followersCount`, `biography` y `externalUrl`, filtra por tamaño y marca las que dicen
"turnos por DM" o piden seña.

> El conector de Apify está instalado pero no conectado en estas sesiones de Claude. Con la clave conectada, Claude puede
> correr estas búsquedas y cargar la cola directamente.

## Lista inicial

Los 35 prospectos de `botdemo/docs/PROSPECTOS.md` (agosto 2026) ya están cargados en la cola viva, sin los que venden
insumos, los muy grandes y los muy chicos. Son de búsquedas web: **abrir cada perfil antes de escribir** y descartar los que
no publican hace meses.
