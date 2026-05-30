import { Router } from 'express';
import { query } from '../db.js';
import { getAuthUserFromRequest, requireAuth, requirePermission } from '../auth.js';
import { sendDbError } from '../dbErrors.js';
import {
  firstError, respondIfInvalid,
  validateEmail, validateRequired, validateMaxLength, validateEnum,
} from '../middleware/validate.js';

const TIPOS_DOCUMENTO = ['RUT', 'CI', 'PASAPORTE', 'DNI', 'OTRO'];


export const clientesRouter = Router();
clientesRouter.use(requireAuth);

function normalizeHora(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toMinutes(hora) {
  if (!hora) return null;
  const [h, m] = String(hora).split(':').map((v) => Number(v));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return (h * 60) + m;
}

function normalizeHorariosPayload(payload = {}) {
  const horario_apertura = normalizeHora(payload.horario_apertura);
  const horario_cierre = normalizeHora(payload.horario_cierre);
  const tiene_reapertura = Boolean(payload.tiene_reapertura);
  let horario_reapertura = normalizeHora(payload.horario_reapertura);
  let horario_cierre_reapertura = normalizeHora(payload.horario_cierre_reapertura);

  if ((payload.horario_apertura && !horario_apertura) || (payload.horario_cierre && !horario_cierre)) {
    return { error: 'Formato de horario principal inválido. Usa HH:MM' };
  }

  if (!tiene_reapertura) {
    horario_reapertura = null;
    horario_cierre_reapertura = null;
  } else {
    if (!horario_apertura || !horario_cierre) {
      return { error: 'Si el cliente tiene reapertura, también debes completar apertura y cierre principal' };
    }
    if (!horario_reapertura || !horario_cierre_reapertura) {
      return { error: 'Si el cliente tiene reapertura debes completar ambos horarios de reapertura' };
    }
  }

  return {
    horario_apertura,
    horario_cierre,
    tiene_reapertura,
    horario_reapertura,
    horario_cierre_reapertura,
  };
}

function actorName(authUser) {
  const full = `${authUser?.nombre || ''} ${authUser?.apellido || ''}`.trim();
  return full || authUser?.username || authUser?.correo || null;
}

clientesRouter.get('/stats', requirePermission('clientes', 'ver'), async (_req, res) => {
  const [totalQ, depClientesQ, depVentasQ] = await Promise.all([
    query(`SELECT COUNT(*) AS total FROM public.clientes WHERE eliminado = false`),
    query(`
      SELECT d.nombre
      FROM public.clientes c
      JOIN public.departamentos d ON d.id = c.departamento_id
      WHERE c.eliminado = false AND c.departamento_id IS NOT NULL
      GROUP BY d.id, d.nombre
      ORDER BY COUNT(c.id) DESC
      LIMIT 1
    `),
    query(`
      SELECT d.nombre
      FROM public.ventas v
      JOIN public.clientes c ON c.id = v.cliente_id
      JOIN public.departamentos d ON d.id = c.departamento_id
      WHERE v.cancelada = false AND COALESCE(v.eliminada, false) = false
        AND c.eliminado = false AND c.departamento_id IS NOT NULL
      GROUP BY d.id, d.nombre
      ORDER BY SUM(v.total) DESC
      LIMIT 1
    `),
  ]);
  res.json({
    total_clientes: Number(totalQ.rows[0]?.total ?? 0),
    dep_mas_clientes: depClientesQ.rows[0]?.nombre ?? null,
    dep_mas_ventas: depVentasQ.rows[0]?.nombre ?? null,
  });
});

clientesRouter.get('/', requirePermission('clientes', 'ver'), async (_req, res) => {
  const result = await query(
    `SELECT c.id, c.nombre, c.rut, c.direccion, c.telefono, c.correo,
            c.horario_apertura, c.horario_cierre,
            c.tiene_reapertura, c.horario_reapertura, c.horario_cierre_reapertura,
            c.departamento_id, c.barrio_id,
            d.nombre AS departamento_nombre,
            b.nombre AS barrio_nombre,
            c.tipo_documento, c.numero_documento, c.ciudad, c.codigo_postal
     FROM public.clientes c
     LEFT JOIN public.departamentos d ON d.id = c.departamento_id
     LEFT JOIN public.barrios b ON b.id = c.barrio_id
     WHERE c.eliminado = false
     ORDER BY c.id DESC`
  );
  res.json(result.rows);
});

clientesRouter.post('/', requirePermission('clientes', 'agregar'), async (req, res) => {
  const {
    nombre,
    rut,
    direccion = null,
    telefono = null,
    correo = null,
    horario_apertura = null,
    horario_cierre = null,
    tiene_reapertura = false,
    horario_reapertura = null,
    horario_cierre_reapertura = null,
    departamento_id = null,
    barrio_id = null,
    tipo_documento = null,
    numero_documento = null,
    ciudad = null,
    codigo_postal = null,
  } = req.body;
  const authUser = getAuthUserFromRequest(req);

  const validationErrPost = firstError(
    validateRequired(nombre, 'Nombre'),
    validateMaxLength(nombre, 255, 'Nombre'),
    validateMaxLength(rut, 50, 'RUT'),
    validateMaxLength(telefono, 50, 'Teléfono'),
    validateMaxLength(correo, 100, 'Correo'),
    correo ? (!validateEmail(correo) ? 'El correo no tiene un formato válido' : null) : null,
    validateMaxLength(direccion, 500, 'Dirección'),
    validateMaxLength(ciudad, 100, 'Ciudad'),
    validateMaxLength(codigo_postal, 20, 'Código postal'),
    validateMaxLength(numero_documento, 50, 'Número de documento'),
    validateEnum(tipo_documento, TIPOS_DOCUMENTO, 'Tipo de documento'),
  );
  if (respondIfInvalid(res, validationErrPost)) return;

  const horarios = normalizeHorariosPayload({
    horario_apertura,
    horario_cierre,
    tiene_reapertura,
    horario_reapertura,
    horario_cierre_reapertura,
  });
  if (horarios?.error) return res.status(400).json({ error: horarios.error });

  // Verificar si existe un cliente eliminado con el mismo tipo+número de documento
  if (tipo_documento && numero_documento) {
    const eliminadoQ = await query(
      `SELECT id, nombre FROM public.clientes
       WHERE eliminado = true
         AND tipo_documento = $1
         AND numero_documento = $2
       LIMIT 1`,
      [tipo_documento, numero_documento]
    );
    if (eliminadoQ.rows.length > 0) {
      return res.status(409).json({
        error: 'CLIENTE_ELIMINADO',
        cliente: { id: eliminadoQ.rows[0].id, nombre: eliminadoQ.rows[0].nombre },
      });
    }
  }

  try {
    const result = await query(
      `INSERT INTO public.clientes
        (nombre, rut, direccion, telefono, correo, horario_apertura, horario_cierre, tiene_reapertura, horario_reapertura, horario_cierre_reapertura, departamento_id, barrio_id, tipo_documento, numero_documento, ciudad, codigo_postal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, nombre, rut, direccion, telefono, correo, horario_apertura, horario_cierre,
                 tiene_reapertura, horario_reapertura, horario_cierre_reapertura,
                 departamento_id, barrio_id, tipo_documento, numero_documento, ciudad, codigo_postal`,
      [
        nombre,
        rut,
        direccion,
        telefono,
        correo,
        horarios.horario_apertura,
        horarios.horario_cierre,
        horarios.tiene_reapertura,
        horarios.horario_reapertura,
        horarios.horario_cierre_reapertura,
        departamento_id,
        barrio_id,
        tipo_documento || null,
        numero_documento || null,
        ciudad || null,
        codigo_postal || null,
      ]
    );
    await query(
      `INSERT INTO public.auditoria_eventos (entidad, entidad_id, accion, detalle, usuario_id, usuario_nombre)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        'cliente',
        result.rows[0].id,
        'crear',
        `Cliente creado: ${result.rows[0].nombre}`,
        authUser?.id || null,
        actorName(authUser),
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return sendDbError(res, error, 'No se pudo crear el cliente');
  }
});

clientesRouter.put('/:id', requirePermission('clientes', 'editar'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID de cliente inválido' });

  const {
    nombre,
    rut,
    direccion = null,
    telefono = null,
    correo = null,
    horario_apertura = null,
    horario_cierre = null,
    tiene_reapertura = false,
    horario_reapertura = null,
    horario_cierre_reapertura = null,
    departamento_id = null,
    barrio_id = null,
    tipo_documento = null,
    numero_documento = null,
    ciudad = null,
    codigo_postal = null,
  } = req.body;
  const authUser = getAuthUserFromRequest(req);

  const validationErrPut = firstError(
    validateRequired(nombre, 'Nombre'),
    validateMaxLength(nombre, 255, 'Nombre'),
    validateMaxLength(rut, 50, 'RUT'),
    validateMaxLength(telefono, 50, 'Teléfono'),
    validateMaxLength(correo, 100, 'Correo'),
    correo ? (!validateEmail(correo) ? 'El correo no tiene un formato válido' : null) : null,
    validateMaxLength(direccion, 500, 'Dirección'),
    validateMaxLength(ciudad, 100, 'Ciudad'),
    validateMaxLength(codigo_postal, 20, 'Código postal'),
    validateMaxLength(numero_documento, 50, 'Número de documento'),
    validateEnum(tipo_documento, TIPOS_DOCUMENTO, 'Tipo de documento'),
  );
  if (respondIfInvalid(res, validationErrPut)) return;

  const horarios = normalizeHorariosPayload({
    horario_apertura,
    horario_cierre,
    tiene_reapertura,
    horario_reapertura,
    horario_cierre_reapertura,
  });
  if (horarios?.error) return res.status(400).json({ error: horarios.error });

  try {
    const result = await query(
      `UPDATE public.clientes
       SET nombre = $1,
           rut = $2,
           direccion = $3,
           telefono = $4,
           correo = $5,
           horario_apertura = $6,
           horario_cierre = $7,
           tiene_reapertura = $8,
           horario_reapertura = $9,
           horario_cierre_reapertura = $10,
           departamento_id = $11,
           barrio_id = $12,
           tipo_documento = $13,
           numero_documento = $14,
           ciudad = $15,
           codigo_postal = $16
       WHERE id = $17
       RETURNING id, nombre, rut, direccion, telefono, correo, horario_apertura, horario_cierre,
                 tiene_reapertura, horario_reapertura, horario_cierre_reapertura,
                 departamento_id, barrio_id, tipo_documento, numero_documento, ciudad, codigo_postal`,
      [
        nombre,
        rut,
        direccion,
        telefono,
        correo,
        horarios.horario_apertura,
        horarios.horario_cierre,
        horarios.tiene_reapertura,
        horarios.horario_reapertura,
        horarios.horario_cierre_reapertura,
        departamento_id,
        barrio_id,
        tipo_documento || null,
        numero_documento || null,
        ciudad || null,
        codigo_postal || null,
        id,
      ]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Cliente no encontrado' });
    await query(
      `INSERT INTO public.auditoria_eventos (entidad, entidad_id, accion, detalle, usuario_id, usuario_nombre)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        'cliente',
        id,
        'editar',
        `Cliente editado: ${result.rows[0].nombre}`,
        authUser?.id || null,
        actorName(authUser),
      ]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    return sendDbError(res, error, 'No se pudo actualizar el cliente');
  }
});

clientesRouter.delete('/:id', requirePermission('clientes', 'eliminar'), async (req, res) => {
  const id = Number(req.params.id);
  const authUser = getAuthUserFromRequest(req);
  const prev = await query(`SELECT id, nombre FROM public.clientes WHERE id = $1 AND eliminado = false`, [id]);
  if (!prev.rowCount) return res.status(404).json({ error: 'Cliente no encontrado' });
  const result = await query(`UPDATE public.clientes SET eliminado = true WHERE id = $1`, [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Cliente no encontrado' });
  const nombre = prev.rows[0]?.nombre || `#${id}`;
  await query(
    `INSERT INTO public.auditoria_eventos (entidad, entidad_id, accion, detalle, usuario_id, usuario_nombre)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      'cliente',
      id,
      'eliminar',
      `Cliente eliminado (soft): ${nombre}`,
      authUser?.id || null,
      actorName(authUser),
    ]
  );
  return res.status(204).send();
});

clientesRouter.post('/:id/restaurar', requirePermission('clientes', 'agregar'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID de cliente inválido' });
  const authUser = getAuthUserFromRequest(req);
  const result = await query(
    `UPDATE public.clientes SET eliminado = false WHERE id = $1 AND eliminado = true
     RETURNING id, nombre, rut, direccion, telefono, correo, horario_apertura, horario_cierre,
               tiene_reapertura, horario_reapertura, horario_cierre_reapertura,
               departamento_id, barrio_id, tipo_documento, numero_documento, ciudad, codigo_postal`,
    [id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Cliente eliminado no encontrado' });
  await query(
    `INSERT INTO public.auditoria_eventos (entidad, entidad_id, accion, detalle, usuario_id, usuario_nombre)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['cliente', id, 'restaurar', `Cliente restaurado: ${result.rows[0].nombre}`, authUser?.id || null, actorName(authUser)]
  );
  return res.json(result.rows[0]);
});
