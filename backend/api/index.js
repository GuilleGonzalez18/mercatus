// Entrypoint serverless para Vercel.
// Reutiliza la misma app Express, sin app.listen (Vercel invoca la función).
import app from '../src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
