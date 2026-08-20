import { app, allowedOrigins } from './app.js';
import { runMigration } from './scripts/runMigration.js';
import { pruneAuditoria } from './scripts/pruneAuditoria.js';

const PORT = Number(process.env.PORT || 3001);

app.listen(PORT, async () => {
  console.log(
    `CORS origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'browser origins blocked until CORS_ORIGIN is configured'}`
  );
  try {
    await runMigration();
    // eslint-disable-next-line no-console
    console.log('Migración aplicada correctamente.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error de migración al iniciar:', err);
  }
  pruneAuditoria();
});
