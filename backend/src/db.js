import './config.js';
import pg from 'pg';

const { Pool } = pg;
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.PGTZ || 'America/Montevideo';

// Devolver columnas DATE (OID 1082) como strings "YYYY-MM-DD" en vez de objetos Date.
// Sin esto el driver las convierte a medianoche UTC y el frontend
// muestra un día menos en zonas UTC-X.
pg.types.setTypeParser(1082, (val) => val);

// Mismo problema con TIMESTAMP WITHOUT TIME ZONE (OID 1114):
// fecha_entrega en ventas está definida como este tipo.
pg.types.setTypeParser(1114, (val) => val);

export const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || 'mercatus_db',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
});

pool.on('connect', async (client) => {
  try {
    await client.query(`SET TIME ZONE '${APP_TIMEZONE.replace(/'/g, "''")}'`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[db] No se pudo establecer zona horaria de sesión (${APP_TIMEZONE}):`, error.message);
  }
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
