import { lazy, Suspense, useState } from 'react';
import { usePermisos } from '../../core/PermisosContext';
import { useConfig } from '../../core/ConfigContext';
import './Stock.css';

const ControlStock = lazy(() => import('./ControlStock'));
const FlujoStock = lazy(() => import('../flujo-stock/FlujoStock'));

/**
 * Sección Stock: combina Control de Stock y Flujo de Stock en pestañas.
 * Cada pestaña se muestra solo si el usuario tiene el permiso correspondiente
 * (stock:ver / flujo-stock:ver) y su módulo está habilitado (control-stock / flujo-stock).
 */
export default function Stock({ productos, setProductos, initialTab = 'control' }) {
  const { can } = usePermisos();
  const { modulos } = useConfig();

  const moduloHabilitado = (codigo) => {
    if (!modulos || modulos.length === 0) return true;
    const mod = modulos.find((m) => m.codigo === codigo);
    return mod ? mod.habilitado : true;
  };

  const puedeControl = can('stock', 'ver') && moduloHabilitado('control-stock');
  const puedeFlujo = can('flujo-stock', 'ver') && moduloHabilitado('flujo-stock');

  const tabs = [];
  if (puedeControl) tabs.push({ key: 'control', label: 'Control de Stock' });
  if (puedeFlujo) tabs.push({ key: 'flujo', label: 'Flujo de Stock' });

  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab === 'flujo' && puedeFlujo) return 'flujo';
    if (initialTab === 'control' && puedeControl) return 'control';
    return tabs[0]?.key ?? 'control';
  });

  if (tabs.length === 0) {
    return (
      <div className="stock-section stock-section--empty">
        <div className="dashboard-placeholder">
          <span className="placeholder-icon">🔒</span>
          <h2>Acceso restringido</h2>
          <p>No tenés permisos para ver esta sección.</p>
        </div>
      </div>
    );
  }

  const current = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0].key;

  return (
    <div className="stock-section">
      <div className="stock-tabs" role="tablist" aria-label="Secciones de stock">
        {tabs.map((t) => (
          <button
            id={`stock-tab-${t.key}`}
            key={t.key}
            type="button"
            role="tab"
            aria-selected={current === t.key}
            className={`stock-tab-btn ${current === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="stock-tab-panel" role="tabpanel">
        <Suspense fallback={<div className="dashboard-screen-loading" />}>
          {current === 'control' && (
            <ControlStock productos={productos} setProductos={setProductos} />
          )}
          {current === 'flujo' && <FlujoStock productos={productos} />}
        </Suspense>
      </div>
    </div>
  );
}
