function normalizeHora(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return '';
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function splitHora(value) {
  const raw = String(value || '').trim();
  if (!raw) return { h: '', m: '' };
  const [hRaw = '', mRaw = ''] = raw.split(':');
  const h = /^\d{1,2}$/.test(hRaw) ? String(Number(hRaw)).padStart(2, '0') : '';
  const m = /^\d{1,2}$/.test(mRaw) ? String(Number(mRaw)).padStart(2, '0') : '';
  return { h, m };
}

export function normalizeHoraForSave(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [hRaw = '', mRaw = ''] = raw.split(':');
  if (!hRaw) return null; // hora vacía → no se puede normalizar
  const hh = Number(hRaw);
  const mm = mRaw !== '' ? Number(mRaw) : 0; // minuto vacío → 00
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function horaConHoraVacia(value) {
  // Devuelve true si el usuario seleccionó un minuto pero dejó la hora vacía
  const raw = String(value || '').trim();
  const [hRaw = ''] = raw.split(':');
  return !hRaw && raw.length > 1;
}

export function formatHorarioCliente(cliente = {}) {
  const apertura = normalizeHora(cliente?.horario_apertura);
  const cierre = normalizeHora(cliente?.horario_cierre);
  const tieneReapertura = Boolean(cliente?.tiene_reapertura);
  const reapertura = normalizeHora(cliente?.horario_reapertura);
  const cierreReapertura = normalizeHora(cliente?.horario_cierre_reapertura);

  if (!apertura || !cierre) return '-';
  if (tieneReapertura && reapertura && cierreReapertura) {
    return `${apertura} a ${cierre} y ${reapertura} a ${cierreReapertura}`;
  }
  return `${apertura} a ${cierre}`;
}

export function isValidHorarioRange(inicio, fin) {
  const start = normalizeHora(inicio);
  const end = normalizeHora(fin);
  if (!start || !end) return true;
  return start < end;
}
