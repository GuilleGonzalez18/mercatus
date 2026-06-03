function resolveApiBase(rawValue) {
  const fallback = 'http://localhost:3001/api';
  const value = String(rawValue || '').trim();
  if (!value) return fallback;

  // If protocol is present, use as-is (trim trailing slash only).
  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\/+$/, '');
  }

  // In Railway/production, users sometimes set host without protocol.
  // Prefer https for public hosts and http for local development hosts.
  const isLocalHost = /^localhost(?::\d+)?(?:\/|$)/i.test(value) || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value);
  const protocol = isLocalHost ? 'http://' : 'https://';
  return `${protocol}${value}`.replace(/\/+$/, '');
}

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL);
const TOKEN_KEY = 'mercatus_auth_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
}

async function request(path, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  const token = getToken();
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // Timeout opcional vía AbortController: si la red/backend no responde a tiempo,
  // se cancela la solicitud automáticamente en vez de quedar colgada para siempre.
  let controller;
  let timeoutId;
  if (timeoutMs) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(fetchOptions.headers || {}),
      },
      ...(controller ? { signal: controller.signal } : {}),
      ...fetchOptions,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('La solicitud tardó demasiado y se canceló automáticamente.');
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    if (error instanceof TypeError) {
      throw new Error('No se pudo conectar con el backend. Valide con RPG Software.');
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let data = null;
    try {
      data = await response.json();
      message = data.error || message;
    } catch {
      // keep default message
    }

    // Token expirado o revocado: limpiar sesión y notificar
    if (response.status === 401 && token) {
      setToken('');
      window.dispatchEvent(new CustomEvent('mercatus:session-expired'));
    }

    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function requestText(path, options = {}) {
  const token = getToken();
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        ...authHeaders,
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('No se pudo conectar con el backend. Valide con RPG Software.');
    }
    throw error;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        message = data.error || message;
      } else {
        const text = await response.text();
        if (text.trim()) message = text.trim();
      }
    } catch {
      // keep default message
    }

    if (response.status === 401 && token) {
      setToken('');
      window.dispatchEvent(new CustomEvent('mercatus:session-expired'));
    }

    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  return response.text();
}

// ── Cache en memoria ──────────────────────────────────────────────────────────
// TTL: datos de referencia (clientes, empaques, roles…) — 2 minutos
const _cache = new Map();    // path → { data, expiresAt }
const _inFlight = new Map(); // path → Promise (deduplicación de llamadas simultáneas)
const _cacheEpoch = new Map(); // path → número de invalidaciones (evita que un GET in-flight pise un PUT posterior)
const CACHE_TTL_MS = 2 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}
function cacheInvalidate(prefix) {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) {
      _cache.delete(key);
      _cacheEpoch.set(key, (_cacheEpoch.get(key) || 0) + 1);
    }
  }
}
function cacheClearAll() { _cache.clear(); _inFlight.clear(); _cacheEpoch.clear(); }

/** GET con caché + deduplicación de requests simultáneos */
function cachedRequest(path) {
  const cached = cacheGet(path);
  if (cached !== null) return Promise.resolve(cached);
  if (_inFlight.has(path)) return _inFlight.get(path);
  const epochAtStart = _cacheEpoch.get(path) || 0;
  const promise = request(path)
    .then(data => {
      // Solo escribe en caché si no hubo invalidación mientras el request estaba en vuelo
      if ((_cacheEpoch.get(path) || 0) === epochAtStart) {
        cacheSet(path, data);
      }
      return data;
    })
    .finally(() => { _inFlight.delete(path); });
  _inFlight.set(path, promise);
  return promise;
}
// ─────────────────────────────────────────────────────────────────────────────

export const api = {
  setAuthToken: (token) => setToken(token),
  clearAuthToken: () => { setToken(''); cacheClearAll(); },
  getAuthToken: () => getToken(),

  login: (correo, password) =>
    request('/usuarios/login', {
      method: 'POST',
      body: JSON.stringify({ correo, password }),
    }),
  forgotPassword: (correo) =>
    request('/usuarios/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ correo }),
    }),
  resetPassword: (token, newPassword) =>
    request('/usuarios/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
  me: () => request('/usuarios/me'),
  getUsuarios: () => cachedRequest('/usuarios'),
  createUsuario: (payload) =>
    request('/usuarios', { method: 'POST', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/usuarios'); return r; }),
  updateUsuario: (id, payload) =>
    request(`/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/usuarios'); return r; }),
  deleteUsuario: (id) =>
    request(`/usuarios/${id}`, { method: 'DELETE' })
      .then(r => { cacheInvalidate('/usuarios'); return r; }),
  cambiarPassword: ({ passwordNueva }) =>
    request('/usuarios/cambiar-password', {
      method: 'POST',
      body: JSON.stringify({ passwordNueva }),
    }),
  forzarCambioPassword: (id) =>
    request(`/usuarios/${id}/forzar-cambio-password`, { method: 'POST' }),

  getProductos: (options = {}) => {
    const q = new URLSearchParams();
    if (options?.includeArchived) q.set('includeArchived', 'true');
    const suffix = q.toString();
    return request(`/productos${suffix ? `?${suffix}` : ''}`);
  },
  uploadImagen: (file) => {
    const token = getToken();
    const formData = new FormData();
    formData.append('imagen', file);
    return fetch(`${API_BASE}/uploads/imagen`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return res.json();
    });
  },
  createProducto: (payload) =>
    request('/productos', { method: 'POST', body: JSON.stringify(payload) }),
  updateProducto: (id, payload) =>
    request(`/productos/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteProducto: (id) =>
    request(`/productos/${id}`, { method: 'DELETE' }),
  restoreProducto: (id) =>
    request(`/productos/${id}/restaurar`, { method: 'PATCH' }),
  ajustarStockProducto: (id, stock) =>
    request(`/productos/${id}/stock`, {
      method: 'PATCH',
      body: JSON.stringify({ stock }),
    }),
  getMovimientosProducto: (id, limit = 10) =>
    request(`/productos/${id}/movimientos?limit=${encodeURIComponent(limit)}`),
  getEmpaques: () => cachedRequest('/empaques'),
  createEmpaque: (payload) =>
    request('/empaques', { method: 'POST', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/empaques'); return r; }),
  updateEmpaque: (id, payload) =>
    request(`/empaques/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/empaques'); return r; }),
  deleteEmpaque: (id) =>
    request(`/empaques/${id}`, { method: 'DELETE' })
      .then(r => { cacheInvalidate('/empaques'); return r; }),

  // Tipos IVA
  getTiposIva: () => cachedRequest('/tipos-iva'),
  createTipoIva: (data) =>
    request('/tipos-iva', { method: 'POST', body: JSON.stringify(data) })
      .then(r => { cacheInvalidate('/tipos-iva'); return r; }),
  updateTipoIva: (id, data) =>
    request(`/tipos-iva/${id}`, { method: 'PUT', body: JSON.stringify(data) })
      .then(r => { cacheInvalidate('/tipos-iva'); return r; }),
  deleteTipoIva: (id) =>
    request(`/tipos-iva/${id}`, { method: 'DELETE' })
      .then(r => { cacheInvalidate('/tipos-iva'); return r; }),

  getClientes: () => cachedRequest('/clientes'),
  createCliente: (payload) =>
    request('/clientes', { method: 'POST', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/clientes'); return r; }),
  updateCliente: (id, payload) =>
    request(`/clientes/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/clientes'); return r; }),
  deleteCliente: (id) =>
    request(`/clientes/${id}`, { method: 'DELETE' })
      .then(r => { cacheInvalidate('/clientes'); return r; }),
  getClientesStats: () => request('/clientes/stats'),
  restaurarCliente: (id) =>
    request(`/clientes/${id}/restaurar`, { method: 'POST' })
      .then(r => { cacheInvalidate('/clientes'); return r; }),

  getDepartamentos: () => cachedRequest('/ubicaciones/departamentos'),
  createDepartamento: (payload) =>
    request('/ubicaciones/departamentos', { method: 'POST', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/ubicaciones/departamentos'); return r; }),
  updateDepartamento: (id, payload) =>
    request(`/ubicaciones/departamentos/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/ubicaciones/departamentos'); return r; }),
  deleteDepartamento: (id) =>
    request(`/ubicaciones/departamentos/${id}`, { method: 'DELETE' })
      .then(r => { cacheInvalidate('/ubicaciones/departamentos'); return r; }),

  getBarrios: (departamentoId) => {
    const url = departamentoId
      ? `/ubicaciones/barrios?departamento_id=${departamentoId}`
      : '/ubicaciones/barrios';
    return request(url);
  },
  createBarrio: (payload) =>
    request('/ubicaciones/barrios', { method: 'POST', body: JSON.stringify(payload) }),
  updateBarrio: (id, payload) =>
    request(`/ubicaciones/barrios/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteBarrio: (id) =>
    request(`/ubicaciones/barrios/${id}`, { method: 'DELETE' }),
  getVentas: (filtro) => {
    if (typeof filtro === 'string') {
      return request(filtro ? `/ventas?fecha=${encodeURIComponent(filtro)}` : '/ventas');
    }
    const q = new URLSearchParams();
    if (filtro?.fecha) q.set('fecha', String(filtro.fecha));
    if (filtro?.desde) q.set('desde', String(filtro.desde));
    if (filtro?.hasta) q.set('hasta', String(filtro.hasta));
    if (filtro?.filtro_fecha) q.set('filtro_fecha', String(filtro.filtro_fecha));
    const suffix = q.toString();
    return request(`/ventas${suffix ? `?${suffix}` : ''}`);
  },
  getEntregasResumen: (filtro, fechaBaseLegacy) => {
    const q = new URLSearchParams();
    if (filtro && typeof filtro === 'object') {
      if (filtro.periodo) q.set('periodo', String(filtro.periodo));
      if (filtro.fechaBase) q.set('fechaBase', String(filtro.fechaBase));
      if (filtro.desde) q.set('desde', String(filtro.desde));
      if (filtro.hasta) q.set('hasta', String(filtro.hasta));
    } else {
      if (filtro) q.set('periodo', String(filtro));
      if (fechaBaseLegacy) q.set('fechaBase', String(fechaBaseLegacy));
    }
    const suffix = q.toString();
    return request(`/ventas/entregas/resumen${suffix ? `?${suffix}` : ''}`);
  },
  getVentaById: (id) => request(`/ventas/${id}`),
  getVentaCFE: (id) => request(`/ventas/${id}/cfe`),
  getVentaCFEAnnotated: (id) => requestText(`/ventas/${id}/cfe?annotated=1`),
  sendVentaCFE: (id, force = false) => request(`/ventas/${id}/cfe/enviar`, {
    method: 'POST',
    body: JSON.stringify({ force }),
  }),
  updateVentaEntregado: (id, entregado) =>
    request(`/ventas/${id}/entregado`, {
      method: 'PUT',
      body: JSON.stringify({ entregado }),
    }),
  updateVentaCfeEnviado: (id, cfe_enviado) =>
    request(`/ventas/${id}/cfe_enviado`, {
      method: 'PATCH',
      body: JSON.stringify({ cfe_enviado }),
    }),
  getVentasCfePendientes: (desde, hasta) => {
    const q = new URLSearchParams({ solo_cfe_pendiente: 'true' });
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    return request(`/ventas?${q.toString()}`);
  },
  buscarVentas: (q, estado = 'todos') => {
    const params = new URLSearchParams({ q, estado });
    return request(`/ventas/buscar?${params.toString()}`);
  },
  cancelarVenta: (id) =>
    request(`/ventas/${id}/cancelar`, {
      method: 'PUT',
    }),
  deleteVenta: (id) =>
    request(`/ventas/${id}`, {
      method: 'DELETE',
    }),
  createVenta: (payload, { timeoutMs } = {}) =>
    request('/ventas', { method: 'POST', body: JSON.stringify(payload), timeoutMs }),
  getDashboardResumen: () => request('/ventas/dashboard/resumen'),
  getDashboardWidget: ({ category, type, metric, range, comparison_period }) => {
    const q = new URLSearchParams({ category, type, metric });
    if (range) q.set('range', range);
    if (comparison_period) q.set('comparison_period', comparison_period);
    return request(`/ventas/dashboard/widget?${q}`);
  },
  getWidgets: () => request('/ventas/dashboard/widgets'),
  saveWidgets: (widgets) => request('/ventas/dashboard/widgets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(widgets),
  }),
  getEstadisticasResumen: (desde, hasta, usuarioId) => {
    const q = new URLSearchParams();
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    if (usuarioId) q.set('usuarioId', String(usuarioId));
    const suffix = q.toString();
    return request(`/ventas/estadisticas/resumen${suffix ? `?${suffix}` : ''}`);
  },
  getAuditoriaEventos: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') q.set(k, v); });
    const suffix = q.toString();
    return request(`/auditoria/eventos${suffix ? `?${suffix}` : ''}`);
  },
  getMovimientosStock: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') q.set(k, v); });
    const suffix = q.toString();
    return request(`/auditoria/movimientos-stock${suffix ? `?${suffix}` : ''}`);
  },
  getStockCostoSerie: (desde, hasta) => {
    const q = new URLSearchParams();
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    const suffix = q.toString();
    return request(`/auditoria/stock-costo-serie${suffix ? `?${suffix}` : ''}`);
  },

  // ── FLUJO DE STOCK ───────────────────────────────────────────────────────────
  getFlujoStock: (productoId) => request(`/flujo-stock/${productoId}`),
  getFlujoStockResumen: () => request('/flujo-stock'),

  // ── CONFIGURACIÓN ──────────────────────────────────────────────────────────
  getConfigEmpresa: () => cachedRequest('/configuracion/empresa'),
  updateConfigEmpresa: (payload) =>
    request('/configuracion/empresa', { method: 'PUT', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/configuracion/empresa'); return r; }),
  getConfigModulos: () => cachedRequest('/configuracion/modulos'),
  updateConfigModulo: (codigo, habilitado) =>
    request(`/configuracion/modulos/${codigo}`, {
      method: 'PUT',
      body: JSON.stringify({ habilitado }),
    }).then(r => { cacheInvalidate('/configuracion/modulos'); return r; }),
  getConfigGanancias: () => cachedRequest('/configuracion/ganancias'),
  updateConfigGanancias: (payload) =>
    request('/configuracion/ganancias', { method: 'PUT', body: JSON.stringify(payload) })
      .then(r => { cacheInvalidate('/configuracion/ganancias'); return r; }),

  // ── PERMISOS ────────────────────────────────────────────────────────────────
  getRoles: () => cachedRequest('/permisos/roles'),
  crearRol: (nombre) =>
    request('/permisos/roles', { method: 'POST', body: JSON.stringify({ nombre }) })
      .then(r => { cacheInvalidate('/permisos'); return r; }),
  eliminarRol: (id) =>
    request(`/permisos/roles/${id}`, { method: 'DELETE' })
      .then(r => { cacheInvalidate('/permisos'); return r; }),
  getPermisos: (rolId) => cachedRequest(`/permisos/${rolId}`),
  updatePermisos: (rolId, permisos) =>
    request(`/permisos/${rolId}`, { method: 'PUT', body: JSON.stringify(permisos) })
      .then(r => { cacheInvalidate('/permisos'); return r; }),
};
