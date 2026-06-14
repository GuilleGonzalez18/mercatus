import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requirePropietario } from '../auth.js';
import { sendServerError } from '../dbErrors.js';
import {
  firstError, respondIfInvalid,
  validateMaxLength, validateHexColor, validateNumber, validateBase64Size,
  validateEnum,
} from '../middleware/validate.js';

const BASE64_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const configuracionRouter = Router();

// ── EMPRESA ──────────────────────────────────────────────────────────────────

configuracionRouter.get('/empresa', async (req, res) => {
  try {
    const result = await query(
      'SELECT *, pdf_factura, pdf_remito FROM public.config_empresa LIMIT 1'
    );
    const empresa = result.rows[0] ?? {};
    res.json({
      ...empresa,
      cfe_habilitado: process.env.CFE_HABILITADO === 'true',
    });
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudo obtener la configuración de la empresa',
      context: 'configuracion.getEmpresa',
    });
  }
});

configuracionRouter.put('/empresa', requireAuth, requirePropietario, async (req, res) => {
  const {
    nombre, razon_social, rut, direccion, telefono, correo, website,
    giro, ciudad, departamento,
    logo_base64, fondo_base64,
    color_primary, color_primary_strong, color_primary_soft,
    color_menu_bg, color_menu_active,
    color_text, color_text_muted, color_menu_text,
    color_logout_bg,
    fondo_opacidad, logo_tamano, logo_bg_color,
    configurado,
    pdf_factura, pdf_remito,
    cfe_ambiente,
    cfe_auto_envio,
    descarga_automatica_pdf,
  } = req.body;

  const configErr = firstError(
    validateMaxLength(nombre, 255, 'Nombre'),
    validateMaxLength(razon_social, 255, 'Razón social'),
    validateMaxLength(rut, 50, 'RUT'),
    validateMaxLength(giro, 255, 'Giro'),
    validateMaxLength(ciudad, 100, 'Ciudad'),
    validateMaxLength(departamento, 100, 'Departamento'),
    validateMaxLength(telefono, 50, 'Teléfono'),
    validateMaxLength(correo, 100, 'Correo'),
    validateMaxLength(website, 255, 'Website'),
    validateBase64Size(logo_base64, BASE64_MAX_BYTES, 'Logo'),
    validateBase64Size(fondo_base64, BASE64_MAX_BYTES, 'Fondo'),
    validateHexColor(color_primary, 'Color primario'),
    validateHexColor(color_primary_strong, 'Color primario fuerte'),
    validateHexColor(color_primary_soft, 'Color primario suave'),
    validateHexColor(color_menu_bg, 'Color fondo menú'),
    validateHexColor(color_menu_active, 'Color activo menú'),
    validateHexColor(color_text, 'Color texto'),
    validateHexColor(color_text_muted, 'Color texto secundario'),
    validateHexColor(color_menu_text, 'Color texto menú'),
    validateHexColor(color_logout_bg, 'Color botón logout'),
    validateHexColor(logo_bg_color, 'Color fondo logo'),
    validateNumber(fondo_opacidad, 'Opacidad del fondo', { min: 0, max: 1 }),
    validateNumber(logo_tamano, 'Tamaño del logo', { min: 10, max: 300 }),
    cfe_ambiente != null
      ? validateEnum(cfe_ambiente, ['LOCAL', 'PRUEBAS', 'PRODUCCION'], 'Ambiente CFE')
      : null,
  );
  if (respondIfInvalid(res, configErr)) return;

  try {
    const existing = await query('SELECT id FROM public.config_empresa LIMIT 1');
    if (existing.rows.length === 0) {
      await query('INSERT INTO public.config_empresa (nombre) VALUES ($1)', [nombre ?? 'Mi Empresa']);
    }

    const result = await query(
      `UPDATE public.config_empresa SET
        nombre               = COALESCE($1, nombre),
        razon_social         = $2,
        rut                  = $3,
        direccion            = $4,
        telefono             = $5,
        correo               = $6,
        website              = $7,
        giro                 = $8,
        ciudad               = $9,
        departamento         = $10,
        logo_base64          = CASE WHEN $11::text IS NULL THEN logo_base64 WHEN $11::text = '' THEN NULL ELSE $11::text END,
        color_primary        = COALESCE($12::varchar,  color_primary),
        color_primary_strong = COALESCE($13::varchar, color_primary_strong),
        color_primary_soft   = COALESCE($14::varchar, color_primary_soft),
        color_menu_bg        = COALESCE($15::varchar, color_menu_bg),
        color_menu_active    = COALESCE($16::varchar, color_menu_active),
        color_text           = COALESCE($17::varchar, color_text),
        color_text_muted     = COALESCE($18::varchar, color_text_muted),
        color_menu_text      = COALESCE($19::varchar, color_menu_text),
        fondo_base64         = CASE WHEN $20::text IS NULL THEN fondo_base64 WHEN $20::text = '' THEN '__none__' ELSE $20::text END,
        configurado          = CASE WHEN $21::boolean IS TRUE THEN true ELSE configurado END,
        color_logout_bg      = COALESCE($22::varchar, color_logout_bg),
        fondo_opacidad       = COALESCE($23::decimal, fondo_opacidad),
        logo_tamano          = COALESCE($24::smallint, logo_tamano),
        logo_bg_color        = COALESCE($25::varchar, logo_bg_color),
        pdf_factura          = COALESCE($26::jsonb, pdf_factura),
        pdf_remito           = COALESCE($27::jsonb, pdf_remito),
        cfe_ambiente         = COALESCE($28::varchar, cfe_ambiente),
        cfe_auto_envio       = COALESCE($29::boolean, cfe_auto_envio),
        descarga_automatica_pdf = COALESCE($30::boolean, descarga_automatica_pdf),
        updated_at           = now()
      WHERE id = (SELECT id FROM public.config_empresa LIMIT 1)
      RETURNING *`,
      [nombre, razon_social, rut, direccion, telefono, correo, website,
       giro ?? null, ciudad ?? null, departamento ?? null,
       logo_base64 ?? null,
       color_primary, color_primary_strong, color_primary_soft,
       color_menu_bg, color_menu_active,
       color_text, color_text_muted, color_menu_text,
       fondo_base64 === undefined ? null : (fondo_base64 === '' ? '' : (fondo_base64 ?? null)),
       configurado ?? null,
       color_logout_bg ?? null,
       fondo_opacidad ?? null,
       logo_tamano ?? null,
       logo_bg_color ?? null,
       pdf_factura != null ? JSON.stringify(pdf_factura) : null,
       pdf_remito != null ? JSON.stringify(pdf_remito) : null,
       cfe_ambiente ?? null,
       cfe_auto_envio ?? null,
       descarga_automatica_pdf ?? null]
    );
    res.json({
      ...result.rows[0],
      cfe_habilitado: process.env.CFE_HABILITADO === 'true',
    });
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudo actualizar la configuración de la empresa',
      context: 'configuracion.putEmpresa',
    });
  }
});

// ── MÓDULOS ───────────────────────────────────────────────────────────────────

configuracionRouter.get('/modulos', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM public.config_modulos ORDER BY orden ASC'
    );
    res.json(result.rows);
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudieron obtener los módulos',
      context: 'configuracion.getModulos',
    });
  }
});

configuracionRouter.put('/modulos/:codigo', requireAuth, requirePropietario, async (req, res) => {
  const { codigo } = req.params;
  const { habilitado } = req.body;
  if (typeof habilitado !== 'boolean') {
    return res.status(400).json({ error: 'habilitado debe ser boolean' });
  }
  try {
    const result = await query(
      'UPDATE public.config_modulos SET habilitado = $1 WHERE codigo = $2 RETURNING *',
      [habilitado, codigo]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Módulo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudo actualizar el módulo',
      context: 'configuracion.putModulo',
    });
  }
});

// ── GANANCIAS ─────────────────────────────────────────────────────────────────

configuracionRouter.get('/ganancias', requireAuth, async (req, res) => {
  try {
    const metodosRes = await query(
      'SELECT * FROM public.config_ganancias_metodos WHERE activo = true ORDER BY id'
    );
    const configRes = await query(`
      SELECT cg.id, cg.metodo_id, cg.updated_at, m.codigo AS metodo_codigo, m.label AS metodo_label
      FROM public.config_ganancias cg
      JOIN public.config_ganancias_metodos m ON m.id = cg.metodo_id
      LIMIT 1
    `);
    res.json({
      metodos: metodosRes.rows,
      config: configRes.rows[0] ?? null,
    });
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudo obtener la configuración de ganancias',
      context: 'configuracion.getGanancias',
    });
  }
});

configuracionRouter.put('/ganancias', requireAuth, requirePropietario, async (req, res) => {
  const { metodo_id } = req.body;
  if (!metodo_id) return res.status(400).json({ error: 'metodo_id es requerido' });
  try {
    const metodoCheck = await query(
      'SELECT id FROM public.config_ganancias_metodos WHERE id = $1 AND activo = true',
      [metodo_id]
    );
    if (metodoCheck.rows.length === 0) return res.status(400).json({ error: 'Método no válido' });

    const existing = await query('SELECT id FROM public.config_ganancias LIMIT 1');
    let result;
    if (existing.rows.length === 0) {
      result = await query(
        'INSERT INTO public.config_ganancias (metodo_id) VALUES ($1) RETURNING *',
        [metodo_id]
      );
    } else {
      result = await query(
        'UPDATE public.config_ganancias SET metodo_id = $1, updated_at = now() WHERE id = (SELECT id FROM public.config_ganancias LIMIT 1) RETURNING *',
        [metodo_id]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudo actualizar la configuración de ganancias',
      context: 'configuracion.putGanancias',
    });
  }
});
