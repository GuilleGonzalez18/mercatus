import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { query } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let barriosSeedSql = null;
try {
  const barriosRawSql = readFileSync(
    join(__dirname, '../../../scripts/localidades_uruguay.sql'),
    'utf8'
  );
  // Extrae solo el INSERT INTO barrios del archivo y lo hace idempotente
  const barriosInsertMatch = barriosRawSql.match(/INSERT INTO barrios[\s\S]+/);
  if (!barriosInsertMatch) throw new Error('No se encontró INSERT INTO barrios en localidades_uruguay.sql');
  barriosSeedSql = barriosInsertMatch[0].trimEnd().replace(/\s*ON CONFLICT DO NOTHING\s*;?\s*$/i, '') + '\nON CONFLICT DO NOTHING;';
} catch (e) {
  console.warn('[migración] localidades_uruguay.sql no encontrado – se omite seed de barrios.', e.message);
}

const statements = [
  `
  CREATE TABLE IF NOT EXISTS public.roles (
    id serial PRIMARY KEY,
    nombre varchar(50) NOT NULL UNIQUE,
    es_sistema boolean NOT NULL DEFAULT false
  );
  `,
  `
  INSERT INTO public.roles (nombre, es_sistema) VALUES
    ('propietario', true),
    ('vendedor',    true)
  ON CONFLICT (nombre) DO NOTHING;
  `,
  `
  CREATE TABLE IF NOT EXISTS public.usuarios (
    id serial PRIMARY KEY,
    username varchar(80) NOT NULL,
    password varchar(255) NOT NULL,
    rol_id integer NULL REFERENCES public.roles(id) ON DELETE SET NULL,
    nombre varchar(120) NULL,
    apellido varchar(120) NULL,
    correo varchar(180) NOT NULL,
    telefono varchar(50) NULL,
    direccion text NULL,
    debe_cambiar_password boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_username ON public.usuarios (username);
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_correo ON public.usuarios (correo);
  `,
  `
  CREATE TABLE IF NOT EXISTS public.departamentos (
    id serial PRIMARY KEY,
    nombre varchar(120) NOT NULL
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS departamentos_nombre_key ON public.departamentos (nombre);
  `,
  `
  CREATE TABLE IF NOT EXISTS public.clientes (
    id serial PRIMARY KEY,
    nombre varchar(180) NOT NULL,
    rut varchar(80) NULL,
    direccion text NULL,
    telefono varchar(50) NULL,
    correo varchar(180) NULL,
    horario_apertura varchar(5) NULL,
    horario_cierre varchar(5) NULL,
    tiene_reapertura boolean NOT NULL DEFAULT false,
    horario_reapertura varchar(5) NULL,
    horario_cierre_reapertura varchar(5) NULL,
    departamento_id integer NULL,
    barrio_id integer NULL,
    tipo_documento varchar(20) NULL,
    numero_documento varchar(50) NULL,
    ciudad varchar(100) NULL,
    codigo_postal varchar(10) NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_clientes_nombre ON public.clientes (nombre);
  `,
  `
  CREATE TABLE IF NOT EXISTS public.barrios (
    id serial PRIMARY KEY,
    nombre varchar(120) NOT NULL,
    departamento_id integer NULL
  );
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'barrios'
        AND constraint_name = 'barrios_departamento_id_fkey'
    ) THEN
      ALTER TABLE public.barrios
      ADD CONSTRAINT barrios_departamento_id_fkey
      FOREIGN KEY (departamento_id) REFERENCES public.departamentos(id) ON DELETE CASCADE;
    END IF;
  END $$;
  `,
  // === TIPOS DE IVA ===
  `
  CREATE TABLE IF NOT EXISTS public.tipos_iva (
    id serial PRIMARY KEY,
    codigo smallint NOT NULL,
    nombre varchar(80) NOT NULL,
    porcentaje decimal(5,2) NOT NULL DEFAULT 0,
    activo boolean NOT NULL DEFAULT true
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ux_tipos_iva_nombre ON public.tipos_iva (nombre);
  `,
  `
  INSERT INTO public.tipos_iva (codigo, nombre, porcentaje)
  VALUES
    (1, 'No Grava',      0.00),
    (1, 'Exento',        0.00),
    (2, 'Tasa Mínima',  10.00),
    (3, 'Tasa Básica',  22.00)
  ON CONFLICT (nombre) DO NOTHING;
  `,
  `
  CREATE TABLE IF NOT EXISTS public.productos (
    id serial PRIMARY KEY,
    nombre varchar(180) NOT NULL,
    costo numeric(12,2) NOT NULL DEFAULT 0,
    precio numeric(12,2) NOT NULL DEFAULT 0,
    stock numeric(12,2) NOT NULL DEFAULT 0,
    unidad varchar(30) NULL,
    imagen text NULL,
    ean varchar(80) NULL,
    cantidad_empaque integer NULL,
    precio_empaque numeric(12,2) NOT NULL DEFAULT 0,
    empaque_id integer NULL,
    iva_id integer NULL,
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_productos_nombre ON public.productos (nombre);
  `,
  `
  ALTER TABLE public.productos
  DROP COLUMN IF EXISTS empaque;
  `,
  `
  ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
  `,
  `
  CREATE TABLE IF NOT EXISTS public.empaques (
    id serial PRIMARY KEY,
    nombre varchar(120) NOT NULL,
    activo boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS empaques_nombre_key ON public.empaques (nombre);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_empaques_nombre ON public.empaques (nombre);
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS productos_ean_unique
    ON public.productos (ean)
    WHERE ean IS NOT NULL;
  `,
  `
  CREATE TABLE IF NOT EXISTS public.ventas (
    id serial PRIMARY KEY,
    usuario_id integer NULL,
    cliente_id integer NULL,
    fecha timestamp without time zone NOT NULL DEFAULT now(),
    fecha_entrega timestamp without time zone NULL,
    medio_pago varchar(20) NOT NULL DEFAULT 'efectivo',
    cancelada boolean NOT NULL DEFAULT false,
    eliminada boolean NOT NULL DEFAULT false,
    entregado boolean NOT NULL DEFAULT false,
    estado_entrega varchar(20) NOT NULL DEFAULT 'pendiente',
    observacion text NULL,
    subtotal numeric(12,2) NOT NULL DEFAULT 0,
    descuento_total_tipo varchar(20) NOT NULL DEFAULT 'ninguno',
    descuento_total_valor numeric(12,2) NOT NULL DEFAULT 0,
    total numeric(12,2) NOT NULL DEFAULT 0,
    cfe_enviado boolean NOT NULL DEFAULT false
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_fecha ON public.ventas (fecha);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_cliente ON public.ventas (cliente_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_usuario ON public.ventas (usuario_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_cancelada ON public.ventas (cancelada);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_fecha_entrega ON public.ventas (fecha_entrega);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_entregado ON public.ventas (entregado);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_estado_entrega ON public.ventas (estado_entrega);
  `,
  `
  ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS eliminada boolean NOT NULL DEFAULT false;
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_ventas_eliminada ON public.ventas (eliminada);
  `,
  `
  ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tiene_reapertura boolean NOT NULL DEFAULT false;
  `,
  `
  ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS horario_reapertura varchar(5) NULL;
  `,
  `
  ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS horario_cierre_reapertura varchar(5) NULL;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'ventas'
        AND constraint_name = 'ventas_cliente_id_fkey'
    ) THEN
      ALTER TABLE public.ventas
      ADD CONSTRAINT ventas_cliente_id_fkey
      FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'ventas'
        AND constraint_name = 'ventas_usuario_id_fkey'
    ) THEN
      ALTER TABLE public.ventas
      ADD CONSTRAINT ventas_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'clientes'
        AND constraint_name = 'clientes_departamento_id_fkey'
    ) THEN
      ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_departamento_id_fkey
      FOREIGN KEY (departamento_id) REFERENCES public.departamentos(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'clientes'
        AND constraint_name = 'clientes_barrio_id_fkey'
    ) THEN
      ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_barrio_id_fkey
      FOREIGN KEY (barrio_id) REFERENCES public.barrios(id) ON DELETE SET NULL;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'productos'
        AND constraint_name = 'productos_empaque_id_fkey'
    ) THEN
      ALTER TABLE public.productos
      ADD CONSTRAINT productos_empaque_id_fkey
      FOREIGN KEY (empaque_id) REFERENCES public.empaques(id);
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'productos'
        AND constraint_name = 'productos_iva_id_fkey'
    ) THEN
      ALTER TABLE public.productos
      ADD CONSTRAINT productos_iva_id_fkey
      FOREIGN KEY (iva_id) REFERENCES public.tipos_iva(id) ON DELETE SET NULL;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'ventas'
        AND constraint_name = 'ventas_estado_entrega_check'
    ) THEN
      ALTER TABLE public.ventas
      ADD CONSTRAINT ventas_estado_entrega_check
      CHECK (estado_entrega IN ('pendiente', 'entregado', 'cancelado'));
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'ventas'
        AND constraint_name = 'ventas_medio_pago_check'
    ) THEN
      ALTER TABLE public.ventas
      ADD CONSTRAINT ventas_medio_pago_check
      CHECK (medio_pago IN ('efectivo', 'debito', 'credito', 'transferencia'));
    END IF;
  END $$;
  `,
  `
  CREATE TABLE IF NOT EXISTS public.venta_detalle (
    id serial PRIMARY KEY,
    venta_id integer NOT NULL,
    producto_id integer NOT NULL,
    cantidad integer NOT NULL,
    precio_unitario numeric(12,2) NOT NULL,
    packs integer NULL,
    unidades_sueltas integer NULL,
    unidades_por_empaque integer NULL,
    tipo_empaque varchar(50) NULL,
    precio_empaque numeric(12,4) NULL,
    precio_unidad numeric(12,4) NULL,
    modo_venta varchar(10) NOT NULL DEFAULT 'unidad',
    descuento_tipo varchar(20) NOT NULL DEFAULT 'ninguno',
    descuento_valor numeric(12,2) NOT NULL DEFAULT 0,
    descuento_aplicado numeric(12,2) NOT NULL DEFAULT 0,
    descuento_packs_tipo varchar(20) NOT NULL DEFAULT 'ninguno',
    descuento_packs_valor numeric(12,2) NOT NULL DEFAULT 0,
    descuento_packs_aplicado numeric(12,2) NOT NULL DEFAULT 0
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_venta_detalle_venta ON public.venta_detalle (venta_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_venta_detalle_producto ON public.venta_detalle (producto_id);
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'venta_detalle'
        AND constraint_name = 'venta_detalle_venta_id_fkey'
    ) THEN
      ALTER TABLE public.venta_detalle
      ADD CONSTRAINT venta_detalle_venta_id_fkey
      FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'venta_detalle'
        AND constraint_name = 'venta_detalle_producto_id_fkey'
    ) THEN
      ALTER TABLE public.venta_detalle
      ADD CONSTRAINT venta_detalle_producto_id_fkey
      FOREIGN KEY (producto_id) REFERENCES public.productos(id);
    END IF;
  END $$;
  `,
  `
  CREATE TABLE IF NOT EXISTS public.auditoria_eventos (
    id bigserial PRIMARY KEY,
    entidad varchar(30) NOT NULL,
    entidad_id integer NULL,
    accion varchar(40) NOT NULL,
    detalle text NULL,
    usuario_id integer NULL,
    usuario_nombre varchar(120) NULL,
    created_at timestamp without time zone NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_auditoria_created_at ON public.auditoria_eventos (created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS public.movimientos_stock (
    id bigserial PRIMARY KEY,
    producto_id integer NOT NULL,
    producto_nombre varchar(180) NULL,
    tipo varchar(20) NOT NULL,
    origen varchar(30) NOT NULL,
    cantidad numeric(12,2) NOT NULL,
    stock_anterior numeric(12,2) NULL,
    stock_nuevo numeric(12,2) NULL,
    referencia_tipo varchar(30) NULL,
    referencia_id integer NULL,
    detalle text NULL,
    usuario_id integer NULL,
    usuario_nombre varchar(120) NULL,
    created_at timestamp without time zone NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_movimientos_stock_created_at ON public.movimientos_stock (created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_movimientos_stock_producto ON public.movimientos_stock (producto_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS public.pagos (
    id bigserial PRIMARY KEY,
    venta_id integer NOT NULL,
    medio_pago varchar(20) NOT NULL,
    monto numeric(12,2) NOT NULL,
    created_at timestamp without time zone NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    id bigserial PRIMARY KEY,
    usuario_id integer NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean NOT NULL DEFAULT false,
    created_at timestamp without time zone NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_usuario ON public.password_reset_tokens (usuario_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_expires ON public.password_reset_tokens (expires_at);
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ux_password_reset_tokens_hash ON public.password_reset_tokens (token_hash);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_pagos_venta ON public.pagos (venta_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS ix_pagos_created_at ON public.pagos (created_at DESC);
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'pagos'
        AND constraint_name = 'pagos_venta_id_fkey'
    ) THEN
      ALTER TABLE public.pagos
      ADD CONSTRAINT pagos_venta_id_fkey
      FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'pagos'
        AND constraint_name = 'pagos_medio_pago_check'
    ) THEN
      ALTER TABLE public.pagos
      ADD CONSTRAINT pagos_medio_pago_check
      CHECK (medio_pago IN ('efectivo', 'debito', 'credito', 'transferencia'));
    END IF;
  END $$;
  `,
  `
  UPDATE public.ventas
  SET
    estado_entrega = CASE
      WHEN entregado IS TRUE THEN 'entregado'
      WHEN COALESCE(NULLIF(TRIM(LOWER(estado_entrega)), ''), 'pendiente') = 'entregado' THEN 'entregado'
      ELSE 'pendiente'
    END,
    medio_pago = CASE
      WHEN COALESCE(NULLIF(TRIM(LOWER(medio_pago)), ''), 'efectivo') IN ('efectivo', 'debito', 'credito', 'transferencia')
        THEN COALESCE(NULLIF(TRIM(LOWER(medio_pago)), ''), 'efectivo')
      ELSE 'efectivo'
    END
  WHERE estado_entrega IS NULL
     OR estado_entrega = ''
     OR LOWER(TRIM(COALESCE(estado_entrega, ''))) NOT IN ('pendiente', 'entregado', 'cancelado')
     OR entregado IS TRUE
     OR medio_pago IS NULL
     OR TRIM(medio_pago) = ''
     OR LOWER(TRIM(medio_pago)) NOT IN ('efectivo', 'debito', 'credito', 'transferencia');
  `,
  // === CONFIGURACIÓN DE EMPRESA ===
  `
  CREATE TABLE IF NOT EXISTS public.config_empresa (
    id serial PRIMARY KEY,
    nombre varchar(180) NOT NULL DEFAULT 'Mi Empresa',
    razon_social varchar(180) NULL,
    rut varchar(80) NULL,
    direccion text NULL,
    telefono varchar(50) NULL,
    correo varchar(180) NULL,
    website varchar(255) NULL,
    giro varchar(180) NULL,
    ciudad varchar(100) NULL,
    departamento varchar(100) NULL,
    logo_base64 text NULL,
    color_primary varchar(7) NOT NULL DEFAULT '#cc2222',
    color_primary_strong varchar(7) NOT NULL DEFAULT '#8f0e0e',
    color_primary_soft varchar(7) NOT NULL DEFAULT '#fce8e8',
    color_menu_bg varchar(7) NOT NULL DEFAULT '#3d1a08',
    color_menu_active varchar(7) NOT NULL DEFAULT '#cc2222',
    color_text varchar(7) DEFAULT '#1d2b3e',
    color_text_muted varchar(7) DEFAULT '#526278',
    color_menu_text varchar(7) DEFAULT '#f5e6e6',
    fondo_base64 text NULL,
    configurado boolean NOT NULL DEFAULT false,
    color_logout_bg varchar(7) DEFAULT '#d32f2f',
    fondo_opacidad decimal(3,2) DEFAULT 0.06,
    logo_tamano smallint DEFAULT 200,
    logo_bg_color varchar(7) DEFAULT '#ffffff',
    pdf_factura jsonb NOT NULL DEFAULT '{}'::jsonb,
    pdf_remito jsonb NOT NULL DEFAULT '{}'::jsonb,
    cfe_ambiente varchar(20) NOT NULL DEFAULT 'LOCAL',
    cfe_auto_envio boolean NOT NULL DEFAULT true,
    updated_at timestamp without time zone NOT NULL DEFAULT now()
  );
  `,
  `
  INSERT INTO public.config_empresa (nombre)
  SELECT 'Mi Empresa'
  WHERE NOT EXISTS (SELECT 1 FROM public.config_empresa);
  `,
  // === MÓDULOS ===
  `
  CREATE TABLE IF NOT EXISTS public.config_modulos (
    id serial PRIMARY KEY,
    codigo varchar(50) NOT NULL,
    label varchar(80) NOT NULL,
    habilitado boolean NOT NULL DEFAULT true,
    solo_propietario boolean NOT NULL DEFAULT false,
    orden integer NOT NULL DEFAULT 0
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ux_config_modulos_codigo ON public.config_modulos (codigo);
  `,
  `
  INSERT INTO public.config_modulos (codigo, label, habilitado, solo_propietario, orden)
  VALUES
    ('nueva-venta',   'Nueva venta',      true, false, 1),
    ('ventas',        'Ventas',           true, false, 2),
    ('productos',     'Productos',        true, false, 3),
    ('clientes',      'Clientes',         true, false, 4),
    ('usuarios',      'Usuarios',         true, true,  5),
    ('auditoria',     'Auditoría',        true, true,  6),
    ('control-stock', 'Control de stock', true, true,  7),
    ('estadisticas',  'Estadísticas',     true, true,  8),
    ('configuracion', 'Configuración',    true, true,  9)
  ON CONFLICT (codigo) DO NOTHING;
  `,
  // === ROLES Y PERMISOS ===
  `
  CREATE TABLE IF NOT EXISTS public.permisos_rol (
    id serial PRIMARY KEY,
    rol_id integer NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    recurso varchar(80) NOT NULL,
    accion varchar(80) NOT NULL,
    habilitado boolean NOT NULL DEFAULT true,
    UNIQUE(rol_id, recurso, accion)
  );
  `,
  `
  INSERT INTO public.permisos_rol (rol_id, recurso, accion, habilitado)
  SELECT r.id, v.recurso, v.accion, v.habilitado
  FROM public.roles r
  JOIN (VALUES
    ('propietario','nueva-venta','usar',true),
    ('propietario','ventas','ver',true),
    ('propietario','ventas','ver_todas',true),
    ('propietario','ventas','eliminar',true),
    ('propietario','ventas','exportar',true),
    ('propietario','productos','ver',true),
    ('propietario','productos','agregar',true),
    ('propietario','productos','editar',true),
    ('propietario','productos','eliminar',true),
    ('propietario','productos','ver_archivados',true),
    ('propietario','productos','gestionar_empaques',true),
    ('propietario','productos','ver_costo',true),
    ('propietario','productos','ver_ganancia',true),
    ('propietario','productos','exportar',true),
    ('propietario','clientes','ver',true),
    ('propietario','clientes','agregar',true),
    ('propietario','clientes','editar',true),
    ('propietario','clientes','eliminar',true),
    ('propietario','clientes','exportar',true),
    ('propietario','usuarios','ver',true),
    ('propietario','usuarios','agregar',true),
    ('propietario','usuarios','editar',true),
    ('propietario','usuarios','eliminar',true),
    ('propietario','estadisticas','ver',true),
    ('propietario','estadisticas','ver_empresa',true),
    ('propietario','estadisticas','ver_por_usuario',true),
    ('propietario','estadisticas','exportar',true),
    ('propietario','stock','ver',true),
    ('propietario','stock','editar',true),
    ('propietario','auditoria','ver',true),
    ('propietario','auditoria','exportar',true),
    ('propietario','configuracion','ver',true),
    ('vendedor','nueva-venta','usar',true),
    ('vendedor','ventas','ver',true),
    ('vendedor','ventas','ver_todas',false),
    ('vendedor','ventas','eliminar',false),
    ('vendedor','ventas','exportar',false),
    ('vendedor','productos','ver',true),
    ('vendedor','productos','agregar',false),
    ('vendedor','productos','editar',false),
    ('vendedor','productos','eliminar',false),
    ('vendedor','productos','ver_archivados',false),
    ('vendedor','productos','gestionar_empaques',false),
    ('vendedor','productos','ver_costo',false),
    ('vendedor','productos','ver_ganancia',false),
    ('vendedor','productos','exportar',false),
    ('vendedor','clientes','ver',true),
    ('vendedor','clientes','agregar',false),
    ('vendedor','clientes','editar',false),
    ('vendedor','clientes','eliminar',false),
    ('vendedor','clientes','exportar',false),
    ('vendedor','usuarios','ver',false),
    ('vendedor','usuarios','agregar',false),
    ('vendedor','usuarios','editar',false),
    ('vendedor','usuarios','eliminar',false),
    ('vendedor','estadisticas','ver',true),
    ('vendedor','estadisticas','ver_empresa',false),
    ('vendedor','estadisticas','ver_por_usuario',false),
    ('vendedor','estadisticas','exportar',false),
    ('vendedor','stock','ver',false),
    ('vendedor','stock','editar',false),
    ('vendedor','auditoria','ver',false),
    ('vendedor','auditoria','exportar',false),
    ('vendedor','configuracion','ver',false)
  ) AS v(rol_nombre, recurso, accion, habilitado) ON r.nombre = v.rol_nombre
  ON CONFLICT (rol_id, recurso, accion) DO NOTHING;
  `,
  // === MÉTODOS DE CÁLCULO DE GANANCIAS ===
  `
  CREATE TABLE IF NOT EXISTS public.config_ganancias_metodos (
    id serial PRIMARY KEY,
    codigo varchar(50) NOT NULL,
    label varchar(120) NOT NULL,
    descripcion text NULL,
    activo boolean NOT NULL DEFAULT true
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ux_config_ganancias_metodos_codigo ON public.config_ganancias_metodos (codigo);
  `,
  `
  INSERT INTO public.config_ganancias_metodos (codigo, label, descripcion)
  VALUES
    ('margen_venta', 'Margen por venta',
     'Ganancia = Σ (precio_unitario_venta − costo_producto) × cantidad. Por cada ítem vendido se descuenta el costo del producto.'),
    ('flujo_caja',   'Flujo de caja',
     'Ganancia = Σ total_ventas − Σ (costo × cantidad de entradas de stock). Cada entrada de stock resta su costo total; cada venta suma su total completo.')
  ON CONFLICT (codigo) DO NOTHING;
  `,
  // === CONFIGURACIÓN ACTIVA DE GANANCIAS ===
  `
  CREATE TABLE IF NOT EXISTS public.config_ganancias (
    id serial PRIMARY KEY,
    metodo_id integer NOT NULL REFERENCES public.config_ganancias_metodos(id),
    updated_at timestamp without time zone NOT NULL DEFAULT now()
  );
  `,
  `
  INSERT INTO public.config_ganancias (metodo_id)
  SELECT id FROM public.config_ganancias_metodos WHERE codigo = 'margen_venta'
  AND NOT EXISTS (SELECT 1 FROM public.config_ganancias)
  LIMIT 1;
  `,
  // === DASHBOARD WIDGETS PERSONALIZADOS POR USUARIO ===
  `
  CREATE TABLE IF NOT EXISTS public.dashboard_widgets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id integer NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    posicion smallint NOT NULL DEFAULT 0,
    categoria varchar(30) NOT NULL,
    tipo varchar(20) NOT NULL,
    metrica varchar(30) NOT NULL,
    rango varchar(20),
    periodo_comparacion varchar(20),
    etiqueta varchar(60) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_usuario ON public.dashboard_widgets(usuario_id);
  `,
  // === SEED DEPARTAMENTOS URUGUAY ===
  `
  INSERT INTO public.departamentos (id, nombre) OVERRIDING SYSTEM VALUE
  VALUES
    (1, 'Artigas'),
    (2, 'Salto'),
    (3, 'Rivera'),
    (4, 'Rio Negro'),
    (5, 'Tacuarembo'),
    (6, 'Soriano'),
    (7, 'Flores'),
    (8, 'Florida'),
    (9, 'Treinta y Tres'),
    (10, 'Montevideo'),
    (11, 'Maldonado'),
    (12, 'San Jose'),
    (13, 'Canelones'),
    (14, 'Lavalleja'),
    (15, 'Rocha'),
    (16, 'Paysandu'),
    (17, 'Cerro Largo'),
    (18, 'Colonia'),
    (19, 'Durazno')
  ON CONFLICT DO NOTHING;
  `,
  // === SEED BARRIOS/LOCALIDADES URUGUAY ===
  `CREATE EXTENSION IF NOT EXISTS unaccent;`,
  // Elimina duplicados antes de crear el índice único (puede haber datos de corridas anteriores)
  `
  DELETE FROM public.barrios a
  USING public.barrios b
  WHERE a.id > b.id
    AND a.nombre = b.nombre
    AND a.departamento_id = b.departamento_id;
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_barrios_nombre_departamento ON public.barrios (nombre, departamento_id);`,
  barriosSeedSql,
];

try {
  for (const sql of statements.filter(Boolean)) {
    await query(sql);
  }
  // eslint-disable-next-line no-console
  console.log('Schema bootstrap aplicado correctamente.');
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('Error aplicando schema bootstrap:', error.message);
  process.exit(1);
}

