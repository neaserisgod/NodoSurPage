# Remake de horsepos.com — plan

Basado en tres fuentes: **taste-skill** (Leonxlnx: dirección de arte anti-plantilla, reglas medidas en navegador),
**web-design-guidelines** (Vercel: accesibilidad, foco, formularios, rendimiento) y **awesome-design-md** (sistemas de
diseño de Stripe, Linear, Mercury, Cal, etc. como referencia de rigor, no para copiar).

Objetivo: más gente que pasa de la home a `/pagar/` (la prueba de 7 días), una página que se vea de 2026 y que nadie
confunda con otro POS.

---

## 1. Diagnóstico de la home actual

Pasé `lint.mjs` de taste-skill sobre `index.html` + `home.css`: **59 FAIL, 7 WARN**.

| Problema | Cantidad | Por qué importa |
| --- | --- | --- |
| Sombras en elementos quietos | 26 | Look "plantilla SaaS" |
| Degradados (incluido texto con degradado) | 19 | El tell más común de las páginas hechas con IA |
| Eyebrows (etiqueta chica arriba del título: "Sistema POS (de caja)", "Precios", "Nuevo · …") | 9 | Ruido, roba lectura al título |
| Vidrio esmerilado (`backdrop-filter`) | 6 | Tell de moda, cuesta GPU en celulares viejos |
| Líneas de 1px como separadores | 5 | Separar con espacio o con cambio de fondo |

Además, leyendo el contenido:

- **El hero no dice el precio ni muestra el producto grande.** El diferencial ("cuánta plata separar para cada
  proveedor") está, pero en un párrafo de 3 líneas.
- **Lista de 20 funciones en pastillas**: abruma y no prueba nada.
- **Carrusel** de capturas: la mitad de la gente nunca pasa de la primera.
- **Tres planes en torres iguales** + Emprendedor escondido abajo: cuesta ver cuál conviene.
- **Ninguna prueba social real** (sin testimonios, sin cantidad de comercios). No hay que inventarla: hay que juntarla.
- **Nada para tocar.** La página explica, pero no deja que el almacenero vea su propio caso.

Lo que está bien y se conserva: la copy en voseo y directa, el "Hoy pagás $ 0 · sin permanencia · 30 días de
devolución", el flujo `/pagar/` con Google + Mercado Pago, el SEO (JSON-LD, FAQ, canonical) y las capturas reales v4.

---

## 2. La idea

Taste-skill repartió tres direcciones y elegí **"Disfrazado de otra cosa"** (las otras: solo tipografía, y el
instrumento silencioso). La regla es vestir un producto aburrido con los modos de una categoría más viva.

**Categoría prestada: el cartel de oferta del almacén.** La cartulina fluo naranja, verde lima y celeste, escrita en
fibrón grueso, pegada torcida en la vidriera. Todo almacenero de Argentina la conoce y ningún POS la usa.

> En esta página, **los carteles fluo de la vidriera y el ticket del cierre de caja** se convierten en
> **un afiche de almacén: campos de color plano, tipografía negra enorme y recortes pegados torcidos.**

Prueba del competidor: si pongo Tango, Fudo o Bistrosoft en la frase, no funciona. Ninguno nació en un almacén de
Bariloche ni vende "cuánto separar por proveedor".

**Lo que se puede tocar (uno solo):** *"¿Cuánto separás hoy?"*. El visitante pone cuánto vendió hoy (o elige un ejemplo)
y ve el ticket de cierre impreso en pantalla: cuánto le toca a cada proveedor (Coca, Arcor, panadería, fiambres) y cuánto
le queda de ganancia. Muestra el diferencial con los números del visitante. Sin JS se ve un ticket de ejemplo fijo.

---

## 3. Sistema visual

Hay una decisión que tomás vos, abajo (sección 8): hoy el sitio sigue el estilo antigravity del POS (blanco, `#F3F4F7`,
Figtree). El remake rompe con eso a propósito en la home y las páginas de venta. Las pantallas de cuenta, admin, negocio
y vincular siguen con el estilo del POS.

**Tipografía:** Epilogue (900 para títulos, 400/500 para texto), alojada en `/fonts/` (la CSP solo permite
`font-src 'self'`), subconjunto latino, `font-display: swap`. Una sola familia.

```css
:root {
  --step-small: clamp(.8125rem, .79rem + .1vw, .875rem);
  --step-body:  clamp(1.0625rem, 1rem + .25vw, 1.1875rem);
  --step-lead:  clamp(1.25rem, 1.1rem + .7vw, 1.625rem);
  --step-head:  clamp(2.5rem, 1.2rem + 5vw, 5.5rem);
  --step-shout: clamp(5rem, 12vw, 11.875rem);   /* solo el hero y el CTA */
}
```

**Color (las cartulinas):** el fondo cambia mientras bajás, el texto es siempre negro.

```css
:root {
  --naranja: #ff8126;  --celeste: #4db3ff;  --lima: #c5f53d;  --noche: #161615;
  --ink: #111111;      --accent: #de194b;  /* rojo "OFERTA": solo en el botón principal */
}
```

**Reglas de la casa (medidas por `inspect.mjs`):** títulos de dos líneas como máximo en todo ancho; sin eyebrows; sin
degradados; sin sombras en reposo; sin líneas finas; sin vidrio; sin tarjetas con ícono arriba; botones de una sola
forma (rectángulo grueso, esquinas rectas); las capturas van recortadas y sin marco de dispositivo.

---

## 4. La página, sección por sección

Primero el argumento (afirmación → prueba). Si una sección no tiene afirmación, no va.

| # | Sección | Afirmación | Prueba | Composición |
| --- | --- | --- | --- | --- |
| 1 | **Hero** | Es el POS que te dice cuánto separar por proveedor, desde $ 35.000 | Captura real del cierre, precio grande | Campo naranja al 82 %, título a 12vw alineado a la izquierda ("Cerrá la caja / sin calculadora"), captura del cierre recortada en arco e inclinada 5° pisando la franja inferior. En la franja: una frase, el precio y **un solo botón** "Probar 7 días gratis". Debajo, chico: "Hoy pagás $ 0 · sin permanencia". |
| 2 | **Lo que se toca: ¿Cuánto separás hoy?** | Lo ves con tus números | El ticket que se imprime | Campo celeste. Un campo de monto y tres ejemplos ("kiosco chico", "almacén de barrio", "autoservicio"). El ticket baja desde arriba como de una ticketera. |
| 3 | **Antes / ahora** | Te ahorra la cuenta de todas las noches | Dos números enormes | "Dos palabras gigantes comparadas": a la izquierda *"45 min"* (cerrar con cuaderno y calculadora), a la derecha *"2 min"*. **El número tiene que ser real:** lo confirma el dueño antes de publicar. |
| 4 | **Funciones** | Lo de todos los días está en primer plano | Detalles de la interfaz en grande | "Tablero de primeros planos": 8 baldosas de color plano, cada una con **un** detalle real de la captura ampliado (el botón de cobrar QR, el número del arqueo, la alerta "te subió el precio", el chip de fiado). Reemplaza la lista de 20 pastillas; la lista completa queda en `/sistema-pos/`. |
| 5 | **Bot de WhatsApp** | Tu cliente escribe y el bot le contesta solo | La conversación de ejemplo | Campo lima. Se queda el chat actual (que ya es bueno), en grande, con los mensajes que entran escalonados. |
| 6 | **Cómo empezás** | En 3 pasos, hoy | Los 3 pasos | "Muchos en uno": un dibujo de cuadraditos (tus productos sueltos → planilla → sistema ordenado) y debajo *Elegís · Lo instalás · Si te sirve, seguís*. |
| 7 | **Precios** | Precio claro, sin letra chica | Los 4 planes | "Planes en escalón": baldosas que crecen como un gráfico de barras (POS → Sistema + Bot el más alto). La franja de abajo de cada baldosa es el botón. Emprendedor deja de estar escondido: va como cuarta baldosa más baja con su rubro ("¿Tenés un servicio?"). Las garantías se repiten justo abajo. |
| 8 | **Preguntas** | Respondemos las dudas antes de que pagues | Las 9 preguntas actuales | "Fichas de cajón": tarjetas apiladas con pestaña (Cobro, Permanencia, Internet, Datos, Excel, Factura, Soporte). Una abierta a la vez, con `<details>` para que ande sin JS. |
| 9 | **CTA** | Probalo hoy | — | Toda la franja es el link: **"Probalo"** a 26vw sobre el rojo oferta. Arriba a la izquierda: "Entrás con Google, activás en Mercado Pago y hoy no pagás nada". |
| 10 | **Pie** | Hecho en Bariloche | Dirección, Instagram, WhatsApp | Fondo noche, "¿Dudas? Escribime" con el botón de WhatsApp y **NODO SUR** a 28vw cortado por el borde inferior. |

**En el celular** (la mayoría de los almaceneros entra desde el celu): cada sección tiene su propia composición (ver la
hoja de dirección), más una **barra fija abajo** con "Probar gratis · $ 0 hoy" que aparece después del hero y se esconde
sobre la sección de precios y el CTA.

**Movimiento:** la captura del hero se abre como persiana (clip-path, 1,1 s) y es el único momento fuerte. Entradas
escalonadas por sección, feedback al tocar cada botón y el ticket del cierre que se imprime. Solo `transform` y
`opacity`; con `prefers-reduced-motion` no se mueve nada y se ve todo.

---

## 5. Conversión

1. **Una sola acción principal en toda la página:** "Probar 7 días gratis" → `/pagar/`. "Ver precios" pasa a link de
   texto. WhatsApp va solo en "¿Dudas?" (como hoy).
2. **Precio en el primer pantallazo.** El almacenero quiere saber cuánto sale antes de leer nada.
3. **El riesgo cero pegado a cada botón:** "Hoy pagás $ 0 · sin permanencia · 30 días de devolución".
4. **Lo que se toca** (sección 2): el que puso sus números ya se imaginó usándolo.
5. **Prueba social real:** pedirle al dueño 2 o 3 frases de clientes con nombre y rubro del comercio (con permiso) y la
   cantidad de comercios que lo usan. **No se inventa nada:** si no hay, la sección no existe.
6. **Barra fija en el celular** (punto anterior).
7. **Medir:** Cloudflare Web Analytics ya está activo. Comparar visitas a `/pagar/` y altas en `/admin/` ("Registrados
   sin pagar", "Plan elegido") 2 semanas antes y 2 semanas después de publicar. Agregar `?desde=hero|precios|cta` a los
   links de `/pagar/` para saber qué botón convierte (sin cookies nuevas).

---

## 6. Calidad (web-design-guidelines de Vercel)

- Link "Ir al contenido", títulos en orden, `alt` real en cada captura, `aria-live` en el resultado de "¿Cuánto separás hoy?".
- Foco visible en todo (`:focus-visible`), nunca `outline: none` sin reemplazo; la barra fija no tapa el foco.
- Campo de monto: `inputmode="numeric"`, `<label>` visible, montos con `Intl.NumberFormat('es-AR')`.
- `<img>` con `width`/`height`; la captura del hero con `fetchpriority="high"`, el resto `loading="lazy"`.
- Fuente precargada; nada de `transition: all`; `touch-action: manipulation`; `env(safe-area-inset-bottom)` en la barra fija.
- `text-wrap: balance` en títulos, `…` y comillas tipográficas, espacios duros en "$ 35.000".
- `theme-color` igual al fondo naranja.
- Presupuesto: home < 200 KB sin las capturas, LCP < 2 s en 4G, cero dependencias nuevas (sin build, como hoy).

---

## 7. Fases

Cada fase es un PR aparte y se mezcla solo con tu OK.

| Fase | Qué | Archivos |
| --- | --- | --- |
| **0. Maqueta** | Home completa en `mocks/remake/index.html` (no se publica), capturas a 1440/768/390 y crítica con la rúbrica de taste-skill. **Acá decidís si seguimos.** | `mocks/remake/` |
| **1. Base** | Epilogue en `/fonts/`, tokens nuevos en `home.css` desde cero, `home.js` nuevo (persiana, entradas, barra fija). | `fonts/`, `home.css`, `home.js` |
| **2. Home** | `index.html` nuevo con las 10 secciones. Se mantienen el `<head>`, el JSON-LD y las rutas. Pasa `lint.mjs` + `inspect.mjs` sin FAIL. | `index.html` |
| **3. Lo que se toca** | "¿Cuánto separás hoy?" con ejemplos reales de reparto por proveedor que confirma el dueño. Solo `textContent` (regla del repo). | `home.js` |
| **4. Páginas de venta** | El mismo lenguaje en `/sistema-pos/`, `/bot-whatsapp/`, `/servicios/`, `/paginas-web/` y las 4 páginas por rubro. | `styles.css`, `theme.css` |
| **5. Guías y pagar** | Las guías del blog y `/pagar/` con la tipografía y los colores nuevos (sin tocar la lógica de pago). | `styles.css`, `pagar/` |
| **6. Medir** | 2 semanas de datos, ajustar el texto del hero y los precios según lo que convierte. | — |

En cada fase: `node scripts/versionar-estaticos.mjs` y todas las pruebas
(`for f in tests/*.test.mjs; do node --experimental-sqlite "$f"; done`) antes de cada commit.

---

## 8. Lo que necesito de vos

1. **¿Va la estética "cartel de almacén"** (naranja / celeste / lima, tipografía negra enorme) o preferís algo más
   sobrio? Alternativa sobria: "El instrumento silencioso" (una columna angosta, mucho blanco, demos chiquitas y exactas,
   más cerca del estilo actual del POS).
2. **¿La home y el POS se separan visualmente?** El plan dice que sí: el sitio vende y el POS trabaja.
3. **Números reales:** cuánto tardaba un cierre a mano y cuánto con el sistema, y un reparto de ejemplo por proveedor
   para el ticket.
4. **Testimonios** con permiso (nombre, comercio, ciudad) y cantidad de comercios que lo usan, si querés mostrarla.
