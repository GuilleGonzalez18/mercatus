import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../core/api';
import { useConfig } from '../../core/ConfigContext';
import { getPrimaryRgb, loadLogoForPdf } from '../../shared/lib/pdfColors';
import { getPdfConfig } from '../../shared/lib/pdfConfigDefaults';
import './VentasHistorial.css';
import { FilterSlot } from '../../shared/lib/filterPanel';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { RiFileExcel2Line, RiSendPlaneFill } from 'react-icons/ri';
import { PiFilePdfBold } from 'react-icons/pi';
import { AiFillPrinter } from 'react-icons/ai';
import { FaReplyAll } from 'react-icons/fa6';
import { appAlert, appConfirm } from '../../shared/lib/appDialog';
import { formatHorarioCliente } from '../../shared/lib/horarios';
import AppTable from '../../shared/components/table/AppTable';
import AppInput from '../../shared/components/fields/AppInput';
import AppSelect from '../../shared/components/fields/AppSelect';
import AppButton from '../../shared/components/button/AppButton';
import { PDF_FONT_FAMILY, PRINT_FONT_FAMILY_CSS } from '../../shared/lib/typography';

function todayISO() {
  const now = new Date();
  return toISODateValue(now);
}

function toISODateValue(value) {
  const date = new Date(value);
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
}

function yesterdayISO() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - 1);
  return toISODateValue(now);
}

function weekRangeISO() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { desde: toISODateValue(start), hasta: toISODateValue(end) };
}

function previousWeekRangeISO() {
  const current = weekRangeISO();
  const start = new Date(`${current.desde}T00:00:00`);
  start.setDate(start.getDate() - 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { desde: toISODateValue(start), hasta: toISODateValue(end) };
}

function monthRangeISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { desde: toISODateValue(start), hasta: toISODateValue(end) };
}

function previousMonthRangeISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { desde: toISODateValue(start), hasta: toISODateValue(end) };
}

function tomorrowISO() {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + 1);
  const tzOffset = base.getTimezoneOffset() * 60000;
  return new Date(base.getTime() - tzOffset).toISOString().slice(0, 10);
}

function formatCurrency(value) {
  const num = Math.round(Number(value || 0) * 100) / 100;
  return `$${num.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function formatDateOnly(value) {
  if (!value) return '-';
  // Extraer solo YYYY-MM-DD del string (maneja tanto "2026-05-23" como "2026-05-23T00:00:00.000Z")
  // y construir como fecha LOCAL para evitar el desplazamiento UTC-X.
  const iso = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(value);
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-UY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function toISODateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
}

function formatMedioPago(value) {
  const v = String(value || 'efectivo').toLowerCase();
  if (v === 'credito') return 'Crédito';
  if (v === 'debito') return 'Débito';
  if (v === 'transferencia') return 'Transferencia';
  return 'Efectivo';
}

function formatPagosResumen(pagos = []) {
  if (!Array.isArray(pagos) || pagos.length === 0) return '-';
  const labels = [...new Set(pagos.map((p) => formatMedioPago(p.medio_pago)))];
  return labels.join(' + ');
}

function normalizeWhatsappPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('598')) return digits;
  if (digits.startsWith('0')) return `598${digits.slice(1)}`;
  if (digits.length <= 9) return `598${digits}`;
  return digits;
}

function formatHorarioClienteEntrega(venta) {
  return formatHorarioCliente({
    horario_apertura: venta?.cliente_horario_apertura,
    horario_cierre: venta?.cliente_horario_cierre,
    tiene_reapertura: venta?.cliente_tiene_reapertura,
    horario_reapertura: venta?.cliente_horario_reapertura,
    horario_cierre_reapertura: venta?.cliente_horario_cierre_reapertura,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizarEstadoEntrega(venta) {
  if (venta?.cancelada) return 'cancelado';
  if (String(venta?.estado_entrega || '').toLowerCase() === 'cancelado') return 'cancelado';
  if (String(venta?.estado_entrega || '').toLowerCase() === 'entregado') return 'entregado';
  return venta?.entregado ? 'entregado' : 'pendiente';
}

export default function VentasHistorial() {
  const { empresa } = useConfig();
  const cfeHabilitado = empresa?.cfe_habilitado === true;
  const [desde, setDesde] = useState(todayISO());
  const [hasta, setHasta] = useState(todayISO());
  const [rangoActivo, setRangoActivo] = useState('hoy');
  const [estadoFiltro, setEstadoFiltro] = useState('todos');
  const [vendedorFiltro, setVendedorFiltro] = useState('');
  const [clienteFiltro, setClienteFiltro] = useState('');
  const [cfeFiltro, setCfeFiltro] = useState('todos');
  const [ventas, setVentas] = useState([]);
  const [sortBy, setSortBy] = useState('id');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [printingId, setPrintingId] = useState(null);
  const [updatingEntregaId, setUpdatingEntregaId] = useState(null);
  const [cancelandoVentaId, setCancelandoVentaId] = useState(null);
  const [eliminandoVentaId, setEliminandoVentaId] = useState(null);
  const [expandedVentaId, setExpandedVentaId] = useState(null);
  const [detalleByVentaId, setDetalleByVentaId] = useState({});
  const [loadingDetalleId, setLoadingDetalleId] = useState(null);
  const [exportingEntregas, setExportingEntregas] = useState(false);
  const [modalExportOpen, setModalExportOpen] = useState(false);
  const [modalTicketsOpen, setModalTicketsOpen] = useState(false);
  const [printingBatch, setPrintingBatch] = useState(false);
  const [ticketsDesde, setTicketsDesde] = useState(todayISO());
  const [ticketsHasta, setTicketsHasta] = useState(todayISO());
  const [ticketsTipo, setTicketsTipo] = useState('factura');
  const [ticketsFiltroFecha, setTicketsFiltroFecha] = useState('entrega');
  const [modalTipoImpresionVentaId, setModalTipoImpresionVentaId] = useState(null);
  const [entregasDesde, setEntregasDesde] = useState(todayISO());
  const [entregasHasta, setEntregasHasta] = useState(todayISO());
  const [modalConsolidadoOpen, setModalConsolidadoOpen] = useState(false);
  const [exportingConsolidado, setExportingConsolidado] = useState(false);
  const [consolidadoDesde, setConsolidadoDesde] = useState(todayISO());
  const [consolidadoHasta, setConsolidadoHasta] = useState(todayISO());
  const [cfeModalData, setCfeModalData] = useState(null);
  const [loadingCfeId, setLoadingCfeId] = useState(null);
  const [enviandoCFE, setEnviandoCFE] = useState(false);
  const [updatingCfeEnviadoId, setUpdatingCfeEnviadoId] = useState(null);
  const [cfeLoteModalOpen, setCfeLoteModalOpen] = useState(false);
  const [cfeLoteDesde, setCfeLoteDesde] = useState(todayISO());
  const [cfeLoteHasta, setCfeLoteHasta] = useState(todayISO());
  const [cfeLoteVentas, setCfeLoteVentas] = useState(null);
  const [cfeLoteBuscando, setCfeLoteBuscando] = useState(false);
  const [cfeLoteEnviando, setCfeLoteEnviando] = useState(false);
  const [cfeLoteResultados, setCfeLoteResultados] = useState([]);
  const [busquedaGlobal, setBusquedaGlobal] = useState('');
  const [modoSearch, setModoSearch] = useState(false);
  const searchDebounceRef = useRef(null);

  const replicarVenta = async (ventaId) => {
    setPrintingId(ventaId);
    try {
      const venta = await api.getVentaById(ventaId);
      sessionStorage.setItem('mercatus_replicar_venta', JSON.stringify(venta));
      window.dispatchEvent(new CustomEvent('mercatus:navigate', { detail: 'nueva-venta' }));
    } catch (err) {
      await appAlert(err.message || 'No se pudo preparar la replicación de la venta.');
    } finally {
      setPrintingId(null);
    }
  };

  const verCFE = async (ventaId, cfeEnviado) => {
    setLoadingCfeId(ventaId);
    try {
      const text = await api.getVentaCFEAnnotated(ventaId);
      setCfeModalData({ ventaId, json: text, cfeEnviado: Boolean(cfeEnviado) });
    } catch (err) {
      await appAlert(err.message || 'No se pudo generar el CFE.');
    } finally {
      setLoadingCfeId(null);
    }
  };

  useEffect(() => {
    if (modoSearch) return;
    const load = async () => {
      if (rangoActivo !== 'siempre' && (!desde || !hasta)) {
        setVentas([]);
        setError('');
        return;
      }
      if (rangoActivo !== 'siempre' && desde > hasta) {
        setVentas([]);
        setError('La fecha "Desde" no puede ser mayor que "Hasta".');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const rows = await api.getVentas(rangoActivo === 'siempre' ? {} : { desde, hasta });
        setVentas(rows);
      } catch (err) {
        setError(err.message || 'No se pudieron cargar las ventas.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [desde, hasta, modoSearch, rangoActivo]);

  useEffect(() => {
    if (!modoSearch || !busquedaGlobal.trim()) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const rows = await api.buscarVentas(busquedaGlobal.trim(), estadoFiltro);
        if (!cancelled) setVentas(rows);
      } catch (err) {
        if (!cancelled) setError(err.message || 'No se pudieron buscar las ventas.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [modoSearch, busquedaGlobal, estadoFiltro]);

  const totalDelDia = useMemo(
    () => ventas.filter((v) => {
      if (v.cancelada) return false;
      if (estadoFiltro === 'canceladas') return false;
      if (estadoFiltro !== 'todos' && normalizarEstadoEntrega(v) !== estadoFiltro) return false;
      if (vendedorFiltro && v.usuario_nombre !== vendedorFiltro) return false;
      if (clienteFiltro && (v.cliente_nombre || 'Consumidor final') !== clienteFiltro) return false;
      if (cfeFiltro === 'enviado' && v.cfe_enviado !== true) return false;
      if (cfeFiltro === 'pendiente' && v.cfe_enviado === true) return false;
      return true;
    }).reduce((acc, v) => acc + Number(v.total || 0), 0),
    [ventas, estadoFiltro, vendedorFiltro, clienteFiltro, cfeFiltro]
  );

  const ventasFiltradas = useMemo(() => {
    let list = ventas;
    if (estadoFiltro === 'canceladas') {
      list = list.filter((v) => Boolean(v.cancelada));
    } else if (estadoFiltro !== 'todos') {
      list = list.filter((v) => !v.cancelada && normalizarEstadoEntrega(v) === estadoFiltro);
    }
    if (vendedorFiltro) list = list.filter((v) => v.usuario_nombre === vendedorFiltro);
    if (clienteFiltro) list = list.filter((v) => (v.cliente_nombre || 'Consumidor final') === clienteFiltro);
    if (cfeFiltro === 'enviado') list = list.filter((v) => v.cfe_enviado === true);
    else if (cfeFiltro === 'pendiente') list = list.filter((v) => v.cfe_enviado !== true);
    return list;
  }, [ventas, estadoFiltro, vendedorFiltro, clienteFiltro, cfeFiltro]);

  const vendedoresOptions = useMemo(
    () => [...new Set(ventas.map((v) => v.usuario_nombre).filter(Boolean))].sort(),
    [ventas]
  );

  const clientesOptions = useMemo(
    () => [...new Set(ventas.map((v) => v.cliente_nombre || 'Consumidor final').filter(Boolean))].sort(),
    [ventas]
  );

  const ventasOrdenadas = useMemo(() => {
    if (modoSearch) return ventasFiltradas;
    const list = [...ventasFiltradas];
    const dir = sortDir === 'asc' ? 1 : -1;
    const asText = (v) => String(v ?? '').toLowerCase();
    const asNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const asDate = (v) => {
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    list.sort((a, b) => {
      switch (sortBy) {
        case 'fecha':
          return (asDate(a.fecha) - asDate(b.fecha)) * dir;
        case 'cliente':
          return asText(a.cliente_nombre).localeCompare(asText(b.cliente_nombre)) * dir;
        case 'vendedor':
          return asText(a.usuario_nombre).localeCompare(asText(b.usuario_nombre)) * dir;
        case 'total':
          return (asNumber(a.total) - asNumber(b.total)) * dir;
        case 'id':
        default:
          return (asNumber(a.id) - asNumber(b.id)) * dir;
      }
    });

    return list;
  }, [ventasFiltradas, sortBy, sortDir, modoSearch]);

  const toggleSort = useCallback((column) => {
    if (sortBy === column) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(column);
    setSortDir('asc');
  }, [sortBy]);

  const buildVentaPdf = async (venta, pdfConfig) => {
    const cfg = pdfConfig || getPdfConfig('factura', empresa.pdf_factura);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 14;

    doc.setFont(cfg.fontFamily || PDF_FONT_FAMILY);

    const headerY = 10;
    const lineH = 5;
    const logoSize = Math.max(10, Math.min(cfg.logoTamano || 40, 60));
    const posicion = cfg.logoPosicion || 'izquierda';

    // Calcular layout según posición del logo
    let infoX, infoWidth, col1X, col2X, colMaxW, contentStartY, titleH, dataRows;
    titleH  = posicion === 'cabecera' || posicion === 'centro' ? 10 : 13;
    dataRows = 4;

    let headerHeight;

    if (posicion === 'cabecera') {
      // Logo como banda completa arriba — ancho disponible
      const maxLogoW = pageWidth - marginX * 2;
      const maxLogoH = logoSize;
      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const nw = logo.naturalWidth || maxLogoW;
          const nh = logo.naturalHeight || maxLogoH;
          const scale = Math.min(maxLogoW / nw, maxLogoH / nh);
          const drawW = nw * scale;
          const drawH = nh * scale;
          const drawX = marginX + (maxLogoW - drawW) / 2;
          doc.addImage(logo.dataUrl, 'JPEG', drawX, headerY, drawW, drawH);
        }
      } catch { /* sin logo */ }
      contentStartY = headerY + logoSize + 4;
      infoX     = marginX;
      infoWidth = pageWidth - marginX * 2;
      col1X     = infoX;
      col2X     = infoX + infoWidth / 2;
      colMaxW   = infoWidth / 2 - 2;
      headerHeight = logoSize + titleH + dataRows * lineH + 8;
    } else if (posicion === 'centro') {
      // Logo centrado, info a ancho completo debajo
      const drawSize = logoSize;
      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const nw = logo.naturalWidth || drawSize;
          const nh = logo.naturalHeight || drawSize;
          const scale = Math.min(drawSize / nw, drawSize / nh);
          const drawW = nw * scale;
          const drawH = nh * scale;
          const drawX = (pageWidth - drawW) / 2;
          doc.addImage(logo.dataUrl, 'JPEG', drawX, headerY, drawW, drawH);
        }
      } catch { /* sin logo */ }
      contentStartY = headerY + drawSize + 4;
      infoX     = marginX;
      infoWidth = pageWidth - marginX * 2;
      col1X     = infoX;
      col2X     = infoX + infoWidth / 2;
      colMaxW   = infoWidth / 2 - 2;
      headerHeight = drawSize + titleH + dataRows * lineH + 8;
    } else {
      // izquierda / derecha: layout en 2 columnas
      const logoBoxSize = logoSize;
      let logoX;
      if (posicion === 'derecha') {
        logoX  = pageWidth - marginX - logoBoxSize;
        infoX  = marginX;
        infoWidth = logoX - marginX - 5;
      } else {
        // izquierda (default)
        logoX  = marginX;
        infoX  = marginX + logoBoxSize + 5;
        infoWidth = pageWidth - infoX - marginX;
      }
      col1X   = infoX;
      col2X   = infoX + infoWidth / 2;
      colMaxW = infoWidth / 2 - 2;
      titleH  = 13;
      headerHeight = titleH + dataRows * lineH + 2;
      contentStartY = headerY;

      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const nw = logo.naturalWidth  || logoBoxSize;
          const nh = logo.naturalHeight || logoBoxSize;
          const scale = Math.min(logoBoxSize / nw, logoBoxSize / nh);
          const drawW = nw * scale;
          const drawH = nh * scale;
          const drawX = logoX + (logoBoxSize - drawW) / 2;
          const drawY = headerY + (logoBoxSize - drawH) / 2;
          doc.addImage(logo.dataUrl, 'JPEG', drawX, drawY, drawW, drawH);
        }
      } catch { /* sin logo */ }
    }

    doc.setFontSize(13);
    doc.text('Ticket de Venta', col1X, contentStartY + 9);

    // Datos de empresa bajo el título
    doc.setFontSize(Math.max(7, (cfg.fontSizeBase || 10) - 2));
    let empresaY = contentStartY + 14;
    const empresaLines = [
      cfg.mostrarRazonSocial !== false && empresa.razon_social ? empresa.razon_social : null,
      cfg.mostrarRut         !== false && empresa.rut          ? `RUT: ${empresa.rut}` : null,
      cfg.mostrarDireccion   !== false && empresa.direccion    ? empresa.direccion : null,
      cfg.mostrarTelefono    !== false && empresa.telefono     ? `Tel: ${empresa.telefono}` : null,
      cfg.mostrarEmail       !== false && empresa.correo       ? empresa.correo : null,
    ].filter(Boolean);
    empresaLines.forEach((line) => {
      const linesCount = doc.splitTextToSize(line, infoWidth).length;
      doc.text(line, col1X, empresaY, { maxWidth: infoWidth });
      empresaY += linesCount * (lineH - 1);
    });

    doc.setFontSize(cfg.fontSizeBase || 10);
    // Start infoY AFTER empresa lines to prevent overlap
    let infoY = Math.max(contentStartY + titleH, empresaY + 2);
    const pagosLabel = Array.isArray(venta.pagos) && venta.pagos.length > 0
      ? formatPagosResumen(venta.pagos)
      : formatMedioPago(venta.medio_pago);

    // Columna izquierda: datos del ticket
    const leftRows = [
      `Fecha Emisión: ${formatDateTime(venta.fecha)}`,
      `Nro. ticket: #${venta.id}`,
      `Vendedor: ${venta.usuario_nombre || '-'}`,
      `Fecha entrega: ${formatDateOnly(venta.fecha_entrega)}`,
    ];

    // Columna derecha: datos del cliente (respetando toggles)
    const rightRows = [
      cfg.mostrarClienteNombre    !== false ? `Cliente: ${venta.cliente_nombre || 'Consumidor final'}` : null,
      cfg.mostrarClienteTelefono  !== false ? `Teléfono: ${venta.cliente_telefono || '-'}` : null,
      cfg.mostrarClienteDireccion !== false ? `Dirección: ${venta.cliente_direccion || '-'}` : null,
      cfg.mostrarClienteHorarios  !== false ? `Horarios: ${formatHorarioClienteEntrega(venta)}` : null,
    ].filter(Boolean);

    const maxRows = Math.max(leftRows.length, rightRows.length);
    for (let i = 0; i < maxRows; i++) {
      const lLines = leftRows[i]  ? doc.splitTextToSize(leftRows[i],  colMaxW).length : 1;
      const rLines = rightRows[i] ? doc.splitTextToSize(rightRows[i], colMaxW).length : 1;
      if (leftRows[i])  doc.text(leftRows[i],  col1X, infoY, { maxWidth: colMaxW });
      if (rightRows[i]) doc.text(rightRows[i], col2X, infoY, { maxWidth: colMaxW });
      infoY += Math.max(lLines, rLines) * lineH;
    }

    // cursorY must be after both headerHeight AND the actual rendered content (info rows + empresa lines)
    let cursorY = Math.max(headerY + headerHeight + 5, infoY + 3);

    autoTable(doc, {
      startY: cursorY,
      head: [['Producto', 'Cant.', 'Presentación', 'P. Unit.', 'Desc.', 'Subtotal']],
      body: (venta.detalle || []).map((item) => {
        const cant = Number(item.cantidad || 0);
        const precio = Number(item.precio_unitario || 0);
        const desc = Number(item.descuento_aplicado || 0) + Number(item.descuento_packs_aplicado || 0);
        const subtotal = cant * precio - desc;
        const packs = Number(item.packs ?? -1);
        const sueltas = Number(item.unidades_sueltas ?? 0);
        const tipoEmpaque = item.tipo_empaque || '';
        let presentacion;
        if (packs >= 0) {
          if (packs > 0 && sueltas > 0) presentacion = `${packs} ${tipoEmpaque} + ${sueltas} u.`;
          else if (packs > 0) presentacion = `${packs} ${tipoEmpaque}`;
          else presentacion = `${sueltas} unidades`;
        } else {
          presentacion = `${cant} unidades`;
        }
        return [
          item.producto_nombre || `Producto #${item.producto_id}`,
          cant,
          presentacion,
          formatCurrency(precio),
          formatCurrency(desc),
          formatCurrency(subtotal),
        ];
      }),
      styles: { fontSize: cfg.fontSizeBase ? cfg.fontSizeBase - 1 : 9, font: cfg.fontFamily || PDF_FONT_FAMILY },
      headStyles: { fillColor: getPrimaryRgb() },
    });

    const finalY = doc.lastAutoTable?.finalY ?? cursorY + 8;
    const totalsRightX = pageWidth - 14;
    const pagosLabelX = pageWidth - 52;
    const pagosValueX = pageWidth - 14;
    let totalsY = finalY + 8;

    doc.setFontSize(cfg.fontSizeBase || 10);
    doc.text(`Subtotal: ${formatCurrency(venta.subtotal)}`, totalsRightX, totalsY, { align: 'right' });
    totalsY += 5;
    doc.text(`Descuentos: -${formatCurrency(venta.descuento_total_valor)}`, totalsRightX, totalsY, { align: 'right' });
    totalsY += 5;

    // ── IVA (solo si está habilitado en config) ──
    if (cfg.mostrarIva) {
      const ivaBase = Number(venta.subtotal || 0) - Number(venta.descuento_total_valor || 0);
      const ivaAmount = ivaBase * 0.22;
      doc.text(`IVA (22%): ${formatCurrency(ivaAmount)}`, totalsRightX, totalsY, { align: 'right' });
      totalsY += 5;
    }

    doc.setFontSize((cfg.fontSizeBase || 10) + 2);
    doc.text(`Total: ${formatCurrency(venta.total)}`, totalsRightX, totalsY, { align: 'right' });
    totalsY += 6;
    doc.setFontSize(cfg.fontSizeBase || 10);
    doc.text('Pagos:', totalsRightX, totalsY, { align: 'right' });
    totalsY += 4;
    if (Array.isArray(venta.pagos) && venta.pagos.length > 0) {
      venta.pagos.forEach((pago) => {
        doc.text(`- ${formatMedioPago(pago.medio_pago)}:`, pagosLabelX, totalsY, { align: 'right' });
        doc.text(`${formatCurrency(pago.monto)}`, pagosValueX, totalsY, { align: 'right' });
        totalsY += 4;
      });
    } else {
      doc.text(`- ${pagosLabel}:`, pagosLabelX, totalsY, { align: 'right' });
      doc.text(formatCurrency(venta.total), pagosValueX, totalsY, { align: 'right' });
    }

    if (venta.observacion) {
      doc.setFontSize((cfg.fontSizeBase || 10) - 1);
      doc.text(`Observación: ${venta.observacion}`, 14, totalsY + 4);
      totalsY += 9;
    }

    // ── Notas ──
    if (cfg.notas) {
      doc.setFontSize((cfg.fontSizeBase || 10) - 1);
      doc.text(cfg.notas, marginX, totalsY + 6, { maxWidth: pageWidth - marginX * 2 });
      totalsY += 10;
    }

    // ── Pie de página ──
    if (cfg.piePagina) {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize((cfg.fontSizeBase || 10) - 1);
      doc.setTextColor(120, 120, 120);
      doc.text(cfg.piePagina, pageWidth / 2, pageHeight - 8, { align: 'center', maxWidth: pageWidth - marginX * 2 });
      doc.setTextColor(0, 0, 0);
    }

    return doc;
  };

  const buildRemitoPdf = async (venta, pdfConfig) => {
    const cfg = pdfConfig || getPdfConfig('remito', empresa.pdf_remito);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 14;

    doc.setFont(cfg.fontFamily || PDF_FONT_FAMILY);

    const headerY = 10;
    const lineH = 5;
    const titleH = 18;
    const dataRows = 4;
    const logoSize = Math.max(10, Math.min(cfg.logoTamano || 40, 60));
    const posicion = cfg.logoPosicion || 'izquierda';

    let infoX, infoWidth, col1X, col2X, colMaxW, contentStartY, headerHeight;

    if (posicion === 'cabecera') {
      const maxLogoW = pageWidth - marginX * 2;
      const maxLogoH = logoSize;
      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const nw = logo.naturalWidth || maxLogoW;
          const nh = logo.naturalHeight || maxLogoH;
          const scale = Math.min(maxLogoW / nw, maxLogoH / nh);
          const drawW = nw * scale;
          const drawH = nh * scale;
          doc.addImage(logo.dataUrl, 'JPEG', marginX + (maxLogoW - drawW) / 2, headerY, drawW, drawH);
        }
      } catch { /* sin logo */ }
      contentStartY = headerY + logoSize + 4;
      infoX = marginX; infoWidth = pageWidth - marginX * 2;
      col1X = infoX; col2X = infoX + infoWidth / 2; colMaxW = infoWidth / 2 - 2;
      headerHeight = logoSize + titleH + dataRows * lineH + 8;
    } else if (posicion === 'centro') {
      const drawSize = logoSize;
      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const nw = logo.naturalWidth || drawSize;
          const nh = logo.naturalHeight || drawSize;
          const scale = Math.min(drawSize / nw, drawSize / nh);
          const drawW = nw * scale;
          const drawH = nh * scale;
          doc.addImage(logo.dataUrl, 'JPEG', (pageWidth - drawW) / 2, headerY, drawW, drawH);
        }
      } catch { /* sin logo */ }
      contentStartY = headerY + drawSize + 4;
      infoX = marginX; infoWidth = pageWidth - marginX * 2;
      col1X = infoX; col2X = infoX + infoWidth / 2; colMaxW = infoWidth / 2 - 2;
      headerHeight = drawSize + titleH + dataRows * lineH + 8;
    } else {
      const logoBoxSize = logoSize;
      let logoX;
      if (posicion === 'derecha') {
        logoX  = pageWidth - marginX - logoBoxSize;
        infoX  = marginX;
        infoWidth = logoX - marginX - 5;
      } else {
        logoX  = marginX;
        infoX  = marginX + logoBoxSize + 5;
        infoWidth = pageWidth - infoX - marginX;
      }
      col1X = infoX; col2X = infoX + infoWidth / 2; colMaxW = infoWidth / 2 - 2;
      headerHeight = titleH + dataRows * lineH + 2;
      contentStartY = headerY;
      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const nw = logo.naturalWidth  || logoBoxSize;
          const nh = logo.naturalHeight || logoBoxSize;
          const scale = Math.min(logoBoxSize / nw, logoBoxSize / nh);
          const drawW = nw * scale;
          const drawH = nh * scale;
          const drawX = logoX + (logoBoxSize - drawW) / 2;
          const drawY = headerY + (logoBoxSize - drawH) / 2;
          doc.addImage(logo.dataUrl, 'JPEG', drawX, drawY, drawW, drawH);
        }
      } catch { /* sin logo */ }
    }

    doc.setFontSize(14);
    doc.setFont(cfg.fontFamily || PDF_FONT_FAMILY, 'bold');
    doc.text('REMITO', col1X, contentStartY + 9);
    doc.setFontSize(cfg.fontSizeBase || 10);
    doc.setFont(cfg.fontFamily || PDF_FONT_FAMILY, 'normal');
    doc.text(`Remito de Factura N° ${venta.id}`, col1X, contentStartY + 15);

    // Datos de empresa bajo el título
    doc.setFontSize(Math.max(7, (cfg.fontSizeBase || 10) - 2));
    let empresaY2 = contentStartY + 20;
    const empresaLines2 = [
      cfg.mostrarRazonSocial !== false && empresa.razon_social ? empresa.razon_social : null,
      cfg.mostrarRut         !== false && empresa.rut          ? `RUT: ${empresa.rut}` : null,
      cfg.mostrarDireccion   !== false && empresa.direccion    ? empresa.direccion : null,
      cfg.mostrarTelefono    !== false && empresa.telefono     ? `Tel: ${empresa.telefono}` : null,
      cfg.mostrarEmail       !== false && empresa.correo       ? empresa.correo : null,
    ].filter(Boolean);
    empresaLines2.forEach((line) => {
      const linesCount = doc.splitTextToSize(line, infoWidth).length;
      doc.text(line, col1X, empresaY2, { maxWidth: infoWidth });
      empresaY2 += linesCount * (lineH - 1);
    });
    doc.setFontSize(cfg.fontSizeBase || 10);
    doc.setFont(cfg.fontFamily || PDF_FONT_FAMILY, 'normal');

    // Start infoY AFTER empresa lines to prevent overlap
    let infoY = Math.max(contentStartY + titleH, empresaY2 + 2);
    const leftRows = [
      `Fecha Emisión: ${formatDateTime(venta.fecha)}`,
      `Fecha entrega: ${formatDateOnly(venta.fecha_entrega)}`,
      `Vendedor: ${venta.usuario_nombre || '-'}`,
    ];
    const rightRows = [
      cfg.mostrarClienteNombre    !== false ? `Cliente: ${venta.cliente_nombre || 'Consumidor final'}` : null,
      cfg.mostrarClienteTelefono  !== false ? `Teléfono: ${venta.cliente_telefono || '-'}` : null,
      cfg.mostrarClienteDireccion !== false ? `Dirección: ${venta.cliente_direccion || '-'}` : null,
      cfg.mostrarClienteHorarios  !== false ? `Horarios: ${formatHorarioClienteEntrega(venta)}` : null,
    ].filter(Boolean);
    const maxRows2 = Math.max(leftRows.length, rightRows.length);
    for (let i = 0; i < maxRows2; i++) {
      const lLines = leftRows[i]  ? doc.splitTextToSize(leftRows[i],  colMaxW).length : 1;
      const rLines = rightRows[i] ? doc.splitTextToSize(rightRows[i], colMaxW).length : 1;
      if (leftRows[i])  doc.text(leftRows[i],  col1X, infoY, { maxWidth: colMaxW });
      if (rightRows[i]) doc.text(rightRows[i], col2X, infoY, { maxWidth: colMaxW });
      infoY += Math.max(lLines, rLines) * lineH;
    }

    // cursorY must be after both headerHeight AND the actual rendered content
    let cursorY = Math.max(headerY + headerHeight + 5, infoY + 3);
    const tableHead = cfg.mostrarCosto
      ? [['Producto', 'Cantidad', 'P. Unitario']]
      : [['Producto', 'Cantidad']];

    const tableBody = (venta.detalle || []).map((item) => {
      const cant = Number(item.cantidad || 0);
      const packs = Number(item.packs ?? -1);
      const sueltas = Number(item.unidades_sueltas ?? 0);
      const tipoEmpaque = item.tipo_empaque || '';
      let presentacion;
      if (packs >= 0) {
        if (packs > 0 && sueltas > 0) presentacion = `${packs} ${tipoEmpaque} + ${sueltas} u.`;
        else if (packs > 0) presentacion = `${packs} ${tipoEmpaque}`;
        else presentacion = `${sueltas} u.`;
      } else {
        presentacion = `${cant} u.`;
      }
      const row = [
        item.producto_nombre || `Producto #${item.producto_id}`,
        presentacion,
      ];
      if (cfg.mostrarCosto) {
        row.push(formatCurrency(Number(item.precio_unitario || 0)));
      }
      return row;
    });

    autoTable(doc, {
      startY: cursorY,
      head: tableHead,
      body: tableBody,
      styles: { fontSize: cfg.fontSizeBase || 10, font: cfg.fontFamily || PDF_FONT_FAMILY },
      headStyles: { fillColor: getPrimaryRgb() },
      columnStyles: cfg.mostrarCosto
        ? { 1: { halign: 'center', cellWidth: 40 }, 2: { halign: 'right', cellWidth: 35 } }
        : { 1: { halign: 'center', cellWidth: 40 } },
    });

    const finalY = doc.lastAutoTable?.finalY ?? cursorY + 8;
    let footerY = finalY + 20;

    const firmaLineX1 = marginX + 10;
    const firmaLineX2 = pageWidth / 2 - 10;

    doc.setDrawColor(0);
    doc.line(firmaLineX1, footerY, firmaLineX2, footerY);
    doc.setFontSize((cfg.fontSizeBase || 10) - 1);
    doc.text('Firma y aclaración del receptor', firmaLineX1, footerY + 5);
    footerY += 10;

    // ── Notas ──
    if (cfg.notas) {
      doc.setFontSize((cfg.fontSizeBase || 10) - 1);
      doc.text(cfg.notas, marginX, footerY + 6, { maxWidth: pageWidth - marginX * 2 });
    }

    // ── Pie de página ──
    if (cfg.piePagina) {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize((cfg.fontSizeBase || 10) - 1);
      doc.setTextColor(120, 120, 120);
      doc.text(cfg.piePagina, pageWidth / 2, pageHeight - 8, { align: 'center', maxWidth: pageWidth - marginX * 2 });
      doc.setTextColor(0, 0, 0);
    }

    return doc;
  };

  const printDocToIframe = (doc) => {
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = blobUrl;
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(blobUrl, '_blank', 'noopener,noreferrer');
      }
    };
    document.body.appendChild(iframe);
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 7000);
  };

  const imprimirSegun = async (ventaId, tipo) => {
    setPrintingId(ventaId);
    try {
      const venta = await api.getVentaById(ventaId);
      if (tipo === 'factura' || tipo === 'ambos') {
        const doc = await buildVentaPdf(venta);
        doc.save(`ticket-venta-${venta.id}.pdf`);
      }
      if (tipo === 'remito' || tipo === 'ambos') {
        const doc = await buildRemitoPdf(venta);
        doc.save(`remito-venta-${venta.id}.pdf`);
      }
    } catch (err) {
      await appAlert(err.message || 'No se pudo generar el documento.');
    } finally {
      setPrintingId(null);
    }
  };

  const imprimirVenta = (ventaId) => {
    setModalTipoImpresionVentaId(ventaId);
  };

  const reenviarFactura = async (ventaId) => {
    setPrintingId(ventaId);
    try {
      const venta = await api.getVentaById(ventaId);
      const telefono = normalizeWhatsappPhone(venta.cliente_telefono);
      if (!telefono) {
        await appAlert('Este cliente no tiene teléfono válido para WhatsApp.');
        return;
      }

      const doc = await buildVentaPdf(venta);
      const fileName = `ticket-venta-${venta.id}.pdf`;
      const message = `Hola ${venta.cliente_nombre || 'cliente'}, te compartimos tu factura de la venta #${venta.id}. Total: ${formatCurrency(venta.total)}.`;
      const waUrl = `https://wa.me/${telefono}?text=${encodeURIComponent(message)}`;

      if (typeof File === 'function' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        const pdfBlob = doc.output('blob');
        const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
        const canShareFiles = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });
        if (canShareFiles) {
          try {
            await navigator.share({ title: `Factura ${venta.id}`, text: message, files: [file] });
            return;
          } catch {
            // fallback below
          }
        }
      }

      doc.save(fileName);
      window.open(waUrl, '_blank', 'noopener,noreferrer');
      await appAlert('Abrimos WhatsApp directo al cliente y descargamos la factura. Adjunta el archivo desde Descargas y envía.');
    } catch (err) {
      await appAlert(err.message || 'No se pudo reenviar la factura.');
    } finally {
      setPrintingId(null);
    }
  };

  const getEntregaEstadoClass = (venta) => {
    const estado = normalizarEstadoEntrega(venta);
    if (estado === 'cancelado') return 'is-cancelado';
    if (estado === 'entregado') return 'is-entregado';
    const entregaIso = toISODateOnly(venta.fecha_entrega);
    if (!entregaIso) return '';
    const todayIso = todayISO();
    if (entregaIso < todayIso) return 'is-vencida';
    if (entregaIso === todayIso) return 'is-hoy';
    return '';
  };

  const toggleEntregado = useCallback(async (ventaId, nextValue) => {
    setUpdatingEntregaId(ventaId);
    try {
      await api.updateVentaEntregado(ventaId, nextValue);
      setVentas((prev) =>
        prev.map((v) => (
          v.id === ventaId
            ? { ...v, entregado: nextValue, estado_entrega: nextValue ? 'entregado' : 'pendiente' }
            : v
        ))
      );
    } catch (err) {
      await appAlert(err.message || 'No se pudo actualizar el estado de entrega.');
    } finally {
      setUpdatingEntregaId(null);
    }
  }, []);

  const toggleCfeEnviado = useCallback(async (ventaId, nextValue) => {
    if (!nextValue) {
      const ok = await appConfirm(
        '¿Marcar esta venta como CFE no enviado? Esto solo actualiza el registro local y no afecta lo enviado a DGI.',
        { confirmText: 'Sí, marcar', cancelText: 'Cancelar' }
      );
      if (!ok) return;
    }
    setUpdatingCfeEnviadoId(ventaId);
    try {
      await api.updateVentaCfeEnviado(ventaId, nextValue);
      setVentas((prev) =>
        prev.map((v) => v.id === ventaId ? { ...v, cfe_enviado: nextValue } : v)
      );
    } catch (err) {
      await appAlert(err.message || 'No se pudo actualizar el estado del CFE.');
    } finally {
      setUpdatingCfeEnviadoId(null);
    }
  }, []);

  const buscarVentasCfePendientes = async () => {
    setCfeLoteBuscando(true);
    setCfeLoteResultados([]);
    try {
      const result = await api.getVentasCfePendientes(cfeLoteDesde, cfeLoteHasta);
      setCfeLoteVentas(result);
    } catch (err) {
      await appAlert(err.message || 'No se pudo obtener las ventas pendientes.');
      setCfeLoteVentas(null);
    } finally {
      setCfeLoteBuscando(false);
    }
  };

  const enviarCfeLote = async () => {
    if (!cfeLoteVentas?.length) return;
    const ok = await appConfirm(
      `Se enviarán ${cfeLoteVentas.length} CFE pendiente(s). El proceso puede demorar varios minutos. ¿Desea continuar?`,
      { confirmText: 'Sí, enviar', cancelText: 'Cancelar' }
    );
    if (!ok) return;
    setCfeLoteEnviando(true);
    setCfeLoteResultados([]);
    for (const venta of cfeLoteVentas) {
      setCfeLoteResultados((prev) => [...prev, { ventaId: venta.id, status: 'enviando' }]);
      try {
        await api.sendVentaCFE(venta.id, false);
        const resultado = { ventaId: venta.id, ok: true, status: 'ok', mensaje: 'CFE emitido' };
        setCfeLoteResultados((prev) => prev.map((r) => r.ventaId === venta.id ? resultado : r));
        setVentas((prev) => prev.map((v) => v.id === venta.id ? { ...v, cfe_enviado: true } : v));
      } catch (err) {
        const resultado = { ventaId: venta.id, ok: false, status: 'error', mensaje: err.message || 'Error' };
        setCfeLoteResultados((prev) => prev.map((r) => r.ventaId === venta.id ? resultado : r));
      }
    }
    setCfeLoteEnviando(false);
  };

  const toggleDetalleVenta = async (ventaId) => {
    if (expandedVentaId === ventaId) {
      setExpandedVentaId(null);
      return;
    }
    setExpandedVentaId(ventaId);
    if (detalleByVentaId[ventaId]) return;
    setLoadingDetalleId(ventaId);
    try {
      const venta = await api.getVentaById(ventaId);
      setDetalleByVentaId((prev) => ({ ...prev, [ventaId]: venta.detalle || [] }));
    } catch (err) {
      await appAlert(err.message || 'No se pudo cargar el detalle de la venta.');
    } finally {
      setLoadingDetalleId(null);
    }
  };

  const cancelarVenta = async (ventaId) => {
    const ok = await appConfirm('¿Seguro que deseas cancelar esta venta? Se repondrá stock y se ajustarán totales/ganancias.', {
      title: 'Cancelar venta',
      confirmText: 'Sí, cancelar',
      cancelText: 'Volver',
    });
    if (!ok) return;
    setCancelandoVentaId(ventaId);
    try {
      await api.cancelarVenta(ventaId);
      window.dispatchEvent(
        new CustomEvent('mercatus:stats-refresh', {
          detail: { source: 'venta-cancelada', ventaId },
        })
      );
      window.dispatchEvent(
        new CustomEvent('mercatus:stock-refresh', {
          detail: { source: 'venta-cancelada', ventaId },
        })
      );
      setVentas((prev) =>
        prev.map((v) => (
          v.id === ventaId
            ? { ...v, cancelada: true, entregado: false, estado_entrega: 'cancelado' }
            : v
        ))
      );
      if (expandedVentaId === ventaId) {
        setExpandedVentaId(null);
      }
    } catch (err) {
      await appAlert(err.message || 'No se pudo cancelar la venta.');
    } finally {
      setCancelandoVentaId(null);
    }
  };

  const eliminarVenta = async (ventaId) => {
    const venta = ventas.find((v) => Number(v.id) === Number(ventaId));
    const ok = await appConfirm(
      venta?.cancelada
        ? '¿Seguro que deseas eliminar esta venta? Ya no aparecerá en el historial visible.'
        : '¿Seguro que deseas eliminar esta venta? Se repondrá stock y dejará de contar en listados y estadísticas.',
      {
        title: 'Eliminar venta',
        confirmText: 'Eliminar',
        cancelText: 'Volver',
      }
    );
    if (!ok) return;
    setEliminandoVentaId(ventaId);
    try {
      await api.deleteVenta(ventaId);
      window.dispatchEvent(
        new CustomEvent('mercatus:stats-refresh', {
          detail: { source: 'venta-eliminada', ventaId },
        })
      );
      window.dispatchEvent(
        new CustomEvent('mercatus:stock-refresh', {
          detail: { source: 'venta-eliminada', ventaId },
        })
      );
      setVentas((prev) => prev.filter((v) => Number(v.id) !== Number(ventaId)));
      if (expandedVentaId === ventaId) {
        setExpandedVentaId(null);
      }
    } catch (err) {
      await appAlert(err.message || 'No se pudo eliminar la venta.');
    } finally {
      setEliminandoVentaId(null);
    }
  };

  const exportarEntregasPDF = async () => {
    setExportingEntregas(true);
    try {
      if (!entregasDesde || !entregasHasta) {
        await appAlert('Debes seleccionar "Desde" y "Hasta" para generar entregas.');
        return;
      }
      if (entregasDesde > entregasHasta) {
        await appAlert('La fecha "Desde" no puede ser mayor que "Hasta".');
        return;
      }
      const resumen = await api.getEntregasResumen({ desde: entregasDesde, hasta: entregasHasta });
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.getWidth();
      let cursorY = 12;
      const periodoLabel = resumen.desde === resumen.hasta ? `Día ${resumen.desde}` : `${resumen.desde} al ${resumen.hasta}`;

      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const maxW = 60;
          const maxH = 20;
          const nw = logo.naturalWidth  || maxW;
          const nh = logo.naturalHeight || maxH;
          const scale = Math.min(maxW / nw, maxH / nh);
          const logoWidth  = nw * scale;
          const logoHeight = nh * scale;
          const x = (pageWidth - logoWidth) / 2;
          doc.addImage(logo.dataUrl, 'JPEG', x, cursorY, logoWidth, logoHeight);
          cursorY += logoHeight + 6;
        }
      } catch {
        cursorY += 2;
      }

      doc.setFontSize(14);
      doc.text('Planilla de entregas', pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 6;
      doc.setFontSize(10);
      doc.text(`Período: ${periodoLabel}`, 14, cursorY);
      cursorY += 5;
      doc.text(`Ventas pendientes: ${Number(resumen.totalVentas || 0).toLocaleString('es-UY')}`, 14, cursorY);
      doc.text(`Monto total: ${formatCurrency(resumen.totalMonto || 0)}`, 120, cursorY);
      cursorY += 7;

      const entregaHead = [['VENTA', 'CLIENTE', 'TELEFONO', 'DIRECCION', 'FECHA ENTREGA', 'TOTAL', 'HORARIOS', 'DETALLE']];
      const entregaBody = (resumen.ventas || []).map((v) => [
        v.id,
        v.cliente_nombre || 'Consumidor final',
        v.cliente_telefono || '-',
        v.cliente_direccion || '-',
        formatDateOnly(v.fecha_entrega),
        formatCurrency(v.total || 0),
        formatHorarioClienteEntrega(v),
        '',
      ]);

      autoTable(doc, {
        startY: cursorY,
        head: entregaHead,
        body: entregaBody,
        styles: { fontSize: 8, valign: 'middle', cellPadding: 2 },
        headStyles: { fillColor: getPrimaryRgb() },
        columnStyles: {
          0: { cellWidth: 18 },
          1: { cellWidth: 36 },
          2: { cellWidth: 24 },
          3: { cellWidth: 56 },
          4: { cellWidth: 24 },
          5: { cellWidth: 22, halign: 'right' },
          6: { cellWidth: 30 },
          7: { cellWidth: 'auto' },
        },
      });

      const suffix = `${resumen.desde || 'desde'}_${resumen.hasta || 'hasta'}`;
      doc.save(`entregas-${suffix}.pdf`);
    } catch (err) {
      await appAlert(err.message || 'No se pudo exportar el PDF de entregas.');
    } finally {
      setExportingEntregas(false);
    }
  };

  const construirResumenEntregas = async () => {
    if (!entregasDesde || !entregasHasta) {
      throw new Error('Debes seleccionar "Desde" y "Hasta" para generar entregas.');
    }
    if (entregasDesde > entregasHasta) {
      throw new Error('La fecha "Desde" no puede ser mayor que "Hasta".');
    }
    return api.getEntregasResumen({ desde: entregasDesde, hasta: entregasHasta });
  };

  const exportarEntregasExcel = async () => {
    setExportingEntregas(true);
    try {
      const resumen = await construirResumenEntregas();

      const periodoLabel = resumen.desde === resumen.hasta ? `Día ${resumen.desde}` : `${resumen.desde} al ${resumen.hasta}`;
      const rowsHtml = (resumen.ventas || [])
        .map((v, idx) => {
          const horarios = formatHorarioClienteEntrega(v);
          const zebra = idx % 2 === 0 ? '#f7faff' : '#ffffff';
          return `
            <tr style="background:${zebra}">
              <td class="td center">${escapeHtml(v.id)}</td>
              <td class="td">${escapeHtml(v.cliente_nombre || 'Consumidor final')}</td>
              <td class="td center">${escapeHtml(v.cliente_telefono || '-')}</td>
              <td class="td">${escapeHtml(v.cliente_direccion || '-')}</td>
              <td class="td center">${escapeHtml(formatDateOnly(v.fecha_entrega))}</td>
              <td class="td right" x:num="${Number(v.total || 0)}">${Number(v.total || 0).toFixed(2)}</td>
              <td class="td center">${escapeHtml(horarios)}</td>
              <td class="td"></td>
            </tr>
          `;
        })
        .join('');

      const html = `
        <html xmlns:x="urn:schemas-microsoft-com:office:excel">
          <head>
            <meta charset="UTF-8" />
            <style>
              body { font-family: ${PRINT_FONT_FAMILY_CSS}; }
              .title { font-size: 18px; font-weight: 700; color: #375f8c; margin-bottom: 8px; }
              .meta { font-size: 13px; margin-bottom: 4px; color: #1f2933; }
              table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-top: 10px; }
              .th, .td { border: 1px solid #c8d3e5; padding: 7px 8px; font-size: 12px; color: #1f2933; vertical-align: middle; }
              .th { background: #375f8c; color: #ffffff; font-weight: 700; text-align: center; }
              .center { text-align: center; }
              .right { text-align: right; }
              .detail-col { width: 32%; }
              .client-col { width: 24%; }
              .addr-col { width: 22%; }
              .total-row td { border: 1px solid #375f8c; font-weight: 700; color: #375f8c; background: #eef4fb; }
            </style>
          </head>
          <body>
            <div class="title">Planilla de entregas</div>
            <div class="meta">Período: ${escapeHtml(periodoLabel)}</div>
            <div class="meta">Ventas pendientes: ${escapeHtml(Number(resumen.totalVentas || 0))} &nbsp;&nbsp;|&nbsp;&nbsp; Monto total: ${escapeHtml(formatCurrency(resumen.totalMonto || 0))}</div>
            <table>
              <colgroup>
                <col style="width:7%">
                <col class="client-col">
                <col style="width:12%">
                <col class="addr-col">
                <col style="width:11%">
                <col style="width:10%">
                <col style="width:12%">
                <col class="detail-col">
              </colgroup>
              <thead>
                <tr>
                  <th class="th">VENTA</th>
                  <th class="th">CLIENTE</th>
                  <th class="th">TELEFONO</th>
                  <th class="th">DIRECCION</th>
                  <th class="th">FECHA ENTREGA</th>
                  <th class="th">TOTAL ($)</th>
                  <th class="th">HORARIOS</th>
                  <th class="th">DETALLE</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
                <tr><td colspan="8" style="border:none;height:8px"></td></tr>
                <tr class="total-row">
                  <td colspan="5">TOTAL A RECAUDAR</td>
                  <td class="right" x:num="${Number(resumen.totalMonto || 0)}">${Number(resumen.totalMonto || 0).toFixed(2)}</td>
                  <td colspan="2"></td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `;

      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const suffix = `${resumen.desde || 'desde'}_${resumen.hasta || 'hasta'}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `entregas-${suffix}.xls`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setModalExportOpen(false);
    } catch (err) {
      await appAlert(err.message || 'No se pudo exportar Excel de entregas.');
    } finally {
      setExportingEntregas(false);
    }
  };

  const imprimirEntregas = async () => {
    setExportingEntregas(true);
    try {
      const resumen = await construirResumenEntregas();
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const periodoLabel = resumen.desde === resumen.hasta ? `Día ${resumen.desde}` : `${resumen.desde} al ${resumen.hasta}`;
      doc.setFontSize(14);
      doc.text('Planilla de entregas', pageWidth / 2, 14, { align: 'center' });
      doc.setFontSize(10);
      doc.text(`Período: ${periodoLabel}`, 14, 22);
      const entregaHead = [['VENTA', 'CLIENTE', 'TELEFONO', 'DIRECCION', 'FECHA ENTREGA', 'TOTAL', 'HORARIOS', 'DETALLE']];
      const entregaBody = (resumen.ventas || []).map((v) => [
        v.id,
        v.cliente_nombre || 'Consumidor final',
        v.cliente_telefono || '-',
        v.cliente_direccion || '-',
        formatDateOnly(v.fecha_entrega),
        formatCurrency(v.total || 0),
        formatHorarioClienteEntrega(v),
        '',
      ]);
      autoTable(doc, {
        startY: 28,
        head: entregaHead,
        body: entregaBody,
        styles: { fontSize: 8, valign: 'middle' },
        headStyles: { fillColor: getPrimaryRgb() },
        columnStyles: {
          0: { cellWidth: 18 },
          1: { cellWidth: 36 },
          2: { cellWidth: 24 },
          3: { cellWidth: 56 },
          4: { cellWidth: 24 },
          5: { cellWidth: 22, halign: 'right' },
          6: { cellWidth: 30 },
          7: { cellWidth: 'auto' },
        },
      });
      const y = (doc.lastAutoTable?.finalY || 28) + 8;
      doc.setFontSize(11);
      doc.text(`TOTAL A RECAUDAR: ${formatCurrency(resumen.totalMonto || 0)}`, 14, y);
      const blob = doc.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = blobUrl;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(blobUrl, '_blank', 'noopener,noreferrer');
        }
      };
      document.body.appendChild(iframe);
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 7000);
      setModalExportOpen(false);
    } catch (err) {
      await appAlert(err.message || 'No se pudo preparar impresión de entregas.');
    } finally {
      setExportingEntregas(false);
    }
  };

  const construirConsolidado = async () => {
    if (!consolidadoDesde || !consolidadoHasta) {
      throw new Error('Debes seleccionar "Desde" y "Hasta" para generar el consolidado.');
    }
    if (consolidadoDesde > consolidadoHasta) {
      throw new Error('La fecha "Desde" no puede ser mayor que "Hasta".');
    }
    return api.getEntregasConsolidado({ desde: consolidadoDesde, hasta: consolidadoHasta });
  };

  const exportarConsolidadoPDF = async () => {
    setExportingConsolidado(true);
    try {
      const resumen = await construirConsolidado();
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let cursorY = 12;
      const periodoLabel = resumen.desde === resumen.hasta ? `Día ${resumen.desde}` : `${resumen.desde} al ${resumen.hasta}`;

      try {
        const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
        if (logo) {
          const maxW = 60;
          const maxH = 20;
          const nw = logo.naturalWidth || maxW;
          const nh = logo.naturalHeight || maxH;
          const scale = Math.min(maxW / nw, maxH / nh);
          const logoWidth = nw * scale;
          const logoHeight = nh * scale;
          const x = (pageWidth - logoWidth) / 2;
          doc.addImage(logo.dataUrl, 'JPEG', x, cursorY, logoWidth, logoHeight);
          cursorY += logoHeight + 6;
        }
      } catch {
        cursorY += 2;
      }

      doc.setFontSize(14);
      doc.text('Consolidado de artículos', pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 6;
      doc.setFontSize(10);
      doc.text(`Período: ${periodoLabel}`, 14, cursorY);
      cursorY += 5;
      doc.text(`Artículos: ${Number(resumen.totalArticulos || 0).toLocaleString('es-UY')}`, 14, cursorY);
      doc.text(`Unidades totales: ${Number(resumen.totalUnidades || 0).toLocaleString('es-UY')}`, 80, cursorY);
      cursorY += 7;

      autoTable(doc, {
        startY: cursorY,
        head: [['ARTÍCULO', 'CANTIDAD']],
        body: (resumen.articulos || []).map((a) => [
          a.nombre,
          Number(a.total_unidades || 0).toLocaleString('es-UY'),
        ]),
        styles: { fontSize: 10, valign: 'middle', cellPadding: 3 },
        headStyles: { fillColor: getPrimaryRgb() },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 40, halign: 'right' },
        },
      });

      const suffix = `${resumen.desde || 'desde'}_${resumen.hasta || 'hasta'}`;
      doc.save(`consolidado-articulos-${suffix}.pdf`);
      setModalConsolidadoOpen(false);
    } catch (err) {
      await appAlert(err.message || 'No se pudo exportar el PDF del consolidado.');
    } finally {
      setExportingConsolidado(false);
    }
  };

  const exportarConsolidadoExcel = async () => {
    setExportingConsolidado(true);
    try {
      const resumen = await construirConsolidado();
      const periodoLabel = resumen.desde === resumen.hasta ? `Día ${resumen.desde}` : `${resumen.desde} al ${resumen.hasta}`;
      const rowsHtml = (resumen.articulos || [])
        .map((a, idx) => {
          const zebra = idx % 2 === 0 ? '#f7faff' : '#ffffff';
          return `
            <tr style="background:${zebra}">
              <td class="td">${escapeHtml(a.nombre)}</td>
              <td class="td right" x:num="${Number(a.total_unidades || 0)}">${Number(a.total_unidades || 0)}</td>
            </tr>
          `;
        })
        .join('');

      const html = `
        <html xmlns:x="urn:schemas-microsoft-com:office:excel">
          <head>
            <meta charset="UTF-8" />
            <style>
              body { font-family: ${PRINT_FONT_FAMILY_CSS}; }
              .title { font-size: 18px; font-weight: 700; color: #375f8c; margin-bottom: 8px; }
              .meta { font-size: 13px; margin-bottom: 4px; color: #1f2933; }
              table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-top: 10px; }
              .th, .td { border: 1px solid #c8d3e5; padding: 7px 8px; font-size: 12px; color: #1f2933; vertical-align: middle; }
              .th { background: #375f8c; color: #ffffff; font-weight: 700; text-align: center; }
              .right { text-align: right; }
              .total-row td { border: 1px solid #375f8c; font-weight: 700; color: #375f8c; background: #eef4fb; }
            </style>
          </head>
          <body>
            <div class="title">Consolidado de artículos</div>
            <div class="meta">Período: ${escapeHtml(periodoLabel)}</div>
            <div class="meta">Artículos: ${escapeHtml(Number(resumen.totalArticulos || 0))} &nbsp;&nbsp;|&nbsp;&nbsp; Unidades totales: ${escapeHtml(Number(resumen.totalUnidades || 0))}</div>
            <table>
              <colgroup>
                <col style="width:78%">
                <col style="width:22%">
              </colgroup>
              <thead>
                <tr>
                  <th class="th">ARTÍCULO</th>
                  <th class="th">CANTIDAD</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
                <tr class="total-row">
                  <td>TOTAL UNIDADES</td>
                  <td class="right" x:num="${Number(resumen.totalUnidades || 0)}">${Number(resumen.totalUnidades || 0)}</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `;

      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const suffix = `${resumen.desde || 'desde'}_${resumen.hasta || 'hasta'}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `consolidado-articulos-${suffix}.xls`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setModalConsolidadoOpen(false);
    } catch (err) {
      await appAlert(err.message || 'No se pudo exportar Excel del consolidado.');
    } finally {
      setExportingConsolidado(false);
    }
  };

  const imprimirConsolidado = async () => {
    setExportingConsolidado(true);
    try {
      const resumen = await construirConsolidado();
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const periodoLabel = resumen.desde === resumen.hasta ? `Día ${resumen.desde}` : `${resumen.desde} al ${resumen.hasta}`;
      doc.setFontSize(14);
      doc.text('Consolidado de artículos', pageWidth / 2, 14, { align: 'center' });
      doc.setFontSize(10);
      doc.text(`Período: ${periodoLabel}`, 14, 22);
      doc.text(`Unidades totales: ${Number(resumen.totalUnidades || 0).toLocaleString('es-UY')}`, 14, 27);
      autoTable(doc, {
        startY: 32,
        head: [['ARTÍCULO', 'CANTIDAD']],
        body: (resumen.articulos || []).map((a) => [
          a.nombre,
          Number(a.total_unidades || 0).toLocaleString('es-UY'),
        ]),
        styles: { fontSize: 10, valign: 'middle' },
        headStyles: { fillColor: getPrimaryRgb() },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 40, halign: 'right' },
        },
      });
      const blob = doc.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = blobUrl;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(blobUrl, '_blank', 'noopener,noreferrer');
        }
      };
      document.body.appendChild(iframe);
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 7000);
      setModalConsolidadoOpen(false);
    } catch (err) {
      await appAlert(err.message || 'No se pudo preparar impresión del consolidado.');
    } finally {
      setExportingConsolidado(false);
    }
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const processTicketsQueue = async (mode) => {
    if (!ticketsDesde || !ticketsHasta) {
      await appAlert('Debes seleccionar "Desde" y "Hasta" para generar los tickets por lote.');
      return;
    }
    if (ticketsDesde > ticketsHasta) {
      await appAlert('La fecha "Desde" no puede ser mayor que "Hasta".');
      return;
    }

    setPrintingBatch(true);
    try {
      const rows = await api.getVentas({ desde: ticketsDesde, hasta: ticketsHasta, filtro_fecha: ticketsFiltroFecha });
      const ventasActivas = rows.filter((v) => !v.cancelada);
      if (ventasActivas.length === 0) {
        await appAlert('No hay ventas activas para ese rango.');
        return;
      }
      for (const v of ventasActivas) {
        const venta = await api.getVentaById(v.id);
        if (ticketsTipo === 'factura' || ticketsTipo === 'ambos') {
          const doc = await buildVentaPdf(venta);
          if (mode === 'pdf') {
            doc.save(`ticket-venta-${venta.id}.pdf`);
          } else {
            printDocToIframe(doc);
          }
          await delay(350);
        }
        if (ticketsTipo === 'remito' || ticketsTipo === 'ambos') {
          const doc = await buildRemitoPdf(venta);
          if (mode === 'pdf') {
            doc.save(`remito-venta-${venta.id}.pdf`);
          } else {
            printDocToIframe(doc);
          }
          await delay(350);
        }
      }
      setModalTicketsOpen(false);
    } catch (err) {
      await appAlert(err.message || 'No se pudieron procesar los tickets en cola.');
    } finally {
      setPrintingBatch(false);
    }
  };

  const sortMark = useCallback((column) => (sortBy === column ? (sortDir === 'asc' ? '▲' : '▼') : ''), [sortBy, sortDir]);

  const aplicarRango = (nextDesde, nextHasta, preset) => {
    setDesde(nextDesde);
    setHasta(nextHasta);
    setRangoActivo(preset);
  };

  const ventasColumns = useMemo(() => [
    {
      key: 'id',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('id')}>
          # {sortMark('id')}
        </button>
      ),
      mobileLabel: '#',
      align: 'right',
      render: (v) => v.id,
    },
    {
      key: 'fecha',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('fecha')}>
          Fecha {sortMark('fecha')}
        </button>
      ),
      mobileLabel: 'Fecha',
      render: (v) => {
        const estadoEntrega = normalizarEstadoEntrega(v);
        return (
          <span className="venta-fecha-cell">
            <span>{formatDateTime(v.fecha)}</span>
            <small className={`entrega-badge ${getEntregaEstadoClass(v)}`}>
              {v.cancelada
                ? '✕ Cancelada'
                : (estadoEntrega === 'entregado' ? '✓ Entregada' : `Entrega: ${formatDateOnly(v.fecha_entrega)}`)}
            </small>
          </span>
        );
      },
    },
    {
      key: 'cliente',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('cliente')}>
          Cliente {sortMark('cliente')}
        </button>
      ),
      mobileLabel: 'Cliente',
      render: (v) => v.cliente_nombre || 'Consumidor final',
    },
    {
      key: 'vendedor',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('vendedor')}>
          Vendedor {sortMark('vendedor')}
        </button>
      ),
      mobileLabel: 'Vendedor',
      mobileHide: true,
      render: (v) => v.usuario_nombre || '-',
    },
    {
      key: 'total',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('total')}>
          Total {sortMark('total')}
        </button>
      ),
      mobileLabel: 'Total',
      align: 'right',
      render: (v) => formatCurrency(v.total),
    },
    {
      key: 'pago',
      header: 'Pago',
      mobileLabel: 'Pago',
      mobileHide: true,
      render: (v) => <span className="pago-resumen-cell">{formatPagosResumen(v.pagos)}</span>,
    },
    {
      key: 'estado',
      header: <span className="estado-col-head">Estado</span>,
      mobileLabel: 'Estado',
      align: 'center',
      render: (v) => {
        const estadoEntrega = normalizarEstadoEntrega(v);
        return (
          <span className={`estado-entrega-text estado-col ${
            estadoEntrega === 'cancelado'
              ? 'is-cancelado'
              : (estadoEntrega === 'entregado' ? 'is-entregado' : 'is-pendiente')
          }`}>
            {estadoEntrega === 'cancelado'
              ? 'Cancelado'
              : (estadoEntrega === 'entregado' ? 'Entregado' : 'Pendiente')}
          </span>
        );
      },
    },
    {
      key: 'entregado',
      header: <span className="entregado-col-head">Entregado</span>,
      mobileLabel: 'Entregado',
      align: 'center',
      render: (v) => {
        const estadoEntrega = normalizarEstadoEntrega(v);
        return (
          <label className="entregado-check entregado-col" onClick={(e) => e.stopPropagation()}>
            <AppInput
              type="checkbox"
              checked={estadoEntrega === 'entregado'}
              disabled={updatingEntregaId === v.id || Boolean(v.cancelada)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => toggleEntregado(v.id, e.target.checked)}
            />
            <span className={`entregado-pill ${estadoEntrega === 'entregado' ? 'is-on' : 'is-off'}`}>
              {estadoEntrega === 'entregado' ? 'Si' : 'No'}
            </span>
          </label>
        );
      },
    },
    ...(cfeHabilitado ? [{
      key: 'cfe',
      header: <span className="cfe-col-head">CFE</span>,
      mobileLabel: 'CFE',
      mobileHide: true,
      align: 'center',
      render: (v) => (
        <label className="entregado-check cfe-col" onClick={(e) => e.stopPropagation()}>
          <AppInput
            type="checkbox"
            checked={Boolean(v.cfe_enviado)}
            disabled={updatingCfeEnviadoId === v.id}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => toggleCfeEnviado(v.id, e.target.checked)}
          />
          <span className={`entregado-pill ${v.cfe_enviado ? 'is-on' : 'is-off'}`}>
            {v.cfe_enviado ? 'Sí' : 'No'}
          </span>
        </label>
      ),
    }] : []),
  ], [sortMark, toggleSort, updatingEntregaId, updatingCfeEnviadoId, cfeHabilitado, toggleEntregado, toggleCfeEnviado]);

  const renderExpandedVenta = (v) => {
    const detalleVenta = detalleByVentaId[v.id] || [];

    return (
      <div className="venta-detalle-panel">
        <div className="venta-detalle-actions">
          <AppButton
            type="button"
            className="cancel-btn"
            onClick={() => cancelarVenta(v.id)}
            disabled={cancelandoVentaId === v.id || Boolean(v.cancelada)}
            title="Cancelar venta"
            aria-label="Cancelar venta"
          >
            <span>{v.cancelada ? '✕' : (cancelandoVentaId === v.id ? '…' : '✕')}</span>
            <small>Cancelar</small>
          </AppButton>
          <AppButton
            type="button"
            className="delete-btn"
            onClick={() => eliminarVenta(v.id)}
            disabled={eliminandoVentaId === v.id}
            title="Eliminar venta"
            aria-label="Eliminar venta"
          >
            <span>{eliminandoVentaId === v.id ? '…' : '🗑'}</span>
            <small>Eliminar</small>
          </AppButton>
          <AppButton
            type="button"
            className="reprint-btn"
            onClick={() => replicarVenta(v.id)}
            disabled={printingId === v.id}
            title="Replicar venta"
            aria-label="Replicar venta"
          >
            <FaReplyAll aria-hidden="true" />
            <small>Replicar</small>
          </AppButton>
          <AppButton
            type="button"
            className="reprint-btn"
            onClick={() => reenviarFactura(v.id)}
            disabled={printingId === v.id}
            title="Reenviar factura"
            aria-label="Reenviar factura"
          >
            <img src="/send.svg" alt="" aria-hidden="true" />
            <small>Reenviar</small>
          </AppButton>
          <AppButton
            type="button"
            className="reprint-btn"
            onClick={() => imprimirVenta(v.id)}
            disabled={printingId === v.id}
            title="Reimprimir ticket"
            aria-label="Reimprimir ticket"
          >
            <img src="/print.svg" alt="" aria-hidden="true" />
            <small>Imprimir</small>
          </AppButton>
          <AppButton
            type="button"
            className="reprint-btn"
            onClick={() => verCFE(v.id, v.cfe_enviado)}
            disabled={loadingCfeId === v.id}
            title="Ver CFE (JSON)"
            aria-label="Ver CFE"
            style={{ display: cfeHabilitado ? undefined : 'none' }}
          >
            <small>{loadingCfeId === v.id ? '...' : 'CFE'}</small>
          </AppButton>
        </div>
        {loadingDetalleId === v.id ? (
          <p>Cargando detalle...</p>
        ) : detalleVenta.length === 0 ? (
          <p>Sin detalle para esta venta.</p>
        ) : (
          <ul className="venta-detalle-list">
            {detalleVenta.map((item) => (
              <li key={item.id}>
                <span>{item.producto_nombre || `Producto #${item.producto_id}`}</span>
                <span>{item.cantidad} u.</span>
                <span>{formatCurrency(item.precio_unitario)}</span>
                <strong>{formatCurrency(Number(item.cantidad || 0) * Number(item.precio_unitario || 0) - Number(item.descuento_aplicado || 0) - Number(item.descuento_packs_aplicado || 0))}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="ventas-historial-main">
      <FilterSlot>
      <div className="ventas-historial-toolbar">
        <div className="ventas-busqueda-row">
          <AppInput
            type="text"
            className="ventas-busqueda-global"
            placeholder="Buscar por cliente, producto o #..."
            value={busquedaGlobal}
            onChange={(e) => {
              const val = e.target.value;
              setBusquedaGlobal(val);
              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
              if (!val.trim()) {
                setModoSearch(false);
                return;
              }
              searchDebounceRef.current = setTimeout(() => setModoSearch(true), 400);
            }}
          />
          {busquedaGlobal && (
            <button
              type="button"
              className="ventas-busqueda-clear"
              onClick={() => { setBusquedaGlobal(''); setModoSearch(false); }}
              aria-label="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>
        {modoSearch && (
          <p className="ventas-busqueda-hint">Modo búsqueda — los filtros de fecha están inactivos</p>
        )}
        <div className="ventas-filtros-group">
          <div className="ventas-range-stack">
            <div className="ventas-quick-range-row">
              <AppButton
                type="button"
                className={`ticket-preset-btn${rangoActivo === 'ayer' ? ' active' : ''}`}
                onClick={() => { const y = yesterdayISO(); aplicarRango(y, y, 'ayer'); }}
              >Ayer</AppButton>
              <AppButton
                type="button"
                className={`ticket-preset-btn${rangoActivo === 'semana_pasada' ? ' active' : ''}`}
                onClick={() => { const r = previousWeekRangeISO(); aplicarRango(r.desde, r.hasta, 'semana_pasada'); }}
              >Semana pasada</AppButton>
              <AppButton
                type="button"
                className={`ticket-preset-btn${rangoActivo === 'mes_anterior' ? ' active' : ''}`}
                onClick={() => { const r = previousMonthRangeISO(); aplicarRango(r.desde, r.hasta, 'mes_anterior'); }}
              >Mes anterior</AppButton>
              <AppButton
                type="button"
                className={`ticket-preset-btn${rangoActivo === 'hoy' ? ' active' : ''}`}
                onClick={() => { const t = todayISO(); aplicarRango(t, t, 'hoy'); }}
              >Hoy</AppButton>
              <AppButton
                type="button"
                className={`ticket-preset-btn${rangoActivo === 'este_mes' ? ' active' : ''}`}
                onClick={() => { const r = monthRangeISO(); aplicarRango(r.desde, r.hasta, 'este_mes'); }}
              >Este mes</AppButton>
              <AppButton
                type="button"
                className={`ticket-preset-btn${rangoActivo === 'siempre' ? ' active' : ''}`}
                onClick={() => aplicarRango('', '', 'siempre')}
              >Siempre</AppButton>
              <AppButton
                type="button"
                className={`ticket-preset-btn${rangoActivo === 'especifica' ? ' active' : ''}`}
                onClick={() => setRangoActivo('especifica')}
              >Fecha específica</AppButton>
            </div>
            <div className="ventas-date-estado-row">
              <label className="ventas-fecha-filter">
                <span>Desde</span>
                <AppInput
                  type="date"
                  value={desde}
                  readOnly={rangoActivo !== 'especifica'}
                  onChange={rangoActivo === 'especifica' ? (e) => setDesde(e.target.value) : () => {}}
                />
              </label>
              <label className="ventas-fecha-filter">
                <span>Hasta</span>
                <AppInput
                  type="date"
                  value={hasta}
                  readOnly={rangoActivo !== 'especifica'}
                  onChange={rangoActivo === 'especifica' ? (e) => setHasta(e.target.value) : () => {}}
                />
              </label>
              <label className="ventas-fecha-filter">
                <span>Estado</span>
                <AppSelect value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
                  <option value="todos">Todos</option>
                  <option value="pendiente">Pendientes</option>
                  <option value="entregado">Entregadas</option>
                  <option value="canceladas">Canceladas</option>
                </AppSelect>
              </label>
              <label className="ventas-fecha-filter">
                <span>Vendedor</span>
                <AppSelect value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  {vendedoresOptions.map((nombre) => (
                    <option key={nombre} value={nombre}>{nombre}</option>
                  ))}
                </AppSelect>
              </label>
              <label className="ventas-fecha-filter">
                <span>Cliente</span>
                <AppSelect value={clienteFiltro} onChange={(e) => setClienteFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  {clientesOptions.map((nombre) => (
                    <option key={nombre} value={nombre}>{nombre}</option>
                  ))}
                </AppSelect>
              </label>
              {cfeHabilitado && (
                <label className="ventas-fecha-filter">
                  <span>Estado CFE</span>
                  <AppSelect value={cfeFiltro} onChange={(e) => setCfeFiltro(e.target.value)}>
                    <option value="todos">Todos</option>
                    <option value="enviado">Enviado</option>
                    <option value="pendiente">Pendiente</option>
                  </AppSelect>
                </label>
              )}
            </div>
          </div>
        </div>
        <div className="ventas-export-group">
          <AppButton
            type="button"
            className="ventas-export-btn"
            onClick={() => setModalTicketsOpen(true)}
            disabled={printingBatch || loading}
            title="Tickets para entrega"
          >
            <AiFillPrinter />
            {printingBatch ? 'Procesando tickets...' : 'Tickets para entrega + Remito'}
          </AppButton>
          <AppButton
            type="button"
            className="ventas-export-btn"
            onClick={() => {
              const t = todayISO();
              setEntregasDesde(t);
              setEntregasHasta(t);
              setModalExportOpen(true);
            }}
            disabled={exportingEntregas}
            title="Imprimir entregas"
          >
            <PiFilePdfBold />
            <span className="btn-label">{exportingEntregas ? 'Procesando...' : 'Imprimir entregas'}</span>
          </AppButton>
          <AppButton
            type="button"
            className="ventas-export-btn"
            onClick={() => {
              const t = todayISO();
              setConsolidadoDesde(t);
              setConsolidadoHasta(t);
              setModalConsolidadoOpen(true);
            }}
            disabled={exportingConsolidado}
            title="Consolidado de artículos para entregas"
          >
            <PiFilePdfBold />
            <span className="btn-label">{exportingConsolidado ? 'Procesando...' : 'Consolidado de artículos'}</span>
          </AppButton>
          {cfeHabilitado && (
            <AppButton
              type="button"
              className="ventas-export-btn"
              onClick={() => {
                const t = todayISO();
                setCfeLoteDesde(t);
                setCfeLoteHasta(t);
                setCfeLoteVentas(null);
                setCfeLoteResultados([]);
                setCfeLoteModalOpen(true);
              }}
              title="Envío CFE por lote"
            >
              <RiSendPlaneFill />
              <span className="btn-label">CFE Lote</span>
            </AppButton>
          )}
        </div>
      </div>
      </FilterSlot>

      {modalTicketsOpen && (
        <div className="export-modal-overlay" role="dialog" aria-modal="true">
          <div className="export-modal-backdrop" onClick={() => !printingBatch && setModalTicketsOpen(false)} />
          <div className="export-modal">
            <h4>Tickets para entrega + Remito</h4>
            <p>
              Se imprimirán o descargarán los tickets activos del rango seleccionado, uno por uno.
              Filtrando por <strong>{ticketsFiltroFecha === 'entrega' ? 'fecha de entrega' : 'fecha de venta'}</strong>.
            </p>
            <div className="tickets-tipo-row">
              {[
                { value: 'entrega', label: 'Fecha de entrega' },
                { value: 'venta',   label: 'Fecha de venta'   },
              ].map((op) => (
                <AppButton
                  key={op.value}
                  type="button"
                  className={`ticket-tipo-btn${ticketsFiltroFecha === op.value ? ' active' : ''}`}
                  onClick={() => setTicketsFiltroFecha(op.value)}
                  disabled={printingBatch}
                >
                  {op.label}
                </AppButton>
              ))}
            </div>
            <div className="tickets-tipo-row">
              {[
                { value: 'factura', label: 'Solo Factura' },
                { value: 'remito',  label: 'Solo Remito'  },
                { value: 'ambos',   label: 'Factura + Remito' },
              ].map((op) => (
                <AppButton
                  key={op.value}
                  type="button"
                  className={`ticket-tipo-btn${ticketsTipo === op.value ? ' active' : ''}`}
                  onClick={() => setTicketsTipo(op.value)}
                  disabled={printingBatch}
                >
                  {op.label}
                </AppButton>
              ))}
            </div>
            <div className="tickets-presets-row">
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const t = todayISO();
                  setTicketsDesde(t);
                  setTicketsHasta(t);
                }}
                disabled={printingBatch}
              >
                Hoy
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const t = tomorrowISO();
                  setTicketsDesde(t);
                  setTicketsHasta(t);
                }}
                disabled={printingBatch}
              >
                Mañana
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const r = weekRangeISO();
                  setTicketsDesde(r.desde);
                  setTicketsHasta(r.hasta);
                }}
                disabled={printingBatch}
              >
                Esta semana
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const r = monthRangeISO();
                  setTicketsDesde(r.desde);
                  setTicketsHasta(r.hasta);
                }}
                disabled={printingBatch}
              >
                Este mes
              </AppButton>
            </div>
            <div className="tickets-range-row">
              <label className="ventas-fecha-filter">
                <span>Desde</span>
                <AppInput type="date" value={ticketsDesde} onChange={(e) => setTicketsDesde(e.target.value)} />
              </label>
              <label className="ventas-fecha-filter">
                <span>Hasta</span>
                <AppInput type="date" value={ticketsHasta} onChange={(e) => setTicketsHasta(e.target.value)} />
              </label>
            </div>
            <div className="export-modal-actions">
              <AppButton type="button" onClick={() => processTicketsQueue('pdf')} disabled={printingBatch}>
                <PiFilePdfBold />
                <span>Descargar PDF (uno por uno)</span>
              </AppButton>
              <AppButton type="button" onClick={() => processTicketsQueue('printer')} disabled={printingBatch}>
                <AiFillPrinter />
                <span>Enviar a impresora (uno por uno)</span>
              </AppButton>
            </div>
            <AppButton
              type="button"
              className="export-modal-close"
              onClick={() => setModalTicketsOpen(false)}
              disabled={printingBatch}
            >
              Cerrar
            </AppButton>
          </div>
        </div>
      )}

      {modalExportOpen && (
        <div className="export-modal-overlay" role="dialog" aria-modal="true">
          <div className="export-modal-backdrop" onClick={() => !exportingEntregas && setModalExportOpen(false)} />
          <div className="export-modal">
            <h4>Planilla de entregas</h4>
            <p>Elige rango y formato.</p>
            <div className="tickets-presets-row">
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const t = todayISO();
                  setEntregasDesde(t);
                  setEntregasHasta(t);
                }}
                disabled={exportingEntregas}
              >
                Hoy
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const t = tomorrowISO();
                  setEntregasDesde(t);
                  setEntregasHasta(t);
                }}
                disabled={exportingEntregas}
              >
                Mañana
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const r = weekRangeISO();
                  setEntregasDesde(r.desde);
                  setEntregasHasta(r.hasta);
                }}
                disabled={exportingEntregas}
              >
                Esta semana
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const r = monthRangeISO();
                  setEntregasDesde(r.desde);
                  setEntregasHasta(r.hasta);
                }}
                disabled={exportingEntregas}
              >
                Este mes
              </AppButton>
            </div>
            <div className="tickets-range-row">
              <label className="ventas-fecha-filter">
                <span>Desde</span>
                <AppInput type="date" value={entregasDesde} onChange={(e) => setEntregasDesde(e.target.value)} />
              </label>
              <label className="ventas-fecha-filter">
                <span>Hasta</span>
                <AppInput type="date" value={entregasHasta} onChange={(e) => setEntregasHasta(e.target.value)} />
              </label>
            </div>
            <div className="export-modal-actions">
              <AppButton type="button" onClick={exportarEntregasPDF} disabled={exportingEntregas}>
                <PiFilePdfBold />
                <span>PDF</span>
              </AppButton>
              <AppButton type="button" onClick={exportarEntregasExcel} disabled={exportingEntregas}>
                <RiFileExcel2Line />
                <span>EXCEL</span>
              </AppButton>
              <AppButton type="button" onClick={imprimirEntregas} disabled={exportingEntregas}>
                <AiFillPrinter />
                <span>Impresora</span>
              </AppButton>
            </div>
            <AppButton
              type="button"
              className="export-modal-close"
              onClick={() => setModalExportOpen(false)}
              disabled={exportingEntregas}
            >
              Cerrar
            </AppButton>
          </div>
        </div>
      )}

      {modalConsolidadoOpen && (
        <div className="export-modal-overlay" role="dialog" aria-modal="true">
          <div className="export-modal-backdrop" onClick={() => !exportingConsolidado && setModalConsolidadoOpen(false)} />
          <div className="export-modal">
            <h4>Consolidado de artículos</h4>
            <p>Suma de unidades necesarias para las entregas pendientes del período.</p>
            <div className="tickets-presets-row">
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const t = todayISO();
                  setConsolidadoDesde(t);
                  setConsolidadoHasta(t);
                }}
                disabled={exportingConsolidado}
              >
                Hoy
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const t = tomorrowISO();
                  setConsolidadoDesde(t);
                  setConsolidadoHasta(t);
                }}
                disabled={exportingConsolidado}
              >
                Mañana
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const r = weekRangeISO();
                  setConsolidadoDesde(r.desde);
                  setConsolidadoHasta(r.hasta);
                }}
                disabled={exportingConsolidado}
              >
                Esta semana
              </AppButton>
              <AppButton
                type="button"
                className="ticket-preset-btn"
                onClick={() => {
                  const r = monthRangeISO();
                  setConsolidadoDesde(r.desde);
                  setConsolidadoHasta(r.hasta);
                }}
                disabled={exportingConsolidado}
              >
                Este mes
              </AppButton>
            </div>
            <div className="tickets-range-row">
              <label className="ventas-fecha-filter">
                <span>Desde</span>
                <AppInput type="date" value={consolidadoDesde} onChange={(e) => setConsolidadoDesde(e.target.value)} />
              </label>
              <label className="ventas-fecha-filter">
                <span>Hasta</span>
                <AppInput type="date" value={consolidadoHasta} onChange={(e) => setConsolidadoHasta(e.target.value)} />
              </label>
            </div>
            <div className="export-modal-actions">
              <AppButton type="button" onClick={exportarConsolidadoPDF} disabled={exportingConsolidado}>
                <PiFilePdfBold />
                <span>PDF</span>
              </AppButton>
              <AppButton type="button" onClick={exportarConsolidadoExcel} disabled={exportingConsolidado}>
                <RiFileExcel2Line />
                <span>EXCEL</span>
              </AppButton>
              <AppButton type="button" onClick={imprimirConsolidado} disabled={exportingConsolidado}>
                <AiFillPrinter />
                <span>Impresora</span>
              </AppButton>
            </div>
            <AppButton
              type="button"
              className="export-modal-close"
              onClick={() => setModalConsolidadoOpen(false)}
              disabled={exportingConsolidado}
            >
              Cerrar
            </AppButton>
          </div>
        </div>
      )}

      {modalTipoImpresionVentaId !== null && (
        <div className="export-modal-overlay" role="dialog" aria-modal="true">
          <div className="export-modal-backdrop" onClick={() => setModalTipoImpresionVentaId(null)} />
          <div className="export-modal">
            <h4>¿Qué deseas imprimir?</h4>
            <div className="export-modal-actions">
              <AppButton
                type="button"
                onClick={() => {
                  const id = modalTipoImpresionVentaId;
                  setModalTipoImpresionVentaId(null);
                  imprimirSegun(id, 'factura');
                }}
                disabled={printingId === modalTipoImpresionVentaId}
              >
                <PiFilePdfBold />
                <span>Solo Factura</span>
              </AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  const id = modalTipoImpresionVentaId;
                  setModalTipoImpresionVentaId(null);
                  imprimirSegun(id, 'remito');
                }}
                disabled={printingId === modalTipoImpresionVentaId}
              >
                <PiFilePdfBold />
                <span>Solo Remito</span>
              </AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  const id = modalTipoImpresionVentaId;
                  setModalTipoImpresionVentaId(null);
                  imprimirSegun(id, 'ambos');
                }}
                disabled={printingId === modalTipoImpresionVentaId}
              >
                <PiFilePdfBold />
                <span>Factura + Remito</span>
              </AppButton>
            </div>
            <AppButton
              type="button"
              className="export-modal-close"
              onClick={() => setModalTipoImpresionVentaId(null)}
            >
              Cancelar
            </AppButton>
          </div>
        </div>
      )}

      <div className="ventas-resumen">
        <span>{ventasFiltradas.length} ventas</span>
        <strong>Total: {formatCurrency(totalDelDia)}</strong>
      </div>

      {loading && <div className="ventas-msg">Cargando ventas...</div>}
      {!loading && error && <div className="ventas-msg error">{error}</div>}

      {!loading && !error && (
        <AppTable
          columns={ventasColumns}
          rows={ventasOrdenadas}
          rowKey="id"
          stickyHeader
          minWidth={980}
          emptyMessage="No hay ventas para los filtros seleccionados."
          onRowClick={(v) => toggleDetalleVenta(v.id)}
          rowClassName={(v) => (v.cancelada ? 'venta-row-cancelada' : (v.entregado ? 'venta-row-entregada' : ''))}
          expandedRowId={expandedVentaId}
          renderExpandedRow={(v) => renderExpandedVenta(v)}
        />
      )}

      {cfeLoteModalOpen && createPortal(
        <div className="export-modal-overlay" role="dialog" aria-modal="true">
          <div className="export-modal-backdrop" onClick={() => !cfeLoteEnviando && setCfeLoteModalOpen(false)} />
          <div className="export-modal cfe-lote-modal">
            <h4>Envío CFE por lote</h4>
            <p>Seleccione el rango de fechas y busque las ventas con CFE pendiente.</p>
            <div className="tickets-tipo-row">
              <label className="ventas-fecha-filter">
                <span>Desde</span>
                <AppInput
                  type="date"
                  value={cfeLoteDesde}
                  onChange={(e) => setCfeLoteDesde(e.target.value)}
                  disabled={cfeLoteEnviando}
                />
              </label>
              <label className="ventas-fecha-filter">
                <span>Hasta</span>
                <AppInput
                  type="date"
                  value={cfeLoteHasta}
                  onChange={(e) => setCfeLoteHasta(e.target.value)}
                  disabled={cfeLoteEnviando}
                />
              </label>
              <AppButton
                type="button"
                onClick={buscarVentasCfePendientes}
                disabled={cfeLoteBuscando || cfeLoteEnviando}
              >
                {cfeLoteBuscando ? 'Buscando...' : 'Buscar'}
              </AppButton>
            </div>
            {cfeLoteVentas !== null && (
              cfeLoteVentas.length === 0 ? (
                <p className="cfe-lote-empty">No hay ventas con CFE pendiente en el rango seleccionado.</p>
              ) : (
                <div className="cfe-lote-lista">
                  <p className="cfe-lote-count">{cfeLoteVentas.length} venta(s) con CFE pendiente</p>
                  <div className="cfe-lote-items">
                    {cfeLoteVentas.map((v) => {
                      const resultado = cfeLoteResultados.find((r) => r.ventaId === v.id);
                      return (
                        <div
                          key={v.id}
                          className={`cfe-lote-item${resultado ? (resultado.status === 'enviando' ? ' item-enviando' : resultado.ok ? ' item-ok' : ' item-error') : ''}`}
                        >
                          <span className="cfe-lote-item-id">#{v.id}</span>
                          <span className="cfe-lote-item-cliente">{v.cliente_nombre || 'Consumidor final'}</span>
                          <span className="cfe-lote-item-total">{formatCurrency(v.total)}</span>
                          <span className="cfe-lote-item-estado">
                            {!resultado
                              ? '—'
                              : resultado.status === 'enviando'
                              ? '⟳ Enviando...'
                              : resultado.ok
                              ? '✓ CFE emitido'
                              : `✗ ${resultado.mensaje}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}
            <div className="export-modal-actions">
              {cfeLoteVentas?.length > 0 &&
                !cfeLoteEnviando &&
                cfeLoteResultados.filter((r) => r.ok).length < cfeLoteVentas.length && (
                  <AppButton type="button" onClick={enviarCfeLote}>
                    Enviar lote
                  </AppButton>
                )}
              {cfeLoteEnviando && (
                <span className="cfe-lote-progreso">
                  Enviando {cfeLoteResultados.length} / {cfeLoteVentas?.length}...
                </span>
              )}
              <AppButton
                type="button"
                className="secundario"
                onClick={() => { if (!cfeLoteEnviando) setCfeLoteModalOpen(false); }}
                disabled={cfeLoteEnviando}
              >
                Cerrar
              </AppButton>
            </div>
          </div>
        </div>,
        document.body
      )}
      {cfeModalData && typeof document !== 'undefined' && createPortal(
        <div className="export-modal-overlay" role="dialog" aria-modal="true" aria-label="CFE JSON">
          <div className="export-modal-backdrop" onClick={() => setCfeModalData(null)} />
          <div className="export-modal cfe-modal">
            <h4>CFE — Venta #{cfeModalData.ventaId}</h4>
            <pre className="cfe-json-pre">{cfeModalData.json}</pre>
            {cfeModalData.envioResultado && (
              <div className={`cfe-envio-resultado ${cfeModalData.envioResultado.ok ? 'cfe-envio-ok' : 'cfe-envio-error'}`}>
                {cfeModalData.envioResultado.ok
                  ? `✓ CFE emitido correctamente`
                  : `✗ ${cfeModalData.envioResultado.error}`}
              </div>
            )}
            <div className="export-modal-actions">
              <AppButton
                type="button"
                variant="primary"
                disabled={enviandoCFE || Boolean(cfeModalData.envioResultado?.ok)}
                onClick={async () => {
                  if (cfeModalData.cfeEnviado) {
                    const confirmar = await appConfirm(
                      'El CFE de esta venta ya fue enviado y confirmado correctamente. Enviarlo nuevamente puede generar duplicidad de comprobantes en DGI.\n\n¿Desea forzar el reenvío de todas formas?'
                    );
                    if (!confirmar) return;
                  }
                  setEnviandoCFE(true);
                  const ventaIdEmitiendo = cfeModalData.ventaId;
                  try {
                    const result = await api.sendVentaCFE(ventaIdEmitiendo, cfeModalData.cfeEnviado);
                    setCfeModalData((prev) => ({ ...prev, cfeEnviado: true, envioResultado: { ok: true, result } }));
                    setVentas((prev) => prev.map((v) => v.id === ventaIdEmitiendo ? { ...v, cfe_enviado: true } : v));
                  } catch (err) {
                    setCfeModalData((prev) => ({ ...prev, envioResultado: { ok: false, error: err.message || 'Error al emitir CFE' } }));
                  } finally {
                    setEnviandoCFE(false);
                  }
                }}
              >
                {enviandoCFE ? 'Emitiendo…' : 'Emitir CFE'}
              </AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  const blob = new Blob([cfeModalData.json], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `cfe-venta-${cfeModalData.ventaId}.jsonc`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Descargar JSON
              </AppButton>
            </div>
            <AppButton
              type="button"
              className="export-modal-close"
              onClick={() => setCfeModalData(null)}
            >
              Cerrar
            </AppButton>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


