import { query } from '../db.js';

/**
 * Elimina registros de auditoría y movimientos de stock anteriores al período
 * de retención configurado. Se invoca al iniciar el servidor de forma no-bloqueante.
 *
 * Variable de entorno: AUDIT_RETENTION_DAYS (default: 90)
 */
export async function pruneAuditoria() {
  const raw = process.env.AUDIT_RETENTION_DAYS;
  const days = parseInt(raw ?? '90', 10);

  if (!Number.isFinite(days) || days <= 0) {
    // eslint-disable-next-line no-console
    console.log('[auditoria:purge] Purga omitida: AUDIT_RETENTION_DAYS no es un número positivo válido.');
    return;
  }

  try {
    const [evResult, movResult] = await Promise.all([
      query(
        `DELETE FROM public.auditoria_eventos WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
        [days],
      ),
      query(
        `DELETE FROM public.movimientos_stock WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
        [days],
      ),
    ]);
    const evCount = evResult.rowCount ?? 0;
    const movCount = movResult.rowCount ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `[auditoria:purge] Retención: ${days} días. Eliminados: ${evCount} eventos, ${movCount} movimientos.`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auditoria:purge] Error al purgar registros de auditoría:', err?.message ?? err);
  }
}
