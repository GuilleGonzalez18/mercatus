# Requisitos — Mejora de Auditoría
**Timestamp**: 2026-05-25  
**Tipo**: Brownfield — Optimización de performance y gestión del ciclo de vida de datos

---

## Diagnóstico del estado actual

### P1 — CRÍTICO: Carga sin filtro de fecha en el montaje
- **Síntoma**: `loadAuditoria('', '')` al montar → el backend devuelve hasta 1200 eventos + 2000 movimientos sin restricción temporal.
- **Impacto**: Payload enorme en cada apertura de pantalla; con volumen alto, puede superar el límite y ocultar datos recientes.

### P2 — ALTO: Paginación y filtrado completamente client-side
- **Síntoma**: Las 1200–2000 filas se filtran en el navegador con `useMemo`. Con catálogos grandes, bloquea el hilo principal en cada cambio de filtro.
- **Causa raíz**: Los endpoints devuelven el payload completo y el frontend hace la paginación (PAGE_SIZE=10) sobre un array en memoria.

### P3 — ALTO: Sin política de retención
- **Síntoma**: `auditoria_eventos` y `movimientos_stock` crecen indefinidamente. Una empresa con 300 ventas/día genera ~900 movimientos diarios; en un año supera 300K filas por tabla.
- **Impacto**: Queries lentas, costos de storage, backups pesados.

### P4 — MEDIO: Rango de fechas vacío como estado inicial
- **Síntoma**: El selector de fechas inicia en `desde=''` y `hasta=''`, comunicando "todo el período" al backend.
- **Impacto**: Confusión de UX + carga innecesaria de datos históricos al abrir la pantalla.

---

## Decisiones de diseño (respondidas por el usuario)

| Decisión | Elección |
|---|---|
| Retención de datos | 90 días |
| Estrategia de purga | Automática al iniciar el servidor |
| Rango por defecto al abrir | Últimos 7 días |
| Paginación | Server-side |
| Purga selectiva de eventos críticos | No (mismo período para todos) |

---

## Functional Requirements

### FR-01: Retención configurable vía variable de entorno
`AUDIT_RETENTION_DAYS` en el `.env` del backend. Default: 90. La purga elimina filas de `auditoria_eventos` y `movimientos_stock` con `created_at < NOW() - N days`.

### FR-02: Purga automática al iniciar el backend
Al arrancar el servidor (dentro del callback de `app.listen`, después de `runMigration`), se llama a `pruneAuditoria()` de forma no-bloqueante (sin await).

### FR-03: Paginación server-side en `/eventos` y `/movimientos-stock`
Ambos endpoints aceptan `page` (default 1) y `pageSize` (default 50, max 10000). Devuelven `{ rows, total, page, pageSize, meta }`.

### FR-04: Filtros server-side
- `/eventos`: acepta `accion`, `usuario`, `q` (búsqueda en entidad + detalle).
- `/movimientos-stock`: acepta `tipo`, `origen`, `usuario`, `q` (búsqueda en producto_nombre + detalle).

### FR-05: Meta en cada respuesta
Cada respuesta incluye `meta` con los valores distintos dentro del rango de fechas, para poblar los dropdowns de filtro:
- Eventos: `{ acciones: string[], usuarios: string[] }`
- Movimientos: `{ origenes: string[], usuarios: string[] }`

### FR-06: Rango por defecto en el frontend
Al montar `Auditoria`, `desde` se inicializa a `lastNDaysISO(7)` y `hasta` a `todayISO()`. "Limpiar fechas" limpia ambos campos (sin fecha = datos más recientes del período de retención).

### FR-07: Debounce en búsqueda de texto
Los campos de texto libre esperan 400ms después del último keystroke antes de disparar la llamada a la API. Los dropdowns de filtro disparan inmediatamente con reset de página a 1.

### FR-08: Export PDF usa todos los resultados del filtro actual
`exportarStockPDF` hace una llamada con `pageSize=10000` para obtener todas las filas del filtro activo, no solo la página visible.

---

## Non-Functional Requirements

### NFR-01: No breaking en otras funcionalidades
`movimientos_stock` es también escrito por otros módulos (ventas, productos). La purga solo elimina filas antiguas; no modifica la estructura.

### NFR-02: Seguridad en parámetros de paginación
`page` y `pageSize` son validados y coercionados server-side. Strings, negativos y valores fuera de rango se normalizan a defaults seguros.

### NFR-03: Parámetros de filtro sanitizados
`accion`, `origen`, `usuario` se truncan a longitud máxima razonable. `q` se trunca a 100 caracteres.

### NFR-04: Cancelación de requests en vuelo
Los efectos de React usan el patrón `let cancelled = true` para evitar actualizaciones de estado sobre componentes desmontados.
