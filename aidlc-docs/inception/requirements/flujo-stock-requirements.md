# Requisitos — Sección "Flujo de Stock"

**Fase AI-DLC**: INCEPTION → Requirements Analysis
**Tipo**: Brownfield — nueva feature
**Fecha**: 2026-06-02
**Estado**: Implementado (Code Generation completo) — pendiente migración de permisos en BD existente

## 0. Resultado de implementación

Archivos creados/modificados:
- **Backend**: `src/routes/flujo-stock.js` (nuevo endpoint), `src/index.js` (montaje),
  `src/scripts/bootstrapSchema.js` (módulo `flujo-stock` + permisos por rol).
- **Frontend**: `src/features/flujo-stock/FlujoStock.jsx` + `.css` + `animations/{semana,mes,anio}.json`,
  `src/core/api.js` (`getFlujoStock`), `src/features/dashboard/Dashboard.jsx` (menú + ruta + gating),
  `src/features/configuracion/Configuracion.jsx` (catálogo de permisos), `package.json` (`lottie-react`).

> **Acción requerida en BD existentes**: correr `npm run db:schema` (backend) para insertar el
> módulo `flujo-stock` y los permisos `flujo-stock:ver` por rol. En BD nuevas ya queda sembrado.

## 1. Resumen

Nueva sección del sistema llamada **"Flujo de Stock"** que permite analizar el movimiento
de ventas (unidades vendidas) de cada producto a través de tres ventanas de tiempo, con
gráficas de tendencia y animaciones Lottie decorativas.

Layout **maestro-detalle**: lista de productos a la izquierda; al seleccionar un producto,
a la derecha se muestran sus tres métricas con gráfica y animación.

## 2. Decisiones de diseño (confirmadas con el usuario)

| # | Tema | Decisión |
|---|------|----------|
| D1 | Definición de "cantidad de ventas" | **Unidades vendidas** = `SUM(venta_detalle.cantidad)` del producto en el período. |
| D2 | Layout / interacción | **Maestro-detalle con búsqueda**: lista de productos a la izquierda (con buscador); al hacer clic en un producto, a la derecha se muestran sus 3 métricas + gráficas + Lottie. Un producto a la vez. |
| D3 | Tipo de gráfica | Las 3 métricas como **gráficas de línea (tendencia)** usando `recharts` (ya instalado). |
| D4 | Animaciones | **Lottie con set fijo incluido**: instalar `lottie-react` e incluir 3 archivos `.json` (uno por métrica) versionados en el repo. Decorativas. |
| D5 | Granularidad de las líneas | **Última semana**: 7 puntos diarios. **Último mes**: ~30 puntos diarios. **Último año**: 12 puntos mensuales (con el promedio mensual como referencia/línea de promedio). |
| D6 | Fecha y estados de ventas | Usar `ventas.fecha`; **excluir** ventas con `cancelada=true` o `eliminada=true`. |
| D7 | Permisos / visibilidad | **Permiso por rol configurable**: nuevo módulo `flujo_stock` en `config_modulos` / `permisos_rol`, habilitable por rol desde Configuración (igual que las demás secciones). |
| D8 | Lista de productos | Solo productos **activos** (`activo=true`), ordenados alfabéticamente por nombre, con buscador. |

## 3. Las tres métricas (por producto seleccionado)

Todas las métricas = **unidades vendidas** (D1), basadas en `ventas.fecha` excluyendo
canceladas/eliminadas (D6).

1. **Unidades vendidas en la última semana**
   - Valor destacado: total de unidades en los últimos 7 días.
   - Gráfica: línea con 7 puntos (uno por día).

2. **Unidades vendidas en el último mes**
   - Valor destacado: total de unidades en los últimos ~30 días.
   - Gráfica: línea con ~30 puntos (uno por día).

3. **Promedio de unidades vendidas por mes en el último año**
   - Valor destacado: promedio mensual = (total unidades últimos 12 meses) / 12.
   - Gráfica: línea con 12 puntos (uno por mes) + línea/referencia del promedio.

Cada métrica tiene su propia gráfica y su propia animación Lottie.

## 4. Alcance backend

- **Nuevo endpoint** bajo `/api/` (p. ej. `GET /api/flujo-stock/:productoId`) que devuelve las
  tres series + valores agregados para un producto. Implementado con SQL parametrizado (driver `pg`),
  siguiendo el patrón de `backend/src/routes/`.
- Posible endpoint/serie de soporte para la lista de productos (reutilizar `productos` si aplica).
- Registrar el módulo `flujo_stock` en el bootstrap de permisos (`config_modulos` / `permisos_rol`).
- Cálculos sobre `ventas` ⋈ `venta_detalle`, filtrando `cancelada=false AND eliminada=false`,
  agrupando por día (semana/mes) y por mes (año).

## 5. Alcance frontend

- **Nueva feature** en `frontend/src/features/flujo-stock/` (`FlujoStock.jsx` + `.css`).
- Nuevo caso `pantalla` en `App.jsx` y entrada de menú (con gating por permiso `flujo_stock`).
- Funciones de API nuevas en `frontend/src/core/api.js` (nunca `fetch` directo).
- Reutilizar componentes compartidos (`AppInput`, `AppButton`, `AppTable`, etc.) y el patrón
  de gráficos de `Estadisticas.jsx` (recharts + colores del tema vía CSS vars).
- Integrar `lottie-react` con 3 animaciones fijas.

## 6. Fuera de alcance (por ahora)

- Configuración de animaciones Lottie por usuario (descartado en D4).
- Comparación multi-producto simultánea (D2: un producto a la vez).
- Productos inactivos en la lista (D8).
- Métricas monetarias o por transacción (D1: solo unidades).

## 7. Preguntas resueltas

Ver tabla §2. No quedan ambigüedades pendientes para iniciar Workflow Planning + Code Generation.
