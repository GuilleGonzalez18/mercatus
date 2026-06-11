# Requisitos — "Descarga automática de PDFs configurable al finalizar la venta"

**Fase AI-DLC**: INCEPTION → Requirements Analysis
**Tipo**: Brownfield — mejora de comportamiento + nueva config
**Fecha**: 2026-06-11
**Estado**: Implementado (Code Generation completo) — backend `node --check` OK, frontend lint + build OK

## 0. Resultado de implementación

Archivos modificados:
- **Backend**:
  - `src/scripts/bootstrapSchema.js` — nueva columna `descarga_automatica_pdf boolean NOT NULL DEFAULT false` en `config_empresa`.
  - `src/scripts/runMigration.js` — migración aditiva v24 (`ADD COLUMN IF NOT EXISTS`).
  - `src/routes/configuracion.js` — `PUT /empresa` acepta y persiste `descarga_automatica_pdf` (`$30`). El `GET /empresa` ya la expone vía `SELECT *`.
- **Frontend**:
  - `src/features/configuracion/Configuracion.jsx` — `buildForm` + `DATOS_FIELDS` + checkbox en la sección Datos.
  - `src/features/ventas/Ventas.jsx` — gating de la auto-descarga del CFE `.jsonc` y nueva auto-descarga del PDF del ticket (vía `useEffect` con patrón "latest ref"), ambas gateadas por el flag.

> **Acción requerida en BD existentes**: correr `npm run db:migrate` (backend) para agregar la
> columna. En BD nuevas ya queda en el `bootstrapSchema`. Default `false` → no cambia datos.

## 1. Resumen

Problema original: en móviles, la **impresión/cierre de venta descarga archivos automáticamente**,
acumulando descargas y notificaciones. Hoy, al confirmar una venta se auto-descarga el comprobante
**CFE `.jsonc`** en cada venta ([Ventas.jsx], el PDF del ticket ya era botón manual).

Solución elegida: un **toggle por empresa** en Configuración que controla si, al finalizar una venta,
se descargan automáticamente los PDFs/comprobantes. Si está **inactivo**, no se descarga nada solo,
pero la **pantalla final sigue mostrando los botones** para descargar/imprimir manualmente.

## 2. Decisiones de diseño (confirmadas con el usuario)

| # | Tema | Decisión |
|---|------|----------|
| D1 | Qué controla el toggle | **Ambos**: la auto-descarga del comprobante CFE `.jsonc` **y** una nueva auto-descarga del **PDF del ticket** al confirmar la venta. |
| D2 | Valor por defecto | **Desactivado** para empresas nuevas y existentes (columna `DEFAULT false`). Resuelve la acumulación en móvil de entrada; quien quiera la auto-descarga la activa. |
| D3 | Alcance | **Solo al finalizar venta**. No se tocan las descargas de "Imprimir entregas" ni tickets por lote (queda como posible mejora futura). |
| D4 | Persistencia | Nueva columna `descarga_automatica_pdf` en `config_empresa` (mismo patrón que `cfe_auto_envio`). |
| D5 | Ubicación del control | Checkbox en **Configuración → Datos de la empresa** (no gateado por CFE, porque también aplica al PDF del ticket). |
| D6 | Comportamiento con toggle OFF | No se auto-descarga nada; la pantalla post-venta con botones PDF / Imprimir ticket / Emitir CFE / WhatsApp permanece igual (descarga manual). |

## 3. Comportamiento esperado

- **Toggle ON**: al confirmar una venta se descargan automáticamente (a) el PDF del ticket y
  (b) el comprobante CFE `.jsonc`, como hasta ahora pero ahora también el ticket.
- **Toggle OFF (default)**: no hay descargas automáticas; la pantalla final sigue ofreciendo los
  botones para descargar/imprimir/compartir manualmente.

## 4. Alcance backend

- Columna `descarga_automatica_pdf boolean NOT NULL DEFAULT false` en `config_empresa`
  (bootstrap + migración aditiva idempotente).
- `PUT /api/configuracion/empresa`: aceptar y persistir el campo con el patrón `COALESCE($n::boolean, …)`.
- `GET /api/configuracion/empresa`: ya lo devuelve (`SELECT *`).

## 5. Alcance frontend

- `Configuracion.jsx`: incluir el campo en `buildForm`, en `DATOS_FIELDS` (para dirty/save) y un
  checkbox con hint explicativo en la sección Datos.
- `Ventas.jsx`: leer `empresa.descarga_automatica_pdf` (vía `useConfig`) y gatear:
  - la auto-descarga existente del CFE `.jsonc` en `confirmarVenta`,
  - una nueva auto-descarga del PDF del ticket al setear `ventaFinalizada` (efecto con ref-guard
    para no repetir y "latest ref" de la función para no recrear dependencias).

## 6. Fuera de alcance (por ahora)

- Toggle para las descargas de "Imprimir entregas" / tickets por lote en móvil (D3).
- Preferencia por usuario (es por empresa).
- Cambiar el método de impresión a vista previa/imprimir sin descarga (se evaluó en el pedido
  original pero se optó por el toggle).

## 7. Preguntas resueltas

Ver tabla §2. D1–D3 confirmadas por el usuario; D4–D6 derivadas del patrón existente. Sin
ambigüedades pendientes.
