import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requirePermission } from '../auth.js';
import { sendServerError } from '../dbErrors.js';

export const flujoStockRouter = Router();
flujoStockRouter.use(requireAuth);

/**
 * GET /api/flujo-stock/:productoId
 *
 * Devuelve el flujo de stock (unidades vendidas) de un producto en tres ventanas:
 *  - semana: serie diaria de los últimos 7 días.
 *  - mes:    serie diaria de los últimos 30 días.
 *  - anio:   serie mensual de los últimos 12 meses + promedio mensual.
 *
 * Unidades = SUM(venta_detalle.cantidad). Se usa ventas.fecha y se excluyen
 * ventas canceladas o eliminadas.
 */
/**
 * GET /api/flujo-stock
 *
 * Resumen global: lista de todos los productos activos con sus unidades vendidas
 * en la última semana, el último mes y el promedio mensual del último año.
 * Pensado para exportar (PDF / Excel) en una sola consulta.
 */
flujoStockRouter.get('/', requirePermission('flujo-stock', 'ver'), async (_req, res) => {
  try {
    const result = await query(
      `SELECT p.id,
              p.nombre,
              p.unidad,
              COALESCE(SUM(vd.cantidad) FILTER (WHERE v.fecha >= (CURRENT_DATE - INTERVAL '6 days')), 0)::int AS semana,
              COALESCE(SUM(vd.cantidad) FILTER (WHERE v.fecha >= (CURRENT_DATE - INTERVAL '29 days')), 0)::int AS mes,
              COALESCE(SUM(vd.cantidad) FILTER (WHERE v.fecha >= (date_trunc('month', CURRENT_DATE) - INTERVAL '11 months')), 0)::int AS anio
       FROM public.productos p
       LEFT JOIN public.venta_detalle vd ON vd.producto_id = p.id
       LEFT JOIN public.ventas v ON v.id = vd.venta_id
         AND v.cancelada = false
         AND v.eliminada = false
       WHERE p.activo = true
       GROUP BY p.id, p.nombre, p.unidad
       ORDER BY p.nombre ASC`
    );

    const items = result.rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      unidad: r.unidad || 'u.',
      semana: Number(r.semana || 0),
      mes: Number(r.mes || 0),
      promedioMensual: Math.round((Number(r.anio || 0) / 12) * 100) / 100,
    }));

    return res.json({ items });
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudo obtener el resumen de flujo de stock',
      context: 'flujoStock.getResumen',
    });
  }
});

flujoStockRouter.get('/:productoId', requirePermission('flujo-stock', 'ver'), async (req, res) => {
  const productoId = Number(req.params.productoId);
  if (!Number.isInteger(productoId) || productoId <= 0) {
    return res.status(400).json({ error: 'Producto inválido' });
  }

  try {
    const productoQ = await query(
      'SELECT id, nombre, unidad FROM public.productos WHERE id = $1',
      [productoId]
    );
    if (!productoQ.rowCount) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Serie diaria de los últimos 30 días (cubre también la ventana de 7 días).
    // generate_series arma la "columna vertebral" de fechas para rellenar días sin ventas con 0.
    const diariaQ = await query(
      `WITH dias AS (
         SELECT generate_series(
           (CURRENT_DATE - INTERVAL '29 days')::date,
           CURRENT_DATE::date,
           INTERVAL '1 day'
         )::date AS dia
       ),
       ventas_dia AS (
         SELECT v.fecha::date AS dia, COALESCE(SUM(vd.cantidad), 0)::int AS unidades
         FROM public.venta_detalle vd
         JOIN public.ventas v ON v.id = vd.venta_id
         WHERE vd.producto_id = $1
           AND v.cancelada = false
           AND v.eliminada = false
           AND v.fecha >= (CURRENT_DATE - INTERVAL '29 days')
         GROUP BY v.fecha::date
       )
       SELECT to_char(d.dia, 'YYYY-MM-DD') AS fecha,
              COALESCE(vd.unidades, 0)::int AS unidades
       FROM dias d
       LEFT JOIN ventas_dia vd ON vd.dia = d.dia
       ORDER BY d.dia ASC`,
      [productoId]
    );

    // Serie mensual de los últimos 12 meses.
    const mensualQ = await query(
      `WITH meses AS (
         SELECT generate_series(
           date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
           date_trunc('month', CURRENT_DATE),
           INTERVAL '1 month'
         )::date AS mes
       ),
       ventas_mes AS (
         SELECT date_trunc('month', v.fecha)::date AS mes, COALESCE(SUM(vd.cantidad), 0)::int AS unidades
         FROM public.venta_detalle vd
         JOIN public.ventas v ON v.id = vd.venta_id
         WHERE vd.producto_id = $1
           AND v.cancelada = false
           AND v.eliminada = false
           AND v.fecha >= (date_trunc('month', CURRENT_DATE) - INTERVAL '11 months')
         GROUP BY date_trunc('month', v.fecha)
       )
       SELECT to_char(m.mes, 'YYYY-MM') AS mes,
              COALESCE(vm.unidades, 0)::int AS unidades
       FROM meses m
       LEFT JOIN ventas_mes vm ON vm.mes = m.mes
       ORDER BY m.mes ASC`,
      [productoId]
    );

    const serieDiaria = diariaQ.rows.map((r) => ({ fecha: r.fecha, unidades: Number(r.unidades || 0) }));
    const serieMensual = mensualQ.rows.map((r) => ({ mes: r.mes, unidades: Number(r.unidades || 0) }));

    // Ventana de 7 días = últimos 7 puntos de la serie diaria.
    const serieSemana = serieDiaria.slice(-7);

    const semanaTotal = serieSemana.reduce((acc, r) => acc + r.unidades, 0);
    const mesTotal = serieDiaria.reduce((acc, r) => acc + r.unidades, 0);
    const anioTotal = serieMensual.reduce((acc, r) => acc + r.unidades, 0);
    const promedioMensual = serieMensual.length ? anioTotal / serieMensual.length : 0;

    return res.json({
      producto: productoQ.rows[0],
      semana: { total: semanaTotal, serie: serieSemana },
      mes: { total: mesTotal, serie: serieDiaria },
      anio: {
        promedioMensual: Math.round(promedioMensual * 100) / 100,
        total: anioTotal,
        serie: serieMensual,
      },
    });
  } catch (err) {
    return sendServerError(res, err, {
      fallback: 'No se pudo obtener el flujo de stock del producto',
      context: 'flujoStock.getByProducto',
    });
  }
});
