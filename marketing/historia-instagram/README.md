# Historia de Instagram: Nodo Sur

`historia-nodosur.mp4`: 1080×1920, 9:16, 36 s, 30 fps, H.264, sin audio. El
audio se pone desde Instagram, porque los audios en tendencia dan más alcance
que uno incrustado.

Tiene el estilo de horsepos.com, que a su vez sigue a antigravity.google:
fondo blanco, bloques #F3F4F7, tinta #121317, títulos livianos y apretados
(Figtree), palabras clave con degradé, el cursor que titila y el campo de
partículas que gira. La sección del bot va en oscuro, igual que en la web.

## Guion (lo que dice cada escena)

| Seg. | Escena | Propuesta de valor |
|---|---|---|
| 0–4 | Gancho: "¿Sabés cuánta plata separar para cada proveedor?" | El diferencial que no tiene otro POS |
| 4–8 | Render 3D de la pantalla Vender + celular | Producto real, PC + Android, funciona sin internet |
| 8–12 | 01 · Cobrás en un toque (venta animada, clic en Efectivo) | Velocidad en el mostrador |
| 12–16 | 02 · Cuánto separar para cada proveedor ($ 987.500 → por proveedor) | Plata ordenada, ganancia real |
| 16–20 | 03 · Cerrás la caja sin calculadora (diferencia $ 0) | Cero errores en el cierre |
| 20–24 | Chips: sin internet, QR/débito Point, fiado, fiambres por peso… | Hace todo lo de un almacén |
| 24–28 | Bot de WhatsApp contestando solo | Venta cruzada del segundo producto |
| 28–32 | Probás primero, pagás después + $ 35.000/mes sin alta + fundador | Riesgo cero, precio claro, urgencia |
| 32–36 | CTA: "Probalo 7 días gratis" · WhatsApp · horsepos.com | Acción |

Los números son los mismos datos de ejemplo de la web. Los precios y las
promesas (7 días gratis, 30 días de devolución, sin alta, precio de fundador
para los primeros 5) son los que publica hoy horsepos.com. **Si cambian
ahí, hay que cambiarlos en `historia.html` y volver a grabar.**

## Al publicarla

- **Sticker de enlace**: `https://wa.me/5492944796044?text=Hola%2C%20quiero%20probar%20el%20sistema`
  con el texto "PROBALO GRATIS", encima del botón negro de la última escena
  (en la parte de abajo, entre 1300 y 1500 px). Si se prefiere la web, usar `horsepos.com`.
- **Sticker de encuesta** en la escena del cierre (seg. 16): "¿Tu caja cierra todos los días?" Sí / Ni idea 😅
- **Mención de ubicación**: San Carlos de Bariloche.
- Audio: algo instrumental con ritmo marcado, en volumen bajo.
- Guardarla en un destacado "Sistema POS" para que quede fija en el perfil.

## Texto para reel o publicación (si se reutiliza el video)

> ¿Sabés cuánta plata separar para cada proveedor al final del día? 🤔
>
> Nodo Sur es el sistema de caja para kioscos y almacenes que lo hizo un almacenero de Bariloche para su propio negocio:
> ⚡ Cobrás en un toque, en efectivo o con Mercado Pago
> 💸 Te dice cuánto separar para cada proveedor y cuánto ganaste de verdad
> ✅ Cerrás la caja sin calculadora
> 📶 Funciona sin internet
>
> Lo instalo en tu compu, cargo tus productos y lo probás 7 días gratis. $ 35.000 por mes, sin costo de alta.
> 👉 Escribime por WhatsApp (link en la bio) · horsepos.com
>
> #kiosco #almacen #sistemapos #puntodeventa #bariloche #emprendedoresargentinos #comercio #controldestock #cierredecaja #mercadopago

## Serie de historias para acompañarla (opcional)

1. **Esta historia** (producto + CTA).
2. **Encuesta**: "¿Cuánto tardás en cerrar la caja?" <5 min / 15 min / Mejor no hablemos.
3. **Pregunta**: "¿Qué es lo que más te complica del mostrador?" Las respuestas sirven para el próximo contenido.
4. **Prueba social**: "Lo uso todos los días en mi almacén", con una foto real del mostrador.
5. **Cuenta regresiva**: "Quedan X lugares a precio de fundador".

## Volver a grabar

```sh
NODE_PATH=$(npm root -g) node render.js                 # → historia-nodosur.mp4
NODE_PATH=$(npm root -g) node render.js cuadro.png 12.5 # un solo cuadro, para revisar
```

`historia.html` también se puede abrir directo en el navegador: se reproduce en loop
(con `?t=12.5` se congela en ese segundo).
