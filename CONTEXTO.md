# Contexto del proyecto (para retomar en Claude Code)

Sesión original: https://claude.ai/code/session_01Ujc9z88LZd6bzcf4wg4KVd
(`claude --teleport session_01Ujc9z88LZd6bzcf4wg4KVd` para continuarla).

## Repos
- `neaserisgod/NodoSurPage`: web de Nodo Sur (horsepos.com). Rama de trabajo `claude/dreamy-brahmagupta-zyp3j9`. Mocks en `mocks/antigravity/`.
- `neaserisgod/P41---POS-`: POS de escritorio (Flutter, Windows) y app Android companion (`lib/companion`). Local: Flutter 3.47.6.
- `horsepospronative`: tercer repo del proyecto (no tocado en esta sesión).

## Objetivo
Rediseño de la web, el POS y la app Android al estilo antigravity.google (fondo blanco, bloques #F3F4F7, acento #121317, radios 28/16), con estilo Y disposición iguales a los mocks interactivos, **usando solo funciones que existen en las apps reales**. Lo que existe solo en los mocks está en `docs/anotaciones-mocks.md` (P41) para revisar luego.

## Estado
- Rediseño del POS (todas las pantallas) y de Android: hecho y publicado.
- Releases: Windows estable y Android estable publicados el 2026-10-02 (nota: "Rediseño completo al estilo de la web de Nodo Sur").
- Feature nueva: pagarle a un proveedor sin cargar deuda antes (PC y celular), PR #28 mergeado. Dispara una beta de Windows; **no está en estable** (ni en el APK estable actual).
- Pagos offline desde el celular no tocan la cuenta corriente de la PC.

## Desvíos deliberados respecto de los mocks (por funciones reales)
- Cierre de caja: conserva el flujo real (efectivo a ciegas primero).
- Vender: cuatro medios de pago siempre visibles con atajos Alt.
- Configuración, Equilibrio, Respaldo e Impresión: estilo nuevo, secciones y campos reales.

## Cómo se publica (P41)
- `publicar-beta.yml`: un merge a `main` que toque código publica beta de Windows (ignora `*.md`, `docs/`, `test/`, `.github/`). Manual: `workflow_dispatch` con canal beta/stable, rollout, notas.
- `publicar-apk.yml`: manual, canal, notas, rollout.
- `tests.yml`. Grupo de concurrencia `publicar`: uno a la vez; publica el HEAD de `main` al despachar.

## Detalles técnicos útiles
- Tema: `ui/tema/` (`colores_escritorio.dart`, `acentos.dart`, `tema.dart`, `tema_inverso.dart`). Filas negras seleccionadas: usar `coloresDeFila` / `TemaInverso`.
- Capturas de pantallas: `test/ui/capturas_escritorio_test.dart` (salen a `capturas/escritorio/`).
- Pagos a proveedores: `movimientos_de_caja` tipo `PAGO_PROVEEDOR` con `proveedorId`; cuenta corriente en `movimientos_deuda`.
- Línea base de tests: 4 archivos de test no cargan desde antes (preexistente).

## Pendiente / opcional
- Diferencias de disposición restantes vs mocks (ver `docs/anotaciones-mocks.md`).
- Decidir si la feature de pago sin deuda pasa a estable (Windows) y publicar nueva APK.
