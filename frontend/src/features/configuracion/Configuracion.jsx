import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../core/api';
import { useConfig } from '../../core/ConfigContext';
import { getPdfConfig } from '../../shared/lib/pdfConfigDefaults';
import { extractPaletteFromDataUrl } from '../../shared/lib/brandingPalette';
import AppButton from '../../shared/components/button/AppButton';
import AppInput from '../../shared/components/fields/AppInput';
import AppTextarea from '../../shared/components/fields/AppTextarea';
import AppSelect from '../../shared/components/fields/AppSelect';
import { appConfirm } from '../../shared/lib/appDialog';
import './Configuracion.css';

const TABS = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'modulos', label: 'Módulos' },
  { key: 'ganancias', label: 'Ganancias' },
  { key: 'permisos', label: 'Permisos' },
];

function compressImage(dataUrl, maxW, maxH, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h); // ensure transparent background before drawing
      ctx.drawImage(img, 0, 0, w, h);
      // Detect transparency: if any pixel has alpha < 255, preserve as PNG
      // so transparent logos are never flattened to white on conversion
      const pixels = ctx.getImageData(0, 0, w, h).data;
      let hasAlpha = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 255) { hasAlpha = true; break; }
      }
      const format = hasAlpha ? 'image/png' : 'image/webp';
      resolve(canvas.toDataURL(format, hasAlpha ? undefined : quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── TAB EMPRESA ───────────────────────────────────────────────────────────────

const DATOS_FIELDS  = ['nombre', 'razon_social', 'rut', 'direccion', 'telefono', 'correo', 'website', 'giro', 'ciudad', 'departamento', 'cfe_ambiente', 'cfe_auto_envio', 'descarga_automatica_pdf'];
const LOGO_FIELDS   = ['logo_base64', 'logo_tamano', 'logo_bg_color'];
const FONDO_FIELDS  = ['fondo_base64', 'fondo_opacidad'];
const COLORES_FIELDS = [
  'color_primary', 'color_primary_strong', 'color_primary_soft',
  'color_menu_bg', 'color_menu_active', 'color_text', 'color_text_muted',
  'color_menu_text', 'color_logout_bg',
];
const VISUAL_FIELDS = [...LOGO_FIELDS, ...FONDO_FIELDS, ...COLORES_FIELDS];

function buildForm(emp) {
  emp = emp || {};
  return {
    nombre:               emp.nombre || '',
    razon_social:         emp.razon_social || '',
    rut:                  emp.rut || '',
    direccion:            emp.direccion || '',
    telefono:             emp.telefono || '',
    correo:               emp.correo || '',
    website:              emp.website || '',
    giro:                 emp.giro || '',
    ciudad:               emp.ciudad || '',
    departamento:         emp.departamento || '',
    cfe_ambiente:         emp.cfe_ambiente || 'LOCAL',
    cfe_auto_envio:       emp.cfe_auto_envio !== false,
    descarga_automatica_pdf: emp.descarga_automatica_pdf === true,
    logo_base64:          emp.logo_base64 || null,
    color_primary:        emp.color_primary || '#375f8c',
    color_primary_strong: emp.color_primary_strong || '#294c74',
    color_primary_soft:   emp.color_primary_soft || '#e7effa',
    color_menu_bg:        emp.color_menu_bg || '#1f2933',
    color_menu_active:    emp.color_menu_active || '#375f8c',
    color_text:           emp.color_text || '#1d2b3e',
    color_text_muted:     emp.color_text_muted || '#526278',
    color_menu_text:      emp.color_menu_text || '#e6ecf4',
    color_logout_bg:      emp.color_logout_bg || '#d32f2f',
    fondo_opacidad:       emp.fondo_opacidad ?? 0.06,
    logo_tamano:          emp.logo_tamano ?? 200,
    logo_bg_color:        emp.logo_bg_color || '#ffffff',
    fondo_base64:         emp.fondo_base64 === '__none__' ? '' : (emp.fondo_base64 || null),
    pdf_factura:          emp.pdf_factura  || {},
    pdf_remito:           emp.pdf_remito   || {},
  };
}

function pickFields(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

// ── Vista previa de PDFs ───────────────────────────────────────────────────────

const PDF_PLACEHOLDER_ROWS = [
  ['Producto A', '2', '1 caja', '$120,00', '$0,00', '$240,00'],
  ['Producto B', '1', '500g',   '$85,00',  '$5,00', '$80,00'],
  ['Producto C', '3', '1 unit', '$60,00',  '$0,00', '$180,00'],
];

const PDF_PRODUCTOS_ROWS = [
  ['Aceite Del Sur 1L',    '48',  '$340,00', '$422,00', 'Caja x 12', '$82,00'],
  ['Fideos Matarazzo 500g','120', '$90,00',  '$138,00', 'Caja x 24', '$48,00'],
  ['Arroz Gallo 1kg',      '75',  '$130,00', '$185,00', 'Caja x 10', '$55,00'],
];

function PdfPreviewMock({ tipo, logoSrc, logoBgColor, logoTamano, primaryColor, pdfConfig }) {
  const primary = primaryColor || '#375f8c';
  const bgLogo  = logoBgColor  || '#ffffff';

  // Map jsPDF font names to CSS font families
  const fontMap = {
    helvetica: "Inter, 'Segoe UI', Tahoma, sans-serif",
    times:     'Times New Roman, serif',
    courier:   'Courier New, monospace',
  };
  const cssFont    = fontMap[pdfConfig?.fontFamily] || "Inter, 'Segoe UI', Tahoma, sans-serif";
  const baseFontSz = pdfConfig?.fontSizeBase || 10;
  const notas      = pdfConfig?.notas    || '';
  const piePagina  = pdfConfig?.piePagina || '';

  // El mock interno mide 680px de ancho (simula hoja A4), se escala al 38%
  const SCALE    = 0.38;
  const MOCK_W   = 680;
  const MOCK_H   = tipo === 'ticket' ? 560 : tipo === 'remito' ? 520 : 320;
  const boxW     = Math.round(MOCK_W * SCALE);
  const boxH     = Math.round(MOCK_H * SCALE);

  // Tamaño del logo dentro del mock: proporcional a logo_tamano (max 200 → ~100px en mock)
  const logoMaxPx = Math.round(Math.min((logoTamano || 200) * 0.5, 110));

  const inner = {
    width:           MOCK_W,
    minHeight:       MOCK_H,
    transform:       `scale(${SCALE})`,
    transformOrigin: 'top left',
    // transform: scale no expande el layout — reservar espacio con height explícito
    height:          MOCK_H,
    background:      '#fff',
    fontFamily:      cssFont,
    fontSize:        baseFontSz,
    color:           '#222',
    padding:         24,
    boxSizing:       'border-box',
    lineHeight:      1.4,
  };

  const thStyle = {
    background: primary,
    color: '#fff',
    padding: '4px 6px',
    fontSize: baseFontSz - 1,
    fontWeight: 600,
    textAlign: 'left',
  };

  const tdStyle    = { padding: '3px 6px', fontSize: baseFontSz - 1.5, borderBottom: '1px solid #eee' };
  const tdAltStyle = { ...tdStyle, background: '#f7f9fc' };

  const logoBox = (height = 80) => (
    <div style={{ width: height, height, background: bgLogo, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid #ddd' }}>
      {logoSrc ? (
        <img src={logoSrc} alt="logo" style={{ maxWidth: logoMaxPx, maxHeight: height - 8, objectFit: 'contain', display: 'block' }} />
      ) : (
        <div style={{ width: 40, height: 20, background: '#ddd', borderRadius: 3 }} />
      )}
    </div>
  );

  const empresaInfoBlock = (
    <div style={{ fontSize: baseFontSz - 2, color: '#666', lineHeight: 1.5, marginBottom: 4 }}>
      {pdfConfig?.mostrarRazonSocial !== false && <div>Mercatus S.A.</div>}
      {pdfConfig?.mostrarRut         !== false && <div>RUT: 21-123456-7</div>}
      {pdfConfig?.mostrarDireccion   !== false && <div>Av. Rivera 2400, Montevideo</div>}
      {pdfConfig?.mostrarTelefono    !== false && <div>Tel: 099 000 111</div>}
      {pdfConfig?.mostrarEmail       !== false && <div>ventas@mercatus.com</div>}
    </div>
  );

  const posicion = pdfConfig?.logoPosicion || 'izquierda';

  const notasBlock = notas ? (
    <div style={{ marginTop: 8, fontSize: baseFontSz - 1, color: '#555', fontStyle: 'italic' }}>{notas}</div>
  ) : null;

  const pieBlock = piePagina ? (
    <div style={{ position: 'absolute', bottom: 16, left: 24, right: 24, textAlign: 'center', fontSize: baseFontSz - 2, color: '#888', borderTop: '1px solid #eee', paddingTop: 4 }}>{piePagina}</div>
  ) : null;

  // Helper: tamaño del logo box en mock (proporcional a logoTamano mm, escala 2px/mm)
  const logoBoxH = Math.max(30, Math.min((pdfConfig?.logoTamano || 40) * 2, 120));

  // Renderiza el header del mock según posición del logo
  const renderMockHeader = (titulo, subtitulo, infoBlock) => {
    if (posicion === 'cabecera') {
      return (
        <>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            {logoBox(logoBoxH)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: baseFontSz + 3, marginBottom: 2 }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: baseFontSz, marginBottom: 4 }}>{subtitulo}</div>}
            {empresaInfoBlock}
            {infoBlock}
          </div>
        </>
      );
    }
    if (posicion === 'centro') {
      return (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            {logoBox(logoBoxH)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: baseFontSz + 3, marginBottom: 2 }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: baseFontSz, marginBottom: 4 }}>{subtitulo}</div>}
            {empresaInfoBlock}
            {infoBlock}
          </div>
        </>
      );
    }
    if (posicion === 'derecha') {
      return (
        <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: baseFontSz + 3, marginBottom: 2 }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: baseFontSz, marginBottom: 4 }}>{subtitulo}</div>}
            {empresaInfoBlock}
            {infoBlock}
          </div>
          {logoBox(logoBoxH)}
        </div>
      );
    }
    // izquierda (default)
    return (
      <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
        {logoBox(logoBoxH)}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: baseFontSz + 3, marginBottom: 2 }}>{titulo}</div>
          {subtitulo && <div style={{ fontSize: baseFontSz, marginBottom: 4 }}>{subtitulo}</div>}
          {empresaInfoBlock}
          {infoBlock}
        </div>
      </div>
    );
  };

  if (tipo === 'ticket') {
    const leftInfo = [
      'Fecha Emisión: 23/04/2026',
      'Nro. ticket: #932',
      'Vendedor: María González',
      'Fecha entrega: 24/04/2026',
    ];
    const rightInfo = [
      pdfConfig?.mostrarClienteNombre    !== false ? 'Cliente: Juan Pérez'          : null,
      pdfConfig?.mostrarClienteTelefono  !== false ? 'Teléfono: 091 234 567'        : null,
      pdfConfig?.mostrarClienteDireccion !== false ? 'Dirección: Av. 18 de Julio'   : null,
      pdfConfig?.mostrarClienteHorarios  !== false ? 'Horarios: 9:00–18:00'         : null,
    ].filter(Boolean);
    const maxInfoR = Math.max(leftInfo.length, rightInfo.length);
    const infoItems = Array.from({ length: maxInfoR }, (_, i) => [leftInfo[i] || '', rightInfo[i] || '']).flat();
    const clienteGrid = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
        {infoItems.map((t, i) => (
          <div key={i} style={{ fontSize: baseFontSz - 1, color: '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</div>
        ))}
      </div>
    );

    return (
      <div style={{ width: boxW, height: boxH, overflow: 'hidden', position: 'relative' }}>
        <div style={{ ...inner, position: 'relative' }}>
          {renderMockHeader('Ticket de Venta', null, clienteGrid)}
          {/* Tabla */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
            <thead>
              <tr>{['Producto','Cant.','Presentación','P. Unit.','Desc.','Subtotal'].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {PDF_PLACEHOLDER_ROWS.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => (
                  <td key={j} style={i % 2 === 0 ? tdStyle : tdAltStyle}>{cell}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
          {/* Totales */}
          <div style={{ textAlign: 'right', fontSize: baseFontSz - 0.5, lineHeight: 1.8 }}>
            <div>Subtotal: $500,00</div>
            <div>Descuentos: -$5,00</div>
            {pdfConfig?.mostrarIva && <div>IVA (22%): $108,90</div>}
            <div style={{ fontWeight: 700, fontSize: baseFontSz + 1 }}>Total: $495,00</div>
            <div style={{ marginTop: 4 }}>Pagos:</div>
            <div>- Efectivo: $495,00</div>
          </div>
          {notasBlock}
          {pieBlock}
        </div>
      </div>
    );
  }

  if (tipo === 'remito') {
    const remitoCols = pdfConfig?.mostrarCosto
      ? ['Producto', 'Cantidad', 'P. Unitario']
      : ['Producto', 'Cantidad'];
    const remitoRows = pdfConfig?.mostrarCosto
      ? [['Aceite Del Sur 1L', '2 (12 caja)', '$340,00'], ['Fideos 500g', '1 u.', '$90,00'], ['Arroz 1kg', '3 u.', '$130,00']]
      : [['Aceite Del Sur 1L', '2 (12 caja)'], ['Fideos 500g', '1 u.'], ['Arroz 1kg', '3 u.']];
    const rLeftInfo = [
      'Fecha Emisión: 23/04/2026',
      'Fecha entrega: 24/04/2026',
      'Vendedor: María González',
    ];
    const rRightInfo = [
      pdfConfig?.mostrarClienteNombre    !== false ? 'Cliente: Juan Pérez'        : null,
      pdfConfig?.mostrarClienteTelefono  !== false ? 'Teléfono: 091 234 567'      : null,
      pdfConfig?.mostrarClienteDireccion !== false ? 'Dirección: Av. 18 de Julio' : null,
      pdfConfig?.mostrarClienteHorarios  !== false ? 'Horarios: 9:00–18:00'       : null,
    ].filter(Boolean);
    const maxRR = Math.max(rLeftInfo.length, rRightInfo.length);
    const rInfoItems = Array.from({ length: maxRR }, (_, i) => [rLeftInfo[i] || '', rRightInfo[i] || '']).flat();
    const rClienteGrid = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
        {rInfoItems.map((t, i) => (
          <div key={i} style={{ fontSize: baseFontSz - 1, color: '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</div>
        ))}
      </div>
    );
    return (
      <div style={{ width: boxW, height: boxH, overflow: 'hidden', position: 'relative' }}>
        <div style={{ ...inner, position: 'relative' }}>
          {renderMockHeader('REMITO', 'Remito de Factura N° 932', rClienteGrid)}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
            <thead>
              <tr>{remitoCols.map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {remitoRows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} style={i % 2 === 0 ? tdStyle : tdAltStyle}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 16 }}>
            <div style={{ borderTop: '1px solid #333', width: 160, paddingTop: 4, fontSize: baseFontSz - 1, color: '#555' }}>Firma y aclaración del receptor</div>
          </div>
          {notasBlock}
          {pieBlock}
        </div>
      </div>
    );
  }

  // tipo === 'productos'
  return (
    <div style={{ width: boxW, height: boxH, overflow: 'hidden', position: 'relative' }}>
      <div style={inner}>
        {/* Header: logo izquierda + título/fecha a la derecha */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div style={{ width: 54, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {logoSrc ? (
              <img src={logoSrc} alt="logo" style={{ maxWidth: 50, maxHeight: 26, objectFit: 'contain', display: 'block' }} />
            ) : (
              <div style={{ width: 34, height: 16, background: '#ddd', borderRadius: 2 }} />
            )}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Lista de Productos</div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>Emitido: 23/4/2026</div>
          </div>
        </div>
        {/* Tabla */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Nombre','Stock','Costo','Venta','Empaque','Ganancia x U'].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {PDF_PRODUCTOS_ROWS.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => (
                <td key={j} style={i % 2 === 0 ? tdStyle : tdAltStyle}>{cell}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionActions({ dirty, saving, onSave, onUndo, msg }) {
  if (!dirty && !msg) return null;
  return (
    <div className="config-section-actions">
      {msg && <span className="config-section-ok">{msg}</span>}
      {dirty && (
        <>
          <AppButton type="button" size="sm" tone="ghost" onClick={onUndo} disabled={!!saving}>
            Deshacer
          </AppButton>
          <AppButton type="button" size="sm" onClick={onSave} disabled={!!saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </AppButton>
        </>
      )}
    </div>
  );
}

function TabEmpresa({ empresa: initialEmpresa, onSaved, applyPreview, cancelPreview }) {
  const [form, setForm]       = useState(() => buildForm(initialEmpresa));
  const [saved, setSaved]     = useState(() => buildForm(initialEmpresa));
  const [savingSection, setSavingSection] = useState(null);
  const [msgs, setMsgs]       = useState({});
  const [err, setErr]         = useState('');
  const [paletaSugerida, setPaletaSugerida] = useState(null);
  const [subTab, setSubTab]   = useState('datos');
  const [pdfDocTab, setPdfDocTab] = useState('factura');
  const [departamentosEmp, setDepartamentosEmp] = useState([]);
  const [barriosEmp, setBarriosEmp] = useState([]);
  const fileRef  = useRef(null);
  const fondoRef = useRef(null);
  const msgTimers = useRef({});
  // Ref to always have latest cancelPreview in cleanup (avoids stale closure)
  const cancelPreviewRef = useRef(cancelPreview);
  useEffect(() => { cancelPreviewRef.current = cancelPreview; }, [cancelPreview]);
  // Ref tracks the last-saved form so we can preserve dirty fields on external reload
  const savedRef = useRef(saved);
  useEffect(() => { savedRef.current = saved; }, [saved]);

  useEffect(() => {
    if (initialEmpresa) {
      const f = buildForm(initialEmpresa);
      let previewForm;
      setForm((prevForm) => {
        const prevSaved = savedRef.current;
        const merged = { ...f };
        // Preserve fields that the user has changed but not yet saved
        for (const key of Object.keys(prevForm)) {
          if (prevForm[key] !== prevSaved[key]) merged[key] = prevForm[key];
        }
        previewForm = merged;
        return merged;
      });
      setSaved(f);
      savedRef.current = f;
      // Re-apply visual preview to restore any unsaved color/visual changes
      // that were wiped by applyColors() during the server reload (reloadConfig)
      if (previewForm) applyPreview?.(previewForm);
    }
  }, [initialEmpresa, applyPreview]);

  useEffect(() => {
    const timers = msgTimers.current;
    return () => {
      cancelPreviewRef.current?.();
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    Promise.all([api.getDepartamentos(), api.getBarrios()])
      .then(([deps, bars]) => { setDepartamentosEmp(deps); setBarriosEmp(bars); })
      .catch(() => {});
  }, []);

  const isDirty = useCallback((fields) => fields.some((f) => form[f] !== saved[f]), [form, saved]);

  const showMsg = (section, text) => {
    clearTimeout(msgTimers.current[section]);
    setMsgs((prev) => ({ ...prev, [section]: text }));
    if (text) {
      msgTimers.current[section] = setTimeout(
        () => setMsgs((prev) => ({ ...prev, [section]: '' })),
        3000,
      );
    }
  };

  const setVisualDirect = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      applyPreview?.(next);
      return next;
    });
  };

  const setVisual = (field) => (e) => setVisualDirect(field, e.target.value);

  const set = (field) => {
    if (VISUAL_FIELDS.includes(field)) return setVisual(field);
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const undoSection = (fields) => {
    setForm((prev) => {
      const next = { ...prev, ...pickFields(saved, fields) };
      if (fields.some((f) => VISUAL_FIELDS.includes(f))) applyPreview?.(next);
      return next;
    });
  };

const saveSection = async (sectionKey, fields) => {
  if (sectionKey === 'datos' && !form.nombre.trim()) {
    setErr('El nombre de la empresa es requerido');
    return;
  }
  setSavingSection(sectionKey);
  setErr('');

  // Si estamos guardando logo, incluir también colores que hayan cambiado
  let fieldsToSave = fields;
  if (sectionKey === 'logo') {
    const coloresDirty = COLORES_FIELDS.filter((f) => form[f] !== saved[f]);
    if (coloresDirty.length > 0) {
      fieldsToSave = [...fields, ...coloresDirty];
    }
  }

  const payload = { ...saved, ...pickFields(form, fieldsToSave) };
  try {
    await api.updateConfigEmpresa(payload);
    savedRef.current = payload; // sync before onSaved may trigger initialEmpresa refresh
    setSaved(payload);
    showMsg(sectionKey, 'Guardado correctamente.');
    onSaved?.();
  } catch (error) {
    setErr(error.message || 'Error al guardar');
  } finally {
    setSavingSection(null);
  }
};

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setErr('El logo no puede superar 10 MB'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result, 400, 200, 0.8);
      setVisualDirect('logo_base64', compressed);
      setErr('');
      const paleta = await extractPaletteFromDataUrl(compressed);
      if (paleta) setPaletaSugerida(paleta);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setVisualDirect('logo_base64', '');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFondoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setErr('La imagen de fondo no puede superar 15 MB'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result, 1920, 1080, 0.7);
      setVisualDirect('fondo_base64', compressed);
      setErr('');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFondo = () => {
    setVisualDirect('fondo_base64', '');
    if (fondoRef.current) fondoRef.current.value = '';
  };

  // ── PDF config helpers ─────────────────────────────────────────────────────
  const currentPdfCfg = useMemo(() => {
    const key = pdfDocTab === 'factura' ? 'pdf_factura' : 'pdf_remito';
    return getPdfConfig(pdfDocTab, form[key]);
  }, [pdfDocTab, form]);

  const setPdfField = (field, value) => {
    const key = pdfDocTab === 'factura' ? 'pdf_factura' : 'pdf_remito';
    setForm((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: value } }));
  };

  const isPdfDirty = (tipo) => {
    const key = tipo === 'factura' ? 'pdf_factura' : 'pdf_remito';
    return JSON.stringify(form[key]) !== JSON.stringify(saved[key]);
  };

  const undoPdfSection = (tipo) => {
    const key = tipo === 'factura' ? 'pdf_factura' : 'pdf_remito';
    setForm((prev) => ({ ...prev, [key]: saved[key] }));
  };
  // ──────────────────────────────────────────────────────────────────────────

  const SUBTABS = [
    { key: 'datos',   label: 'Datos de la empresa' },
    { key: 'imagen',  label: 'Logo e Imagen de fondo' },
    { key: 'colores', label: 'Colores' },
    { key: 'pdfs',    label: 'PDFs' },
  ];

  return (
    <div>
      <div className="config-subtabs">
        {SUBTABS.map((st) => (
          <button
            key={st.key}
            type="button"
            className={`config-subtab-btn${subTab === st.key ? ' active' : ''}`}
            onClick={() => setSubTab(st.key)}
          >
            {st.label}
          </button>
        ))}
      </div>

      <div className="config-tab-form">
        {err && <p className="config-error">{err}</p>}

      {/* ── DATOS DE LA EMPRESA ── */}
      {subTab === 'datos' && <div className="config-section">
        <div className="config-field-row">
          <label className="config-field-label">Nombre *</label>
          <AppInput value={form.nombre} onChange={set('nombre')} placeholder="Nombre de la empresa" />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Razón social</label>
          <AppInput value={form.razon_social} onChange={set('razon_social')} placeholder="Razón social" />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">RUT</label>
          <AppInput value={form.rut} onChange={set('rut')} placeholder="RUT" />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Dirección</label>
          <AppTextarea value={form.direccion} onChange={set('direccion')} placeholder="Dirección" rows={2} />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Teléfono</label>
          <AppInput value={form.telefono} onChange={set('telefono')} placeholder="Teléfono" />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Correo</label>
          <AppInput type="email" value={form.correo} onChange={set('correo')} placeholder="correo@empresa.com" />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Sitio web</label>
          <AppInput value={form.website} onChange={set('website')} placeholder="https://..." />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Giro comercial</label>
          <AppInput value={form.giro} onChange={set('giro')} placeholder="Giro comercial" />
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Departamento</label>
          <AppSelect
            value={form.departamento}
            onChange={(e) => setForm((prev) => ({ ...prev, departamento: e.target.value, ciudad: '' }))}
          >
            <option value="">— Seleccionar —</option>
            {departamentosEmp.map((d) => (
              <option key={d.id} value={d.nombre}>{d.nombre}</option>
            ))}
          </AppSelect>
        </div>
        <div className="config-field-row">
          <label className="config-field-label">Ciudad</label>
          <AppSelect
            value={form.ciudad}
            onChange={set('ciudad')}
            disabled={!form.departamento}
          >
            <option value="">— Seleccionar —</option>
            {barriosEmp
              .filter((b) => !form.departamento || b.departamento_nombre === form.departamento)
              .map((b) => (
                <option key={b.id} value={b.nombre}>{b.nombre}</option>
              ))}
          </AppSelect>
        </div>
        {(!form.ciudad || !form.departamento) && (
          <div className="config-field-row">
            <span />
            <p className="config-hint config-hint--warn">
              ⚠️ Ciudad y Departamento son obligatorios para emitir CFE ante DGI.
            </p>
          </div>
        )}
        <div className="config-field-row">
          <label className="config-field-label">Estado CFE</label>
          <span
            className={`config-cfe-badge config-cfe-badge--${initialEmpresa?.cfe_habilitado ? 'on' : 'off'}`}
          >
            {initialEmpresa?.cfe_habilitado ? '✓ Habilitado' : '✗ Deshabilitado'}
          </span>
        </div>
        {initialEmpresa?.cfe_habilitado && (
          <div className="config-field-row">
            <label className="config-field-label">Ambiente CFE</label>
            <AppSelect
              value={form.cfe_ambiente}
              onChange={async (e) => {
                const val = e.target.value;
                if (val === 'PRODUCCION') {
                  const ok = await appConfirm(
                    '⚠️ Ha seleccionado Producción.\n\n' +
                    'Con esto activo, todas las transacciones realizadas quedarán registradas ante la DGI.\n\n' +
                    'Habilítese SOLO si se pasó por el proceso de Testing y Homologación, es decir, realizó pruebas para asegurar que el sistema se comunica correctamente con la DGI.',
                    { confirmText: 'Confirmar Producción', cancelText: 'Cancelar' }
                  );
                  if (!ok) {
                    setForm((prev) => ({ ...prev, cfe_ambiente: 'PRUEBAS' }));
                    return;
                  }
                }
                setForm((prev) => ({ ...prev, cfe_ambiente: val }));
              }}
            >
              <option value="LOCAL">Local (solo JSON)</option>
              <option value="PRUEBAS">Pruebas</option>
              <option value="PRODUCCION">Producción</option>
            </AppSelect>
          </div>
        )}
        {initialEmpresa?.cfe_habilitado && (
          <div className="config-field-row config-field-row--checkbox">
            <label className="config-field-label">Enviar CFE automáticamente</label>
            <input
              type="checkbox"
              className="config-checkbox"
              checked={form.cfe_auto_envio}
              onChange={(e) => setForm((prev) => ({ ...prev, cfe_auto_envio: e.target.checked }))}
            />
            <span className="config-hint" style={{ gridColumn: '2', marginTop: 0 }}>
              Si está activo, el CFE se emite automáticamente al confirmar cada venta.
            </span>
          </div>
        )}
        <div className="config-field-row config-field-row--checkbox">
          <label className="config-field-label">Descargar PDFs automáticamente al finalizar la venta</label>
          <input
            type="checkbox"
            className="config-checkbox"
            checked={form.descarga_automatica_pdf}
            onChange={(e) => setForm((prev) => ({ ...prev, descarga_automatica_pdf: e.target.checked }))}
          />
          <span className="config-hint" style={{ gridColumn: '2', marginTop: 0 }}>
            Si está activo, al confirmar una venta se descargan automáticamente el PDF del ticket y el comprobante CFE.
            Si está inactivo, no se descarga nada solo: la pantalla final sigue mostrando los botones para descargar o imprimir manualmente.
          </span>
        </div>
        <SectionActions
          dirty={isDirty(DATOS_FIELDS)}
          saving={savingSection === 'datos'}
          onSave={() => saveSection('datos', DATOS_FIELDS)}
          onUndo={() => undoSection(DATOS_FIELDS)}
          msg={msgs.datos}
        />
      </div>}

      {/* ── LOGO e IMAGEN ── */}
      {subTab === 'imagen' && <><div className="config-section">
        <h3 className="config-section-title">Logo</h3>

        {/* Vista previa del menú */}
        <div className="config-logo-menu-preview">
          <p className="config-hint" style={{ marginBottom: '0.5rem' }}>Vista previa en el menú:</p>
          <div
            className="config-logo-menu-mock"
            style={{ background: form.color_menu_bg || '#1f2933' }}
          >
            <div
              className="config-logo-menu-mock-wrap"
              style={{ background: form.logo_bg_color || '#ffffff' }}
            >
              {form.logo_base64 && form.logo_base64 !== '' ? (
                <img
                  src={form.logo_base64}
                  alt="Vista previa del logo"
                  className="config-logo-menu-mock-img"
                  style={{ maxWidth: `${Math.round((form.logo_tamano || 200) * 0.45)}px` }}
                />
              ) : (
                <span className="config-logo-menu-mock-empty" style={{ color: form.color_menu_text || '#e6ecf4' }}>
                  Sin logo
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="config-logo-area">
          {form.logo_base64 && form.logo_base64 !== '' ? (
            <div className="config-logo-preview-wrap">
              <img src={form.logo_base64} alt="Logo preview" className="config-logo-preview" />
              <AppButton type="button" tone="danger" size="sm" onClick={handleRemoveLogo}>
                Quitar logo
              </AppButton>
            </div>
          ) : (
            <div className="config-logo-placeholder">Sin logo</div>
          )}
          <AppButton type="button" size="sm" onClick={() => fileRef.current?.click()}>
            {form.logo_base64 && form.logo_base64 !== '' ? 'Cambiar logo' : 'Subir logo'}
          </AppButton>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} />
          <p className="config-hint">Formatos: PNG, JPG, WebP. Se comprime automáticamente.</p>
        </div>
        <div className="config-fondo-extra">
          <div className="config-field-group">
            <label className="config-field-label">
              Tamaño del logo en el menú: <strong>{form.logo_tamano}px</strong>
            </label>
            <input
              type="range"
              min="60" max="250" step="5"
              value={form.logo_tamano}
              onChange={(e) => setVisualDirect('logo_tamano', Number(e.target.value))}
              className="config-range"
            />
          </div>
          <div className="config-color-row" style={{ marginTop: '0.6rem' }}>
            <label className="config-field-label">Color de fondo del logo</label>
            <div className="config-color-input-wrap">
              <input type="color" value={form.logo_bg_color} onChange={set('logo_bg_color')} className="config-color-picker" />
              <AppInput value={form.logo_bg_color} onChange={set('logo_bg_color')} placeholder="#ffffff" className="config-color-text" />
            </div>
          </div>
        </div>
        {paletaSugerida && (
          <div className="config-paleta-sugerida">
            <p className="config-paleta-label">
              🎨 Se detectaron colores del logo. ¿Querés aplicar una paleta basada en ellos?
            </p>
            <div className="config-paleta-preview">
              {Object.entries(paletaSugerida).map(([key, color]) => (
                <span key={key} title={key} style={{ background: color, width: 28, height: 28, borderRadius: 6, display: 'inline-block', border: '1px solid rgba(0,0,0,0.15)' }} />
              ))}
            </div>
            <div className="config-paleta-actions">
              <AppButton
                type="button"
                size="sm"
                onClick={() => {
                  const next = { ...form, ...paletaSugerida };
                  setForm(next);
                  applyPreview?.(next);
                  setPaletaSugerida(null);
                }}
              >
                Aplicar paleta
              </AppButton>
              <AppButton type="button" size="sm" tone="ghost" onClick={() => setPaletaSugerida(null)}>
                No, mantener colores
              </AppButton>
            </div>
          </div>
        )}
        <SectionActions
          dirty={isDirty(LOGO_FIELDS) || isDirty(COLORES_FIELDS)}
          saving={savingSection === 'logo'}
          onSave={() => saveSection('logo', LOGO_FIELDS)}
          onUndo={() => undoSection([...LOGO_FIELDS, ...COLORES_FIELDS])}
          msg={msgs.logo}
        />
      </div>

      {/* ── IMAGEN DE FONDO ── */}
      <div className="config-section">
        <h3 className="config-section-title">Imagen de fondo</h3>
        <p className="config-hint">Se muestra detrás del contenido principal del sistema.</p>
        <div className="config-logo-area">
          {form.fondo_base64 && form.fondo_base64 !== '' ? (
            <div className="config-logo-preview-wrap">
              <img src={form.fondo_base64} alt="Fondo preview" className="config-fondo-preview" />
              <AppButton type="button" tone="danger" size="sm" onClick={handleRemoveFondo}>
                Sin fondo
              </AppButton>
            </div>
          ) : form.fondo_base64 === '' ? (
            <div className="config-logo-placeholder">Sin fondo (fondo blanco)</div>
          ) : (
            <div className="config-logo-preview-wrap">
              <img src="/mercatus-logo.png" alt="Fondo por defecto" className="config-fondo-preview" style={{ objectFit: 'contain', opacity: 0.5 }} />
              <AppButton type="button" tone="danger" size="sm" onClick={handleRemoveFondo}>
                Sin fondo
              </AppButton>
            </div>
          )}
          <AppButton type="button" size="sm" onClick={() => fondoRef.current?.click()}>
            {form.fondo_base64 && form.fondo_base64 !== '' ? 'Cambiar fondo' : 'Subir imagen personalizada'}
          </AppButton>
          <input ref={fondoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFondoChange} />
          <p className="config-hint">Formatos: JPG, PNG, WebP. Se comprime automáticamente.</p>
        </div>
        <div className="config-fondo-extra">
          <div className="config-field-group">
            <label className="config-field-label">
              Opacidad del fondo: <strong>{Math.round(Number(form.fondo_opacidad) * 100)}%</strong>
            </label>
            <input
              type="range"
              min="0" max="1" step="0.01"
              value={form.fondo_opacidad}
              onChange={(e) => setVisualDirect('fondo_opacidad', Number(e.target.value))}
              className="config-range"
            />
          </div>
        </div>
        <SectionActions
          dirty={isDirty(FONDO_FIELDS)}
          saving={savingSection === 'fondo'}
          onSave={() => saveSection('fondo', FONDO_FIELDS)}
          onUndo={() => undoSection(FONDO_FIELDS)}
          msg={msgs.fondo}
        />
      </div></>}

      {/* ── COLORES ── */}
      {subTab === 'colores' && <div className="config-section">
        <div className="config-colors-grid">
          {[
            { field: 'color_primary',        label: 'Color principal',         placeholder: '#375f8c' },
            { field: 'color_primary_strong',  label: 'Color principal fuerte',  placeholder: '#294c74' },
            { field: 'color_primary_soft',    label: 'Color principal suave',   placeholder: '#e7effa' },
            { field: 'color_menu_bg',         label: 'Fondo del menú',          placeholder: '#1f2933' },
            { field: 'color_menu_active',     label: 'Color activo del menú',   placeholder: '#375f8c' },
            { field: 'color_menu_text',       label: 'Texto del menú',          placeholder: '#e6ecf4' },
            { field: 'color_text',            label: 'Color de texto',          placeholder: '#1d2b3e' },
            { field: 'color_text_muted',      label: 'Texto secundario',        placeholder: '#526278' },
            { field: 'color_logout_bg',       label: 'Botón Cerrar sesión',     placeholder: '#d32f2f' },
          ].map(({ field, label, placeholder }) => {
            const dirty = form[field] !== saved[field];
            const saving = savingSection === field;
            return (
              <div key={field} className="config-color-row">
                <label className="config-field-label">{label}</label>
                <div className="config-color-input-wrap">
                  <input type="color" value={form[field]} onChange={set(field)} className="config-color-picker" />
                  <AppInput value={form[field]} onChange={set(field)} placeholder={placeholder} className="config-color-text" />
                </div>
                <div className="config-color-row-actions">
                  {msgs[field] && <span className="config-section-ok">{msgs[field]}</span>}
                  {dirty && (
                    <>
                      <AppButton type="button" size="sm" tone="ghost" onClick={() => undoSection([field])} disabled={saving}>
                        ↩
                      </AppButton>
                      <AppButton type="button" size="sm" onClick={() => saveSection(field, [field])} disabled={saving}>
                        {saving ? '...' : 'Guardar'}
                      </AppButton>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="config-colors-preview">
          <span style={{ background: form.color_primary, color: '#fff', padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>Principal</span>
          <span style={{ background: form.color_primary_strong, color: '#fff', padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>Fuerte</span>
          <span style={{ background: form.color_primary_soft, color: form.color_primary, padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>Suave</span>
          <span style={{ background: form.color_menu_bg, color: form.color_menu_text, padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>Menú</span>
          <span style={{ background: form.color_menu_active, color: '#fff', padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>Activo</span>
          <span style={{ color: form.color_text, background: '#f4f7fb', padding: '6px 16px', borderRadius: 6, fontSize: 13, border: '1px solid #ddd' }}>Texto</span>
          <span style={{ color: form.color_text_muted, background: '#f4f7fb', padding: '6px 16px', borderRadius: 6, fontSize: 13, border: '1px solid #ddd' }}>Secundario</span>
          <span style={{ background: form.color_logout_bg, color: '#fff', padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>Cerrar sesión</span>
        </div>
      </div>}

      {/* ── PDFs ── */}
      {subTab === 'pdfs' && <div className="config-section">

        {/* Vista previa de documentos (movida desde Logo e imagen) */}
        <div className="config-section config-pdf-overview-section">
          <h3 className="config-section-title">Vista previa de documentos</h3>
          <p className="config-hint">Así se verá tu logo y colores en los reportes generados.</p>
          <div className="config-pdf-previews-row">
            <div className="config-pdf-preview-card">
              <span className="config-pdf-preview-label">Ticket de venta</span>
              <div className="config-pdf-mock">
                <PdfPreviewMock
                  tipo="ticket"
                  logoSrc={form.logo_base64 || null}
                  logoBgColor={form.logo_bg_color}
                  logoTamano={form.logo_tamano}
                  primaryColor={form.color_primary}
                  pdfConfig={getPdfConfig('factura', form.pdf_factura)}
                />
              </div>
            </div>
            <div className="config-pdf-preview-card">
              <span className="config-pdf-preview-label">Remito</span>
              <div className="config-pdf-mock">
                <PdfPreviewMock
                  tipo="remito"
                  logoSrc={form.logo_base64 || null}
                  logoBgColor={form.logo_bg_color}
                  logoTamano={form.logo_tamano}
                  primaryColor={form.color_primary}
                  pdfConfig={getPdfConfig('remito', form.pdf_remito)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Configuración por documento */}
        <h3 className="config-section-title" style={{ marginTop: 24 }}>Configuración por documento</h3>
        <div className="config-pdf-doctabs">
          {[{ key: 'factura', label: 'Factura / Ticket' }, { key: 'remito', label: 'Remito' }].map((dt) => (
            <button
              key={dt.key}
              type="button"
              className={`config-pdf-doctab-btn${pdfDocTab === dt.key ? ' active' : ''}`}
              onClick={() => setPdfDocTab(dt.key)}
            >
              {dt.label}
            </button>
          ))}
        </div>

        <div className="config-pdf-editor">
          {/* Panel de configuración */}
          <div className="config-pdf-editor-panel">
            <div className="config-field-row">
              <label className="config-field-label">Tipografía</label>
              <AppSelect value={currentPdfCfg.fontFamily} onChange={(e) => setPdfField('fontFamily', e.target.value)}>
                <option value="helvetica">Helvetica (predeterminado)</option>
                <option value="times">Times New Roman</option>
                <option value="courier">Courier</option>
              </AppSelect>
            </div>
            <div className="config-field-row">
              <label className="config-field-label">Tamaño de fuente base</label>
              <AppInput
                type="number"
                min="7"
                max="14"
                step="1"
                value={currentPdfCfg.fontSizeBase}
                onChange={(e) => setPdfField('fontSizeBase', Number(e.target.value))}
              />
            </div>
            <div className="config-field-row">
              <label className="config-field-label">Posición del logo</label>
              <AppSelect value={currentPdfCfg.logoPosicion || 'izquierda'} onChange={(e) => setPdfField('logoPosicion', e.target.value)}>
                <option value="izquierda">Izquierda (columna)</option>
                <option value="derecha">Derecha (columna)</option>
                <option value="centro">Centro (encima del contenido)</option>
                <option value="cabecera">Cabecera (ancho completo)</option>
              </AppSelect>
            </div>
            <div className="config-field-row">
              <label className="config-field-label">Tamaño del logo (mm)</label>
              <AppInput
                type="number"
                min="10"
                max="80"
                step="5"
                value={currentPdfCfg.logoTamano}
                onChange={(e) => setPdfField('logoTamano', Number(e.target.value))}
              />
            </div>
            <div className="config-field-row">
              <label className="config-field-label">Pie de página</label>
              <AppInput
                value={currentPdfCfg.piePagina}
                onChange={(e) => setPdfField('piePagina', e.target.value)}
                placeholder="Texto que aparece al pie de cada página"
              />
            </div>
            <div className="config-field-row">
              <label className="config-field-label">Notas / observaciones</label>
              <AppTextarea
                value={currentPdfCfg.notas}
                onChange={(e) => setPdfField('notas', e.target.value)}
                placeholder="Texto adicional al final del documento"
                rows={2}
              />
            </div>

            <h4 className="config-pdf-section-subtitle">Datos de la empresa</h4>
            {[
              { key: 'mostrarRazonSocial', label: 'Mostrar razón social' },
              { key: 'mostrarRut',         label: 'Mostrar RUT' },
              { key: 'mostrarDireccion',   label: 'Mostrar dirección' },
              { key: 'mostrarTelefono',    label: 'Mostrar teléfono' },
              { key: 'mostrarEmail',       label: 'Mostrar email' },
            ].map(({ key, label }) => (
              <div key={key} className="config-field-row config-field-row--checkbox">
                <label className="config-field-label">{label}</label>
                <input
                  type="checkbox"
                  className="config-checkbox"
                  checked={currentPdfCfg[key] !== false}
                  onChange={(e) => setPdfField(key, e.target.checked)}
                />
              </div>
            ))}

            <h4 className="config-pdf-section-subtitle">Datos del cliente</h4>
            {[
              { key: 'mostrarClienteNombre',    label: 'Mostrar nombre del cliente' },
              { key: 'mostrarClienteTelefono',  label: 'Mostrar teléfono' },
              { key: 'mostrarClienteDireccion', label: 'Mostrar dirección' },
              { key: 'mostrarClienteHorarios',  label: 'Mostrar horarios' },
            ].map(({ key, label }) => (
              <div key={key} className="config-field-row config-field-row--checkbox">
                <label className="config-field-label">{label}</label>
                <input
                  type="checkbox"
                  className="config-checkbox"
                  checked={currentPdfCfg[key] !== false}
                  onChange={(e) => setPdfField(key, e.target.checked)}
                />
              </div>
            ))}

            <h4 className="config-pdf-section-subtitle">Opciones</h4>
            {pdfDocTab === 'factura' && (
              <div className="config-field-row config-field-row--checkbox">
                <label className="config-field-label">Mostrar desglose de IVA</label>
                <input
                  type="checkbox"
                  className="config-checkbox"
                  checked={!!currentPdfCfg.mostrarIva}
                  onChange={(e) => setPdfField('mostrarIva', e.target.checked)}
                />
              </div>
            )}
            {pdfDocTab === 'remito' && (
              <div className="config-field-row config-field-row--checkbox">
                <label className="config-field-label">Mostrar precio unitario</label>
                <input
                  type="checkbox"
                  className="config-checkbox"
                  checked={!!currentPdfCfg.mostrarCosto}
                  onChange={(e) => setPdfField('mostrarCosto', e.target.checked)}
                />
              </div>
            )}
            <SectionActions
              dirty={isPdfDirty(pdfDocTab)}
              saving={savingSection === `pdf_${pdfDocTab}`}
              onSave={() => saveSection(`pdf_${pdfDocTab}`, [`pdf_${pdfDocTab}`])}
              onUndo={() => undoPdfSection(pdfDocTab)}
              msg={msgs[`pdf_${pdfDocTab}`]}
            />
          </div>

          {/* Vista previa en tiempo real */}
          <div className="config-pdf-editor-preview">
            <span className="config-pdf-preview-label">
              {pdfDocTab === 'factura' ? 'Factura / Ticket de venta' : 'Remito'}
            </span>
            <div className="config-pdf-mock config-pdf-mock--large">
              <PdfPreviewMock
                tipo={pdfDocTab === 'factura' ? 'ticket' : 'remito'}
                logoSrc={form.logo_base64 || null}
                logoBgColor={form.logo_bg_color}
                logoTamano={form.logo_tamano}
                primaryColor={form.color_primary}
                pdfConfig={currentPdfCfg}
              />
            </div>
          </div>
        </div>
      </div>}

      </div>
    </div>
  );
}

// ── TAB MÓDULOS ───────────────────────────────────────────────────────────────

function TabModulos({ onSaved }) {
  const [modulos, setModulos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [err, setErr] = useState('');

  const cargarModulos = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getConfigModulos();
      setModulos(data);
    } catch (e) {
      setErr(e.message || 'Error al cargar módulos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarModulos(); }, [cargarModulos]);

  const toggleModulo = async (codigo, habilitado) => {
    setSaving(codigo);
    setErr('');
    try {
      await api.updateConfigModulo(codigo, habilitado);
      setModulos((prev) => prev.map((m) => m.codigo === codigo ? { ...m, habilitado } : m));
      onSaved?.();
    } catch (e) {
      setErr(e.message || 'Error al actualizar módulo');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="config-loading">Cargando módulos...</div>;

  return (
    <div className="config-tab-form">
      <div className="config-section">
        <h3 className="config-section-title">Módulos del sistema</h3>
        <p className="config-hint">Habilitá o deshabilitá secciones del menú. Los módulos deshabilitados no aparecen en la navegación.</p>
        <div className="config-modulos-list">
          {modulos.filter((mod) => mod.codigo !== 'configuracion').map((mod) => (
            <div key={mod.codigo} className="config-modulo-row">
              <div className="config-modulo-info">
                <span className="config-modulo-label">{mod.label}</span>
                {mod.solo_propietario && <span className="config-modulo-badge">Solo propietario</span>}
              </div>
              <label className="config-toggle" title={mod.habilitado ? 'Deshabilitar' : 'Habilitar'}>
                <input
                  type="checkbox"
                  checked={mod.habilitado}
                  disabled={saving === mod.codigo}
                  onChange={(e) => toggleModulo(mod.codigo, e.target.checked)}
                  className="config-toggle-input"
                />
                <span className="config-toggle-track" />
              </label>
            </div>
          ))}
        </div>
        {err && <p className="config-error">{err}</p>}
      </div>
    </div>
  );
}

// ── TAB GANANCIAS ─────────────────────────────────────────────────────────────

function TabGanancias() {
  const [metodos, setMetodos] = useState([]);
  const [metodoId, setMetodoId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getConfigGanancias().then((data) => {
      setMetodos(data.metodos || []);
      if (data.config?.metodo_id) setMetodoId(String(data.config.metodo_id));
    }).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!metodoId) return;
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      await api.updateConfigGanancias({ metodo_id: Number(metodoId) });
      setMsg('Método de cálculo actualizado.');
    } catch (error) {
      setErr(error.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="config-loading">Cargando configuración...</div>;

  const metodoSeleccionado = metodos.find((m) => String(m.id) === metodoId);

  return (
    <form className="config-tab-form" onSubmit={handleSave}>
      <div className="config-section">
        <h3 className="config-section-title">Método de cálculo de ganancias</h3>
        <p className="config-hint">Define cómo se calcula la ganancia en el dashboard y en los reportes de estadísticas.</p>
        <div className="config-field-row">
          <label className="config-field-label">Método activo</label>
          <AppSelect value={metodoId} onChange={(e) => setMetodoId(e.target.value)}>
            <option value="">Seleccioná un método...</option>
            {metodos.map((m) => (
              <option key={m.id} value={String(m.id)}>{m.label}</option>
            ))}
          </AppSelect>
        </div>
        {metodoSeleccionado && (
          <div className="config-metodo-desc">
            <p>{metodoSeleccionado.descripcion}</p>
          </div>
        )}
      </div>
      {err && <p className="config-error">{err}</p>}
      {msg && <p className="config-ok">{msg}</p>}
      <div className="config-actions">
        <AppButton type="submit" disabled={saving || !metodoId}>
          {saving ? 'Guardando...' : 'Guardar método'}
        </AppButton>
      </div>
    </form>
  );
}

// ── TAB PERMISOS ──────────────────────────────────────────────────────────────

const RECURSOS = [
  { key: 'nueva-venta', label: 'Nueva venta',  acciones: ['usar'] },
  { key: 'ventas',      label: 'Ventas',        acciones: ['ver', 'ver_todas', 'eliminar', 'eliminar_todas', 'exportar'] },
  { key: 'productos',   label: 'Productos',     acciones: ['ver', 'agregar', 'editar', 'eliminar', 'ver_archivados', 'gestionar_empaques', 'ver_costo', 'ver_ganancia', 'exportar'] },
  { key: 'clientes',    label: 'Clientes',      acciones: ['ver', 'agregar', 'editar', 'eliminar', 'exportar'] },
  { key: 'usuarios',    label: 'Usuarios',      acciones: ['ver', 'agregar', 'editar', 'eliminar'] },
  { key: 'estadisticas',label: 'Estadísticas',  acciones: ['ver', 'ver_empresa', 'ver_por_usuario', 'exportar'] },
  { key: 'flujo-stock', label: 'Flujo de Stock', acciones: ['ver'] },
  { key: 'stock',       label: 'Control de Stock', acciones: ['ver', 'editar'] },
  { key: 'auditoria',   label: 'Auditoría',     acciones: ['ver', 'exportar'] },
  { key: 'configuracion',label:'Configuración', acciones: ['ver'] },
];

const ACCION_LABELS = {
  usar: 'Usar', ver: 'Ver', agregar: 'Agregar', editar: 'Editar',
  eliminar: 'Eliminar', exportar: 'Exportar', ver_costo: 'Ver costo',
  ver_ganancia: 'Ver ganancia', ver_archivados: 'Ver archivados',
  gestionar_empaques: 'Gestionar empaques',
  ver_empresa: 'Ver empresa', ver_por_usuario: 'Ver por usuario', ver_todas: 'Ver todas',
  eliminar_todas: 'Eliminar/cancelar todas',
};

function ResumenPermisos({ recurso, acciones, permisos }) {
  const activos = acciones.filter((a) => permisos[`${recurso}:${a}`]);
  return (
    <span className="config-acordeon-resumen">
      {activos.length === 0
        ? <span className="resumen-ninguno">Sin acceso</span>
        : activos.length === acciones.length
          ? <span className="resumen-todos">Acceso total</span>
          : <span className="resumen-parcial">{activos.length} de {acciones.length}</span>
      }
    </span>
  );
}

function TabPermisos() {
  const [roles, setRoles] = useState([]);
  const [rolSeleccionado, setRolSeleccionado] = useState(null); // ahora es el ID (number)
  const [permisos, setPermisos] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [nuevoRol, setNuevoRol] = useState('');
  const [creandoRol, setCreandoRol] = useState(false);
  const [seccionesAbiertas, setSeccionesAbiertas] = useState({});

  const loadRoles = useCallback(async () => {
    try {
      const rows = await api.getRoles();
      setRoles(rows);
      if (!rolSeleccionado && rows.length > 0) setRolSeleccionado(rows[0].id);
    } catch { /* ignore */ }
  }, [rolSeleccionado]);

  const loadPermisos = useCallback(async (rolId) => {
    if (!rolId) return;
    try {
      const rows = await api.getPermisos(rolId);
      const map = {};
      for (const { recurso, accion, habilitado } of rows) {
        map[`${recurso}:${accion}`] = !!habilitado;
      }
      setPermisos(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);
  useEffect(() => { if (rolSeleccionado) loadPermisos(rolSeleccionado); }, [rolSeleccionado, loadPermisos]);

  const toggle = (recurso, accion) => {
    const key = `${recurso}:${accion}`;
    setPermisos((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSeccion = (key) => {
    setSeccionesAbiertas((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTodosSeccion = (recurso, acciones) => {
    const todosActivos = acciones.every((a) => permisos[`${recurso}:${a}`]);
    setPermisos((prev) => {
      const next = { ...prev };
      for (const a of acciones) next[`${recurso}:${a}`] = !todosActivos;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true); setMsg(''); setErr('');
    try {
      const payload = RECURSOS.flatMap(({ key: recurso, acciones }) =>
        acciones.map((accion) => ({ recurso, accion, habilitado: !!(permisos[`${recurso}:${accion}`]) }))
      );
      await api.updatePermisos(rolSeleccionado, payload);
      setMsg('Permisos guardados correctamente.');
      window.dispatchEvent(new CustomEvent('mercatus:permisos-updated'));
    } catch (e) {
      setErr(e.message || 'Error al guardar permisos');
    } finally {
      setSaving(false);
    }
  };

  const handleCrearRol = async () => {
    if (!nuevoRol.trim()) return;
    setCreandoRol(true); setErr('');
    try {
      const creado = await api.crearRol(nuevoRol.trim());
      setNuevoRol('');
      await loadRoles();
      setRolSeleccionado(creado.id);
    } catch (e) {
      setErr(e.message || 'Error al crear rol');
    } finally {
      setCreandoRol(false);
    }
  };

  const handleEliminarRol = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar el rol "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.eliminarRol(id);
      const rows = await api.getRoles();
      setRoles(rows);
      setRolSeleccionado(rows[0]?.id ?? null);
    } catch (e) {
      setErr(e.message || 'Error al eliminar rol');
    }
  };

  const rolActual = roles.find((r) => r.id === rolSeleccionado);

  return (
    <div className="config-permisos-root">
      {/* ── Selector de rol ── */}
      <div className="config-section">
        <h3 className="config-section-title">Roles del sistema</h3>
        <p className="config-hint">Seleccioná un rol para ver y editar sus permisos. Los roles del sistema no se pueden eliminar.</p>
        <div className="config-roles-list">
          {roles.map((r) => (
            <div key={r.id} className={`config-rol-chip ${r.id === rolSeleccionado ? 'active' : ''}`}>
              <button type="button" className="config-rol-chip-btn" onClick={() => setRolSeleccionado(r.id)}>
                {r.nombre}
                {r.es_sistema && <span className="config-rol-badge">sistema</span>}
              </button>
              {!r.es_sistema && (
                <button type="button" className="config-rol-delete" title="Eliminar rol" onClick={() => handleEliminarRol(r.id, r.nombre)}>×</button>
              )}
            </div>
          ))}
        </div>
        <div className="config-nuevo-rol">
          <AppInput
            placeholder="Nombre del nuevo rol..."
            value={nuevoRol}
            onChange={(e) => setNuevoRol(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCrearRol()}
          />
          <AppButton type="button" size="sm" onClick={handleCrearRol} disabled={creandoRol || !nuevoRol.trim()}>
            {creandoRol ? '...' : '+ Crear rol'}
          </AppButton>
        </div>
      </div>

      {/* ── Acordeón de permisos ── */}
      {rolSeleccionado && (
        <div className="config-section">
          <h3 className="config-section-title">
            Permisos del rol: <span className="config-rol-nombre">{rolActual?.nombre ?? ''}</span>
          </h3>
          <p className="config-hint">Tocá cada sección para expandir y configurar sus permisos.</p>
          <div className="config-acordeon">
            {RECURSOS.map(({ key: recurso, label, acciones }) => {
              const abierto = !!seccionesAbiertas[recurso];
              const todosActivos = acciones.every((a) => permisos[`${recurso}:${a}`]);
              return (
                <div key={recurso} className={`config-acordeon-item ${abierto ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="config-acordeon-header"
                    onClick={() => toggleSeccion(recurso)}
                    aria-expanded={abierto}
                  >
                    <span className="config-acordeon-label">{label}</span>
                    <ResumenPermisos recurso={recurso} acciones={acciones} permisos={permisos} />
                    <span className="config-acordeon-chevron" aria-hidden="true">{abierto ? '▲' : '▼'}</span>
                  </button>
                  {abierto && (
                    <div className="config-acordeon-body">
                      <button
                        type="button"
                        className="config-toggle-todos"
                        onClick={() => toggleTodosSeccion(recurso, acciones)}
                      >
                        {todosActivos ? 'Quitar todo' : 'Activar todo'}
                      </button>
                      <div className="config-permisos-acciones">
                        {acciones.map((accion) => {
                          const key = `${recurso}:${accion}`;
                          const habilitado = !!(permisos[key]);
                          return (
                            <label key={accion} className={`config-permiso-chip ${habilitado ? 'on' : 'off'}`}>
                              <input
                                type="checkbox"
                                checked={habilitado}
                                onChange={() => toggle(recurso, accion)}
                                className="config-permiso-checkbox"
                              />
                              <span className="config-permiso-icon" aria-hidden="true">{habilitado ? '✓' : '○'}</span>
                              {ACCION_LABELS[accion] || accion}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {err && <p className="config-error">{err}</p>}
          {msg && <p className="config-success">{msg}</p>}
          <div className="config-actions">
            <AppButton type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar permisos'}
            </AppButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function Configuracion() {
  const [tab, setTab] = useState('empresa');
  const { empresa, reloadConfig, applyPreview, cancelPreview } = useConfig();

  return (
    <div className="config-root">
      <div className="config-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`config-tab-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="config-panel">
        {tab === 'empresa' && <TabEmpresa empresa={empresa} onSaved={reloadConfig} applyPreview={applyPreview} cancelPreview={cancelPreview} />}
        {tab === 'modulos' && <TabModulos onSaved={reloadConfig} />}
        {tab === 'ganancias' && <TabGanancias />}
        {tab === 'permisos' && <TabPermisos />}
      </div>
    </div>
  );
}
