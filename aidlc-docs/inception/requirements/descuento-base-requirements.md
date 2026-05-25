# Requisitos — Descuento por unidad vs por total
**Timestamp**: 2026-05-25  
**Tipo**: Brownfield — Nueva dimensión en descuentos de ítem

---

## Descripción del cambio

Agregar una segunda dimensión a los descuentos individuales de ítem (sueltas y empaques):
**base = 'total' | 'unidad'**

Aplica únicamente a los descuentos de ítem (sueltas y packs). El descuento global de la venta queda sin cambios.

---

## Decisiones de diseño (confirmadas por el usuario)

| Decisión | Elección |
|---|---|
| ¿A qué descuentos aplica? | Solo descuentos de ítem (sueltas + empaque) |
| Fijo por unidad: comportamiento | `valor × cant_unidades` (ej: $10 × 14u = $140) |
| Porcentual por unidad: comportamiento | Idéntico a porcentual por total (10% por unidad = 10% del total) |
| Fijo por total: comportamiento | `valor` exacto (sin multiplicar por unidades) |
| Posición UI | Segunda fila de botones toggle debajo de Porcentual / Fijo |

---

## Functional Requirements

### FR-01: Nueva columna `descuento_base` en `venta_detalle`
Columna `descuento_base varchar(10) NOT NULL DEFAULT 'total'` para las unidades sueltas.  
Columna `descuento_packs_base varchar(10) NOT NULL DEFAULT 'total'` para los empaques.  
Valores válidos: `'total'` | `'unidad'`.

### FR-02: Cálculo del descuento con `base = 'unidad'`
Solo afecta el tipo `fijo`. Para `porcentaje`, `base` no cambia el resultado.

- **Sueltas, fijo, unidad**: `descSueltas = min(montoSueltas, valor × unidades_sueltas)`
- **Packs, fijo, unidad**: `descPacks = min(montoPacks, valor × packs × unidades_por_empaque)`

Comportamiento `base = 'total'` (o cualquier `porcentaje`): sin cambios respecto al estado actual.

### FR-03: UI — segunda fila de toggle buttons en `DiscountModal`
Debajo de la fila "Porcentual (%) / Fijo ($)", agregar una segunda fila:
`[Por total]  [Por unidad]`  
El botón activo se resalta igual que los botones de tipo.

La opción de base aplica **solo al DiscountModal de ítems**. El global modal no incluye esta opción.

### FR-04: Persistencia en la base de datos
Al crear una venta, `descuento_base` y `descuento_packs_base` se almacenan en `venta_detalle`.  
Se devuelven en `GET /:id` (detalle de venta).

### FR-05: Compatibilidad con datos existentes
Filas antiguas de `venta_detalle` sin las columnas recibirán `DEFAULT 'total'`, lo que reproduce el comportamiento previo exactamente.

---

## DB Changes

```sql
-- runMigration (v22)
ALTER TABLE public.venta_detalle ADD COLUMN IF NOT EXISTS descuento_base varchar(10) NOT NULL DEFAULT 'total';
ALTER TABLE public.venta_detalle ADD COLUMN IF NOT EXISTS descuento_packs_base varchar(10) NOT NULL DEFAULT 'total';
```

```sql
-- bootstrapSchema: añadir a venta_detalle tras descuento_packs_aplicado
descuento_base varchar(10) NOT NULL DEFAULT 'total',
descuento_packs_base varchar(10) NOT NULL DEFAULT 'total'
```

---

## Files to change

| File | Change |
|---|---|
| `backend/src/scripts/bootstrapSchema.js` | Añadir 2 columnas a `venta_detalle` |
| `backend/src/scripts/runMigration.js` | v22: 2 `ALTER TABLE` |
| `backend/src/routes/ventas.js` | SELECT + INSERT incluyen nuevas columnas |
| `frontend/src/features/ventas/Ventas.jsx` | `DiscountModal`, estado, cálculo, payload API |
