# Requisitos — "Consolidado de artículos para entregas"

**Fase AI-DLC**: INCEPTION → Requirements Analysis
**Tipo**: Brownfield — nueva feature
**Fecha**: 2026-06-11
**Estado**: Implementado (Code Generation completo) — backend `node --check` OK, frontend lint + build OK

## 0. Resultado de implementación

Archivos modificados:
- **Backend**: `src/routes/ventas.js` — nuevo endpoint `GET /api/ventas/entregas/consolidado`
  (agrupa por `producto_id`, `SUM(cantidad)`, mismos filtros que `/entregas/resumen`).
- **Frontend**:
  - `src/core/api.js` — `getEntregasConsolidado({ desde, hasta })`.
  - `src/features/ventas/VentasHistorial.jsx` — botón "Consolidado de artículos" junto a
    "Imprimir entregas", modal propio con presets/rango, y export PDF/Excel/Imprimir
    (`construirConsolidado`, `exportarConsolidadoPDF`, `exportarConsolidadoExcel`, `imprimirConsolidado`).

> Sin cambios de esquema ni de permisos: reutiliza `requirePermission('ventas', 'ver')`.
> No requiere migración en BD.

## 1. Resumen

Nueva opción junto al botón **"Imprimir Entregas"** (en `VentasHistorial`) que genera un
**resumen consolidado de artículos** necesarios para cumplir todas las entregas de una fecha
o rango de fechas. Agrupa los artículos repetidos entre todas las ventas del período y suma
las cantidades, devolviendo una lista del estilo:

```
Azúcar ........................ 240
Yerba .......................... 120
Arroz .......................... 80
```

**Objetivo**: que el usuario prepare el reparto y valide físicamente la disponibilidad de
mercadería **independientemente del stock registrado**. No es un control de stock; es una
**lista de necesidades de carga** para entregas futuras. Uso típico: el día anterior al reparto.

## 2. Decisiones de diseño (confirmadas con el usuario)

| # | Tema | Decisión |
|---|------|----------|
| D1 | Cantidad mostrada | **Solo total de unidades** por artículo = `SUM(venta_detalle.cantidad)`. Una sola cifra (sin desglose de empaques). |
| D2 | Ventas incluidas | **Solo entregas pendientes**: mismo filtro que `Imprimir Entregas` → excluye canceladas/eliminadas (`ACTIVE_SALES_CONDITION`) y ya entregadas (`estado_entrega <> 'entregado'`), con `fecha_entrega IS NOT NULL` dentro del rango. |
| D3 | Ubicación UI | **Botón separado** junto a "Imprimir Entregas" que abre su **propio modal** con selector de rango (presets + rango específico) y exportación. |
| D4 | Formatos de salida | **PDF, Excel e Imprimir** (idéntico al resumen de Entregas actual). |
| D5 | Orden del listado | **Por cantidad descendente** (como el ejemplo del usuario), desempate alfabético por nombre. *(default — confirmable)* |
| D6 | Agrupación / identidad | Agrupar por **`producto_id`**, mostrando el **nombre actual** del producto. Productos eliminados se incluyen igual si tienen entregas pendientes. *(default — confirmable)* |
| D7 | Permisos / visibilidad | Reutiliza `requirePermission('ventas', 'ver')` y el **mismo filtro por usuario** que `/entregas/resumen` (no-propietario ve solo sus ventas). *(default — confirmable)* |
| D8 | Filtrado por cantidad | Mostrar **solo artículos con cantidad > 0** (criterio de aceptación; se cumple naturalmente con `SUM` + `HAVING SUM(cantidad) > 0`). |
| D9 | Rango = un día | Si `desde === hasta`, el reporte cubre ese único día (selección de "fecha o rango"). |

## 3. Comportamiento esperado

1. El usuario abre el modal "Consolidado de artículos" y selecciona una **fecha o rango**
   (reutiliza los presets/rango específico ya existentes en el modal de Entregas).
2. El backend toma todas las ventas **pendientes** con `fecha_entrega` dentro del período (D2).
3. Une `ventas ⋈ venta_detalle ⋈ productos`, agrupa por `producto_id` y **suma `cantidad`** (D1).
4. Filtra artículos con total > 0 (D8), ordena por cantidad desc (D5).
5. Devuelve la lista consolidada (artículo + total) + metadatos del período.
6. El frontend la muestra y permite **PDF / Excel / Imprimir** (D4).

El reporte **no lee ni depende de `productos.stock`** (requisito explícito).

## 4. Alcance backend

- **Nuevo endpoint** `GET /api/ventas/entregas/consolidado?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
  (mismo módulo `routes/ventas.js`, patrón de `/entregas/resumen`).
  - Validación de fechas idéntica a `/entregas/resumen` (formato, `desde`/`hasta` ambos, `desde <= hasta`).
  - Mismos filtros de ventas: `ACTIVE_SALES_CONDITION`, `estado_entrega <> 'entregado'`,
    `fecha_entrega IS NOT NULL`, `DATE(v.fecha_entrega) BETWEEN $1 AND $2`, y filtro por usuario
    para no-propietario (D7).
  - SQL parametrizado (driver `pg`), agrupando:
    ```sql
    SELECT vd.producto_id,
           COALESCE(p.nombre, 'Producto') AS nombre,
           p.ean,
           SUM(vd.cantidad)::int AS total_unidades
    FROM public.ventas v
    JOIN public.venta_detalle vd ON vd.venta_id = v.id
    LEFT JOIN public.productos p ON p.id = vd.producto_id
    WHERE <mismos filtros que /entregas/resumen>
    GROUP BY vd.producto_id, p.nombre, p.ean
    HAVING SUM(vd.cantidad) > 0
    ORDER BY total_unidades DESC, nombre ASC;
    ```
  - Respuesta: `{ desde, hasta, totalArticulos, totalUnidades, articulos: [{ producto_id, nombre, ean, total_unidades }] }`.

## 5. Alcance frontend

- **Nueva función API** en `core/api.js`: `getEntregasConsolidado({ desde, hasta })` (nunca `fetch` directo).
- **Nuevo botón** junto a "Imprimir Entregas" en `VentasHistorial.jsx` y **nuevo modal** propio (D3)
  con el mismo patrón de presets/rango específico que el modal de Entregas (reutilizar helpers de rango
  `monthRangeISO`, `previousWeekRangeISO`, etc., y estados `*Desde/*Hasta` análogos).
- **Exportación** (D4) reutilizando utilidades existentes:
  - PDF con `jsPDF` + `autoTable` (logo + título "Consolidado de artículos" + período), columnas
    `Artículo | Cantidad`.
  - Excel vía el mismo mecanismo HTML→`.xls` usado por `exportarEntregasExcel`.
  - Imprimir vía ventana del navegador (mismo patrón que `imprimirEntregas`).
- Estados de carga/errores con `appAlert`, igual que las exportaciones de Entregas.

## 6. Fuera de alcance (por ahora)

- Desglose por empaque/bultos en la cantidad (D1: solo unidades).
- Lectura o validación contra `productos.stock` (requisito explícito: independiente del stock).
- Incluir ventas ya entregadas o canceladas (D2).
- Agrupar por algo distinto a `producto_id` (categorías, proveedor, etc.).
- Filtros adicionales (por cliente, por vendedor) dentro de este reporte.

## 7. Preguntas resueltas

Ver tabla §2. D1–D4 confirmadas por el usuario; D5–D7 son defaults razonables marcados como
confirmables. No quedan ambigüedades bloqueantes para iniciar Code Generation.
