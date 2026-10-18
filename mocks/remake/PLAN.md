# Remake de la home — plan (actualizado 2026-10-17)

Manda el contexto de diseño del dueño (`CONTEXTO-DISENO.md`, del zip `nodosur-diseno`). La primera versión de este
plan (dirección "cartel de almacén", POS de protagonista) quedó descartada.

## Decidido (no se re-pregunta)

- Solo la home por ahora; después el mismo sistema en las internas.
- Protagonista: **Nodo Sur Servicios** (plan Emprendedor, $ 18.000/mes, sin alta). POS y bot para comercios: una línea
  con links en Precios y en el pie.
- Un objetivo: **«Probar 7 días gratis»** → `/pagar/`. WhatsApp solo como «¿Dudas?».
- Estilo claro tipo Apple. Blanco, piedra `#F5F4F2`, tinta `#1A1714`, gris `#57534E`, naranja `#E4580B` (texto negro
  encima), naranja oscuro `#9A3A07`. Bricolage Grotesque (títulos) + Geist (texto). Sin `backdrop-filter`.
- Home elegida = variante B con el chat y el precio de C (`VariantBC`).

## Hecho en esta sesión

- Canvas: https://claude.ai/artifact/7nzzkKo9eLSi57MMgm7jFi
  - **Home elegida en escritorio** (era el pendiente 2): hero en dos columnas con dos celulares, chat jugable al lado
    de su explicación, cuenta con el resultado al costado, precio a todo el ancho, preguntas en dos columnas. Es fluida:
    en el celular se acomoda y muestra la barra fija.
  - La home elegida de celular, tal cual.
  - Plan para pasarla al repo.
- `nodosur-home-escritorio.html`: la versión escritorio como HTML suelto (hecha con `tools/convertir.mjs` del zip),
  para abrir directo en el navegador.

## Revisión con las skills

- **taste-skill**: la home elegida ya evita lo que marca en la home actual (59 problemas: degradados, vidrio,
  etiquetas arriba de los títulos, sombras). La sombra del celular y los botones redondeados quedan por decisión del
  dueño.
- **web-design-guidelines (Vercel)**, a aplicar al pasarla al repo: `width`/`height` en cada imagen, foco visible,
  `aria-live` en el chat, montos con `toLocaleString('es-AR')`, `touch-action: manipulation`, sin `transition: all`.

## Siguiente: un PR

1. `index.html` nuevo (título, descripción y JSON-LD actualizados a Servicios; rutas iguales).
2. `home.css` / `home.js`: chat y cuenta escritos a mano con `textContent` (sin `innerHTML`).
3. Bricolage y Geist en `/fonts/` (la CSP solo permite `font-src 'self'`). Capturas con nombre nuevo en `/img/`.
4. `node scripts/versionar-estaticos.mjs` y todos los `tests/*.test.mjs`. Merge solo con el OK del dueño.

Falta del dueño: OK a la versión escritorio y 2–3 capturas de WhatsApp de clientas reales (con permiso).
