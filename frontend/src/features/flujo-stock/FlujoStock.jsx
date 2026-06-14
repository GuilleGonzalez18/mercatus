import { useEffect, useMemo, useRef, useState } from 'react';
import { useLottie } from 'lottie-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TbFileSpreadsheet, TbFileTypePdf } from 'react-icons/tb';
import { api } from '../../core/api';
import { useConfig } from '../../core/ConfigContext';
import { getPrimaryRgb, loadLogoForPdf } from '../../shared/lib/pdfColors';
import AppInput from '../../shared/components/fields/AppInput';
import AppButton from '../../shared/components/button/AppButton';
import semanaAnim from './animations/semana.json';
import mesAnim from './animations/mes.json';
import anioAnim from './animations/anio.json';
import './FlujoStock.css';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function qty(value) {
  const n = Number(value || 0);
  return n.toLocaleString('es-UY', { maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dayLabel(fecha) {
  // fecha = 'YYYY-MM-DD' → 'DD/MM'
  const [, m, d] = String(fecha || '').split('-');
  if (!m || !d) return String(fecha || '');
  return `${d}/${m}`;
}

function monthLabel(mes) {
  // mes = 'YYYY-MM' → 'Ene' (con año si cambia)
  const [y, m] = String(mes || '').split('-');
  const idx = Number(m) - 1;
  const nombre = MESES_CORTOS[idx] || mes;
  return `${nombre}/${String(y || '').slice(2)}`;
}

function LottieIcon({ animationData }) {
  const { View } = useLottie({ animationData, loop: true, autoplay: true });
  return View;
}

function FlujoTooltip({ active, payload, label, unidad }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value || 0);
  return (
    <div className="flujo-tooltip">
      <strong>{label}</strong>
      <span>{qty(value)} {unidad || 'u.'}</span>
    </div>
  );
}

function MetricCard({ titulo, descripcion, valor, unidadLabel, animationData, chartData, themeColor, referenceValue = null, referenceLabel = '' }) {
  return (
    <article className="flujo-metric-card">
      <div className="flujo-metric-head">
        <div className="flujo-metric-lottie" aria-hidden="true">
          <LottieIcon animationData={animationData} />
        </div>
        <div className="flujo-metric-heading">
          <span className="flujo-metric-kicker">{titulo}</span>
          <strong className="flujo-metric-value">{qty(valor)} <small>{unidadLabel}</small></strong>
          <span className="flujo-metric-desc">{descripcion}</span>
        </div>
      </div>
      {chartData.length ? (
        <div className="flujo-metric-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 14, left: -6, bottom: 4 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#dce7f4" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={18}
                tick={{ fill: themeColor.textMuted, fontSize: 11, fontWeight: 700 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={36}
                tick={{ fill: themeColor.textMuted, fontSize: 11, fontWeight: 700 }}
              />
              <Tooltip
                content={<FlujoTooltip unidad={unidadLabel} />}
                isAnimationActive={false}
                wrapperStyle={{ pointerEvents: 'none' }}
              />
              {referenceValue != null && (
                <ReferenceLine
                  y={referenceValue}
                  stroke={themeColor.primaryStrong}
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  label={{ value: referenceLabel, position: 'insideTopRight', fill: themeColor.primaryStrong, fontSize: 10, fontWeight: 700 }}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke={themeColor.primary}
                strokeWidth={3}
                isAnimationActive={false}
                dot={{ r: 3, fill: '#ffffff', stroke: themeColor.primary, strokeWidth: 2 }}
                activeDot={{ r: 5, fill: '#ffffff', stroke: themeColor.primary, strokeWidth: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flujo-metric-empty">Sin datos para mostrar.</div>
      )}
    </article>
  );
}

export default function FlujoStock({ productos = [] }) {
  const themeColor = useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      primary: cs.getPropertyValue('--color-primary').trim() || '#cc2222',
      primaryStrong: cs.getPropertyValue('--color-primary-strong').trim() || '#8f0e0e',
      textMuted: cs.getPropertyValue('--color-text-muted').trim() || '#526278',
    };
  }, []);

  const { empresa } = useConfig();
  const [busqueda, setBusqueda] = useState('');
  const [productoId, setProductoId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const [exportError, setExportError] = useState('');
  const reqIdRef = useRef(0);

  const productosActivos = useMemo(() => (
    (productos || [])
      .filter((p) => p.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  ), [productos]);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productosActivos;
    return productosActivos.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [busqueda, productosActivos]);

  // Producto efectivo: el seleccionado o, si no hay, el primero de la lista.
  const selectedId = productoId ?? productosActivos[0]?.id ?? null;

  useEffect(() => {
    if (selectedId == null) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError('');
    api.getFlujoStock(selectedId)
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        setData(res);
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        setData(null);
        setError(err?.message || 'No se pudo cargar el flujo de stock.');
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
  }, [selectedId]);

  // Siempre "unidades" del producto, sin la unidad de medida (evita confundir
  // "2 botellas de 2L" con "2 litros").
  const unidadLabel = 'unidades';

  const fetchResumen = async () => {
    const res = await api.getFlujoStockResumen();
    return Array.isArray(res?.items) ? res.items : [];
  };

  const exportarExcel = async () => {
    setExportando(true);
    setExportError('');
    try {
      const items = await fetchResumen();
      const rowsHtml = items.map((it, idx) => {
        const zebra = idx % 2 === 0 ? '#f7faff' : '#ffffff';
        return `
          <tr style="background:${zebra}">
            <td>${escapeHtml(it.nombre)}</td>
            <td style="text-align:center">${qty(it.semana)}</td>
            <td style="text-align:center">${qty(it.mes)}</td>
            <td style="text-align:center">${qty(it.promedioMensual)}</td>
          </tr>`;
      }).join('');
      const html = `
        <html><head><meta charset="UTF-8" /></head><body>
          <h3 style="color:#cc2222;margin:0 0 10px">Flujo de Stock — Unidades vendidas por producto</h3>
          <table border="1" style="border-collapse:collapse;width:100%">
            <thead>
              <tr style="background:#cc2222;color:#fff">
                <th>Producto</th>
                <th>Última semana (unidades)</th>
                <th>Último mes (unidades)</th>
                <th>Promedio mensual (unidades/año)</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'flujo-stock.xls';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err?.message || 'No se pudo exportar el Excel.');
    } finally {
      setExportando(false);
    }
  };

  const exportarPDF = async () => {
    setExportando(true);
    setExportError('');
    try {
      const items = await fetchResumen();
      const doc = new jsPDF();
      const fecha = new Date().toLocaleDateString('es-UY');
      const logo = await loadLogoForPdf(empresa?.logo_base64, '#ffffff');
      if (logo) doc.addImage(logo.dataUrl, 'JPEG', 10, 10, 40, 20);
      doc.setFontSize(16);
      doc.text('Flujo de Stock — Unidades vendidas', 55, 18);
      doc.setFontSize(10);
      doc.text('Cantidad de unidades vendidas por producto', 55, 24);
      doc.text(`Emitido: ${fecha}`, 55, 29);
      autoTable(doc, {
        startY: 36,
        head: [['Producto', 'Última semana\n(unidades)', 'Último mes\n(unidades)', 'Promedio mensual\n(unidades/año)']],
        body: items.map((it) => [
          it.nombre,
          qty(it.semana),
          qty(it.mes),
          qty(it.promedioMensual),
        ]),
        styles: { fontSize: 9 },
        columnStyles: {
          1: { halign: 'center' },
          2: { halign: 'center' },
          3: { halign: 'center' },
        },
        headStyles: { fillColor: getPrimaryRgb() },
      });
      doc.save('flujo-stock.pdf');
    } catch (err) {
      setExportError(err?.message || 'No se pudo exportar el PDF.');
    } finally {
      setExportando(false);
    }
  };

  const semanaChart = useMemo(() => (
    (data?.semana?.serie || []).map((r) => ({ label: dayLabel(r.fecha), value: r.unidades }))
  ), [data]);

  const mesChart = useMemo(() => (
    (data?.mes?.serie || []).map((r) => ({ label: dayLabel(r.fecha), value: r.unidades }))
  ), [data]);

  const anioChart = useMemo(() => (
    (data?.anio?.serie || []).map((r) => ({ label: monthLabel(r.mes), value: r.unidades }))
  ), [data]);

  const productoSeleccionado = productosActivos.find((p) => p.id === selectedId);

  return (
    <div className="flujo-stock">
      <aside className="flujo-list">
        <div className="flujo-list-head">
          <h3>Productos</h3>
          <AppInput
            type="search"
            placeholder="Buscar producto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <div className="flujo-export-actions">
            <AppButton
              type="button"
              className="flujo-export-btn"
              onClick={exportarExcel}
              disabled={exportando}
              title="Exportar todos los productos a Excel"
            >
              <TbFileSpreadsheet aria-hidden="true" />
              <span>Excel</span>
            </AppButton>
            <AppButton
              type="button"
              className="flujo-export-btn"
              onClick={exportarPDF}
              disabled={exportando}
              title="Exportar todos los productos a PDF"
            >
              <TbFileTypePdf aria-hidden="true" />
              <span>PDF</span>
            </AppButton>
          </div>
          {exportError && <p className="flujo-export-error">{exportError}</p>}
        </div>
        <div className="flujo-list-items">
          {productosFiltrados.length === 0 && (
            <p className="flujo-list-empty">No hay productos para mostrar.</p>
          )}
          {productosFiltrados.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`flujo-list-item ${p.id === selectedId ? 'active' : ''}`}
              onClick={() => setProductoId(p.id)}
            >
              <span className="flujo-list-item-name">{p.nombre}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flujo-detail">
        {selectedId == null ? (
          <div className="flujo-detail-placeholder">No hay productos para mostrar.</div>
        ) : (
          <>
            <header className="flujo-detail-head">
              <h2>{productoSeleccionado?.nombre || data?.producto?.nombre || 'Producto'}</h2>
              <p>Unidades vendidas — ventas no canceladas, por fecha de venta.</p>
            </header>

            {loading && <div className="flujo-msg">Cargando flujo de stock...</div>}
            {!loading && error && <div className="flujo-msg error">{error}</div>}

            {!loading && !error && data && (
              <div className="flujo-metrics-grid">
                <MetricCard
                  titulo="Última semana"
                  descripcion="Unidades vendidas en los últimos 7 días"
                  valor={data.semana?.total || 0}
                  unidadLabel={unidadLabel}
                  animationData={semanaAnim}
                  chartData={semanaChart}
                  themeColor={themeColor}
                />
                <MetricCard
                  titulo="Último mes"
                  descripcion="Unidades vendidas en los últimos 30 días"
                  valor={data.mes?.total || 0}
                  unidadLabel={unidadLabel}
                  animationData={mesAnim}
                  chartData={mesChart}
                  themeColor={themeColor}
                />
                <MetricCard
                  titulo="Promedio mensual (último año)"
                  descripcion="Promedio de unidades vendidas por mes en los últimos 12 meses"
                  valor={data.anio?.promedioMensual || 0}
                  unidadLabel={unidadLabel}
                  animationData={anioAnim}
                  chartData={anioChart}
                  themeColor={themeColor}
                  referenceValue={data.anio?.promedioMensual || 0}
                  referenceLabel="Promedio"
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
