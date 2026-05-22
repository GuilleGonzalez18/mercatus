# Plan: Normalización de documentos de cliente

> Fecha: 2026-05-22  
> Estado: Pendiente de implementación

---

## Motivación

Actualmente la tabla `clientes` tiene dos mecanismos redundantes para identificar documentos:

- Columna `rut varchar(50)` — campo legacy original
- Columnas `tipo_documento varchar(20)` + `numero_documento varchar(50)` — añadidas luego

El tipo de documento se guarda como string libre (`'RUT'`, `'CI'`, `'PASAPORTE'`, etc.) sin integridad referencial. El campo `rut` quedó como copia redundante de `numero_documento`.

---

## Objetivo

1. Crear tabla `tipos_documento` con los tipos válidos
2. Reemplazar `tipo_documento varchar` por `tipo_documento_id integer FK → tipos_documento.id`
3. Migrar datos existentes
4. Eliminar la columna `rut` redundante
5. Actualizar backend y frontend

---

## Paso 1 — Nueva tabla `tipos_documento`

```sql
CREATE TABLE IF NOT EXISTS public.tipos_documento (
  id   serial PRIMARY KEY,
  codigo  varchar(20)  NOT NULL UNIQUE,  -- 'RUT', 'CI', 'PASAPORTE', 'DNI', 'OTRO'
  nombre  varchar(100) NOT NULL,          -- 'RUT', 'Cédula de identidad', etc.
  activo  boolean NOT NULL DEFAULT true
);

INSERT INTO public.tipos_documento (codigo, nombre) VALUES
  ('RUT',       'RUT'),
  ('CI',        'Cédula de identidad'),
  ('PASAPORTE', 'Pasaporte'),
  ('DNI',       'DNI'),
  ('OTRO',      'Otro')
ON CONFLICT (codigo) DO NOTHING;
```

---

## Paso 2 — Migración de `clientes`

```sql
-- 2a. Copiar rut → numero_documento donde numero_documento esté vacío
UPDATE public.clientes
SET numero_documento = rut
WHERE (numero_documento IS NULL OR numero_documento = '')
  AND rut IS NOT NULL AND rut <> '';

-- 2b. Agregar columna FK (nullable al inicio para no romper registros sin tipo)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tipo_documento_id integer REFERENCES public.tipos_documento(id);

-- 2c. Poblar la FK desde el string existente
UPDATE public.clientes c
SET tipo_documento_id = td.id
FROM public.tipos_documento td
WHERE UPPER(c.tipo_documento) = td.codigo
  AND c.tipo_documento IS NOT NULL AND c.tipo_documento <> '';

-- 2d. Eliminar columna string redundante
ALTER TABLE public.clientes DROP COLUMN IF EXISTS tipo_documento;

-- 2e. Eliminar columna rut redundante
ALTER TABLE public.clientes DROP COLUMN IF EXISTS rut;
```

Todo esto va en `runMigration.js` como un bloque secuencial.

---

## Paso 3 — `bootstrapSchema.js` (estado final)

En el `CREATE TABLE public.clientes`, reemplazar:

```sql
-- QUITAR:
rut              varchar(50)  NULL,
tipo_documento   varchar(20)  NULL,

-- AGREGAR:
tipo_documento_id integer REFERENCES public.tipos_documento(id),
```

Y agregar la creación de `tipos_documento` **antes** del CREATE TABLE de `clientes` (por la FK).

---

## Paso 4 — Backend `clientes.js`

- `GET /`: SELECT incluye `JOIN tipos_documento td ON td.id = c.tipo_documento_id`, retorna `td.codigo AS tipo_documento` y `td.nombre AS tipo_documento_nombre`
- `POST /`: recibe `tipo_documento` (código string), resuelve el ID con `SELECT id FROM tipos_documento WHERE codigo = $1`, guarda `tipo_documento_id`
- `PUT /:id`: ídem POST
- Eliminar todas las referencias a `rut` en queries y validaciones

Nuevo endpoint sugerido (o reutilizar datos del GET de clientes):

```
GET /api/tipos-documento   → [{ id, codigo, nombre }]
```

Para que el frontend pueda cargar el select dinámicamente.

---

## Paso 5 — Frontend

### `api.js`
Agregar `getTiposDocumento()` → `GET /api/tipos-documento`

### `Clientes.jsx` y `Ventas.jsx` (modal nuevo cliente)
- Cargar `tiposDocumento` desde la API al montar
- El select de "Tipo de documento" usa `{ value: td.id, label: td.nombre }`
- Se envía `tipo_documento_id` en el payload (o el backend lo resuelve por código — a definir)
- Eliminar `rut: ''` de los estados `nuevo` y `NUEVO_CLIENTE_EMPTY`

### `Clientes.jsx` tabla
- La columna "Documento" ya muestra `c.numero_documento || '-'`
- Agregar tooltip o subtext con `c.tipo_documento_nombre` si está disponible

---

## Orden de ejecución

| # | Tarea | Archivo |
|---|-------|---------|
| 1 | Crear tabla `tipos_documento` en bootstrapSchema y migración | bootstrapSchema.js, runMigration.js |
| 2 | Migrar datos + DROP columnas `tipo_documento`, `rut` | runMigration.js |
| 3 | Actualizar `clientes.js` backend (queries + nuevo endpoint) | routes/clientes.js |
| 4 | Agregar `getTiposDocumento` en api.js | core/api.js |
| 5 | Actualizar form en Clientes.jsx | features/clientes/Clientes.jsx |
| 6 | Actualizar form en Ventas.jsx (modal nuevo cliente) | features/ventas/Ventas.jsx |
| 7 | Correr migración en producción | `npm run db:migrate` |

---

## Notas

- La migración es destructiva (DROP COLUMN) — hacer backup antes de correr en producción.
- El campo `rut` también se referenciaba en `initializeServices.js` (CFE) para obtener el RUT del cliente receptor: `String(cliente.tipo_documento || '').toUpperCase() === 'RUT' && cliente.numero_documento`. Después del cambio, esa lógica debe adaptarse a `tipo_documento_id` o al nuevo `tipo_documento_codigo` retornado por el JOIN.
