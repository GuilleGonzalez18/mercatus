# Preguntas — Agrupación de líneas CFE por producto

Por favor completá cada pregunta escribiendo la letra elegida después de `[Answer]:`.

## Question 1
Cuando una clave del Map agrupa exactamente **1 rawLine** (sin mezcla packs+sueltas para ese producto), ¿qué hacemos con `IteDscItem`?

Contexto: si una venta tiene solo packs de un producto, el rawLine tiene `dscItem = "6 Empaques x 4 unidades"`. Con el agrupador, ese producto genera 1 sola entrada en el Map.

A) Preservar el `dscItem` original de la rawLine — ventas solo-packs conservan la descripción de empaque en el CFE (más informativo para DGI)
B) Siempre vacío — comportamiento uniforme independientemente del caso, implementación más simple
X) Other (please describe after [Answer]: tag below)

[Answer]:

## Question 2
¿Incluimos tests unitarios para la nueva lógica de agrupación?

Contexto: `buildCFE` actualmente no tiene cobertura unitaria (solo E2E). Podría agregarse un test en `backend/src/__tests__/` que mockee `query` y verifique que packs+sueltas del mismo producto generan 1 sola línea con `IteDescuentoPct !== "100.00"`.

A) Sí — agregar test unitario en `backend/src/__tests__/` para el nuevo comportamiento
B) No — solo modificar `cfeBuilder.js`, los tests quedan fuera de este alcance
X) Other (please describe after [Answer]: tag below)

[Answer]:
