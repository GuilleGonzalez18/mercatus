import { useCallback, useEffect, useMemo, useState } from 'react';
import './Productos.css';
import { FilterSlot } from '../../shared/lib/filterPanel';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../../core/api';
import { useConfig } from '../../core/ConfigContext';
import { usePermisos } from '../../core/PermisosContext';
import { getPrimaryRgb, detectImageFormat, loadLogoForPdf } from '../../shared/lib/pdfColors';
import { fromApiProducto, toApiProducto } from '../../shared/lib/productMapper';
import { appAlert, appConfirm } from '../../shared/lib/appDialog';
import AppTable from '../../shared/components/table/AppTable';
import AppInput from '../../shared/components/fields/AppInput';
import AppSelect from '../../shared/components/fields/AppSelect';
import { TbFileTypePdf, TbFileSpreadsheet, TbPrinter, TbBrandWhatsapp } from 'react-icons/tb';
import AppButton from '../../shared/components/button/AppButton';
import { PRINT_FONT_FAMILY_CSS } from '../../shared/lib/typography';

function stockState(stockValue) {
  const s = Number(stockValue || 0);
  if (!Number.isFinite(s)) return 'normal';
  if (s <= 0) return 'stock-zero';
  if (s < 30) return 'stock-low';
  return 'normal';
}

function formatMoney(value) {
  const n = Number(value || 0);
  const hasDecimals = n % 1 !== 0;
  return `$${n.toLocaleString('es-UY', { minimumFractionDigits: hasDecimals ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function formatCatalogUpdatedAt() {
  return new Date().toLocaleString('es-UY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function calcularGananciaUnidad(costo, venta) {
  const costoNum = Number(costo);
  const ventaNum = Number(venta);
  if (!Number.isFinite(costoNum) || !Number.isFinite(ventaNum)) return 0;
  return ventaNum - costoNum;
}

export default function Productos({ productos = [], setProductos }) {
  const { empresa } = useConfig();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [productoExpandidoId, setProductoExpandidoId] = useState(null);
  const [imagenUrlError, setImagenUrlError] = useState('');
  const [imagenUploading, setImagenUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState('nombre');
  const [sortDir, setSortDir] = useState('asc');
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [archivadosModalOpen, setArchivadosModalOpen] = useState(false);
  const [productosArchivados, setProductosArchivados] = useState([]);
  const [empaquesModalOpen, setEmpaquesModalOpen] = useState(false);
  const [empaques, setEmpaques] = useState([]);
  const [nuevoEmpaqueNombre, setNuevoEmpaqueNombre] = useState('');
  const [tiposIvaModalOpen, setTiposIvaModalOpen] = useState(false);
  const [tiposIva, setTiposIva] = useState([]);
  const [nuevoIvaNombre, setNuevoIvaNombre] = useState('');
  const [nuevoIvaPorcentaje, setNuevoIvaPorcentaje] = useState('');
  const mostrarOpcionesCatalogo = false;
  const { can } = usePermisos();
  const verCosto = can('productos', 'ver_costo');
  const verGanancia = can('productos', 'ver_ganancia');
  const puedeAgregar = can('productos', 'agregar');
  const puedeEditar = can('productos', 'editar');
  const puedeEliminar = can('productos', 'eliminar');
  const puedeExportar = can('productos', 'exportar');
  const verArchivados = can('productos', 'ver_archivados');
  const gestionarEmpaques = can('productos', 'gestionar_empaques');
  const [nuevo, setNuevo] = useState({
    nombre: '', stock: '', categoria: '', imagen: null, imagenPreview: '', ean: '', tipoEmpaque: '', empaqueId: '', cantidadEmpaque: '', costo: '', venta: '', precioEmpaque: '', ivaId: ''
  });

  const loadEmpaques = async () => {
    try {
      const rows = await api.getEmpaques();
      setEmpaques(Array.isArray(rows) ? rows : []);
    } catch (error) {
      await appAlert(error.message || 'No se pudieron cargar los empaques.');
    }
  };

  const loadTiposIva = async () => {
    try {
      const rows = await api.getTiposIva();
      setTiposIva(Array.isArray(rows) ? rows : []);
    } catch (error) {
      await appAlert(error.message || 'No se pudieron cargar los tipos de IVA.');
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      loadEmpaques();
      loadTiposIva();
    });
  }, []);

  const loadProductosArchivados = async () => {
    try {
      const rows = await api.getProductos({ includeArchived: true });
      const archivados = Array.isArray(rows)
        ? rows.filter((row) => row?.activo === false).map(fromApiProducto)
        : [];
      setProductosArchivados(archivados);
    } catch (error) {
      await appAlert(error.message || 'No se pudieron cargar los productos archivados.');
    }
  };

  const normalizeImageUrl = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  };

  const handleChange = e => {
    const { name, value } = e.target;
    if (name === 'imagenUrl') {
      const trimmed = normalizeImageUrl(value);
      if (!trimmed) {
        setImagenUrlError('');
        setNuevo(n => ({ ...n, imagen: null, imagenPreview: '' }));
        return;
      }
      if (!isHttpUrl(trimmed)) {
        setImagenUrlError('La URL debe comenzar con http:// o https://');
        setNuevo(n => ({ ...n, imagen: null, imagenPreview: trimmed }));
        return;
      }
      setImagenUrlError('');
      setNuevo(n => ({
        ...n,
        imagen: null,
        imagenPreview: trimmed,
      }));
      return;
    }
    if (name === 'empaqueId') {
      const selected = empaques.find((e) => String(e.id) === String(value));
      setNuevo(n => ({
        ...n,
        empaqueId: value,
        tipoEmpaque: selected?.nombre || '',
      }));
      return;
    }
    setNuevo(n => ({ ...n, [name]: value }));
  };

  const handleImagenFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setNuevo(n => ({ ...n, imagenPreview: blobUrl }));
    setImagenUrlError('');
    setImagenUploading(true);
    try {
      const { url } = await api.uploadImagen(file);
      setNuevo(n => ({ ...n, imagenPreview: url }));
    } catch (err) {
      setImagenUrlError(`Error al subir imagen: ${err.message}`);
      setNuevo(n => ({ ...n, imagenPreview: '' }));
    } finally {
      URL.revokeObjectURL(blobUrl);
      setImagenUploading(false);
    }
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (saving || !setProductos) return;
    if (imagenUrlError) {
      await appAlert('Corrige la URL de imagen antes de guardar.');
      return;
    }

    setSaving(true);
    try {
      if (editando !== null) {
        const updated = await api.updateProducto(editando, toApiProducto(nuevo));
        setProductos(productos.map(p => p.id === editando ? fromApiProducto(updated) : p));
        setEditando(null);
      } else {
        const created = await api.createProducto(toApiProducto(nuevo));
        setProductos([fromApiProducto(created), ...productos]);
      }
      setNuevo({ nombre: '', stock: '', categoria: '', imagen: null, imagenPreview: '', ean: '', tipoEmpaque: '', empaqueId: '', cantidadEmpaque: '', costo: '', venta: '', precioEmpaque: '', ivaId: '' });
      setMostrarForm(false);
      setImagenUrlError('');
    } catch (error) {
      await appAlert(`Error guardando producto: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEditar = prod => {
    setProductoExpandidoId(null);
    const matchedByName = empaques.find((e) => String(e.nombre || '').toLowerCase() === String(prod.tipoEmpaque || '').toLowerCase());
    setNuevo({
      ...prod,
      imagen: null,
      empaqueId: prod.empaqueId || (matchedByName ? String(matchedByName.id) : ''),
      ivaId: prod.ivaId || '',
    });
    setImagenUrlError('');
    setEditando(prod.id);
    setMostrarForm(true);
  };

  const handleEliminar = async id => {
    const ok = await appConfirm('¿Seguro que deseas archivar este producto? Dejará de aparecer en el catálogo y en ventas nuevas.', {
      title: 'Archivar producto',
      confirmText: 'Archivar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    try {
      await api.deleteProducto(id);
      setProductos(productos.filter(p => p.id !== id));
      const archivado = productos.find((p) => Number(p.id) === Number(id));
      if (archivado) {
        setProductosArchivados((prev) => [archivado, ...prev.filter((p) => Number(p.id) !== Number(id))]);
      }
      setProductoExpandidoId((prev) => (prev === id ? null : prev));
    } catch (error) {
      await appAlert(`No se pudo archivar: ${error.message}`);
    }
  };

  const handleRestaurar = async (producto) => {
    const ok = await appConfirm(`¿Restaurar "${producto.nombre}" al catálogo activo?`, {
      title: 'Restaurar producto',
      confirmText: 'Restaurar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    try {
      const restored = await api.restoreProducto(producto.id);
      const mapped = fromApiProducto(restored);
      setProductos((prev) => [mapped, ...prev.filter((p) => Number(p.id) !== Number(producto.id))]);
      setProductosArchivados((prev) => prev.filter((p) => Number(p.id) !== Number(producto.id)));
    } catch (error) {
      await appAlert(`No se pudo restaurar: ${error.message}`);
    }
  };

  const crearEmpaque = async () => {
    const nombre = String(nuevoEmpaqueNombre || '').trim();
    if (!nombre) {
      await appAlert('Ingresa un nombre para el empaque.');
      return;
    }
    try {
      const created = await api.createEmpaque({ nombre });
      setEmpaques((prev) => [...prev, created].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))));
      setNuevoEmpaqueNombre('');
    } catch (error) {
      await appAlert(error.message || 'No se pudo crear el empaque.');
    }
  };

  const eliminarEmpaque = async (empaque) => {
    const ok = await appConfirm(`¿Eliminar empaque "${empaque.nombre}"?`, {
      title: 'Eliminar empaque',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    try {
      await api.deleteEmpaque(empaque.id);
      setEmpaques((prev) => prev.filter((e) => Number(e.id) !== Number(empaque.id)));
      setNuevo((prev) => (
        String(prev.empaqueId) === String(empaque.id)
          ? { ...prev, empaqueId: '', tipoEmpaque: '' }
          : prev
      ));
    } catch (error) {
      await appAlert(error.message || 'No se pudo eliminar el empaque.');
    }
  };

  const crearTipoIva = async () => {
    const nombre = String(nuevoIvaNombre || '').trim();
    const porcentaje = String(nuevoIvaPorcentaje || '').trim();
    if (!nombre) {
      await appAlert('Ingresa un nombre para el tipo de IVA.');
      return;
    }
    if (porcentaje === '' || isNaN(Number(porcentaje)) || Number(porcentaje) < 0) {
      await appAlert('Ingresa un porcentaje válido (mayor o igual a 0).');
      return;
    }
    try {
      const created = await api.createTipoIva({ codigo: 1, nombre, porcentaje: Number(porcentaje) });
      setTiposIva((prev) => [...prev, created].sort((a, b) => Number(a.porcentaje) - Number(b.porcentaje)));
      setNuevoIvaNombre('');
      setNuevoIvaPorcentaje('');
    } catch (error) {
      await appAlert(error.message || 'No se pudo crear el tipo de IVA.');
    }
  };

  const eliminarTipoIva = async (tipoIva) => {
    const ok = await appConfirm(`¿Eliminar tipo de IVA "${tipoIva.nombre}"?`, {
      title: 'Eliminar tipo de IVA',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    try {
      await api.deleteTipoIva(tipoIva.id);
      setTiposIva((prev) => prev.filter((t) => Number(t.id) !== Number(tipoIva.id)));
      setNuevo((prev) => (
        String(prev.ivaId) === String(tipoIva.id)
          ? { ...prev, ivaId: '' }
          : prev
      ));
    } catch (error) {
      await appAlert(error.message || 'No se pudo eliminar el tipo de IVA.');
    }
  };

  const exportarPDF = async () => {
    const doc = new jsPDF();
    const fecha = new Date().toLocaleDateString();
    const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
    if (logo) {
      doc.addImage(logo.dataUrl, 'JPEG', 10, 10, 40, 20);
    }
    doc.setFontSize(16);
    doc.text('Lista de Productos', 55, 22);
    doc.setFontSize(10);
    doc.text('Emitido: ' + fecha, 55, 28);
    autoTable(doc, {
      startY: 35,
      head: [[
        'Nombre',
        'Stock',
        ...(verCosto ? ['Costo'] : []),
        'Venta',
        'Empaque',
        ...(verGanancia ? ['Ganancia x U'] : []),
      ]],
      body: sortedProductos.map(p => [
        p.nombre,
        p.stock,
        ...(verCosto ? [formatMoney(p.costo)] : []),
        formatMoney(p.venta),
        `${p.tipoEmpaque} x ${p.cantidadEmpaque}`,
        ...(verGanancia ? [formatMoney(calcularGananciaUnidad(p.costo, p.venta))] : []),
      ]),
      didParseCell: function (data) {
        if (data.section !== 'body') return;
        const producto = sortedProductos[data.row.index];
        const state = stockState(producto?.stock);
        if (state === 'stock-zero') {
          data.cell.styles.fillColor = [246, 196, 196];
          data.cell.styles.textColor = [127, 29, 29];
        } else if (state === 'stock-low') {
          data.cell.styles.fillColor = [255, 236, 173];
          data.cell.styles.textColor = [120, 53, 15];
        }
      },
      styles: { fontSize: 10 },
      headStyles: { fillColor: getPrimaryRgb() },
    });
    doc.save('productos.pdf');
  };

  const exportarExcel = () => {
    const rowsHtml = sortedProductos.map((p, idx) => {
      const zebra = idx % 2 === 0 ? '#f7faff' : '#ffffff';
      const ganancia = verGanancia ? formatMoney(calcularGananciaUnidad(p.costo, p.venta)) : '';
      return `
        <tr style="background:${zebra}">
          <td>${p.nombre || ''}</td>
          <td>${p.ean || ''}</td>
          <td style="text-align:center">${p.stock || 0}</td>
          ${verCosto ? `<td style="text-align:right">${formatMoney(p.costo)}</td>` : ''}
          <td style="text-align:right">${formatMoney(p.venta)}</td>
          <td>${(p.tipoEmpaque || '')} x ${(p.cantidadEmpaque || 0)}</td>
          ${verGanancia ? `<td style="text-align:right">${ganancia}</td>` : ''}
        </tr>
      `;
    }).join('');

    const html = `
      <html>
        <head><meta charset="UTF-8" /></head>
        <body>
          <table border="1" style="border-collapse:collapse;width:100%">
            <thead>
              <tr style="background:#375f8c;color:#fff">
                <th>Nombre</th>
                <th>Código</th>
                <th>Stock</th>
                ${verCosto ? '<th>Costo</th>' : ''}
                <th>Venta</th>
                <th>Empaque</th>
                ${verGanancia ? '<th>Ganancia x U</th>' : ''}
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'productos.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const imprimirProductos = () => {
    const tableRows = sortedProductos.map((p) => `
      <tr>
        <td>${p.nombre || ''}</td>
        <td>${p.ean || '-'}</td>
        <td>${p.stock || 0}</td>
        ${verCosto ? `<td>${formatMoney(p.costo)}</td>` : ''}
        <td>${formatMoney(p.venta)}</td>
        <td>${(p.tipoEmpaque || '')} x ${(p.cantidadEmpaque || 0)}</td>
        ${verGanancia ? `<td>${formatMoney(calcularGananciaUnidad(p.costo, p.venta))}</td>` : ''}
      </tr>
    `).join('');
    const w = window.open('', '_blank', 'noopener,noreferrer,width=980,height=700');
    if (!w) return;
    w.document.write(`
      <html><head><title>Productos</title>
      <style>
        body{font-family:${PRINT_FONT_FAMILY_CSS};padding:16px}
        h2{color:#375f8c}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #c8d3e5;padding:6px 8px;font-size:12px}
        th{background:#375f8c;color:#fff}
      </style></head>
      <body>
        <h2>Lista de productos</h2>
        <table>
          <thead><tr>
            <th>Nombre</th><th>Código</th><th>Stock</th>${verCosto ? '<th>Costo</th>' : ''}<th>Venta</th><th>Empaque</th>${verGanancia ? '<th>Ganancia x U</th>' : ''}
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  const getCatalogItems = () =>
    sortedProductos.map((p) => ({
      nombre: p.nombre || '-',
      codigo: p.ean || '-',
      unidadPrecio: formatMoney(p.venta),
      empaqueLabel: `${p.tipoEmpaque || '-'} x ${p.cantidadEmpaque || 0}`,
      empaquePrecio: formatMoney(p.precioEmpaque || 0),
      imagen: isHttpUrl(p.imagenPreview) ? p.imagenPreview : '',
    }));

  const buildCatalogHtml = (items, updatedAt) => `
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Catálogo de Productos</title>
        <style>
          body { font-family: ${PRINT_FONT_FAMILY_CSS}; padding: 18px; color: #1f2933; }
          .header { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
          .logo { width: 88px; height: auto; object-fit: contain; }
          h1 { margin: 0; font-size: 24px; color: #375f8c; }
          .meta { margin: 3px 0 14px; font-size: 13px; color: #5f7085; }
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
          .card { border: 1px solid #d7e1ef; border-radius: 10px; padding: 10px; break-inside: avoid; }
          .thumb-wrap { display: flex; justify-content: center; margin-bottom: 8px; }
          .thumb { width: 100%; height: 96px; object-fit: contain; border: none; border-radius: 0; background: transparent; }
          .title { font-size: 13px; font-weight: 700; margin-bottom: 4px; min-height: 30px; text-align: center; }
          .code { font-size: 11px; color: #708094; margin-bottom: 8px; font-weight: 700; text-align: center; }
          .line { font-size: 12px; margin: 2px 0; text-align: center; }
          .price { color: #c1121f; font-weight: 800; }
        </style>
      </head>
      <body>
        <div class="header">
          <img class="logo" src="/mercatus-logo.png" alt="Mercatus" />
          <div>
            <h1>Catálogo de Productos</h1>
            <div class="meta">Actualizado: ${updatedAt}</div>
          </div>
        </div>
        <div class="grid">
          ${items.map((item) => `
            <article class="card">
              <div class="thumb-wrap">
                ${item.imagen
                  ? `<img class="thumb" src="${escapeHtml(item.imagen)}" alt="${escapeHtml(item.nombre)}" />`
                  : `<div class="thumb"></div>`}
              </div>
              <div class="title">${escapeHtml(item.nombre)}</div>
              <div class="code">Código: ${escapeHtml(item.codigo)}</div>
              <div class="line">Unidad: <span class="price">${escapeHtml(item.unidadPrecio)}</span></div>
              <div class="line">${escapeHtml(item.empaqueLabel)}: <span class="price">${escapeHtml(item.empaquePrecio)}</span></div>
            </article>
          `).join('')}
        </div>
      </body>
    </html>
  `;

  const imprimirCatalogo = () => {
    const items = getCatalogItems();
    const updatedAt = formatCatalogUpdatedAt();
    const w = window.open('', '_blank', 'noopener,noreferrer,width=1080,height=780');
    if (!w) return;
    w.document.write(buildCatalogHtml(items, updatedAt));
    w.document.close();
    w.focus();
    w.print();
  };

  const exportarCatalogoPDF = async () => {
    const items = getCatalogItems();
    const updatedAt = formatCatalogUpdatedAt();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const gap = 3;
    const cols = 4;
    const cardW = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
    const cardH = 56;
    let y = 28;
    let col = 0;

    const headerLogo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
    if (headerLogo) {
      doc.addImage(headerLogo.dataUrl, 'JPEG', margin, 8, 24, 12);
    }

    doc.setFontSize(16);
    doc.setTextColor(55, 95, 140);
    doc.text('Catálogo de Productos', 38, 14);
    doc.setFontSize(10);
    doc.setTextColor(95, 112, 133);
    doc.text(`Actualizado: ${updatedAt}`, 38, 20);

    for (const item of items) {
      const x = margin + col * (cardW + gap);
      doc.setDrawColor(215, 225, 239);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');

      const imgX = x + 2;
      const imgY = y + 2;
      const imgW = cardW - 4;
      const imgH = 20;

      if (item.imagen) {
        try {
          const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = 'anonymous';
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = item.imagen;
          });
          doc.addImage(img, detectImageFormat(item.imagen), imgX + 0.5, imgY + 0.5, imgW - 1, imgH - 1);
        } catch {
          // noop
        }
      }

      doc.setTextColor(31, 41, 51);
      doc.setFontSize(9);
      doc.text(item.nombre, x + cardW / 2, y + 27, { align: 'center', maxWidth: cardW - 4 });
      doc.setFontSize(8);
      doc.setTextColor(112, 128, 148);
      doc.text(`Código: ${item.codigo}`, x + cardW / 2, y + 32, { align: 'center' });
      doc.setTextColor(31, 41, 51);
      doc.text('Unidad:', x + cardW / 2 - 12, y + 39, { align: 'right' });
      doc.setTextColor(193, 18, 31);
      doc.text(item.unidadPrecio, x + cardW / 2 - 10, y + 39, { align: 'left' });
      doc.setTextColor(31, 41, 51);
      doc.text(`${item.empaqueLabel}:`, x + cardW / 2 - 12, y + 45, { align: 'right', maxWidth: 22 });
      doc.setTextColor(193, 18, 31);
      doc.text(item.empaquePrecio, x + cardW / 2 - 10, y + 45, { align: 'left' });

      col += 1;
      if (col >= cols) {
        col = 0;
        y += cardH + gap;
      }
      if (y + cardH > pageHeight - margin && col === 0) {
        doc.addPage();
        y = margin;
      }
    }

    doc.save('catalogo-productos.pdf');
  };

  const buildCatalogPdfBlob = async () => {
    const items = getCatalogItems();
    const updatedAt = formatCatalogUpdatedAt();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const gap = 3;
    const cols = 4;
    const cardW = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
    const cardH = 56;
    let y = 28;
    let col = 0;

    const headerLogo2 = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
    if (headerLogo2) {
      doc.addImage(headerLogo2.dataUrl, 'JPEG', margin, 8, 24, 12);
    }

    doc.setFontSize(16);
    doc.setTextColor(55, 95, 140);
    doc.text('Catálogo de Productos', 38, 14);
    doc.setFontSize(10);
    doc.setTextColor(95, 112, 133);
    doc.text(`Actualizado: ${updatedAt}`, 38, 20);

    for (const item of items) {
      const x = margin + col * (cardW + gap);
      doc.setDrawColor(215, 225, 239);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');

      const imgX = x + 2;
      const imgY = y + 2;
      const imgW = cardW - 4;
      const imgH = 20;

      if (item.imagen) {
        try {
          const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = 'anonymous';
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = item.imagen;
          });
          doc.addImage(img, detectImageFormat(item.imagen), imgX + 0.5, imgY + 0.5, imgW - 1, imgH - 1);
        } catch {
          // noop
        }
      }

      doc.setTextColor(31, 41, 51);
      doc.setFontSize(9);
      doc.text(item.nombre, x + cardW / 2, y + 27, { align: 'center', maxWidth: cardW - 4 });
      doc.setFontSize(8);
      doc.setTextColor(112, 128, 148);
      doc.text(`Código: ${item.codigo}`, x + cardW / 2, y + 32, { align: 'center' });
      doc.setTextColor(31, 41, 51);
      doc.text('Unidad:', x + cardW / 2 - 12, y + 39, { align: 'right' });
      doc.setTextColor(193, 18, 31);
      doc.text(item.unidadPrecio, x + cardW / 2 - 10, y + 39, { align: 'left' });
      doc.setTextColor(31, 41, 51);
      doc.text(`${item.empaqueLabel}:`, x + cardW / 2 - 12, y + 45, { align: 'right', maxWidth: 22 });
      doc.setTextColor(193, 18, 31);
      doc.text(item.empaquePrecio, x + cardW / 2 - 10, y + 45, { align: 'left' });

      col += 1;
      if (col >= cols) {
        col = 0;
        y += cardH + gap;
      }
      if (y + cardH > pageHeight - margin && col === 0) {
        doc.addPage();
        y = margin;
      }
    }

    return doc.output('blob');
  };

  const compartirCatalogoWhatsApp = async () => {
    const blob = await buildCatalogPdfBlob();
    const file = new File([blob], 'catalogo-productos.pdf', { type: 'application/pdf' });
    const shareData = {
      files: [file],
      title: 'Catálogo de Productos',
    };

    const canShareFile = typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare(shareData);

    if (canShareFile) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // noop
      }
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'catalogo-productos.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    window.open('https://web.whatsapp.com/', '_blank', 'noopener,noreferrer');
    await appAlert('Tu navegador no permite adjuntar el PDF automáticamente. Se descargó el archivo y se abrió WhatsApp Web para adjuntarlo manualmente.');
  };

  const productosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return productos;
    return productos.filter((p) =>
      [p.nombre, p.categoria, p.ean, p.tipoEmpaque, p.stock, p.costo, p.venta]
        .join(' ')
        .toLowerCase()
        .includes(texto)
    );
  }, [productos, busqueda]);

  const sortedProductos = useMemo(() => {
    const list = [...productosFiltrados];
    const dir = sortDir === 'asc' ? 1 : -1;
    const asNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const asText = (v) => String(v ?? '').toLowerCase();

    list.sort((a, b) => {
      switch (sortBy) {
        case 'stock':
          return (asNumber(a.stock) - asNumber(b.stock)) * dir;
        case 'costo':
          return (asNumber(a.costo) - asNumber(b.costo)) * dir;
        case 'venta':
          return (asNumber(a.venta) - asNumber(b.venta)) * dir;
        case 'empaque':
          return asText(a.tipoEmpaque).localeCompare(asText(b.tipoEmpaque)) * dir;
        case 'ganancia': {
          if (!verGanancia) return 0;
          const ag = calcularGananciaUnidad(a.costo, a.venta);
          const bg = calcularGananciaUnidad(b.costo, b.venta);
          return (ag - bg) * dir;
        }
        case 'totalCosto':
          return ((asNumber(a.stock) * asNumber(a.costo)) - (asNumber(b.stock) * asNumber(b.costo))) * dir;
        case 'totalVenta':
          return ((asNumber(a.stock) * asNumber(a.venta)) - (asNumber(b.stock) * asNumber(b.venta))) * dir;
        case 'totalGanancia': {
          const aGanancia = asNumber(a.stock) * calcularGananciaUnidad(a.costo, a.venta);
          const bGanancia = asNumber(b.stock) * calcularGananciaUnidad(b.costo, b.venta);
          return (aGanancia - bGanancia) * dir;
        }
        case 'nombre':
        default:
          return asText(a.nombre).localeCompare(asText(b.nombre)) * dir;
      }
    });

    return list;
  }, [productosFiltrados, sortBy, sortDir, verGanancia]);

  const totalesInventario = useMemo(() => {
    return productos.reduce((acc, p) => {
      const stock = Number(p.stock || 0);
      const costo = Number(p.costo || 0);
      const venta = Number(p.venta || 0);
      const gananciaUnidad = calcularGananciaUnidad(costo, venta);
      acc.totalCosto += stock * costo;
      acc.totalVenta += stock * venta;
      acc.totalGanancia += stock * gananciaUnidad;
      return acc;
    }, { totalCosto: 0, totalVenta: 0, totalGanancia: 0 });
  }, [productos]);

  const toggleSort = useCallback((column) => {
    if (sortBy === column) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(column);
    setSortDir('asc');
  }, [sortBy]);

  const abrirAlta = () => {
    setMostrarForm(true);
    setEditando(null);
    setNuevo({ nombre: '', stock: '', categoria: '', imagen: null, imagenPreview: '', ean: '', tipoEmpaque: '', empaqueId: '', cantidadEmpaque: '', costo: '', venta: '', precioEmpaque: '', ivaId: '' });
    setImagenUrlError('');
  };

  const cerrarPanel = () => {
    setMostrarForm(false);
    setEditando(null);
    setNuevo({ nombre: '', stock: '', categoria: '', imagen: null, imagenPreview: '', ean: '', tipoEmpaque: '', empaqueId: '', cantidadEmpaque: '', costo: '', venta: '', precioEmpaque: '', ivaId: '' });
    setImagenUrlError('');
  };

  const imagenPreviewValida = useMemo(
    () => typeof nuevo.imagenPreview === 'string' && !!nuevo.imagenPreview.trim() &&
      (isHttpUrl(nuevo.imagenPreview) || nuevo.imagenPreview.startsWith('blob:')),
    [nuevo.imagenPreview]
  );

  const sortMark = useCallback((column) => (sortBy === column ? (sortDir === 'asc' ? '▲' : '▼') : ''), [sortBy, sortDir]);

  const productosColumns = useMemo(() => [
    {
      key: 'imagen',
      header: 'Imagen',
      mobileLabel: 'Imagen',
      cellClassName: 'producto-image-cell',
      render: (p) => (
        p.imagenPreview ? (
          <img src={p.imagenPreview} alt={p.nombre} className="producto-thumb" />
        ) : (
          <span className="sin-imagen">Sin imagen</span>
        )
      ),
    },
    {
      key: 'nombre',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('nombre')}>
          Nombre {sortMark('nombre')}
        </button>
      ),
      mobileLabel: 'Nombre',
      render: (p) => (
        <span className="nombre-cell">
          <strong>{p.nombre}</strong>
          <small className="producto-codigo">Código: {p.ean || '-'}</small>
        </span>
      ),
    },
    {
      key: 'stock',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('stock')}>
          Stock {sortMark('stock')}
        </button>
      ),
      mobileLabel: 'Stock',
      align: 'right',
      cellClassName: (p) => `stock-value ${stockState(p.stock)}`,
      render: (p) => p.stock,
    },
    ...(verCosto
      ? [{
          key: 'costo',
          header: (
            <button type="button" className="sort-header-btn" onClick={() => toggleSort('costo')}>
              Costo {sortMark('costo')}
            </button>
          ),
          mobileLabel: 'Costo',
          align: 'right',
          render: (p) => formatMoney(p.costo),
        }]
      : []),
    {
      key: 'venta',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('venta')}>
          Venta {sortMark('venta')}
        </button>
      ),
      mobileLabel: 'Venta',
      align: 'right',
      render: (p) => formatMoney(p.venta),
    },
    {
      key: 'empaque',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('empaque')}>
          Empaque {sortMark('empaque')}
        </button>
      ),
      mobileLabel: 'Empaque',
      mobileHide: true,
      render: (p) => `${p.tipoEmpaque} x ${p.cantidadEmpaque}`,
    },
    {
      key: 'iva',
      header: 'IVA',
      mobileLabel: 'IVA',
      render: (p) => p.ivaNombre
        ? `${p.ivaNombre}${p.ivaPorcentaje ? ` ${p.ivaPorcentaje}%` : ''}`
        : '-',
    },
    ...(verGanancia
      ? [{
          key: 'ganancia',
          header: (
            <button type="button" className="sort-header-btn" onClick={() => toggleSort('ganancia')}>
              Ganancia x U {sortMark('ganancia')}
            </button>
          ),
          mobileLabel: 'Ganancia x U',
          align: 'right',
          render: (p) => formatMoney(calcularGananciaUnidad(p.costo, p.venta)),
        }]
      : []),
    {
      key: 'totalCosto',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('totalCosto')}>
          Total Costo {sortMark('totalCosto')}
        </button>
      ),
      mobileLabel: 'Total Costo',
      mobileHide: true,
      align: 'right',
      render: (p) => formatMoney((Number(p.stock || 0) * Number(p.costo || 0))),
    },
    {
      key: 'totalVenta',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('totalVenta')}>
          Total Venta {sortMark('totalVenta')}
        </button>
      ),
      mobileLabel: 'Total Venta',
      mobileHide: true,
      align: 'right',
      render: (p) => formatMoney((Number(p.stock || 0) * Number(p.venta || 0))),
    },
    {
      key: 'totalGanancia',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('totalGanancia')}>
          Total Ganancia {sortMark('totalGanancia')}
        </button>
      ),
      mobileLabel: 'Total Ganancia',
      mobileHide: true,
      align: 'right',
      render: (p) => formatMoney(Number(p.stock || 0) * calcularGananciaUnidad(p.costo, p.venta)),
    },
  ], [toggleSort, sortMark, verCosto, verGanancia]);

  return (
    <div className="productos-main">
      <div className="productos-right full-width">
        <div className="productos-toolbar">
          <AppInput
            type="text"
            className="buscar-producto table-search-field"
            placeholder="Buscar por nombre, codigo, categoria..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <FilterSlot>
          <div className="productos-toolbar-actions">
            {puedeAgregar && (
            <AppButton className="agregar-btn toolbar-add" title="Agregar producto" onClick={abrirAlta}>
              <span>Añadir Productos</span>
            </AppButton>
            )}
            {verArchivados && (
            <AppButton
              className="agregar-btn toolbar-add"
              title="Ver archivados"
              onClick={async () => {
                await loadProductosArchivados();
                setArchivadosModalOpen(true);
              }}
            >
              <span>Productos Archivados</span>
            </AppButton>
            )}
            {gestionarEmpaques && (
            <AppButton className="agregar-btn toolbar-add" title="Gestionar empaques" onClick={() => setEmpaquesModalOpen(true)}>
              <span>Gestión Empaques</span>
            </AppButton>
            )}
            {gestionarEmpaques && (
            <AppButton className="agregar-btn toolbar-add" title="Gestionar tipos de IVA" onClick={() => setTiposIvaModalOpen(true)}>
              <span>Gestión IVA</span>
            </AppButton>
            )}
            {puedeExportar && (
            <AppButton className="exportar-pdf" title="Exportar" onClick={() => setExportModalOpen(true)}>
              <TbPrinter aria-hidden="true" />
            </AppButton>
            )}
          </div>
          </FilterSlot>
        </div>

        <div className="productos-totales">
          {verCosto && (
            <div className="productos-total-card">
              <span>Total Costo</span>
              <strong>{formatMoney(totalesInventario.totalCosto)}</strong>
            </div>
          )}
          <div className="productos-total-card">
            <span>Total Venta</span>
            <strong>{formatMoney(totalesInventario.totalVenta)}</strong>
          </div>
          {verGanancia && (
            <div className="productos-total-card">
              <span>Total Ganancia</span>
              <strong>{formatMoney(totalesInventario.totalGanancia)}</strong>
            </div>
          )}
        </div>

        {exportModalOpen && (
          <div className="export-modal-overlay" role="dialog" aria-modal="true">
            <div className="export-modal-backdrop" onClick={() => setExportModalOpen(false)} />
            <div className="export-modal">
              <h4>Exportar productos</h4>
              <p>Elige un formato:</p>
              <div className="export-modal-actions">
                <AppButton type="button" onClick={() => { exportarPDF(); setExportModalOpen(false); }}>
                  <TbFileTypePdf />
                  <span>PDF</span>
                </AppButton>
                <AppButton type="button" onClick={() => { exportarExcel(); setExportModalOpen(false); }}>
                  <TbFileSpreadsheet />
                  <span>EXCEL</span>
                </AppButton>
                <AppButton type="button" onClick={() => { imprimirProductos(); setExportModalOpen(false); }}>
                  <TbPrinter />
                  <span>Impresora</span>
                </AppButton>
              </div>
              {mostrarOpcionesCatalogo && (
                <>
                  <p className="export-modal-section-title">Imprimir como catálogo</p>
                  <div className="export-modal-actions">
                    <AppButton type="button" onClick={async () => { await exportarCatalogoPDF(); setExportModalOpen(false); }}>
                      <TbFileTypePdf />
                      <span>Catálogo PDF</span>
                    </AppButton>
                    <AppButton type="button" onClick={() => { imprimirCatalogo(); setExportModalOpen(false); }}>
                      <TbPrinter />
                      <span>Catálogo Impresora</span>
                    </AppButton>
                    <AppButton type="button" onClick={async () => { await compartirCatalogoWhatsApp(); setExportModalOpen(false); }}>
                      <TbBrandWhatsapp aria-hidden="true" />
                      <span>Compartir por WhatsApp</span>
                    </AppButton>
                  </div>
                </>
              )}
              <AppButton type="button" className="export-modal-close" onClick={() => setExportModalOpen(false)}>
                Cerrar
              </AppButton>
            </div>
          </div>
        )}

        {archivadosModalOpen && (
          <div className="export-modal-overlay" role="dialog" aria-modal="true">
            <div className="export-modal-backdrop" onClick={() => setArchivadosModalOpen(false)} />
            <div className="export-modal">
              <h4>Productos archivados</h4>
              <p>Estos productos no aparecen en el catálogo activo ni en ventas nuevas.</p>
              <div className="empaques-list">
                {productosArchivados.map((producto) => (
                  <div key={producto.id} className="empaque-item">
                    <span>{producto.nombre}</span>
                    <AppButton type="button" onClick={() => handleRestaurar(producto)}>Restaurar</AppButton>
                  </div>
                ))}
                {!productosArchivados.length && <p className="empaque-empty">No hay productos archivados.</p>}
              </div>
              <AppButton type="button" className="export-modal-close" onClick={() => setArchivadosModalOpen(false)}>
                Cerrar
              </AppButton>
            </div>
          </div>
        )}

        {empaquesModalOpen && (
          <div className="export-modal-overlay" role="dialog" aria-modal="true">
            <div className="export-modal-backdrop" onClick={() => setEmpaquesModalOpen(false)} />
            <div className="export-modal">
              <h4>Gestionar empaques</h4>
              <p>Agrega y administra los tipos de empaque.</p>
              <div className="empaques-create-row">
                <AppInput
                  type="text"
                  value={nuevoEmpaqueNombre}
                  onChange={(e) => setNuevoEmpaqueNombre(e.target.value)}
                  placeholder="Nuevo empaque"
                />
                <AppButton type="button" onClick={crearEmpaque}>Agregar</AppButton>
              </div>
              <div className="empaques-list">
                {empaques.map((e) => (
                  <div key={e.id} className="empaque-item">
                    <span>{e.nombre}</span>
                    <AppButton type="button" onClick={() => eliminarEmpaque(e)}>Eliminar</AppButton>
                  </div>
                ))}
                {!empaques.length && <p className="empaque-empty">No hay empaques cargados.</p>}
              </div>
              <AppButton type="button" className="export-modal-close" onClick={() => setEmpaquesModalOpen(false)}>
                Cerrar
              </AppButton>
            </div>
          </div>
        )}

        {tiposIvaModalOpen && (
          <div className="export-modal-overlay" role="dialog" aria-modal="true">
            <div className="export-modal-backdrop" onClick={() => setTiposIvaModalOpen(false)} />
            <div className="export-modal">
              <h4>Gestionar tipos de IVA</h4>
              <p>Agrega y administra los tipos de IVA.</p>
              <div className="empaques-create-row">
                <AppInput
                  type="text"
                  value={nuevoIvaNombre}
                  onChange={(e) => setNuevoIvaNombre(e.target.value)}
                  placeholder="Nombre (ej: Tasa Básica)"
                />
                <AppInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={nuevoIvaPorcentaje}
                  onChange={(e) => setNuevoIvaPorcentaje(e.target.value)}
                  placeholder="%"
                  style={{ width: '80px' }}
                />
                <AppButton type="button" onClick={crearTipoIva}>Agregar</AppButton>
              </div>
              <div className="empaques-list">
                {tiposIva.map((t) => (
                  <div key={t.id} className="empaque-item">
                    <span>{t.nombre} ({t.porcentaje}%)</span>
                    <AppButton type="button" onClick={() => eliminarTipoIva(t)}>Eliminar</AppButton>
                  </div>
                ))}
                {!tiposIva.length && <p className="empaque-empty">No hay tipos de IVA cargados.</p>}
              </div>
              <AppButton type="button" className="export-modal-close" onClick={() => setTiposIvaModalOpen(false)}>
                Cerrar
              </AppButton>
            </div>
          </div>
        )}

        <AppTable
          columns={productosColumns}
          rows={sortedProductos}
          rowKey="id"
          emptyMessage="No hay productos"
          stickyHeader
          onRowClick={(p) => setProductoExpandidoId((prev) => (prev === p.id ? null : p.id))}
          rowClassName={(p) => `producto-row ${stockState(p.stock)}`}
          expandedRowId={productoExpandidoId}
          renderExpandedRow={(p) => (
            <div className="acciones-producto-panel">
              {puedeEditar && (
              <AppButton
                className="edit-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditar(p);
                }}
                title="Editar"
              >
                Editar
              </AppButton>
              )}
              {puedeEliminar && (
              <AppButton
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEliminar(p.id);
                }}
                title="Archivar"
              >
                Archivar
              </AppButton>
              )}
            </div>
          )}
        />
      </div>

      <div className={`side-panel-overlay ${mostrarForm ? 'open' : ''}`} aria-hidden={!mostrarForm}>
        <div className="side-panel-backdrop" onClick={cerrarPanel} />
        <aside className="side-panel">
          <div className="side-panel-header">
            <h3>{editando !== null ? 'Editar producto' : 'Nuevo producto'}</h3>
            <button type="button" className="side-panel-close" onClick={cerrarPanel}>✕</button>
          </div>
          <form className="form-producto" onSubmit={handleSubmit}>
            <label className="field-label">Nombre del producto
              <AppInput name="nombre" value={nuevo.nombre} onChange={handleChange} placeholder="Nombre" required />
            </label>
            <label className="field-label">Stock
              <AppInput name="stock" value={nuevo.stock} onChange={handleChange} placeholder="Stock" type="number" step="1" required />
            </label>
            <label className="field-label">EAN / Código
              <AppInput name="ean" value={nuevo.ean} onChange={handleChange} placeholder="EAN/Código" />
            </label>
            <label className="field-label">Tipo de empaque
              <AppSelect name="empaqueId" value={nuevo.empaqueId || ''} onChange={handleChange} required>
                <option value="">Seleccionar empaque</option>
                {empaques.map((e) => <option key={e.id} value={String(e.id)}>{e.nombre}</option>)}
              </AppSelect>
            </label>
            <label className="field-label">IVA
              <AppSelect name="ivaId" value={nuevo.ivaId || ''} onChange={handleChange} required>
                <option value="">Seleccionar IVA</option>
                {tiposIva.map((t) => <option key={t.id} value={String(t.id)}>{t.nombre} ({t.porcentaje}%)</option>)}
              </AppSelect>
            </label>
            <label className="field-label">Cantidad por empaque
              <AppInput name="cantidadEmpaque" value={nuevo.cantidadEmpaque} onChange={handleChange} placeholder="Cantidad por empaque" type="number" min="0" step="1" />
            </label>
            <label className="field-label">Precio de costo
              <AppInput name="costo" value={nuevo.costo} onChange={handleChange} placeholder="Precio de Costo" type="number" min="0" step="0.01" />
            </label>
            <label className="field-label">Precio de venta
              <AppInput name="venta" value={nuevo.venta} onChange={handleChange} placeholder="Precio de Venta" type="number" min="0" step="0.01" />
            </label>
            <label className="field-label">Precio por empaque
              <AppInput name="precioEmpaque" value={nuevo.precioEmpaque} onChange={handleChange} placeholder="Precio por empaque" type="number" min="0" step="0.01" />
            </label>
            <label className="field-label">URL de imagen
              <AppInput
                name="imagenUrl"
                value={nuevo.imagenPreview || ''}
                onChange={handleChange}
                placeholder="URL de imagen (https://...)"
                type="text"
                disabled={imagenUploading}
              />
            </label>
            <label className="field-label">O subir archivo
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleImagenFileChange}
                disabled={imagenUploading}
                className="imagen-file-input"
              />
            </label>
            {imagenUploading && <p className="imagen-uploading-msg">Subiendo imagen...</p>}
            {imagenUrlError && <p className="input-error">{imagenUrlError}</p>}
            {imagenPreviewValida && (
              <div className="panel-image-preview">
                <img src={nuevo.imagenPreview} alt="Vista previa" />
              </div>
            )}
            <div className="form-actions">
              <AppButton type="submit" disabled={imagenUploading || saving}>{saving ? 'Guardando...' : (editando !== null ? 'Guardar cambios' : 'Guardar')}</AppButton>
              <AppButton type="button" onClick={cerrarPanel}>Cancelar</AppButton>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}


