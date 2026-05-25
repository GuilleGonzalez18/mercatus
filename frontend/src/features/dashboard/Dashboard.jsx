import { cloneElement, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const Ventas          = lazy(() => import('../ventas/Ventas'));
const VentasHistorial = lazy(() => import('../ventas/VentasHistorial'));
const Productos       = lazy(() => import('../productos/Productos'));
const Clientes        = lazy(() => import('../clientes/Clientes'));
const Auditoria       = lazy(() => import('../auditoria/Auditoria'));
const Usuarios        = lazy(() => import('../usuarios/Usuarios'));
const Estadisticas    = lazy(() => import('../estadisticas/Estadisticas'));
const ControlStock    = lazy(() => import('../stock/ControlStock'));
const Configuracion   = lazy(() => import('../configuracion/Configuracion'));
import './Dashboard.css';
import { api } from '../../core/api';
import { CgArrowsExchange } from 'react-icons/cg';
import { FiShoppingCart, FiSliders, FiX, FiPlus, FiCheck } from 'react-icons/fi';
import { RiSettings3Line } from 'react-icons/ri';
import { APP_VERSION } from '../../core/version';
import AppButton from '../../shared/components/button/AppButton';
import { FilterPanelProvider, useFilterPanel } from '../../shared/lib/filterPanel';
import { useConfig } from '../../core/ConfigContext';
import { usePermisos } from '../../core/PermisosContext';
import AvisoBanner from '../../shared/components/avisos/AvisoBanner';

// ── Widget system ──────────────────────────────────────────────────────────────

const WIDGET_CATALOG = {
  ventas: {
    label: 'Ventas', icon: '/dollar.svg', requiresEmpresa: false,
    tipos: {
      cantidad: {
        label: 'Cantidad',
        metricas: [
          { id: 'monto', label: 'Monto total', format: 'money' },
          { id: 'count', label: 'Número de ventas', format: 'count' },
        ],
        usaRango: true,
      },
      promedio: {
        label: 'Promedio',
        metricas: [
          { id: 'monto_venta', label: 'Promedio por venta', format: 'money' },
          { id: 'diario',      label: 'Promedio diario',    format: 'decimal' },
        ],
        usaRango: true,
      },
      comparacion: {
        label: 'Comparación',
        metricas: [
          { id: 'monto', label: 'Monto total', format: 'money' },
          { id: 'count', label: 'Número de ventas', format: 'count' },
        ],
        usaComparacion: true,
      },
    },
  },
  productos: {
    label: 'Productos', icon: '/product.svg', requiresEmpresa: false,
    tipos: {
      cantidad: {
        label: 'Cantidad',
        metricas: [{ id: 'count', label: 'Productos agregados', format: 'count' }],
        usaRango: true,
      },
      promedio: {
        label: 'Promedio',
        metricas: [{ id: 'diario', label: 'Promedio diario', format: 'decimal' }],
        usaRango: true,
      },
      comparacion: {
        label: 'Comparación',
        metricas: [{ id: 'count', label: 'Productos agregados', format: 'count' }],
        usaComparacion: true,
      },
    },
  },
  clientes: {
    label: 'Clientes', icon: '/client.svg', requiresEmpresa: false,
    tipos: {
      cantidad: {
        label: 'Cantidad',
        metricas: [{ id: 'count', label: 'Clientes nuevos', format: 'count' }],
        usaRango: true,
      },
      promedio: {
        label: 'Promedio',
        metricas: [{ id: 'diario', label: 'Promedio diario', format: 'decimal' }],
        usaRango: true,
      },
      comparacion: {
        label: 'Comparación',
        metricas: [{ id: 'count', label: 'Clientes nuevos', format: 'count' }],
        usaComparacion: true,
      },
    },
  },
  usuarios: {
    label: 'Usuarios', icon: '/user.svg', requiresEmpresa: false,
    tipos: {
      cantidad: {
        label: 'Cantidad',
        metricas: [{ id: 'count', label: 'Usuarios creados', format: 'count' }],
        usaRango: true,
      },
      promedio: {
        label: 'Promedio',
        metricas: [{ id: 'diario', label: 'Promedio diario', format: 'decimal' }],
        usaRango: true,
      },
      comparacion: {
        label: 'Comparación',
        metricas: [{ id: 'count', label: 'Usuarios creados', format: 'count' }],
        usaComparacion: true,
      },
    },
  },
  stock: {
    label: 'Stock', icon: '/grid-view.svg', requiresEmpresa: false,
    tipos: {
      cantidad: {
        label: 'Cantidad',
        metricas: [{ id: 'total_unidades', label: 'Unidades en stock', format: 'count' }],
        usaRango: false,
      },
    },
  },
  ganancia: {
    label: 'Ganancia', icon: '/cash.svg', requiresEmpresa: true,
    tipos: {
      cantidad: {
        label: 'Cantidad',
        metricas: [{ id: 'total', label: 'Ganancia total', format: 'money' }],
        usaRango: true,
      },
      promedio: {
        label: 'Promedio',
        metricas: [{ id: 'diario', label: 'Promedio diario', format: 'money' }],
        usaRango: true,
      },
      comparacion: {
        label: 'Comparación',
        metricas: [{ id: 'total', label: 'Ganancia total', format: 'money' }],
        usaComparacion: true,
      },
    },
  },
};

const RANGE_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: 'week',  label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: 'year',  label: 'Este año' },
  { value: 'all',   label: 'Siempre' },
];
const COMPARISON_OPTIONS = [
  { value: 'yesterday',   label: 'Ayer' },
  { value: 'last_week',   label: 'Semana pasada' },
  { value: 'last_month',  label: 'Mes pasado' },
  { value: 'last_year',   label: 'Año pasado' },
];
const RANGE_LABEL = Object.fromEntries([...RANGE_OPTIONS, ...COMPARISON_OPTIONS].map((r) => [r.value, r.label]));

function formatWidgetValue(raw, format) {
  if (raw === null || raw === undefined) return '—';
  if (format === 'money') return `$${Math.round(raw).toLocaleString('es-UY')}`;
  if (format === 'decimal') return Number(raw).toLocaleString('es-UY', { maximumFractionDigits: 1 });
  return Math.round(raw).toLocaleString('es-UY');
}

function getMetricFormat(categoria, tipo, metrica) {
  return WIDGET_CATALOG[categoria]?.tipos[tipo]?.metricas.find((m) => m.id === metrica)?.format ?? 'count';
}

function buildDefaultLabel(categoria, tipo, metrica) {
  const cat = WIDGET_CATALOG[categoria];
  if (!cat) return 'Widget';
  const m = cat.tipos[tipo]?.metricas.find((mx) => mx.id === metrica);
  return m?.label ?? cat.label;
}

function toButtonIdPart(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

// ── useWidgetPrefs: fetches from DB, saves to DB ──────────────────────────────

function useWidgetPrefs() {
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.getWidgets()
      .then((data) => { if (!cancelled && Array.isArray(data)) setWidgets(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const saveWidgets = useCallback((next) => {
    setWidgets(next);
    // eslint-disable-next-line no-unused-vars
    api.saveWidgets(next.map(({ id: _id, ...rest }) => rest)).then((saved) => {
      if (Array.isArray(saved)) setWidgets(saved);
    }).catch(() => {});
  }, []);

  return [widgets, saveWidgets, loading];
}

// ── WidgetCard ────────────────────────────────────────────────────────────────

function WidgetCard({ widget, editMode, onRemove, onUpdate, idx }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formLabel, setFormLabel] = useState(widget.etiqueta);
  const [formRango, setFormRango] = useState(widget.rango || 'month');
  const [formPeriodo, setFormPeriodo] = useState(widget.periodo_comparacion || 'last_month');
  const inputRef = useRef(null);

  const tipoConfig = WIDGET_CATALOG[widget.categoria]?.tipos[widget.tipo];
  const isComparacion = widget.tipo === 'comparacion';
  const format = getMetricFormat(widget.categoria, widget.tipo, widget.metrica);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const params = isComparacion
      ? { category: widget.categoria, type: 'comparacion', metric: widget.metrica, comparison_period: widget.periodo_comparacion }
      : { category: widget.categoria, type: widget.tipo, metric: widget.metrica, range: widget.rango };

    api.getDashboardWidget(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [widget.categoria, widget.tipo, widget.metrica, widget.rango, widget.periodo_comparacion, isComparacion]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const handleSave = () => {
    const updated = { ...widget, etiqueta: formLabel };
    if (isComparacion) updated.periodo_comparacion = formPeriodo;
    else updated.rango = formRango;
    onUpdate(updated);
    setEditing(false);
  };
  const handleCancel = () => {
    setFormLabel(widget.etiqueta);
    setFormRango(widget.rango || 'month');
    setFormPeriodo(widget.periodo_comparacion || 'last_month');
    setEditing(false);
  };

  const iconSrc = WIDGET_CATALOG[widget.categoria]?.icon ?? '/dollar.svg';
  const timeLabel = isComparacion
    ? RANGE_LABEL[widget.periodo_comparacion] || widget.periodo_comparacion
    : RANGE_LABEL[widget.rango] || widget.rango;

  return (
    <article
      className={`dashboard-kpi-card ${isComparacion ? 'is-comparison' : ''} ${editing ? 'is-editing' : ''}`}
      style={{ animationDelay: `${idx * 100}ms` }}
    >
      {editMode && !editing && (
        <button
          id={`dashboard-widget-remove-${widget.id ?? idx}`}
          type="button"
          className="widget-remove-btn"
          onClick={onRemove}
          title="Quitar widget"
          aria-label="Quitar widget"
        >
          <FiX />
        </button>
      )}

      {!editing ? (
        <div
          className={`dashboard-kpi-inner ${editMode ? 'editable' : ''}`}
          onClick={editMode ? () => setEditing(true) : undefined}
          role={editMode ? 'button' : undefined}
          tabIndex={editMode ? 0 : undefined}
          onKeyDown={editMode ? (e) => e.key === 'Enter' && setEditing(true) : undefined}
          title={editMode ? 'Clic para editar' : undefined}
        >
          <div className="dashboard-kpi-icon-wrap" aria-hidden="true">
            <img src={iconSrc} alt="" className="dashboard-kpi-icon" />
          </div>
          <div className="dashboard-kpi-content">
            <span className="widget-label">{widget.etiqueta}</span>
            {loading ? (
              <strong className="widget-loading">…</strong>
            ) : isComparacion ? (
              <>
                <strong className="widget-comparison-current">{formatWidgetValue(data?.current, format)}</strong>
                <div className="widget-comparison-row">
                  <span className="widget-comparison-previous">{formatWidgetValue(data?.previous, format)}</span>
                  {data?.pct_change !== null && data?.pct_change !== undefined && (
                    <span className={`widget-pct-badge ${data.pct_change >= 0 ? 'up' : 'down'}`}>
                      {data.pct_change >= 0 ? '↑' : '↓'} {Math.abs(data.pct_change)}%
                    </span>
                  )}
                </div>
              </>
            ) : (
              <strong>{formatWidgetValue(data?.raw, format)}</strong>
            )}
            <span className="widget-range-tag">{timeLabel}</span>
          </div>
        </div>
      ) : (
        <div className="widget-edit-form">
          <div className="widget-edit-row">
            <label className="widget-edit-label">Nombre</label>
            <input ref={inputRef} type="text" className="widget-edit-input" value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)} maxLength={60} />
          </div>
          <div className="widget-edit-row">
            <label className="widget-edit-label">{isComparacion ? 'Período' : 'Rango'}</label>
            {isComparacion ? (
              <select className="widget-edit-select" value={formPeriodo} onChange={(e) => setFormPeriodo(e.target.value)}>
                {COMPARISON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <select className="widget-edit-select" value={formRango} onChange={(e) => setFormRango(e.target.value)}>
                {tipoConfig?.usaRango && RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
          <div className="widget-edit-actions">
            <button id={`dashboard-widget-save-${widget.id ?? idx}`} type="button" className="widget-edit-save" onClick={handleSave}><FiCheck /> Guardar</button>
            <button id={`dashboard-widget-cancel-${widget.id ?? idx}`} type="button" className="widget-edit-cancel" onClick={handleCancel}>Cancelar</button>
          </div>
        </div>
      )}
    </article>
  );
}

// ── AddWidgetCard — Wizard de 4 pasos ────────────────────────────────────────

const WIZARD_STEPS = { CATEGORY: 0, TYPE: 1, METRIC: 2, RANGE: 3, LABEL: 4 };

function AddWidgetCard({ onAdd, canVerEmpresa }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(WIZARD_STEPS.CATEGORY);
  const [sel, setSel] = useState({ categoria: null, tipo: null, metrica: null, rango: 'today', periodo_comparacion: 'last_month' });
  const [etiqueta, setEtiqueta] = useState('');

  const reset = () => { setStep(WIZARD_STEPS.CATEGORY); setSel({ categoria: null, tipo: null, metrica: null, rango: 'today', periodo_comparacion: 'last_month' }); setEtiqueta(''); setOpen(false); };

  const categorias = Object.entries(WIDGET_CATALOG).filter(([, v]) => !v.requiresEmpresa || canVerEmpresa);

  const handleSelectCategoria = (catKey) => {
    setSel((p) => ({ ...p, categoria: catKey, tipo: null, metrica: null }));
    setStep(WIZARD_STEPS.TYPE);
  };

  const handleSelectTipo = (tipoKey) => {
    const metricas = WIDGET_CATALOG[sel.categoria].tipos[tipoKey].metricas;
    const newSel = { ...sel, tipo: tipoKey, metrica: metricas.length === 1 ? metricas[0].id : null };
    setSel(newSel);
    if (metricas.length === 1) {
      const tipoConfig = WIDGET_CATALOG[sel.categoria].tipos[tipoKey];
      if (!tipoConfig.usaRango && !tipoConfig.usaComparacion) {
        const defaultLabel = buildDefaultLabel(sel.categoria, tipoKey, metricas[0].id);
        setEtiqueta(defaultLabel); setStep(WIZARD_STEPS.LABEL);
      } else {
        setStep(WIZARD_STEPS.RANGE);
      }
    } else {
      setStep(WIZARD_STEPS.METRIC);
    }
  };

  const handleSelectMetrica = (metricaId) => {
    const newSel = { ...sel, metrica: metricaId };
    setSel(newSel);
    const tipoConfig = WIDGET_CATALOG[sel.categoria].tipos[sel.tipo];
    if (!tipoConfig.usaRango && !tipoConfig.usaComparacion) {
      const defaultLabel = buildDefaultLabel(sel.categoria, sel.tipo, metricaId);
      setEtiqueta(defaultLabel); setStep(WIZARD_STEPS.LABEL);
    } else {
      setStep(WIZARD_STEPS.RANGE);
    }
  };

  const handleSelectRango = (val, isComparacion) => {
    const newSel = isComparacion ? { ...sel, periodo_comparacion: val } : { ...sel, rango: val };
    setSel(newSel);
    const defaultLabel = buildDefaultLabel(sel.categoria, sel.tipo, sel.metrica);
    setEtiqueta(defaultLabel);
    setStep(WIZARD_STEPS.LABEL);
  };

  const handleAdd = () => {
    onAdd({
      categoria: sel.categoria,
      tipo: sel.tipo,
      metrica: sel.metrica,
      rango: sel.tipo !== 'comparacion' ? sel.rango : null,
      periodo_comparacion: sel.tipo === 'comparacion' ? sel.periodo_comparacion : null,
      etiqueta: etiqueta.trim() || buildDefaultLabel(sel.categoria, sel.tipo, sel.metrica),
    });
    reset();
  };

  if (!open) {
    return (
      <button id="dashboard-widget-add-open" type="button" className="dashboard-add-widget-btn" onClick={() => setOpen(true)} title="Agregar widget">
        <FiPlus /><span>Agregar</span>
      </button>
    );
  }

  const tipoConfig = sel.categoria ? WIDGET_CATALOG[sel.categoria]?.tipos[sel.tipo] : null;
  const isComparacion = sel.tipo === 'comparacion';

  return (
    <div className="dashboard-add-widget-panel">
      {/* Paso: Categoría */}
      {step === WIZARD_STEPS.CATEGORY && (
        <>
            <p className="add-widget-title">Elegí una categoría</p>
            <div className="wizard-step-categories">
              {categorias.map(([key, cat]) => (
                <button id={`dashboard-widget-category-${toButtonIdPart(key)}`} key={key} type="button" className="wizard-category-btn" onClick={() => handleSelectCategoria(key)}>
                  <img src={cat.icon} alt="" />
                  <span>{cat.label}</span>
                </button>
              ))}
          </div>
        </>
      )}

      {/* Paso: Tipo */}
      {step === WIZARD_STEPS.TYPE && sel.categoria && (
        <>
          <p className="add-widget-title">Tipo de métrica — <strong>{WIDGET_CATALOG[sel.categoria].label}</strong></p>
          <div className="wizard-step-types">
            {Object.entries(WIDGET_CATALOG[sel.categoria].tipos).map(([key, t]) => (
              <button id={`dashboard-widget-type-${toButtonIdPart(sel.categoria)}-${toButtonIdPart(key)}`} key={key} type="button" className="wizard-type-btn" onClick={() => handleSelectTipo(key)}>
                {t.label}
              </button>
            ))}
          </div>
          <button id="dashboard-widget-back-category" type="button" className="widget-add-back-btn" onClick={() => setStep(WIZARD_STEPS.CATEGORY)}>← Atrás</button>
        </>
      )}

      {/* Paso: Métrica (solo si hay más de una) */}
      {step === WIZARD_STEPS.METRIC && sel.tipo && (
        <>
          <p className="add-widget-title">¿Qué querés medir?</p>
          <div className="wizard-step-types">
            {WIDGET_CATALOG[sel.categoria].tipos[sel.tipo].metricas.map((m) => (
              <button id={`dashboard-widget-metric-${toButtonIdPart(sel.categoria)}-${toButtonIdPart(sel.tipo)}-${toButtonIdPart(m.id)}`} key={m.id} type="button" className="wizard-type-btn" onClick={() => handleSelectMetrica(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <button id="dashboard-widget-back-type" type="button" className="widget-add-back-btn" onClick={() => setStep(WIZARD_STEPS.TYPE)}>← Atrás</button>
        </>
      )}

      {/* Paso: Rango / Período */}
      {step === WIZARD_STEPS.RANGE && tipoConfig && (
        <>
          <p className="add-widget-title">{isComparacion ? 'Comparar respecto a...' : 'Período de tiempo'}</p>
          <div className="wizard-step-types">
            {isComparacion
              ? COMPARISON_OPTIONS.map((o) => (
                  <button id={`dashboard-widget-range-${toButtonIdPart(o.value)}`} key={o.value} type="button" className="wizard-type-btn" onClick={() => handleSelectRango(o.value, true)}>{o.label}</button>
                ))
              : RANGE_OPTIONS.map((o) => (
                  <button id={`dashboard-widget-range-${toButtonIdPart(o.value)}`} key={o.value} type="button" className="wizard-type-btn" onClick={() => handleSelectRango(o.value, false)}>{o.label}</button>
                ))
            }
          </div>
          <button id="dashboard-widget-back-range" type="button" className="widget-add-back-btn"
            onClick={() => setStep(WIDGET_CATALOG[sel.categoria].tipos[sel.tipo].metricas.length > 1 ? WIZARD_STEPS.METRIC : WIZARD_STEPS.TYPE)}>
            ← Atrás
          </button>
        </>
      )}

      {/* Paso: Etiqueta */}
      {step === WIZARD_STEPS.LABEL && (
        <>
          <p className="add-widget-title">Nombre del widget</p>
          <input type="text" className="widget-edit-input" value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)} maxLength={60} autoFocus />
          <div className="widget-edit-actions" style={{ marginTop: '0.6rem' }}>
            <button id="dashboard-widget-add-confirm" type="button" className="widget-edit-save" onClick={handleAdd}><FiCheck /> Agregar</button>
            <button id="dashboard-widget-back-label" type="button" className="widget-edit-cancel" onClick={() => setStep(WIZARD_STEPS.RANGE)}>← Atrás</button>
          </div>
        </>
      )}

      <button id="dashboard-widget-add-cancel" type="button" className="add-widget-cancel" style={{ marginTop: '0.4rem' }} onClick={reset}>Cancelar</button>
    </div>
  );
}

const OPCIONES = [
  { key: 'nueva-venta', label: 'Nueva venta', topbarTitle: 'Nueva venta', icon: '/newsale.svg' },
  { key: 'ventas', label: 'Ventas', topbarTitle: 'Ventas realizadas', icon: '/cart.svg' },
  { key: 'productos', label: 'Productos', topbarTitle: 'Lista de productos', icon: '/product.svg' },
  { key: 'clientes', label: 'Clientes', topbarTitle: 'Lista de clientes', icon: '/client.svg' },
  { key: 'usuarios', label: 'Usuarios', topbarTitle: 'Usuarios del sistema', icon: '/user.svg' },
  { key: 'mi-usuario', label: 'Mi usuario', topbarTitle: 'Mi usuario', icon: '/user.svg' },
  { key: 'auditoria', label: 'Auditoría', topbarTitle: 'Auditoría y movimientos de stock', icon: '/auditory.svg' },
  { key: 'control-stock', label: 'Control de stock', topbarTitle: 'Control de stock', icon: 'stock-control' },
  { key: 'estadisticas', label: 'Estadísticas', topbarTitle: 'Estadísticas comerciales', icon: '/stats.svg' },
  { key: 'configuracion', label: 'Configuración', topbarTitle: 'Configuración del sistema', icon: 'configuracion' },
];

function Placeholder({ titulo, icon }) {
  return (
    <div className="dashboard-placeholder">
      <span className="placeholder-icon">{icon}</span>
      <h2>{titulo}</h2>
      <p>Sección en construcción.</p>
    </div>
  );
}

function MiUsuarioView({ user }) {
  return (
    <div className="mi-usuario-split">
      <section className="mi-usuario-col mi-usuario-col-stats">
        <Estadisticas compact />
      </section>
      <section className="mi-usuario-col mi-usuario-col-form">
        <Usuarios currentUser={user} onlySelf />
      </section>
    </div>
  );
}

export default function Dashboard(props) {
  return (
    <FilterPanelProvider>
      <DashboardInner {...props} />
    </FilterPanelProvider>
  );
}

function DashboardInner({ user, pantalla, productos, setProductos, onNavigate, onLogout }) {
  const { isOpen: filterPanelOpen, setIsOpen: setFilterPanelOpen, hasContent: filterHasContent, containerRefCb } = useFilterPanel();
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [ventasCarritoAbierto, setVentasCarritoAbierto] = useState(false);
  const [ventasCarritoCount, setVentasCarritoCount] = useState(0);
  const [carritoIconAnim, setCarritoIconAnim] = useState(0);
  const prevCarritoCount = useRef(0);
  const [editMode, setEditMode] = useState(false);
  const { empresa, modulos } = useConfig();
  const { can, esPropietario } = usePermisos();
  const canVerEmpresa = can('estadisticas', 'ver_empresa');
  const [widgets, saveWidgets, widgetsLoading] = useWidgetPrefs();

  // Animar ícono del carrito cuando aumenta el count
  useEffect(() => {
    const prev = prevCarritoCount.current;
    prevCarritoCount.current = ventasCarritoCount;
    if (ventasCarritoCount > prev) {
      const id = setTimeout(() => setCarritoIconAnim((k) => k + 1), 0);
      return () => clearTimeout(id);
    }
  }, [ventasCarritoCount]);

  const opcionesMenu = useMemo(() => OPCIONES.filter((op) => {
    // Permisos dinámicos por sección
    if (op.key === 'nueva-venta' && !can('nueva-venta', 'usar')) return false;
    if (op.key === 'usuarios' && !can('usuarios', 'ver')) return false;
    if (op.key === 'mi-usuario' && esPropietario) return false;
    if (op.key === 'mi-usuario' && can('usuarios', 'ver')) return false; // si puede ver usuarios, no necesita "mi usuario"
    if (op.key === 'control-stock' && !can('stock', 'ver')) return false;
    if (op.key === 'estadisticas' && !can('estadisticas', 'ver')) return false;
    if (op.key === 'auditoria' && !can('auditoria', 'ver')) return false;
    if (op.key === 'configuracion' && !can('configuracion', 'ver')) return false;

    if (modulos.length > 0) {
      const mod = modulos.find((m) => m.codigo === op.key);
      if (mod && !mod.habilitado) return false;
    }
    return true;
  }), [can, esPropietario, modulos]);

  const handleNavigate = (seccion) => {
    onNavigate(seccion);
    setMenuMovilAbierto(false);
    setVentasCarritoAbierto(false);
    setFilterPanelOpen(false);
  };

  useEffect(() => {
    setFilterPanelOpen(false);
  }, [pantalla, setFilterPanelOpen]);

  useEffect(() => {
    if (pantalla !== 'nueva-venta' && ventasCarritoCount !== 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVentasCarritoCount(0);
    }
  }, [pantalla, ventasCarritoCount]);



  const closeVentasCarritoDrawer = useCallback(() => {
    setVentasCarritoAbierto(false);
  }, []);

  const toggleVentasCarritoDrawer = useCallback(() => {
    setVentasCarritoAbierto((prev) => !prev);
  }, []);

  const handleLogout = () => {
    setMenuMovilAbierto(false);
    setVentasCarritoAbierto(false);
    onLogout();
  };

  useEffect(() => {
    document.body.classList.add('dashboard-scroll-lock');
    return () => document.body.classList.remove('dashboard-scroll-lock');
  }, []);

  useEffect(() => {
    const onNavigateEvent = (event) => {
      const target = event?.detail;
      if (typeof target !== 'string') return;
      onNavigate(target);
      setMenuMovilAbierto(false);
      setVentasCarritoAbierto(false);
    };
    window.addEventListener('mercatus:navigate', onNavigateEvent);
    return () => window.removeEventListener('mercatus:navigate', onNavigateEvent);
  }, [onNavigate]);

  useEffect(() => {
    const onStatsRefresh = () => {
      window.dispatchEvent(new CustomEvent('mercatus:widget-refresh'));
    };
    window.addEventListener('mercatus:stats-refresh', onStatsRefresh);
    return () => window.removeEventListener('mercatus:stats-refresh', onStatsRefresh);
  }, []);

  const tituloActual= OPCIONES.find((o) => o.key === pantalla)?.topbarTitle ?? 'Dashboard';
  const esPantallaDashboard = !pantalla;
  const dashboardGreeting = user?.nombre || user?.username || 'Equipo';
  const contenidoPantalla = useMemo(
    () => {
      switch (pantalla) {
        case 'nueva-venta':
          if (!can('nueva-venta', 'usar')) return <Placeholder titulo="Acceso restringido" icon="🔒" />;
          return (
            <Ventas
              user={user}
              productos={productos}
              setProductos={setProductos}
              onCloseCarritoDrawer={closeVentasCarritoDrawer}
              onCarritoCountChange={setVentasCarritoCount}
            />
          );
        case 'ventas':       return <VentasHistorial />;
        case 'productos':    return <Productos user={user} productos={productos} setProductos={setProductos} />;
        case 'clientes':     return <Clientes />;
        case 'usuarios':     return <Usuarios currentUser={user} />;
        case 'mi-usuario':   return <MiUsuarioView user={user} />;
        case 'auditoria':
          return <Auditoria />;
        case 'control-stock':
          return can('stock', 'ver')
            ? (
              <ControlStock
                productos={productos}
                setProductos={setProductos}
              />
            )
            : <Placeholder titulo="Acceso restringido" icon="X" />;
        case 'estadisticas': return <Estadisticas />;
        case 'configuracion':
          return (esPropietario || can('configuracion', 'ver')) ? <Configuracion /> : <Placeholder titulo="Acceso restringido" icon="🔒" />;
        default:             return null;
      }
    },
    [
      pantalla,
      user,
      productos,
      setProductos,
      can,
      esPropietario,
      closeVentasCarritoDrawer,
    ]
  );

  return (
    <div className="dashboard-layout">
      <div
        className={`dashboard-mobile-backdrop ${menuMovilAbierto ? 'visible' : ''}`}
        onClick={() => setMenuMovilAbierto(false)}
        aria-hidden="true"
      />
      <aside className={`dashboard-sidebar ${menuMovilAbierto ? 'mobile-open' : ''}`}>
        <div className="dashboard-logo-wrap">
          <button
            id="dashboard-logo-home"
            type="button"
            className="dashboard-logo-btn"
            onClick={() => handleNavigate('')}
            title="Ir al dashboard"
            aria-label="Ir al dashboard"
          >
            <img
              src={empresa.logo_base64 || '/mercatus-logo.png'}
              alt={empresa.nombre || 'Logo'}
              className="dashboard-logo"
            />
          </button>
        </div>
        <div className="dashboard-user-greeting">
          <p className="dashboard-greeting-name">
            Bienvenido/a, {user?.nombre || user?.username}!
          </p>
          {user?.rol_nombre && (
            <span className="dashboard-role-badge">
              {user.rol_nombre.charAt(0).toUpperCase() + user.rol_nombre.slice(1)}
            </span>
          )}
        </div>
        <nav className="dashboard-nav">
          {opcionesMenu.map(({ key, label, icon }) => (
            <button
              id={`dashboard-nav-${toButtonIdPart(key)}`}
              key={key}
              type="button"
              className={pantalla === key ? 'active' : ''}
              onClick={() => handleNavigate(key)}
            >
              {icon === 'stock-control'
                ? <CgArrowsExchange className="nav-icon-svg" aria-hidden="true" />
                : icon === 'configuracion'
                ? <RiSettings3Line className="nav-icon-svg" aria-hidden="true" />
                : <img src={icon} alt="" className="nav-icon-img" aria-hidden="true" />}
              {label}
            </button>
          ))}
        </nav>
        <AppButton id="dashboard-logout" type="button" tone="danger" className="dashboard-logout" onClick={handleLogout}>
          <img src="/logout.svg" alt="" className="logout-icon-img" aria-hidden="true" />
          Cerrar sesión
        </AppButton>
        <small className="dashboard-version-label">v. {APP_VERSION}</small>
        <div className="dashboard-brand-watermark">
          <span className="dashboard-brand-name">
            <img src="/favicon.png" alt="" className="dashboard-brand-icon" aria-hidden="true" />
            Mercatus
          </span>
          <span className="dashboard-brand-copy">© 2025 RPG Software. Todos los derechos reservados.</span>
        </div>
      </aside>

      <main className="dashboard-content">
        <AvisoBanner app="mercatus" />
        <div className="dashboard-topbar">
          <div className="dashboard-topbar-content">
            <button
              id="dashboard-mobile-menu-toggle"
              type="button"
              className={`dashboard-mobile-fab ${menuMovilAbierto ? 'is-open' : ''}`}
              onClick={() => setMenuMovilAbierto((prev) => !prev)}
              aria-label={menuMovilAbierto ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={menuMovilAbierto}
            >
              {menuMovilAbierto ? '✕' : '☰'}
            </button>
            <div className="dashboard-topbar-heading">
              <span className="dashboard-topbar-eyebrow">{empresa?.nombre || 'Mercatus'}</span>
              <span className="dashboard-topbar-title">{tituloActual}</span>
            </div>
            <div className="dashboard-topbar-actions">
              {pantalla === 'nueva-venta' && (
                <button
                  id="dashboard-cart-toggle"
                  type="button"
                  key={carritoIconAnim}
                  className={`dashboard-topbar-action ventas-carrito-btn ${ventasCarritoAbierto ? 'active' : ''} ${carritoIconAnim > 0 ? 'carrito-shake' : ''}`}
                  onClick={() => setVentasCarritoAbierto((prev) => !prev)}
                  aria-label={ventasCarritoAbierto ? `Cerrar carrito (${ventasCarritoCount})` : `Abrir carrito (${ventasCarritoCount})`}
                  aria-expanded={ventasCarritoAbierto}
                >
                  <FiShoppingCart aria-hidden="true" />
                  <span>Carrito</span>
                  {ventasCarritoCount > 0 && <span className="ventas-carrito-count">{ventasCarritoCount}</span>}
                </button>
              )}

              {filterHasContent && (
                <button
                  id="dashboard-filter-toggle"
                  type="button"
                  className={`dashboard-mobile-fab filter-panel-btn ${filterPanelOpen ? 'is-open' : ''}`}
                  onClick={() => setFilterPanelOpen((prev) => !prev)}
                  aria-label={filterPanelOpen ? 'Cerrar panel' : 'Abrir filtros y acciones'}
                  aria-expanded={filterPanelOpen}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <line x1="2" y1="4.5" x2="16" y2="4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <line x1="2" y1="13.5" x2="16" y2="13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <circle cx="6" cy="4.5" r="2.2" fill="currentColor" />
                    <circle cx="12" cy="9" r="2.2" fill="currentColor" />
                    <circle cx="7.5" cy="13.5" r="2.2" fill="currentColor" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className={`dashboard-body ${esPantallaDashboard ? 'with-kpis' : ''}`}>
          {esPantallaDashboard && (
            <>
              <section className="dashboard-hero-panel">
                <div className="dashboard-hero-copy">
                  <span className="dashboard-hero-badge">Centro de operaciones</span>
                  <h1>Hola, {dashboardGreeting}</h1>
                  <p>
                    Seguí el pulso del negocio, accedé rápido a tus módulos y mantené el foco en ventas, stock y seguimiento.
                  </p>
                </div>
                <div className="dashboard-hero-meta">
                  <div className="dashboard-hero-stat">
                    <span>Módulos activos</span>
                    <strong>{opcionesMenu.length}</strong>
                  </div>
                  <div className="dashboard-hero-stat">
                    <span>Perfil actual</span>
                    <strong>{user?.rol_nombre || user?.tipo || 'Operador'}</strong>
                  </div>
                </div>
              </section>
              <section className="dashboard-kpis-strip">
              <div className="dashboard-kpis-header">
                {!widgetsLoading && (
                  <>
                    <button
                      id="dashboard-widgets-edit-toggle"
                      type="button"
                      className={`dashboard-widgets-btn ${editMode ? 'is-active' : ''}`}
                      onClick={() => setEditMode((v) => !v)}
                      title={editMode ? 'Salir de edición' : 'Personalizar widgets'}
                    >
                      {editMode ? (
                        <><FiCheck aria-hidden="true" /><span>Listo</span></>
                      ) : (
                        <><FiSliders aria-hidden="true" /><span>Personalizar</span></>
                      )}
                    </button>
                    {editMode && (
                      <button
                        id="dashboard-widgets-reset"
                        type="button"
                        className="dashboard-widgets-reset"
                        onClick={() => { saveWidgets([]); setEditMode(false); }}
                        title="Restaurar widgets por defecto"
                      >
                        Restaurar
                      </button>
                    )}
                  </>
                )}
              </div>
              {widgetsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <article key={i} className="dashboard-kpi-card widget-skeleton" style={{ animationDelay: `${i * 100}ms` }} />
                ))
              ) : (
                widgets.map((w, idx) => (
                  <WidgetCard
                    key={w.id || `${w.categoria}-${w.tipo}-${w.metrica}-${idx}`}
                    widget={w}
                    idx={idx}
                    editMode={editMode}
                    onRemove={() => saveWidgets(widgets.filter((_, i) => i !== idx))}
                    onUpdate={(updated) => saveWidgets(widgets.map((x, i) => i === idx ? updated : x))}
                  />
                ))
              )}
              {editMode && !widgetsLoading && (
                <AddWidgetCard
                  canVerEmpresa={canVerEmpresa}
                  onAdd={(newWidget) => saveWidgets([...widgets, newWidget])}
                />
              )}
              </section>
            </>
          )}
          {esPantallaDashboard ? null : (
            <div
              key={pantalla}
              className={`dashboard-screen-shell ${pantalla === 'nueva-venta' ? 'dashboard-screen-shell--full-height' : ''}`}
            >
              <Suspense fallback={<div className="dashboard-screen-loading" />}>
                {pantalla === 'nueva-venta' && contenidoPantalla
                  ? cloneElement(contenidoPantalla, {
                      carritoDrawerOpen: ventasCarritoAbierto,
                      onToggleCarritoDrawer: toggleVentasCarritoDrawer,
                    })
                  : contenidoPantalla}
              </Suspense>
            </div>
          )}
        </div>

        {/* Panel de filtros y acciones — mobile */}
        <div
          className={`filter-panel-overlay ${filterPanelOpen ? 'open' : ''}`}
          onClick={() => setFilterPanelOpen(false)}
          aria-hidden={!filterPanelOpen}
        >
          <aside
            className="filter-panel-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Filtros y acciones"
          >
            <div className="filter-panel-head">
              <h3>Filtros y acciones</h3>
              <button
                id="dashboard-filter-close"
                type="button"
                className="filter-panel-close"
                onClick={() => setFilterPanelOpen(false)}
                aria-label="Cerrar panel"
              >
                ✕
              </button>
            </div>
            <div className="filter-panel-body" ref={containerRefCb} />
          </aside>
        </div>
      </main>
    </div>
  );
}
