import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../core/api';
import { useConfig } from '../../core/ConfigContext';
import { usePermisos } from '../../core/PermisosContext';
import { getPrimaryRgb, loadLogoForPdf } from '../../shared/lib/pdfColors';
import './Auditoria.css';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import AppTable from '../../shared/components/table/AppTable';
import AppInput from '../../shared/components/fields/AppInput';
import AppSelect from '../../shared/components/fields/AppSelect';
import AppButton from '../../shared/components/button/AppButton';
import { FilterSlot } from '../../shared/lib/filterPanel';

const PAGE_SIZE = 50;

function lastNDaysISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n + 1);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-UY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatQty(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString('es-UY') : String(value ?? '-');
}

export default function Auditoria() {
  const { empresa } = useConfig();
  const { can } = usePermisos();
  const puedeExportar = can('auditoria', 'exportar');
  const [activeTab, setActiveTab] = useState('movimientos');

  // --- Rango de fechas compartido ---
  const [desde, setDesde] = useState(() => lastNDaysISO(7));
  const [hasta, setHasta] = useState(() => todayISO());

  // --- Estado de movimientos ---
  const [movimientos, setMovimientos] = useState([]);
  const [movTotal, setMovTotal] = useState(0);
  const [movPage, setMovPage] = useState(1);
  const [metaMov, setMetaMov] = useState({ origenes: [], usuarios: [] });
  const [loadingMov, setLoadingMov] = useState(false);
  const [errorMov, setErrorMov] = useState('');

  // Filtros de movimientos
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroOrigenMov, setFiltroOrigenMov] = useState('todos');
  const [filtroUsuarioMov, setFiltroUsuarioMov] = useState('todos');
  const [filtroTextoMov, setFiltroTextoMov] = useState('');
  const [textoMovFetch, setTextoMovFetch] = useState('');
  const textMovRef = useRef(null);

  // --- Estado de eventos ---
  const [eventos, setEventos] = useState([]);
  const [evTotal, setEvTotal] = useState(0);
  const [evPage, setEvPage] = useState(1);
  const [metaEv, setMetaEv] = useState({ acciones: [], usuarios: [] });
  const [loadingEv, setLoadingEv] = useState(false);
  const [errorEv, setErrorEv] = useState('');

  // Filtros de eventos
  const [filtroAccionEvento, setFiltroAccionEvento] = useState('todos');
  const [filtroUsuarioEvento, setFiltroUsuarioEvento] = useState('todos');
  const [filtroTextoEvento, setFiltroTextoEvento] = useState('');
  const [textoEvFetch, setTextoEvFetch] = useState('');
  const textEvRef = useRef(null);

  // Carga de movimientos
  useEffect(() => {
    let cancelled = false;
    setLoadingMov(true);
    setErrorMov('');
    const params = { page: movPage, pageSize: PAGE_SIZE };
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    if (filtroTipo !== 'todos') params.tipo = filtroTipo;
    if (filtroOrigenMov !== 'todos') params.origen = filtroOrigenMov;
    if (filtroUsuarioMov !== 'todos') params.usuario = filtroUsuarioMov;
    if (textoMovFetch) params.q = textoMovFetch;
    api.getMovimientosStock(params)
      .then((data) => {
        if (cancelled) return;
        setMovimientos(data.rows ?? []);
        setMovTotal(data.total ?? 0);
        setMetaMov(data.meta ?? { origenes: [], usuarios: [] });
      })
      .catch((err) => { if (!cancelled) setErrorMov(err.message || 'No se pudieron cargar los movimientos.'); })
      .finally(() => { if (!cancelled) setLoadingMov(false); });
    return () => { cancelled = true; };
  }, [desde, hasta, movPage, filtroTipo, filtroOrigenMov, filtroUsuarioMov, textoMovFetch]);

  // Carga de eventos
  useEffect(() => {
    let cancelled = false;
    setLoadingEv(true);
    setErrorEv('');
    const params = { page: evPage, pageSize: PAGE_SIZE };
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    if (filtroAccionEvento !== 'todos') params.accion = filtroAccionEvento;
    if (filtroUsuarioEvento !== 'todos') params.usuario = filtroUsuarioEvento;
    if (textoEvFetch) params.q = textoEvFetch;
    api.getAuditoriaEventos(params)
      .then((data) => {
        if (cancelled) return;
        setEventos(data.rows ?? []);
        setEvTotal(data.total ?? 0);
        setMetaEv(data.meta ?? { acciones: [], usuarios: [] });
      })
      .catch((err) => { if (!cancelled) setErrorEv(err.message || 'No se pudieron cargar los eventos.'); })
      .finally(() => { if (!cancelled) setLoadingEv(false); });
    return () => { cancelled = true; };
  }, [desde, hasta, evPage, filtroAccionEvento, filtroUsuarioEvento, textoEvFetch]);

  // Debounce para texto de movimientos
  const handleTextoMovChange = useCallback((value) => {
    setFiltroTextoMov(value);
    clearTimeout(textMovRef.current);
    textMovRef.current = setTimeout(() => {
      setMovPage(1);
      setTextoMovFetch(value);
    }, 400);
  }, []);

  // Debounce para texto de eventos
  const handleTextoEvChange = useCallback((value) => {
    setFiltroTextoEvento(value);
    clearTimeout(textEvRef.current);
    textEvRef.current = setTimeout(() => {
      setEvPage(1);
      setTextoEvFetch(value);
    }, 400);
  }, []);

  const limpiarFechas = useCallback(() => {
    setDesde('');
    setHasta('');
    setMovPage(1);
    setEvPage(1);
  }, []);

  // Paginación movimientos
  const movTotalPages = Math.max(1, Math.ceil(movTotal / PAGE_SIZE));
  const movRange = movTotal === 0
    ? 'Mostrando 0 de 0'
    : `Mostrando ${(movPage - 1) * PAGE_SIZE + 1}-${Math.min(movPage * PAGE_SIZE, movTotal)} de ${movTotal}`;

  // Paginación eventos
  const evTotalPages = Math.max(1, Math.ceil(evTotal / PAGE_SIZE));
  const evRange = evTotal === 0
    ? 'Mostrando 0 de 0'
    : `Mostrando ${(evPage - 1) * PAGE_SIZE + 1}-${Math.min(evPage * PAGE_SIZE, evTotal)} de ${evTotal}`;

  const getRangoLabel = () => {
    if (!desde && !hasta) return 'Todo el período disponible';
    if (desde && hasta) return `${desde} a ${hasta}`;
    if (desde) return `Desde ${desde}`;
    return `Hasta ${hasta}`;
  };

  const withHeaderLogo = async (doc) => {
    const fecha = new Date().toLocaleDateString();
    const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
    if (logo) {
      doc.addImage(logo.dataUrl, 'JPEG', 10, 10, 40, 20);
    }
    doc.setFontSize(10);
    doc.text(`Emitido: ${fecha}`, 55, 28);
    doc.text(`Rango: ${getRangoLabel()}`, 55, 33);
    return 40;
  };

  const exportarStockPDF = async () => {
    try {
      const params = { page: 1, pageSize: 10000 };
      if (desde) params.desde = desde;
      if (hasta) params.hasta = hasta;
      if (filtroTipo !== 'todos') params.tipo = filtroTipo;
      if (filtroOrigenMov !== 'todos') params.origen = filtroOrigenMov;
      if (filtroUsuarioMov !== 'todos') params.usuario = filtroUsuarioMov;
      if (textoMovFetch) params.q = textoMovFetch;
      const allData = await api.getMovimientosStock(params);
      const allMovimientos = allData.rows ?? [];
      const doc = new jsPDF();
      const startY = await withHeaderLogo(doc);
      autoTable(doc, {
        startY,
        head: [['Fecha', 'Producto', 'Tipo', 'Origen', 'Cantidad', 'Stock', 'Usuario']],
        body: allMovimientos.map((m) => [
          formatDateTime(m.created_at),
          m.producto_nombre || `#${m.producto_id}`,
          m.tipo === 'entrada' ? 'Entrada' : 'Salida',
          m.origen,
          formatQty(m.cantidad),
          `${formatQty(m.stock_anterior)} -> ${formatQty(m.stock_nuevo)}`,
          m.usuario_nombre || '-',
        ]),
        styles: { fontSize: 8.8 },
        headStyles: { fillColor: getPrimaryRgb() },
      });
      doc.save('auditoria-stock.pdf');
    } catch {
      // silencioso: el usuario ve que no se descargó el archivo
    }
  };

  const movimientosColumns = useMemo(() => ([
    {
      key: 'fecha',
      header: 'Fecha',
      mobileLabel: 'Fecha',
      render: (m) => formatDateTime(m.created_at),
    },
    {
      key: 'producto',
      header: 'Producto',
      mobileLabel: 'Producto',
      render: (m) => m.producto_nombre || `#${m.producto_id}`,
    },
    {
      key: 'tipo',
      header: 'Tipo',
      mobileLabel: 'Tipo',
      render: (m) => (
        <span className={m.tipo === 'entrada' ? 'tag in' : 'tag out'}>
          {m.tipo === 'entrada' ? 'Entrada' : 'Salida'}
        </span>
      ),
    },
    {
      key: 'origen',
      header: 'Origen',
      mobileLabel: 'Origen',
      mobileHide: true,
      accessor: 'origen',
    },
    {
      key: 'cantidad',
      header: 'Cantidad',
      mobileLabel: 'Cantidad',
      align: 'right',
      render: (m) => formatQty(m.cantidad),
    },
    {
      key: 'stock',
      header: 'Stock',
      mobileLabel: 'Stock',
      mobileHide: true,
      render: (m) => `${formatQty(m.stock_anterior)} -> ${formatQty(m.stock_nuevo)}`,
    },
    {
      key: 'usuario',
      header: 'Usuario',
      mobileLabel: 'Usuario',
      render: (m) => m.usuario_nombre || '-',
    },
  ]), []);

  const eventosColumns = useMemo(() => ([
    {
      key: 'fecha',
      header: 'Fecha',
      mobileLabel: 'Fecha',
      render: (e) => formatDateTime(e.created_at),
    },
    {
      key: 'entidad',
      header: 'Entidad',
      mobileLabel: 'Entidad',
      render: (e) => `${e.entidad} #${e.entidad_id ?? '-'}`,
    },
    {
      key: 'accion',
      header: 'Acción',
      mobileLabel: 'Acción',
      accessor: 'accion',
    },
    {
      key: 'detalle',
      header: 'Detalle',
      mobileLabel: 'Detalle',
      render: (e) => e.detalle || '-',
    },
    {
      key: 'usuario',
      header: 'Usuario',
      mobileLabel: 'Usuario',
      render: (e) => e.usuario_nombre || '-',
    },
  ]), []);

  const loading = activeTab === 'movimientos' ? loadingMov : loadingEv;
  const error = activeTab === 'movimientos' ? errorMov : errorEv;

  return (
    <div className="auditoria-main">
      <FilterSlot>
        <div className="auditoria-fecha-range">
          <AppInput
            type="date"
            value={desde}
            onChange={(e) => { setDesde(e.target.value); setMovPage(1); setEvPage(1); }}
            title="Desde"
          />
          <AppInput
            type="date"
            value={hasta}
            onChange={(e) => { setHasta(e.target.value); setMovPage(1); setEvPage(1); }}
            title="Hasta"
          />
          <AppButton type="button" className="audit-btn secondary" onClick={limpiarFechas} disabled={!desde && !hasta}>
            Limpiar fechas
          </AppButton>
        </div>
      </FilterSlot>

      <div className="auditoria-tabs" role="tablist" aria-label="Secciones de auditoría">
        <button
          type="button"
          role="tab"
          className={`auditoria-tab ${activeTab === 'movimientos' ? 'active' : ''}`}
          aria-selected={activeTab === 'movimientos'}
          onClick={() => setActiveTab('movimientos')}
        >
          Movimientos de stock
        </button>
        <button
          type="button"
          role="tab"
          className={`auditoria-tab ${activeTab === 'eventos' ? 'active' : ''}`}
          aria-selected={activeTab === 'eventos'}
          onClick={() => setActiveTab('eventos')}
        >
          Eventos de auditoría
        </button>
      </div>

      {loading && <div className="auditoria-msg">Cargando auditoría...</div>}
      {!loading && error && <div className="auditoria-msg error">{error}</div>}

      {!loading && !error && (
        <>
          <section
            className={`auditoria-card ${activeTab === 'movimientos' ? '' : 'auditoria-card-hidden'}`}
            role="tabpanel"
            hidden={activeTab !== 'movimientos'}
          >
            <div className="auditoria-card-head">
              <h4>Movimientos de stock</h4>
              {puedeExportar && (
                <AppButton type="button" className="audit-btn" onClick={exportarStockPDF}>PDF stock</AppButton>
              )}
            </div>
            <div className="auditoria-card-filtros">
              <AppSelect value={filtroTipo} onChange={(e) => { setFiltroTipo(e.target.value); setMovPage(1); }}>
                <option value="todos">Tipo: todos</option>
                <option value="entrada">Tipo: entrada</option>
                <option value="salida">Tipo: salida</option>
              </AppSelect>
              <AppSelect value={filtroOrigenMov} onChange={(e) => { setFiltroOrigenMov(e.target.value); setMovPage(1); }}>
                <option value="todos">Origen: todos</option>
                {metaMov.origenes.map((origen) => (
                  <option key={origen} value={origen}>{origen}</option>
                ))}
              </AppSelect>
              <AppSelect value={filtroUsuarioMov} onChange={(e) => { setFiltroUsuarioMov(e.target.value); setMovPage(1); }}>
                <option value="todos">Usuario: todos</option>
                {metaMov.usuarios.map((usuario) => (
                  <option key={usuario} value={usuario}>{usuario}</option>
                ))}
              </AppSelect>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => {
                  setFiltroTipo('todos');
                  setFiltroOrigenMov('todos');
                  setFiltroUsuarioMov('todos');
                  setFiltroTextoMov('');
                  clearTimeout(textMovRef.current);
                  setTextoMovFetch('');
                  setMovPage(1);
                }}
              >
                Limpiar filtros
              </AppButton>
              <AppInput
                type="text"
                className="table-search-field"
                placeholder="Buscar por producto o detalle..."
                value={filtroTextoMov}
                onChange={(e) => handleTextoMovChange(e.target.value)}
              />
            </div>
            <AppTable
              stickyHeader
              columns={movimientosColumns}
              rows={movimientos}
              rowKey="id"
              minWidth={980}
              emptyMessage="No hay movimientos para los filtros seleccionados."
            />
            <div className="auditoria-pager">
              <span className="auditoria-range">{movRange}</span>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setMovPage(1)}
                disabled={movPage <= 1}
                title="Primera página"
                aria-label="Primera página"
              >
                ⏮
              </AppButton>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setMovPage((p) => Math.max(1, p - 1))}
                disabled={movPage <= 1}
                title="Página anterior"
                aria-label="Página anterior"
              >
                ◀
              </AppButton>
              <span>Página {movPage} de {movTotalPages}</span>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setMovPage((p) => Math.min(movTotalPages, p + 1))}
                disabled={movPage >= movTotalPages}
                title="Página siguiente"
                aria-label="Página siguiente"
              >
                ▶
              </AppButton>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setMovPage(movTotalPages)}
                disabled={movPage >= movTotalPages}
                title="Última página"
                aria-label="Última página"
              >
                ⏭
              </AppButton>
            </div>
          </section>

          <section
            className={`auditoria-card ${activeTab === 'eventos' ? '' : 'auditoria-card-hidden'}`}
            role="tabpanel"
            hidden={activeTab !== 'eventos'}
          >
            <div className="auditoria-card-head">
              <h4>Eventos de auditoría (altas, ediciones y eliminaciones)</h4>
            </div>
            <div className="auditoria-card-filtros">
              <AppSelect value={filtroAccionEvento} onChange={(e) => { setFiltroAccionEvento(e.target.value); setEvPage(1); }}>
                <option value="todos">Acción: todas</option>
                {metaEv.acciones.map((accion) => (
                  <option key={accion} value={accion}>{accion}</option>
                ))}
              </AppSelect>
              <AppSelect value={filtroUsuarioEvento} onChange={(e) => { setFiltroUsuarioEvento(e.target.value); setEvPage(1); }}>
                <option value="todos">Usuario: todos</option>
                {metaEv.usuarios.map((usuario) => (
                  <option key={usuario} value={usuario}>{usuario}</option>
                ))}
              </AppSelect>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => {
                  setFiltroAccionEvento('todos');
                  setFiltroUsuarioEvento('todos');
                  setFiltroTextoEvento('');
                  clearTimeout(textEvRef.current);
                  setTextoEvFetch('');
                  setEvPage(1);
                }}
              >
                Limpiar filtros
              </AppButton>
              <AppInput
                type="text"
                className="table-search-field"
                placeholder="Buscar por entidad, acción o detalle..."
                value={filtroTextoEvento}
                onChange={(e) => handleTextoEvChange(e.target.value)}
              />
            </div>
            <AppTable
              stickyHeader
              columns={eventosColumns}
              rows={eventos}
              rowKey="id"
              minWidth={860}
              emptyMessage="No hay eventos para los filtros seleccionados."
            />
            <div className="auditoria-pager">
              <span className="auditoria-range">{evRange}</span>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setEvPage(1)}
                disabled={evPage <= 1}
                title="Primera página"
                aria-label="Primera página"
              >
                ⏮
              </AppButton>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setEvPage((p) => Math.max(1, p - 1))}
                disabled={evPage <= 1}
                title="Página anterior"
                aria-label="Página anterior"
              >
                ◀
              </AppButton>
              <span>Página {evPage} de {evTotalPages}</span>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setEvPage((p) => Math.min(evTotalPages, p + 1))}
                disabled={evPage >= evTotalPages}
                title="Página siguiente"
                aria-label="Página siguiente"
              >
                ▶
              </AppButton>
              <AppButton
                type="button"
                className="audit-btn secondary"
                onClick={() => setEvPage(evTotalPages)}
                disabled={evPage >= evTotalPages}
                title="Última página"
                aria-label="Última página"
              >
                ⏭
              </AppButton>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
