import './config.js';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { sendServerError } from './dbErrors.js';
import { productosRouter } from './routes/productos.js';
import { clientesRouter } from './routes/clientes.js';
import { usuariosRouter } from './routes/usuarios.js';
import { ventasRouter } from './routes/ventas.js';
import { auditoriaRouter } from './routes/auditoria.js';
import { empaquesRouter } from './routes/empaques.js';
import { tiposIvaRouter } from './routes/tipos-iva.js';
import { configuracionRouter } from './routes/configuracion.js';
import { permisosRouter } from './routes/permisos.js';
import { ubicacionesRouter } from './routes/ubicaciones.js';
import { uploadsRouter } from './routes/uploads.js';
import { flujoStockRouter } from './routes/flujo-stock.js';

const corsOrigin = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '';

function normalizeOrigin(value) {
  return String(value || '')
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\/+$/, '');
}

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

export const allowedOrigins = corsOrigin
  .split(',')
  .map((value) => normalizeOrigin(value))
  .filter(Boolean);

export const app = express();

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.length) return callback(null, false);
    const requestOrigin = normalizeOrigin(origin);
    const isAllowed = allowedOrigins.some((rule) => {
      if (!rule.includes('*')) return rule === requestOrigin;
      return wildcardToRegex(rule).test(requestOrigin);
    });
    return callback(null, isAllowed);
  },
}));
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true });
  } catch (error) {
    return sendServerError(res, error, {
      status: 503,
      fallback: 'Servicio no disponible',
      context: 'health',
    });
  }
});

app.use('/api/productos', productosRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/ventas', ventasRouter);
app.use('/api/auditoria', auditoriaRouter);
app.use('/api/empaques', empaquesRouter);
app.use('/api/tipos-iva', tiposIvaRouter);
app.use('/api/configuracion', configuracionRouter);
app.use('/api/permisos', permisosRouter);
app.use('/api/ubicaciones', ubicacionesRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/flujo-stock', flujoStockRouter);

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  return sendServerError(res, error, {
    fallback: 'Error interno del servidor',
    context: 'express',
  });
});
