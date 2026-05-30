import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import './Ventas.css';
import { api } from '../../core/api';
import { useConfig } from '../../core/ConfigContext';
import { getPrimaryRgb, loadLogoForPdf } from '../../shared/lib/pdfColors';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { appAlert, appConfirm } from '../../shared/lib/appDialog';
import { formatHorarioCliente, horaConHoraVacia, normalizeHoraForSave, splitHora } from '../../shared/lib/horarios';
import { fireConfetti } from '../../shared/lib/confetti';
import AppInput from '../../shared/components/fields/AppInput';
import AppSelect from '../../shared/components/fields/AppSelect';
import AppTextarea from '../../shared/components/fields/AppTextarea';
import AppButton from '../../shared/components/button/AppButton';

const PASOS = ['Productos y carrito', 'Pago y preventa'];
const MEDIOS_PAGO = [
  { key: 'efectivo', label: 'Efectivo', icon: '/cash.svg' },
  { key: 'debito', label: 'Débito', icon: '/debit.svg' },
  { key: 'credito', label: 'Crédito', icon: '/credit.svg' },
  { key: 'transferencia', label: 'Transferencia', icon: '/transfer.svg' },
];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeDiscountValue(value) {
  return String(value ?? '').trim().replace(/,/g, '.');
}

function money(value) {
  const rounded = roundMoney(value);
  return `$${rounded.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isSameMoney(a, b) {
  return Math.abs(roundMoney(a) - roundMoney(b)) < 0.001;
}

function getEmpaqueUnits(producto) {
  const n = Math.floor(toNumber(producto?.cantidadEmpaque));
  return n > 0 ? n : 1;
}

function splitByEmpaque(unidades, unidadesPorEmpaque) {
  const totalUnidades = Math.max(0, Math.floor(toNumber(unidades)));
  const packSize = Math.max(1, Math.floor(toNumber(unidadesPorEmpaque)));
  if (packSize <= 1) return { packs: 0, unidadesSueltas: totalUnidades };
  return {
    packs: Math.floor(totalUnidades / packSize),
    unidadesSueltas: totalUnidades % packSize,
  };
}

function formatEmpaqueSplit(item) {
  const packSize = Math.max(1, Math.floor(toNumber(item.unidadesPorEmpaque)));
  if (packSize <= 1) return `${Math.floor(toNumber(item.unidadesSolicitadas))} unidades`;
  const { packs, unidadesSueltas } = splitByEmpaque(item.unidadesSolicitadas, packSize);
  const packLabel = item.tipoEmpaque || 'empaque';
  if (packs > 0 && unidadesSueltas > 0) return `${packs} ${packLabel} + ${unidadesSueltas} unidades`;
  if (packs > 0) return `${packs} ${packLabel}`;
  return `${unidadesSueltas} unidades`;
}

function todayISODate() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

function normalizeButtonIdPart(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'sin-valor';
}

function ventasButtonId(...parts) {
  return ['nueva-venta', ...parts.map(normalizeButtonIdPart)].join('-');
}

function ventasFieldId(...parts) {
  return ['nueva-venta', ...parts.map(normalizeButtonIdPart)].join('-');
}

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTOS = ['00', '15', '30', '45'];

const NUEVO_CLIENTE_EMPTY = {
  nombre: '', rut: '', direccion: '', telefono: '', correo: '',
  tipo_documento: '', numero_documento: '',
  departamento_id: '', barrio_id: '', codigo_postal: '',
  horario_apertura: '', horario_cierre: '',
  tiene_reapertura: false, horario_reapertura: '', horario_cierre_reapertura: '',
};

function formatMedioPago(value) {
  const v = String(value || 'efectivo').toLowerCase();
  if (v === 'credito') return 'Crédito';
  if (v === 'debito') return 'Débito';
  if (v === 'transferencia') return 'Transferencia';
  return 'Efectivo';
}

const ProductoCatalogCard = memo(function ProductoCatalogCard({
  producto,
  vistaProductos,
  pickerModo,
  pickerCantidad,
  stockDisponible,
  unidadesEnCarrito,
  onSetPickerModo,
  onSetPickerCantidad,
  onAddToCart,
}) {
  const unidadesPorEmpaque = getEmpaqueUnits(producto);
  const precioEmpaque = roundMoney(producto.precioEmpaque);
  const enCarrito = unidadesEnCarrito > 0;
  const cardRef = useRef(null);
  const productoIdPart = normalizeButtonIdPart(producto.id ?? producto.ean ?? producto.nombre);

  const [inputCantidad, setInputCantidad] = useState(String(pickerCantidad));
  useEffect(() => {
    setInputCantidad(String(pickerCantidad));
  }, [pickerCantidad]);

  const handleCantidadBlur = () => {
    const parsed = Math.floor(toNumber(inputCantidad));
    if (!inputCantidad.trim() || parsed < 1) {
      setInputCantidad(String(pickerCantidad));
    } else {
      onSetPickerCantidad(producto.id, parsed);
      setInputCantidad(String(parsed));
    }
  };

  const handleAdd = () => {
    // Lanzar partícula desde el centro de la card hacia el carrito
    const card = cardRef.current;
    if (card) {
      const dot = document.createElement('span');
      dot.className = 'carrito-fly-dot';
      const rect = card.getBoundingClientRect();
      dot.style.left = `${rect.left + rect.width / 2}px`;
      dot.style.top = `${rect.top + rect.height / 2}px`;
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 700);
    }
    onAddToCart(producto, pickerModo, pickerCantidad);
  };

  return (
    <article
      ref={cardRef}
      className={`producto-card ${vistaProductos === 'list' ? 'list' : ''} ${enCarrito ? 'en-carrito' : ''}`}
    >
      {enCarrito && (
        <span key={unidadesEnCarrito} className="producto-carrito-badge">{unidadesEnCarrito}</span>
      )}
      <div className="producto-image-wrap">
        {producto.imagenPreview ? (
          <img src={producto.imagenPreview} alt={producto.nombre} className="producto-image" />
        ) : (
          <div className="producto-image placeholder">Sin imagen</div>
        )}
        <div className="overlay">
          <h4>{producto.nombre}</h4>
          <small className="overlay-code">Código: {producto.ean || '-'}</small>
          <span>{money(producto.venta)}</span>
        </div>
      </div>
      <div className="card-footer">
        <small>Stock disponible: {stockDisponible}</small>
        <div className="producto-pricing">
          <small>Unidad: {money(producto.venta)}</small>
          <small>{producto.tipoEmpaque || 'Empaque'}: {precioEmpaque > 0 ? money(precioEmpaque) : '-'}</small>
        </div>
        <div className="producto-picker">
          <div className="picker-mode">
            <button
              id={ventasButtonId('producto', productoIdPart, 'modo', 'unidad')}
              type="button"
              className={`picker-mode-btn ${pickerModo === 'unidad' ? 'active' : ''}`}
              onClick={() => onSetPickerModo(producto.id, 'unidad')}
            >
              Unidad
            </button>
            <button
              id={ventasButtonId('producto', productoIdPart, 'modo', 'empaque')}
              type="button"
              className={`picker-mode-btn ${pickerModo === 'empaque' ? 'active' : ''}`}
              onClick={() => onSetPickerModo(producto.id, 'empaque')}
            >
              {producto.tipoEmpaque || 'Empaque'} ({unidadesPorEmpaque}u)
            </button>
          </div>
          <div className="picker-qty">
            <button
              id={ventasButtonId('producto', productoIdPart, 'cantidad', 'restar')}
              type="button"
              className="picker-step"
              onClick={() => onSetPickerCantidad(producto.id, pickerCantidad - 1)}
            >
              -
            </button>
            <AppInput
              id={ventasFieldId('producto', productoIdPart, 'cantidad', 'input')}
              type="number"
              className="picker-qty-input"
              min="1"
              step="1"
              value={inputCantidad}
              onChange={(e) => setInputCantidad(e.target.value)}
              onBlur={handleCantidadBlur}
            />
            <button
              id={ventasButtonId('producto', productoIdPart, 'cantidad', 'sumar')}
              type="button"
              className="picker-step"
              onClick={() => onSetPickerCantidad(producto.id, pickerCantidad + 1)}
            >
              +
            </button>
          </div>
          <AppButton
            id={ventasButtonId('producto', productoIdPart, 'agregar')}
            type="button"
            className="picker-add-btn"
            onClick={handleAdd}
          >
            Agregar
          </AppButton>
        </div>
      </div>
    </article>
  );
});

function CartItemQtyInput({ itemId, displayValue, onCommit, fieldId }) {
  const [raw, setRaw] = useState(String(displayValue));
  useEffect(() => { setRaw(String(displayValue)); }, [displayValue]);
  const handleBlur = () => {
    const parsed = Math.floor(toNumber(raw));
    if (!raw.trim() || parsed < 1) {
      setRaw(String(displayValue));
    } else {
      onCommit(itemId, parsed);
      setRaw(String(parsed));
    }
  };
  return (
    <AppInput
      id={fieldId}
      type="number"
      min="1"
      step="1"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={handleBlur}
    />
  );
}

const DiscountModal = memo(function DiscountModal({
  open,
  title,
  description,
  initialTipo,
  initialValor,
  initialBase,
  showBase = false,
  onClose,
  onApply,
  idPrefix = ventasButtonId('descuento-modal'),
}) {
  const inputRef = useRef(null);
  const [draftTipo, setDraftTipo] = useState(initialTipo === 'porcentaje' ? 'porcentaje' : 'fijo');
  const [draftValor, setDraftValor] = useState(initialValor || '');
  const [draftBase, setDraftBase] = useState(initialBase === 'total' ? 'total' : 'unidad');

  useEffect(() => {
    if (!open) return undefined;
    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [open]);

  const handleApply = useCallback(() => {
    onApply({ tipo: draftTipo, valor: draftValor, base: draftBase });
  }, [draftTipo, draftValor, draftBase, onApply]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleApply();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }, [handleApply, onClose]);

  if (!open) return null;

  return (
    <div className="descuento-modal-overlay" aria-hidden="false">
      <div className="descuento-modal-backdrop" onClick={onClose} />
      <div className="descuento-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h4>{title}</h4>
        <p>{description}</p>
        <div className="descuento-modal-tipos">
          <AppButton
            id={`${idPrefix}-tipo-porcentaje`}
            type="button"
            className={draftTipo === 'porcentaje' ? 'active' : ''}
            onClick={() => setDraftTipo('porcentaje')}
          >
            Porcentual (%)
          </AppButton>
          <AppButton
            id={`${idPrefix}-tipo-fijo`}
            type="button"
            className={draftTipo === 'fijo' ? 'active' : ''}
            onClick={() => setDraftTipo('fijo')}
          >
            Fijo ($)
          </AppButton>
        </div>
        <AppInput
          id={`${idPrefix}-valor`}
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={draftValor}
          onChange={(event) => setDraftValor(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={draftTipo === 'porcentaje' ? 'Ej: 10' : 'Ej: 500'}
        />
        {showBase && (
          <div className="descuento-modal-base-checks">
            <label className="descuento-modal-base-check-row">
              <AppInput
                id={`${idPrefix}-base-unidad`}
                type="checkbox"
                checked={draftBase === 'unidad'}
                onChange={() => setDraftBase('unidad')}
              />
              <span>Aplicar x Unidad</span>
            </label>
            <label className="descuento-modal-base-check-row">
              <AppInput
                id={`${idPrefix}-base-total`}
                type="checkbox"
                checked={draftBase === 'total'}
                onChange={() => setDraftBase('total')}
              />
              <span>Aplicar al Total</span>
            </label>
          </div>
        )}
        <div className="descuento-modal-actions">
          <AppButton id={`${idPrefix}-cancelar`} type="button" className="secundario" onClick={onClose}>
            Cancelar
          </AppButton>
          <AppButton id={`${idPrefix}-aplicar`} type="button" onClick={handleApply}>
            Aplicar
          </AppButton>
        </div>
      </div>
    </div>
  );
});

export default function Ventas({
  user,
  productos = [],
  setProductos,
  carritoDrawerOpen = false,
  onCloseCarritoDrawer,
  onCarritoCountChange,
}) {
  const { empresa } = useConfig();
  const cfeHabilitado = empresa?.cfe_habilitado === true;
  const [paso, setPaso] = useState(1);
  const [busqueda, setBusqueda] = useState('');
  const [vistaProductos, setVistaProductos] = useState('grid');
  const [selectorClienteAbierto, setSelectorClienteAbierto] = useState(false);
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [nuevoClienteModalOpen, setNuevoClienteModalOpen] = useState(false);
  const [nuevoClienteForm, setNuevoClienteForm] = useState(NUEVO_CLIENTE_EMPTY);
  const [nuevoClienteSaving, setNuevoClienteSaving] = useState(false);
  const [departamentosCliente, setDepartamentosCliente] = useState([]);
  const [barriosCliente, setBarriosCliente] = useState([]);
  const [ubicacionesCargadas, setUbicacionesCargadas] = useState(false);
  const [productPicker, setProductPicker] = useState({});

  const [carrito, setCarrito] = useState([]);
  const [descuentoItemModal, setDescuentoItemModal] = useState({
    open: false,
    itemId: null,
    parte: 'sueltas',
    tipo: 'fijo',
    valor: '',
    base: 'unidad',
  });
  const [descuentoTotalTipo, setDescuentoTotalTipo] = useState('ninguno');
  const [descuentoTotalValor, setDescuentoTotalValor] = useState('');
  const [descuentoGlobalModal, setDescuentoGlobalModal] = useState({
    open: false,
    tipo: 'porcentaje',
    valor: '',
  });
  const [carritoResumenAbierto, setCarritoResumenAbierto] = useState(false);

  const [clienteId, setClienteId] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [pagos, setPagos] = useState([
    { medio_pago: 'efectivo', activo: true, monto: '' },
    { medio_pago: 'debito', activo: false, monto: '' },
    { medio_pago: 'credito', activo: false, monto: '' },
    { medio_pago: 'transferencia', activo: false, monto: '' },
  ]);
  const [observacion, setObservacion] = useState('');
  const [ventaFinalizada, setVentaFinalizada] = useState(null);
  const [ticketImpreso, setTicketImpreso] = useState(false);
  const [cfeLoading, setCfeLoading] = useState(false);
  const [submittingVenta, setSubmittingVenta] = useState(false);
  const submittingVentaRef = useRef(false);
  const [clientes, setClientes] = useState([]);
  const [carritoRestaurado, setCarritoRestaurado] = useState(false);
  const [flashIds, setFlashIds] = useState(new Set());
  const clienteDropdownRef = useRef(null);
  // Flag para evitar que el save sobreescriba el storage antes del primer restore
  const carritoRestoreAttempted = useRef(false);

  // Clave única por empresa+usuario para aislamiento multitenancy y multiusuario
  const carritoKey = empresa?.id && user?.id
    ? `mercatus_carrito_${empresa.id}_${user.id}`
    : null;

  // Persistir carrito en localStorage al cambiar state relevante
  useEffect(() => {
    if (!carritoKey) return;
    // No persistir hasta que se haya intentado el restore (evita borrar datos guardados en el mount inicial)
    if (!carritoRestoreAttempted.current) return;
    // No persistir si hay una venta finalizada (carrito vacío post-confirmación)
    if (ventaFinalizada) return;
    const snapshot = {
      carrito,
      clienteId,
      fechaEntrega,
      pagos,
      observacion,
      descuentoTotalTipo,
      descuentoTotalValor,
    };
    // Solo guardar si hay algo en el carrito
    if (carrito.length > 0 || clienteId || fechaEntrega || observacion) {
      localStorage.setItem(carritoKey, JSON.stringify(snapshot));
    } else {
      localStorage.removeItem(carritoKey);
    }
  }, [carritoKey, carrito, clienteId, fechaEntrega, pagos, observacion, descuentoTotalTipo, descuentoTotalValor, ventaFinalizada]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!selectorClienteAbierto) return;
      if (!clienteDropdownRef.current) return;
      if (!clienteDropdownRef.current.contains(event.target)) {
        setSelectorClienteAbierto(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [selectorClienteAbierto]);

  useEffect(() => {
    const loadClientes = async () => {
      try {
        const rows = await api.getClientes();
        setClientes(rows.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          telefono: c.telefono || '',
          direccion: c.direccion || '',
          horario_apertura: c.horario_apertura || '',
          horario_cierre: c.horario_cierre || '',
          tiene_reapertura: Boolean(c.tiene_reapertura),
          horario_reapertura: c.horario_reapertura || '',
          horario_cierre_reapertura: c.horario_cierre_reapertura || '',
        })));
      } catch (error) {
        console.error('Error cargando clientes', error);
      }
    };
    loadClientes();
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem('mercatus_replicar_venta');
    if (!raw) return;
    let venta = null;
    try {
      venta = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem('mercatus_replicar_venta');
      return;
    }
    if (!venta || typeof venta !== 'object') {
      sessionStorage.removeItem('mercatus_replicar_venta');
      return;
    }

    const detalle = Array.isArray(venta.detalle) ? venta.detalle : [];
    const itemsReplicados = detalle
      .map((item, idx) => {
        const productoId = Number(item.producto_id);
        if (!Number.isFinite(productoId) || productoId <= 0) return null;
        const producto = productos.find((p) => Number(p.id) === productoId);
        const unidadesPorEmpaque = getEmpaqueUnits(producto);
        const cantidad = Math.max(1, Math.floor(toNumber(item.cantidad)));
        return {
          id: Date.now() + Math.random() + idx,
          productoId,
          nombre: producto?.nombre || item.producto_nombre || `Producto #${productoId}`,
          unidadesSolicitadas: cantidad,
          precioUnidad: roundMoney(producto?.venta ?? item.precio_unitario),
          precioEmpaque: roundMoney(producto?.precioEmpaque ?? 0),
          unidadesPorEmpaque,
          tipoEmpaque: String(producto?.tipoEmpaque || 'empaque').trim() || 'empaque',
          modoVenta: unidadesPorEmpaque > 1 && cantidad % unidadesPorEmpaque === 0 ? 'empaque' : 'unidad',
          descuentoTipo: 'ninguno',
          descuentoValor: '',
          descuentoPacksTipo: 'ninguno',
          descuentoPacksValor: '',
        };
      })
      .filter(Boolean);

    const pagosVenta = Array.isArray(venta.pagos) ? venta.pagos : [];
    const pagosReplicados = MEDIOS_PAGO.map((medio) => {
      const pago = pagosVenta.find((p) => p?.medio_pago === medio.key);
      return {
        medio_pago: medio.key,
        activo: Boolean(pago),
        monto: pago ? String(roundMoney(pago.monto)) : '',
      };
    });
    queueMicrotask(() => {
      if (itemsReplicados.length > 0) {
        setCarrito(itemsReplicados);
      }
      setClienteId(venta.cliente_id ? String(venta.cliente_id) : '');
      setFechaEntrega(venta.fecha_entrega ? String(venta.fecha_entrega).slice(0, 10) : '');
      setObservacion(venta.observacion || '');
      setDescuentoTotalTipo(
        venta.descuento_total_tipo === 'porcentaje' || venta.descuento_total_tipo === 'fijo'
          ? venta.descuento_total_tipo
          : 'ninguno'
      );
      setDescuentoTotalValor(
        venta.descuento_total_tipo === 'porcentaje' || venta.descuento_total_tipo === 'fijo'
          ? String(roundMoney(venta.descuento_total_valor))
          : ''
      );
      setPagos(
        pagosReplicados.some((p) => p.activo)
          ? pagosReplicados
          : [
            { medio_pago: 'efectivo', activo: true, monto: '' },
            { medio_pago: 'debito', activo: false, monto: '' },
            { medio_pago: 'credito', activo: false, monto: '' },
            { medio_pago: 'transferencia', activo: false, monto: '' },
          ]
      );
      setPaso(1);
      setVentaFinalizada(null);
      setTicketImpreso(false);
      setSelectorClienteAbierto(false);
      setBusquedaCliente('');
    });
    sessionStorage.removeItem('mercatus_replicar_venta');
  }, [productos]);

  // Restaurar carrito guardado (solo si no hay replicar_venta y carritoKey disponible)
  useEffect(() => {
    if (!carritoKey) return;
    // Marcar que el restore fue intentado (habilita el save useEffect)
    carritoRestoreAttempted.current = true;
    // Si hay una replicación pendiente, no restaurar (el otro useEffect lo maneja)
    if (sessionStorage.getItem('mercatus_replicar_venta')) return;
    const raw = localStorage.getItem(carritoKey);
    if (!raw) return;
    let snapshot = null;
    try { snapshot = JSON.parse(raw); } catch { return; }
    if (!snapshot || !Array.isArray(snapshot.carrito) || snapshot.carrito.length === 0) return;

    queueMicrotask(() => {
      setCarrito(snapshot.carrito);
      if (snapshot.clienteId) setClienteId(snapshot.clienteId);
      if (snapshot.fechaEntrega) setFechaEntrega(snapshot.fechaEntrega);
      if (snapshot.observacion) setObservacion(snapshot.observacion);
      if (snapshot.descuentoTotalTipo) setDescuentoTotalTipo(snapshot.descuentoTotalTipo);
      if (snapshot.descuentoTotalValor) setDescuentoTotalValor(snapshot.descuentoTotalValor);
      if (Array.isArray(snapshot.pagos)) setPagos(snapshot.pagos);
      setPaso(1); // siempre volver al paso 1 al restaurar
      setCarritoRestaurado(true);
    });
  }, [carritoKey]); // solo al montar (carritoKey es estable)

  const busquedaDeferred = useDeferredValue(busqueda);
  const busquedaClienteDeferred = useDeferredValue(busquedaCliente);

  const productosFiltrados = useMemo(() => {
    const q = busquedaDeferred.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) =>
      `${p.nombre || ''} ${p.ean || ''}`.toLowerCase().includes(q)
    );
  }, [productos, busquedaDeferred]);

  const clientesFiltrados = useMemo(() => {
    const q = busquedaClienteDeferred.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [busquedaClienteDeferred, clientes]);

  const abrirNuevoClienteModal = async () => {
    setNuevoClienteForm(NUEVO_CLIENTE_EMPTY);
    setNuevoClienteModalOpen(true);
    setBusquedaCliente('');
    if (!ubicacionesCargadas) {
      try {
        const [deps, barrios] = await Promise.all([api.getDepartamentos(), api.getBarrios()]);
        setDepartamentosCliente(deps);
        setBarriosCliente(barrios);
        setUbicacionesCargadas(true);
      } catch { /* silencioso — los selects quedarán vacíos */ }
    }
  };

  const setNuevoClienteHorarioPart = (field, part, value) => {
    setNuevoClienteForm((prev) => {
      const current = splitHora(prev[field]);
      const next = part === 'h' ? { ...current, h: value } : { ...current, m: value };
      return { ...prev, [field]: `${next.h}:${next.m}` };
    });
  };

  const handleNuevoClienteReaperturaChange = (checked) => {
    setNuevoClienteForm((prev) => ({
      ...prev,
      tiene_reapertura: checked,
      horario_reapertura: checked ? prev.horario_reapertura : '',
      horario_cierre_reapertura: checked ? prev.horario_cierre_reapertura : '',
    }));
  };

  const handleCrearCliente = async (e) => {
    e.preventDefault();
    const nombre = nuevoClienteForm.nombre.trim();
    if (!nombre) return;

    const payload = {
      nombre,
      rut: nuevoClienteForm.numero_documento.trim() || null,
      telefono: nuevoClienteForm.telefono.trim() || null,
      correo: nuevoClienteForm.correo.trim() || null,
      direccion: nuevoClienteForm.direccion.trim() || null,
      tipo_documento: nuevoClienteForm.tipo_documento || null,
      numero_documento: nuevoClienteForm.numero_documento.trim() || null,
      departamento_id: nuevoClienteForm.departamento_id ? Number(nuevoClienteForm.departamento_id) : null,
      barrio_id: nuevoClienteForm.barrio_id ? Number(nuevoClienteForm.barrio_id) : null,
      codigo_postal: nuevoClienteForm.codigo_postal.trim() || null,
      horario_apertura: normalizeHoraForSave(nuevoClienteForm.horario_apertura),
      horario_cierre: normalizeHoraForSave(nuevoClienteForm.horario_cierre),
      tiene_reapertura: Boolean(nuevoClienteForm.tiene_reapertura),
      horario_reapertura: nuevoClienteForm.tiene_reapertura ? normalizeHoraForSave(nuevoClienteForm.horario_reapertura) : null,
      horario_cierre_reapertura: nuevoClienteForm.tiene_reapertura ? normalizeHoraForSave(nuevoClienteForm.horario_cierre_reapertura) : null,
    };

    const camposHorarioVenta = [
      [nuevoClienteForm.horario_apertura, 'apertura'],
      [nuevoClienteForm.horario_cierre, 'cierre'],
      ...(nuevoClienteForm.tiene_reapertura ? [
        [nuevoClienteForm.horario_reapertura, 'reapertura'],
        [nuevoClienteForm.horario_cierre_reapertura, 'cierre de reapertura'],
      ] : []),
    ];
    for (const [rawVal, label] of camposHorarioVenta) {
      if (horaConHoraVacia(rawVal)) {
        await appAlert(`Debes completar la hora de ${label}.`);
        return;
      }
    }
    if (Boolean(payload.horario_apertura) !== Boolean(payload.horario_cierre)) {
      await appAlert('Debes completar tanto el horario de apertura como el de cierre, o dejar ambos vacíos.');
      return;
    }
    if (payload.tiene_reapertura && (!payload.horario_apertura || !payload.horario_cierre)) {
      await appAlert('Si el cliente tiene reapertura, completá también apertura y cierre principal.');
      return;
    }
    if (payload.tiene_reapertura && (!payload.horario_reapertura || !payload.horario_cierre_reapertura)) {
      await appAlert('Debés completar ambos horarios de reapertura.');
      return;
    }

    setNuevoClienteSaving(true);
    try {
      let created;
      try {
        created = await api.createCliente(payload);
      } catch (createErr) {
        if (createErr.status === 409 && createErr.data?.cliente) {
          const { id: clienteEliminadoId, nombre: clienteEliminadoNombre } = createErr.data.cliente;
          const ok = await appConfirm(
            `El cliente "${clienteEliminadoNombre}" ya está registrado con ese documento pero fue eliminado. ¿Querés restaurarlo?`,
            { title: 'Cliente eliminado encontrado', confirmText: 'Restaurar', cancelText: 'Cancelar' }
          );
          if (!ok) { setNuevoClienteSaving(false); return; }
          created = await api.restaurarCliente(clienteEliminadoId);
        } else {
          throw createErr;
        }
      }
      const cliente = { id: created.id, nombre: created.nombre, telefono: created.telefono || '', direccion: created.direccion || '' };
      setClientes((prev) => [cliente, ...prev]);
      setClienteId(String(created.id));
      setNuevoClienteModalOpen(false);
      setNuevoClienteForm(NUEVO_CLIENTE_EMPTY);
      setSelectorClienteAbierto(false);
      setBusquedaCliente('');
    } catch (err) {
      await appAlert(err.message || 'No se pudo crear el cliente');
    } finally {
      setNuevoClienteSaving(false);
    }
  };

  const stockReservadoPorProducto = useMemo(() => {
    return carrito.reduce((acc, item) => {
      acc[item.productoId] = (acc[item.productoId] || 0) + toNumber(item.unidadesSolicitadas);
      return acc;
    }, {});
  }, [carrito]);

  const stockBasePorProducto = useMemo(() => {
    return productos.reduce((acc, producto) => {
      acc[producto.id] = Math.floor(toNumber(producto.stock || 0));
      return acc;
    }, {});
  }, [productos]);

  const stockRestantePorProducto = useMemo(() => {
    const remaining = {};
    Object.keys(stockBasePorProducto).forEach((productoId) => {
      const base = Math.floor(toNumber(stockBasePorProducto[productoId]));
      const reservado = Math.floor(toNumber(stockReservadoPorProducto[productoId] || 0));
      remaining[productoId] = base - reservado;
    });
    return remaining;
  }, [stockBasePorProducto, stockReservadoPorProducto]);

  const setPickerModo = useCallback((productoId, modo) => {
    setProductPicker((prev) => {
      const current = prev[productoId] || { modo: 'unidad', cantidad: 1 };
      return {
        ...prev,
        [productoId]: { ...current, modo: modo === 'empaque' ? 'empaque' : 'unidad' },
      };
    });
  }, []);

  const setPickerCantidad = useCallback((productoId, cantidad) => {
    const next = Math.max(1, Math.floor(toNumber(cantidad || 1)));
    setProductPicker((prev) => {
      const current = prev[productoId] || { modo: 'unidad', cantidad: 1 };
      return {
        ...prev,
        [productoId]: { ...current, cantidad: next },
      };
    });
  }, []);

  const addToCartFromPicker = useCallback((producto, pickerModo, pickerCantidad) => {
    const modo = pickerModo === 'empaque' ? 'empaque' : 'unidad';
    const cantidad = Math.max(1, Math.floor(toNumber(pickerCantidad || 1)));
    const unidadesPorEmpaque = getEmpaqueUnits(producto);
    const multiplicador = modo === 'empaque' ? unidadesPorEmpaque : 1;
    const unidadesAgregar = cantidad * multiplicador;
    const precioUnidad = roundMoney(producto.venta);
    const precioEmpaque = roundMoney(producto.precioEmpaque);
    const tipoEmpaque = String(producto.tipoEmpaque || 'empaque').trim() || 'empaque';
    const modoVenta = modo;

    let newId = null;
    setCarrito((prev) => {
      const itemExistente = prev.find((i) => i.productoId === producto.id && i.modoVenta === modoVenta);
      if (itemExistente) {
        newId = itemExistente.id;
        return prev.map((item) =>
          item.id === itemExistente.id
            ? {
              ...item,
              unidadesSolicitadas: toNumber(item.unidadesSolicitadas) + unidadesAgregar,
              precioUnidad,
              precioEmpaque,
              unidadesPorEmpaque,
              tipoEmpaque,
              modoVenta,
              ean: producto.ean || item.ean || '',
            }
            : item
        );
      }

      newId = Date.now() + Math.random();
      return [
        ...prev,
        {
          id: newId,
          productoId: producto.id,
          nombre: producto.nombre,
          ean: producto.ean || '',
          unidadesSolicitadas: unidadesAgregar,
          precioUnidad,
          precioEmpaque,
          unidadesPorEmpaque,
          tipoEmpaque,
          modoVenta,
          descuentoTipo: 'ninguno',
          descuentoValor: '',
          descuentoPacksTipo: 'ninguno',
          descuentoPacksValor: '',
        },
      ];
    });

    // Flash visual breve en el ítem agregado/actualizado
    if (newId !== null) {
      setFlashIds((prev) => new Set([...prev, newId]));
      setTimeout(() => {
        setFlashIds((prev) => {
          const next = new Set(prev);
          next.delete(newId);
          return next;
        });
      }, 600);
    }
  }, []);

  const catalogoCards = useMemo(() => {
    if (productosFiltrados.length === 0) return null;

    // Suma total de unidades por productoId en carrito
    const unidadesPorProducto = carrito.reduce((acc, item) => {
      acc[item.productoId] = (acc[item.productoId] || 0) + toNumber(item.unidadesSolicitadas);
      return acc;
    }, {});

    return productosFiltrados.map((producto) => {
      const saved = productPicker[producto.id];
      const pickerModo = saved?.modo === 'empaque' ? 'empaque' : 'unidad';
      const pickerCantidad = Math.max(1, Math.floor(toNumber(saved?.cantidad || 1)));
      const stockDisponible = Math.floor(toNumber(stockRestantePorProducto[producto.id] || 0));

      return (
        <ProductoCatalogCard
          key={producto.id}
          producto={producto}
          vistaProductos={vistaProductos}
          pickerModo={pickerModo}
          pickerCantidad={pickerCantidad}
          stockDisponible={stockDisponible}
          unidadesEnCarrito={unidadesPorProducto[producto.id] || 0}
          onSetPickerModo={setPickerModo}
          onSetPickerCantidad={setPickerCantidad}
          onAddToCart={addToCartFromPicker}
        />
      );
    });
  }, [
    addToCartFromPicker,
    carrito,
    productosFiltrados,
    productPicker,
    setPickerCantidad,
    setPickerModo,
    stockRestantePorProducto,
    vistaProductos,
  ]);

  const removeItem = (itemId) => {
    setCarrito((prev) => prev.filter((i) => i.id !== itemId));
    setDescuentoItemModal((prev) =>
      prev.itemId === itemId ? { open: false, itemId: null, tipo: 'porcentaje', valor: '' } : prev
    );
  };

  const updateItem = (itemId, patch) => {
    setCarrito((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  };

  const updateUnits = (itemId, nextValue) => {
    const item = carrito.find((i) => i.id === itemId);
    if (!item) return;
    const packSize = Math.max(1, Math.floor(toNumber(item.unidadesPorEmpaque)));
    const ingreso = Math.max(1, Math.floor(toNumber(nextValue)));
    const unidades = item.modoVenta === 'empaque' ? ingreso * packSize : ingreso;
    if (unidades <= 0) {
      return;
    }
    updateItem(itemId, { unidadesSolicitadas: unidades });
  };

  const openDiscountModal = (item, parte = 'sueltas') => {
    const esPacks = parte === 'packs';
    setDescuentoItemModal({
      open: true,
      itemId: item.id,
      parte,
      tipo: esPacks
        ? (item.descuentoPacksTipo === 'porcentaje' ? 'porcentaje' : 'fijo')
        : (item.descuentoTipo === 'porcentaje' ? 'porcentaje' : 'fijo'),
      valor: esPacks ? (item.descuentoPacksValor || '') : (item.descuentoValor || ''),
      base: esPacks ? (item.descuentoPacksBase || 'unidad') : (item.descuentoBase || 'unidad'),
    });
  };

  const closeDiscountModal = () => {
    setDescuentoItemModal({ open: false, itemId: null, parte: 'sueltas', tipo: 'fijo', valor: '', base: 'unidad' });
  };

  const applyItemDiscount = ({ tipo, valor, base } = descuentoItemModal) => {
    if (!descuentoItemModal.itemId) return;
    const valorNormalizado = normalizeDiscountValue(valor);
    if (descuentoItemModal.parte === 'packs') {
      updateItem(descuentoItemModal.itemId, {
        descuentoPacksTipo: tipo,
        descuentoPacksValor: valorNormalizado,
        descuentoPacksBase: base || 'total',
      });
    } else {
      updateItem(descuentoItemModal.itemId, {
        descuentoTipo: tipo,
        descuentoValor: valorNormalizado,
        descuentoBase: base || 'total',
      });
    }
    closeDiscountModal();
  };

  const removeItemDiscount = (itemId, parte = 'sueltas') => {
    if (parte === 'packs') {
      updateItem(itemId, { descuentoPacksTipo: 'ninguno', descuentoPacksValor: '', descuentoPacksBase: 'total' });
    } else {
      updateItem(itemId, { descuentoTipo: 'ninguno', descuentoValor: '', descuentoBase: 'total' });
    }
  };

  const openGlobalDiscountModal = () => {
    setDescuentoGlobalModal({
      open: true,
      tipo: descuentoTotalTipo === 'fijo' ? 'fijo' : 'porcentaje',
      valor: descuentoTotalValor || '',
    });
  };

  const closeGlobalDiscountModal = () => {
    setDescuentoGlobalModal({ open: false, tipo: 'porcentaje', valor: '' });
  };

  const applyGlobalDiscount = ({ tipo, valor } = descuentoGlobalModal) => {
    setDescuentoTotalTipo(tipo);
    setDescuentoTotalValor(normalizeDiscountValue(valor));
    closeGlobalDiscountModal();
  };

  const removeGlobalDiscount = () => {
    setDescuentoTotalTipo('ninguno');
    setDescuentoTotalValor('');
    closeGlobalDiscountModal();
  };

  const carritoCalculado = useMemo(() => {
    return carrito.map((item) => {
      const unidades = Math.max(0, Math.floor(toNumber(item.unidadesSolicitadas)));
      const packSize = Math.max(1, Math.floor(toNumber(item.unidadesPorEmpaque)));
      const precioUnidad = roundMoney(item.precioUnidad);
      const precioEmpaque = roundMoney(item.precioEmpaque);
      const puedeEmpaque = packSize > 1 && precioEmpaque > 0;
      const split = puedeEmpaque
        ? splitByEmpaque(unidades, packSize)
        : { packs: 0, unidadesSueltas: unidades };

      const montoPacks = puedeEmpaque ? roundMoney(split.packs * precioEmpaque) : 0;
      const montoSueltas = roundMoney(split.unidadesSueltas * precioUnidad);
      const base = roundMoney(montoPacks + montoSueltas);

      // Descuento sobre sueltas (o sobre la base completa si no hay split de packs)
      const valorSueltas = toNumber(item.descuentoValor);
      const baseSueltas = puedeEmpaque && split.packs > 0 ? montoSueltas : base;
      let descSueltas = 0;
      if (item.descuentoTipo === 'porcentaje') {
        descSueltas = (baseSueltas * Math.max(0, Math.min(100, valorSueltas))) / 100;
      } else if (item.descuentoTipo === 'fijo') {
        if (item.descuentoBase === 'unidad') {
          descSueltas = Math.max(0, Math.min(baseSueltas, roundMoney(valorSueltas * split.unidadesSueltas)));
        } else {
          descSueltas = Math.max(0, Math.min(baseSueltas, roundMoney(valorSueltas)));
        }
      }

      // Descuento sobre packs (solo si hay packs)
      let descPacks = 0;
      if (split.packs > 0) {
        const valorPacks = toNumber(item.descuentoPacksValor);
        if (item.descuentoPacksTipo === 'porcentaje') {
          descPacks = (montoPacks * Math.max(0, Math.min(100, valorPacks))) / 100;
        } else if (item.descuentoPacksTipo === 'fijo') {
          if (item.descuentoPacksBase === 'unidad') {
            const totalUnidadesEnPacks = split.packs * packSize;
            descPacks = Math.max(0, Math.min(montoPacks, roundMoney(valorPacks * totalUnidadesEnPacks)));
          } else {
            descPacks = Math.max(0, Math.min(montoPacks, roundMoney(valorPacks)));
          }
        }
      }

      const descuentoPacksAplicado = roundMoney(descPacks);
      const descuentoSueltasAplicado = roundMoney(descSueltas);
      const descuentoAplicado = roundMoney(descuentoPacksAplicado + descuentoSueltasAplicado);

      return {
        ...item,
        subtotalBase: base,
        packsCalculados: split.packs,
        unidadesSueltasCalculadas: split.unidadesSueltas,
        precioUnitarioCalculado: unidades > 0 ? (base / unidades) : 0,
        descuentoPacksAplicado,
        descuentoSueltasAplicado,
        descuentoAplicado,
      };
    });
  }, [carrito]);

  const descuentoItemsTotal = useMemo(
    () => roundMoney(carritoCalculado.reduce((acc, i) => acc + toNumber(i.descuentoAplicado), 0)),
    [carritoCalculado]
  );

  const subtotal = useMemo(
    () => roundMoney(carritoCalculado.reduce((acc, i) => acc + toNumber(i.subtotalBase), 0)),
    [carritoCalculado]
  );

  const baseParaDescuentoGlobal = Math.max(0, subtotal - descuentoItemsTotal);

  const descuentoGlobal = useMemo(() => {
    const v = toNumber(descuentoTotalValor);
    if (descuentoTotalTipo === 'porcentaje') {
      const pct = Math.max(0, Math.min(100, v));
      return roundMoney((baseParaDescuentoGlobal * pct) / 100);
    }
    if (descuentoTotalTipo === 'fijo') {
      const fijo = roundMoney(v);
      return Math.max(0, Math.min(baseParaDescuentoGlobal, fijo));
    }
    return 0;
  }, [descuentoTotalTipo, descuentoTotalValor, baseParaDescuentoGlobal]);

  const descuentoTotalAplicado = roundMoney(Math.max(0, descuentoItemsTotal + descuentoGlobal));
  const total = roundMoney(Math.max(0, subtotal - descuentoTotalAplicado));
  const totalUnidadesCarrito = useMemo(
    () => carritoCalculado.reduce((acc, item) => acc + toNumber(item.unidadesSolicitadas), 0),
    [carritoCalculado]
  );

  useEffect(() => {
    if (typeof onCarritoCountChange === 'function') {
      onCarritoCountChange(totalUnidadesCarrito);
    }
  }, [onCarritoCountChange, totalUnidadesCarrito]);

  // Dispara confetti cuando se confirma una venta
  useEffect(() => {
    if (ventaFinalizada) {
      fireConfetti();
    }
  }, [ventaFinalizada]);
  const clienteSeleccionado = clientes.find((c) => String(c.id) === String(clienteId));
  const pagosActivos = useMemo(
    () => pagos.filter((p) => p.activo),
    [pagos]
  );
  const esPagoUnico = pagosActivos.length === 1;
  const pagosConMonto = useMemo(
    () => {
      if (pagosActivos.length === 1) {
        return [{ ...pagosActivos[0], montoNumber: total }];
      }
      return pagosActivos
        .map((p) => ({ ...p, montoNumber: roundMoney(p.monto) }))
        .filter((p) => p.montoNumber > 0);
    },
    [pagosActivos, total]
  );
  const totalPagos = useMemo(
    () => roundMoney(pagosConMonto.reduce((acc, p) => acc + p.montoNumber, 0)),
    [pagosConMonto]
  );

  const goNext = () => {
    setPaso(2);
    closeCarritoDrawer();
  };

  const goBack = () => {
    setPaso(1);
    closeCarritoDrawer();
  };

  const resetVenta = () => {
    if (carritoKey) localStorage.removeItem(carritoKey);
    setPaso(1);
    setBusqueda('');
    setCarrito([]);
    setCarritoResumenAbierto(false);
    setSelectorClienteAbierto(false);
    setBusquedaCliente('');
    setProductPicker({});
    setDescuentoTotalTipo('ninguno');
    setDescuentoTotalValor('');
    setClienteId('');
    setFechaEntrega('');
    setPagos([
      { medio_pago: 'efectivo', activo: true, monto: '' },
      { medio_pago: 'debito', activo: false, monto: '' },
      { medio_pago: 'credito', activo: false, monto: '' },
      { medio_pago: 'transferencia', activo: false, monto: '' },
    ]);
    setObservacion('');
  };

  const buildTicketPdf = async () => {
    if (!ventaFinalizada) return null;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 14;

    // ── Layout: logo box (izquierda) + dos columnas de info (derecha) ──
    const headerY = 10;
    const titleH = 13;   // más espacio para el título + margen inferior
    const lineH = 5;     // altura fila datos
    const dataRows = 4;  // Fecha / Nro ticket / Vendedor+Fecha entrega / (cliente cols)
    const headerHeight = titleH + dataRows * lineH + 2;

    const logoBoxSize = headerHeight;           // cuadrado del logo = alto del bloque
    const logoX = marginX;
    const infoX = marginX + logoBoxSize + 5;    // info comienza tras el logo + gap
    const infoWidth = pageWidth - infoX - marginX;
    const col1X = infoX;
    const col2X = infoX + infoWidth / 2;
    const colMaxW = infoWidth / 2 - 2;

    // ── Logo (contain dentro del cuadrado, sin distorsión) ──
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

    // ── Título ──
    doc.setFontSize(13);
    doc.text('Ticket de Venta', col1X, headerY + 9);

    // ── Filas de info: col izquierda (ticket) | col derecha (cliente) ──
    doc.setFontSize(9.5);
    let infoY = headerY + titleH;
    const infoRows = [
      [
        `Fecha Emisión: ${new Date(ventaFinalizada.fecha).toLocaleString('es-UY')}`,
        `Cliente: ${ventaFinalizada.clienteNombre || '-'}`,
      ],
      [
        `Nro. ticket: ${ventaFinalizada.id ? `#${ventaFinalizada.id}` : 'Sin número'}`,
        `Teléfono: ${ventaFinalizada.clienteTelefono || '-'}`,
      ],
      [
        `Vendedor: ${ventaFinalizada.vendedorNombre || '-'}`,
        `Dirección: ${ventaFinalizada.clienteDireccion || '-'}`,
      ],
      [
        `Fecha entrega: ${(() => { const iso = String(ventaFinalizada.fechaEntrega || '').slice(0, 10); const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-UY'); })()}`,
        `Horarios: ${ventaFinalizada.clienteHorarios || '-'}`,
      ],
    ];
    infoRows.forEach(([left, right]) => {
      doc.text(left, col1X, infoY, { maxWidth: colMaxW });
      doc.text(right, col2X, infoY, { maxWidth: colMaxW });
      infoY += lineH;
    });

    let cursorY = headerY + headerHeight + 5;

    autoTable(doc, {
      startY: cursorY,
      head: [['Producto', 'Cant.', 'Presentación', 'P. Unit.', 'Desc.', 'Subtotal']],
      body: ventaFinalizada.items.map((item) => [
        item.nombre,
        item.unidadesSolicitadas,
        formatEmpaqueSplit(item),
        money(item.precioUnitarioCalculado),
        money(item.descuentoAplicado),
        money(roundMoney(item.subtotalBase - item.descuentoAplicado)),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: getPrimaryRgb() },
    });

    const finalY = doc.lastAutoTable?.finalY ?? cursorY + 8;
    const totalsRightX = pageWidth - 14;
    const pagosLabelX = pageWidth - 52;
    const pagosValueX = pageWidth - 14;
    let totalsY = finalY + 8;
    doc.setFontSize(10);
    doc.text(`Subtotal: ${money(ventaFinalizada.subtotal)}`, totalsRightX, totalsY, { align: 'right' });
    totalsY += 5;
    doc.text(`Descuentos: -${money(ventaFinalizada.descuentoGlobal)}`, totalsRightX, totalsY, { align: 'right' });
    totalsY += 5;
    doc.setFontSize(12);
    doc.text(`Total: ${money(ventaFinalizada.total)}`, totalsRightX, totalsY, { align: 'right' });
    totalsY += 6;
    doc.setFontSize(10);
    doc.text('Pagos:', totalsRightX, totalsY, { align: 'right' });
    totalsY += 4;
    (ventaFinalizada.pagos || []).forEach((pago) => {
      doc.text(`- ${formatMedioPago(pago.medio_pago)}:`, pagosLabelX, totalsY, { align: 'right' });
      doc.text(`${money(pago.monto)}`, pagosValueX, totalsY, { align: 'right' });
      totalsY += 4;
    });

    if (ventaFinalizada.observacion) {
      doc.setFontSize(9);
      doc.text(`Observación: ${ventaFinalizada.observacion}`, 14, totalsY + 2);
    }

    const fileName = `ticket-venta-${ventaFinalizada.id || Date.now()}.pdf`;
    return { doc, fileName };
  };

  const imprimirTicket = async () => {
    const data = await buildTicketPdf();
    if (!data) return;
    const blob = data.doc.output('blob');
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
    setTicketImpreso(true);
  };

  const descargarTicketPdf = async () => {
    const data = await buildTicketPdf();
    if (!data) return;
    data.doc.save(data.fileName);
    setTicketImpreso(true);
  };

  const descargarCfeAnotado = async (ventaId) => {
    const text = await api.getVentaCFEAnnotated(ventaId);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cfe-venta-${ventaId}.jsonc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return text;
  };

  const emitirCfeVentaFinal = async () => {
    if (!ventaFinalizada?.id) return;

    const yaEnviado = ventaFinalizada.cfe_enviado || ventaFinalizada.cfe?.autoSent;
    if (yaEnviado) {
      const confirmar = await appConfirm(
        'El CFE de esta venta ya fue enviado y confirmado correctamente. Enviarlo nuevamente puede generar duplicidad de comprobantes en DGI.\n\n¿Desea forzar el reenvío de todas formas?'
      );
      if (!confirmar) return;
    }

    setCfeLoading(true);
    try {
      await api.sendVentaCFE(ventaFinalizada.id, yaEnviado);
      setVentaFinalizada((prev) => (prev ? {
        ...prev,
        cfe_enviado: true,
        cfe: {
          ...(prev.cfe || {}),
          autoAttempted: true,
          autoSent: true,
          autoError: null,
        },
      } : prev));
      await descargarCfeAnotado(ventaFinalizada.id);
      await appAlert('CFE emitido correctamente.');
    } catch (error) {
      setVentaFinalizada((prev) => (prev ? {
        ...prev,
        cfe: {
          ...(prev.cfe || {}),
          autoAttempted: true,
          autoSent: false,
          autoError: error.message || 'No se pudo emitir el CFE',
        },
      } : prev));
      await appAlert(
        `El CFE no fue emitido.\n\n${error.message || 'Error de comunicación con el proveedor de CFE.'}`
      );
    } finally {
      setCfeLoading(false);
    }
  };

  const enviarTicketWhatsApp = async () => {
    if (!ventaFinalizada) return;
    const data = await buildTicketPdf();
    if (!data) return;
    const pdfBlob = data.doc.output('blob');
    const file = new File([pdfBlob], data.fileName, { type: 'application/pdf' });
    const shareData = {
      files: [file],
      title: `Ticket ${ventaFinalizada.id || ''}`,
    };
    const canShareFile = typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare(shareData);

    if (canShareFile) {
      try {
        await navigator.share(shareData);
        setTicketImpreso(true);
        return;
      } catch {
        // fallback below
      }
    }

    data.doc.save(data.fileName);
    window.open('https://web.whatsapp.com/', '_blank', 'noopener,noreferrer');
    setTicketImpreso(true);
  };

  const iniciarNuevaVenta = () => {
    setVentaFinalizada(null);
    setTicketImpreso(false);
    resetVenta();
  };

  const closeCarritoDrawer = () => {
    if (typeof onCloseCarritoDrawer === 'function') {
      onCloseCarritoDrawer();
    }
  };

  const cerrarVentaFinalDesdeBackdrop = () => {
    if (!ventaFinalizada) return;
    if (!ticketImpreso) {
      appConfirm('Aún no imprimiste el ticket. ¿Cerrar igual y comenzar nueva venta?', {
        title: 'Cerrar venta confirmada',
        confirmText: 'Cerrar igual',
        cancelText: 'Seguir aquí',
      }).then((ok) => {
        if (ok) iniciarNuevaVenta();
      });
      return;
    }
    iniciarNuevaVenta();
  };

  const confirmarVenta = async () => {
    if (submittingVentaRef.current) return;
    submittingVentaRef.current = true;
    if (!clienteId || !fechaEntrega) {
      await appAlert('Debes seleccionar cliente y fecha de entrega.');
      return;
    }
    if (pagosConMonto.length === 0) {
      await appAlert('Debes cargar al menos un medio de pago con monto.');
      return;
    }
    if (!isSameMoney(totalPagos, total)) {
      await appAlert(`La suma de pagos (${money(totalPagos)}) debe coincidir con el total (${money(total)}).`);
      return;
    }
    if (total <= 0) {
      await appAlert('El total de la venta debe ser mayor a cero.');
      return;
    }
    if (!setProductos) return;

    const demanda = carritoCalculado.reduce((acc, i) => {
      acc[i.productoId] = (acc[i.productoId] || 0) + toNumber(i.unidadesSolicitadas);
      return acc;
    }, {});

    setSubmittingVenta(true);
    try {
      const ventaCreada = await api.createVenta({
        usuario_id: user?.id ?? null,
        cliente_id: Number(clienteId),
        fecha_entrega: fechaEntrega,
        medio_pago: pagosConMonto[0]?.medio_pago || 'efectivo',
        pagos: pagosConMonto.map((p) => ({ medio_pago: p.medio_pago, monto: p.montoNumber })),
        observacion,
        descuento_total_tipo: 'fijo',
        descuento_total_valor: roundMoney(descuentoTotalAplicado),
        detalle: carritoCalculado.map((item) => ({
          producto_id: item.productoId,
          cantidad: item.unidadesSolicitadas,
          precio_unitario: toNumber(item.precioUnitarioCalculado),
          packs: item.packsCalculados,
          unidades_sueltas: item.unidadesSueltasCalculadas,
          unidades_por_empaque: item.unidadesPorEmpaque,
          tipo_empaque: item.tipoEmpaque,
          precio_empaque: toNumber(item.precioEmpaque),
          precio_unidad: toNumber(item.precioUnidad),
          modo_venta: item.modoVenta || 'unidad',
          descuento_tipo: item.descuentoTipo || 'ninguno',
          descuento_valor: toNumber(item.descuentoValor),
          descuento_aplicado: toNumber(item.descuentoSueltasAplicado ?? item.descuentoAplicado),
          descuento_base: item.descuentoBase || 'total',
          descuento_packs_tipo: item.descuentoPacksTipo || 'ninguno',
          descuento_packs_valor: toNumber(item.descuentoPacksValor),
          descuento_packs_aplicado: toNumber(item.descuentoPacksAplicado),
          descuento_packs_base: item.descuentoPacksBase || 'total',
        })),
      });

      window.dispatchEvent(
        new CustomEvent('mercatus:stats-refresh', {
          detail: { source: 'venta-creada', ventaId: ventaCreada?.id ?? null },
        })
      );

      setProductos(
        productos.map((p) => {
          const need = toNumber(demanda[p.id] || 0);
          if (!need) return p;
          const stock = Math.floor(toNumber(p.stock));
          return { ...p, stock: String(stock - need) };
        })
      );

      const cliente = clientes.find((c) => String(c.id) === String(clienteId));
      // Limpiar carrito guardado ya que la venta se confirmó exitosamente
      if (carritoKey) localStorage.removeItem(carritoKey);
      setVentaFinalizada({
        id: ventaCreada?.id ?? null,
        cfe_enviado: ventaCreada?.cfe_enviado ?? false,
        fecha: new Date().toISOString(),
        clienteId: Number(clienteId),
        clienteNombre: cliente?.nombre || 'Cliente',
        clienteTelefono: cliente?.telefono || '',
        clienteDireccion: cliente?.direccion || '',
        clienteHorarios: formatHorarioCliente(cliente || {}),
        vendedorNombre: user?.nombre || user?.usuario || 'Vendedor',
        fechaEntrega,
        pagos: (ventaCreada?.pagos || pagosConMonto).map((p) => ({
          medio_pago: p.medio_pago,
          monto: toNumber(p.montoNumber ?? p.monto),
        })),
        observacion,
        items: carritoCalculado,
        subtotal,
        descuentoGlobal: descuentoTotalAplicado,
        descuentoTotalTipo,
        descuentoTotalValor,
        total,
        cfe: ventaCreada?.cfe || null,
      });
      setSelectorClienteAbierto(false);
      setBusquedaCliente('');

      // Descargar JSON CFE automáticamente (con comentarios JSONC)
      if (ventaCreada?.id) {
        descargarCfeAnotado(ventaCreada.id)
          .catch(() => {}); // silencioso, no interrumpe el flujo
      }
      if (ventaCreada?.cfe?.autoAttempted && ventaCreada?.cfe?.autoError) {
        await appAlert(`Venta registrada correctamente.\n\nEl CFE no fue emitido:\n${ventaCreada.cfe.autoError}`);
      }
    } catch (error) {
      await appAlert(`No se pudo registrar la venta: ${error.message}`);
    } finally {
      submittingVentaRef.current = false;
      setSubmittingVenta(false);
    }
  };

  return (
    <div className="ventas-main">
      <div
        className={`ventas-carrito-overlay ${carritoDrawerOpen ? 'open' : ''}`}
        onClick={closeCarritoDrawer}
        aria-hidden={!carritoDrawerOpen}
      />

      {/* Banner de carrito restaurado */}
      {carritoRestaurado && (
        <div className="ventas-carrito-restaurado-banner">
          <span>🛒 Tenés una venta en progreso guardada.</span>
          <button
            id={ventasButtonId('carrito-restaurado', 'descartar')}
            type="button"
            className="ventas-carrito-restaurado-descartar"
            onClick={() => {
              appConfirm('¿Descartás el carrito guardado y empezás desde cero?', {
                title: 'Descartar carrito',
                confirmText: 'Sí, descartar',
                cancelText: 'Mantener',
              }).then((ok) => {
                if (ok) {
                  resetVenta();
                  setCarritoRestaurado(false);
                }
              });
            }}
          >
            Descartar
          </button>
          <button
            id={ventasButtonId('carrito-restaurado', 'cerrar')}
            type="button"
            className="ventas-carrito-restaurado-cerrar"
            onClick={() => setCarritoRestaurado(false)}
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}


      <div className="ventas-layout">
        <section className={`ventas-contenido ${paso === 1 ? 'paso-productos' : paso === 2 ? 'paso-preventa' : ''}`}>

          {paso === 1 && (
            <div className="ventas-panel ventas-panel-catalogo">
              <div className="catalogo-head">
                {/* {pasosHeader} */}
                <div className="catalogo-top">
                  <AppInput
                    id={ventasFieldId('productos', 'busqueda')}
                    type="text"
                    className="table-search-field"
                    placeholder="Buscar por nombre o código..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                  />
                  <AppButton
                    id={ventasButtonId('vista-productos', 'toggle')}
                    type="button"
                    className="vista-toggle"
                    onClick={() => setVistaProductos((v) => (v === 'grid' ? 'list' : 'grid'))}
                    title={vistaProductos === 'grid' ? 'Cambiar a lista' : 'Cambiar a cuadrícula'}
                  >
                    {vistaProductos === 'grid' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" width="16" height="16" aria-label="Vista lista">
                        <line x1="8" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <line x1="8" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <line x1="8" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="4" cy="6" r="1.5" fill="currentColor"/>
                        <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
                        <circle cx="4" cy="18" r="1.5" fill="currentColor"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" width="16" height="16" aria-label="Vista cuadrícula">
                        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
                        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
                        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
                        <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    )}
                  </AppButton>
                </div>
              </div>

              <div className={`catalogo-grid catalogo-grid-scroll ${vistaProductos === 'list' ? 'catalogo-list' : ''}`}>
                {productosFiltrados.length === 0 && <p className="muted">No hay productos para mostrar.</p>}
                {catalogoCards}
              </div>
            </div>
          )}

          {paso === 2 && (
            <div className="ventas-panel ventas-panel-preventa">
              <div className="preventa-head">
                <h3>Pago y preventa</h3>
              </div>
              <div className="preventa-scroll">
                <div className="form-entrega">
                  <div className="pagos-box full">
                    <span className="pagos-label">Selecciona uno o más medios de pago</span>
                    <div className="pago-grid">
                      {MEDIOS_PAGO.map((method) => {
                        const row = pagos.find((p) => p.medio_pago === method.key);
                        const activo = Boolean(row?.activo);
                        return (
                          <AppButton
                            id={ventasButtonId('medio-pago', method.key, 'toggle')}
                            key={method.key}
                            type="button"
                            className={`pago-card ${activo ? 'active' : ''}`}
                            onClick={() => {
                              setPagos((prev) => prev.map((p) => (
                                p.medio_pago === method.key ? { ...p, activo: !p.activo } : p
                              )));
                            }}
                          >
                            <img src={method.icon} alt="" aria-hidden="true" />
                            <span>{method.label}</span>
                          </AppButton>
                        );
                      })}
                    </div>
                    <div className="pago-inputs">
                      {pagosActivos.map((pago) => (
                        <label key={`monto-${pago.medio_pago}`}>
                          <span>{formatMedioPago(pago.medio_pago)}</span>
                          <AppInput
                            id={ventasFieldId('medio-pago', pago.medio_pago, 'monto')}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Monto"
                            value={esPagoUnico ? total : pago.monto}
                            readOnly={esPagoUnico}
                            onChange={(e) => {
                              if (esPagoUnico) return;
                              const value = e.target.value;
                              setPagos((prev) => prev.map((p) => (
                                p.medio_pago === pago.medio_pago ? { ...p, monto: value } : p
                              )));
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    {esPagoUnico && (
                      <small className="pago-auto-info">
                        Monto automático: se completa con el total al usar un solo medio.
                      </small>
                    )}
                    <div className={`pagos-total ${isSameMoney(totalPagos, total) ? 'ok' : 'warn'}`}>
                      Pagos: <strong>{money(totalPagos)}</strong> / Total: <strong>{money(total)}</strong>
                    </div>
                    <label className="observacion-venta">
                      <span>Observación</span>
                      <AppTextarea
                        id={ventasFieldId('observacion')}
                        value={observacion}
                        onChange={(e) => setObservacion(e.target.value)}
                        placeholder="Observación (opcional)"
                        rows={3}
                      />
                    </label>
                  </div>
                </div>

                <div className="ticket-resumen">
                  <div className="ticket-header">
                    <div>
                      <h4>Pre-ticket de venta</h4>
                      <span>Vista previa del comprobante</span>
                    </div>
                    <strong className="ticket-total-chip">{money(total)}</strong>
                  </div>
                  <div className="ticket-grid">
                    <p><span>Cliente:</span> {clienteSeleccionado?.nombre || 'Sin seleccionar'}</p>
                    <p><span>Horarios:</span> {formatHorarioCliente(clienteSeleccionado || {})}</p>
                    <p><span>Entrega:</span> {fechaEntrega || 'Sin definir'}</p>
                    <p><span>Pagos:</span> {pagosConMonto.length}</p>
                    <p><span>Ítems:</span> {carritoCalculado.length}</p>
                    <p><span>Unidades:</span> {carritoCalculado.reduce((acc, i) => acc + toNumber(i.unidadesSolicitadas), 0)}</p>
                  </div>
                  <ul className="ticket-pagos">
                    {pagosConMonto.map((pago) => (
                      <li key={`preview-pago-${pago.medio_pago}`}>
                        <span>{formatMedioPago(pago.medio_pago)}</span>
                        <strong>{money(pago.montoNumber)}</strong>
                      </li>
                    ))}
                  </ul>
                  <ul className="ticket-items">
                    {carritoCalculado.map((item) => (
                      <li key={item.id}>
                        <span><b>{item.nombre}</b> x {item.unidadesSolicitadas}</span>
                        <strong>{money(roundMoney(item.subtotalBase - item.descuentoAplicado))}</strong>
                        <small>{formatEmpaqueSplit(item)}</small>
                      </li>
                    ))}
                  </ul>
                  <div className="ticket-totales">
                    <p>Subtotal <strong>{money(subtotal)}</strong></p>
                    <p>Descuento ítems <strong>-{money(descuentoItemsTotal)}</strong></p>
                    <p>Descuento total <strong>-{money(descuentoGlobal)}</strong></p>
                    <p className="ticket-total-final">Total <strong>{money(total)}</strong></p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </section>

        <aside className={`ventas-carrito ${carritoDrawerOpen ? 'mobile-open' : ''}`}>
          <div className="ventas-carrito-mobile-head">
            <h3>Carrito</h3>
            <AppButton
              id={ventasButtonId('carrito', 'cerrar')}
              type="button"
              className="ventas-carrito-close"
              onClick={closeCarritoDrawer}
              aria-label="Cerrar carrito"
            >
              ✕
            </AppButton>
          </div>
          <div className="cliente-cabecera">
            <AppButton
              id={ventasButtonId('cliente', 'toggle')}
              type="button"
              tone="ghost"
              className="cliente-toggle"
              onClick={() => {
                setSelectorClienteAbierto((prev) => !prev);
                setBusquedaCliente('');
              }}
            >
              {clienteId
                ? `Cliente: ${clientes.find((c) => String(c.id) === String(clienteId))?.nombre || 'Seleccionado'}`
                : 'Agregar cliente'}
            </AppButton>
          </div>
          <div className="sidebar-entrega">
            <label>
              Fecha de entrega
              <AppInput
                id={ventasFieldId('fecha-entrega')}
                type="date"
                min={todayISODate()}
                value={fechaEntrega}
                onChange={(e) => setFechaEntrega(e.target.value)}
              />
            </label>
          </div>

          <h3 className="ventas-carrito-title">Carrito</h3>
          {carritoCalculado.length === 0 && <p className="muted">Aún no agregaste productos.</p>}
          <div className="carrito-list">
            {carritoCalculado.map((item) => (
              <div key={item.id} className={`carrito-item${flashIds.has(item.id) ? ' carrito-item--flash' : ''}`}>
                {(() => {
                  const itemIdPart = normalizeButtonIdPart(item.id ?? item.productoId ?? item.nombre);
                  return (
                <>
                <div>
                  <strong>{item.nombre}</strong>
                  <p className="carrito-codigo">Código: {item.ean || '-'}</p>
                  <p className={toNumber(stockRestantePorProducto[item.productoId] || 0) < 0 ? 'unidades-negativas' : ''}>
                    {item.modoVenta === 'empaque'
                      ? `${item.unidadesSolicitadas} unidad(es)`
                      : `${item.unidadesSolicitadas} unidad(es)`}
                  </p>
                  <div className="unidades-edit">
                    <label htmlFor={ventasFieldId('item', itemIdPart, 'unidades')}>
                      {item.modoVenta === 'empaque' ? (item.tipoEmpaque || 'Empaques') : 'Unidades'}
                    </label>
                    <CartItemQtyInput
                      itemId={item.id}
                      displayValue={
                        item.modoVenta === 'empaque'
                          ? Math.max(1, Math.floor(toNumber(item.unidadesSolicitadas) / Math.max(1, Math.floor(toNumber(item.unidadesPorEmpaque)))))
                          : item.unidadesSolicitadas
                      }
                      onCommit={updateUnits}
                      fieldId={ventasFieldId('item', itemIdPart, 'unidades')}
                    />
                  </div>
                  <div className="descuentos-item">
                    {item.packsCalculados > 0 && item.unidadesSueltasCalculadas > 0 ? (
                      // Descuentos independientes: uno para packs, otro para sueltas
                      <>
                        <div className="descuento-linea">
                          <span className="descuento-label">{item.tipoEmpaque || 'Empaque'}:</span>
                          {item.descuentoPacksTipo === 'ninguno' ? (
                            <AppButton id={ventasButtonId('item', itemIdPart, 'descuento', 'packs', 'crear')} type="button" tone="ghost" size="sm" className="descuento-action-link" onClick={() => openDiscountModal(item, 'packs')}>
                              Dar descuento
                            </AppButton>
                          ) : (
                            <>
                              <span className="descuento-aplicado">
                                {item.descuentoPacksTipo === 'porcentaje'
                                  ? `${toNumber(item.descuentoPacksValor)}%`
                                  : money(item.descuentoPacksValor)}
                              </span>
                              <AppButton id={ventasButtonId('item', itemIdPart, 'descuento', 'packs', 'editar')} type="button" tone="ghost" size="sm" className="descuento-action-link" onClick={() => openDiscountModal(item, 'packs')}>Editar</AppButton>
                              <AppButton id={ventasButtonId('item', itemIdPart, 'descuento', 'packs', 'eliminar')} type="button" tone="ghost" size="sm" className="descuento-action-link" onClick={() => removeItemDiscount(item.id, 'packs')}>✕</AppButton>
                            </>
                          )}
                        </div>
                        <div className="descuento-linea">
                          <span className="descuento-label">Sueltas:</span>
                          {item.descuentoTipo === 'ninguno' ? (
                            <AppButton id={ventasButtonId('item', itemIdPart, 'descuento', 'sueltas', 'crear')} type="button" tone="ghost" size="sm" className="descuento-action-link" onClick={() => openDiscountModal(item, 'sueltas')}>
                              Dar descuento
                            </AppButton>
                          ) : (
                            <>
                              <span className="descuento-aplicado">
                                {item.descuentoTipo === 'porcentaje'
                                  ? `${toNumber(item.descuentoValor)}%`
                                  : money(item.descuentoValor)}
                              </span>
                              <AppButton id={ventasButtonId('item', itemIdPart, 'descuento', 'sueltas', 'editar')} type="button" tone="ghost" size="sm" className="descuento-action-link" onClick={() => openDiscountModal(item, 'sueltas')}>Editar</AppButton>
                              <AppButton id={ventasButtonId('item', itemIdPart, 'descuento', 'sueltas', 'eliminar')} type="button" tone="ghost" size="sm" className="descuento-action-link" onClick={() => removeItemDiscount(item.id, 'sueltas')}>✕</AppButton>
                            </>
                          )}
                        </div>
                      </>
                    ) : item.packsCalculados > 0 ? (
                      // Solo empaques — descuento sobre packs
                      item.descuentoPacksTipo === 'ninguno' ? (
                        <AppButton
                          id={ventasButtonId('item', itemIdPart, 'descuento', 'packs', 'crear')}
                          type="button"
                          tone="ghost"
                          size="sm"
                          className="descuento-action-link"
                          onClick={() => openDiscountModal(item, 'packs')}
                        >
                          Dar descuento
                        </AppButton>
                      ) : (
                        <>
                          <span className="descuento-aplicado">
                            Descuento:{' '}
                            {item.descuentoPacksTipo === 'porcentaje'
                              ? `${toNumber(item.descuentoPacksValor)}%`
                              : money(item.descuentoPacksValor)}
                          </span>
                          <AppButton
                            id={ventasButtonId('item', itemIdPart, 'descuento', 'packs', 'editar')}
                            type="button"
                            tone="ghost"
                            size="sm"
                            className="descuento-action-link"
                            onClick={() => openDiscountModal(item, 'packs')}
                          >
                            Editar
                          </AppButton>
                          <AppButton
                            id={ventasButtonId('item', itemIdPart, 'descuento', 'packs', 'eliminar')}
                            type="button"
                            tone="ghost"
                            size="sm"
                            className="descuento-action-link"
                            onClick={() => removeItemDiscount(item.id, 'packs')}
                          >
                            Eliminar descuento
                          </AppButton>
                        </>
                      )
                    ) : (
                      // Solo unidades sueltas — descuento sobre sueltas
                      item.descuentoTipo === 'ninguno' ? (
                        <AppButton
                          id={ventasButtonId('item', itemIdPart, 'descuento', 'sueltas', 'crear')}
                          type="button"
                          tone="ghost"
                          size="sm"
                          className="descuento-action-link"
                          onClick={() => openDiscountModal(item, 'sueltas')}
                        >
                          Dar descuento
                        </AppButton>
                      ) : (
                        <>
                          <span className="descuento-aplicado">
                            Descuento:{' '}
                            {item.descuentoTipo === 'porcentaje'
                              ? `${toNumber(item.descuentoValor)}%`
                              : money(item.descuentoValor)}
                          </span>
                          <AppButton
                            id={ventasButtonId('item', itemIdPart, 'descuento', 'sueltas', 'eliminar')}
                            type="button"
                            tone="ghost"
                            size="sm"
                            className="descuento-action-link"
                            onClick={() => removeItemDiscount(item.id, 'sueltas')}
                          >
                            Eliminar descuento
                          </AppButton>
                        </>
                      )
                    )}
                  </div>
                </div>
                <div className="carrito-right">
                  <span>{money(roundMoney(item.subtotalBase - item.descuentoAplicado))}</span>
                  <small>
                    {item.modoVenta === 'empaque'
                      ? `${Math.max(1, Math.floor(toNumber(item.unidadesSolicitadas) / Math.max(1, Math.floor(toNumber(item.unidadesPorEmpaque)))))}
                         ${item.tipoEmpaque || 'empaque'}(s)`
                      : formatEmpaqueSplit(item)}
                  </small>
                  {item.descuentoAplicado > 0 && (
                    <small className="linea-descuento">Desc: -{money(item.descuentoAplicado)}</small>
                  )}
                  <AppButton id={ventasButtonId('item', itemIdPart, 'eliminar')} type="button" onClick={() => removeItem(item.id)}>✕</AppButton>
                </div>
                </>
                  );
                })()}
              </div>
            ))}
          </div>

          <div className="carrito-footer">
            <div className="carrito-totales">
              <div className={`carrito-resumen-card${carritoResumenAbierto ? ' open' : ''}`}>
                <button
                  id={ventasButtonId('carrito', 'resumen', 'toggle')}
                  type="button"
                  className="carrito-resumen-toggle"
                  aria-expanded={carritoResumenAbierto}
                  aria-controls="carrito-resumen-expandible"
                  onClick={() => setCarritoResumenAbierto((prev) => !prev)}
                >
                  <div className="carrito-resumen-head">
                    <span>Resumen</span>
                    <strong>{carritoCalculado.length} item(s)</strong>
                  </div>
                  <div className="carrito-resumen-total">
                    <span>Total final</span>
                    <strong>{money(total)}</strong>
                  </div>
                  <span className={`carrito-resumen-chevron${carritoResumenAbierto ? ' open' : ''}`} aria-hidden="true">
                    {carritoResumenAbierto ? '−' : '+'}
                  </span>
                </button>
                <div
                  id="carrito-resumen-expandible"
                  className={`carrito-resumen-expand${carritoResumenAbierto ? ' open' : ''}`}
                  aria-hidden={!carritoResumenAbierto}
                >
                  <div className="carrito-resumen-expand-inner">
                    <div className="carrito-resumen-rows">
                      <div className="carrito-resumen-row">
                        <span>Subtotal</span>
                        <strong>{money(subtotal)}</strong>
                      </div>
                      <div className="carrito-resumen-row descuento">
                        <span>Descuento ítems</span>
                        <strong>-{money(descuentoItemsTotal)}</strong>
                      </div>
                      <div className="carrito-resumen-row descuento">
                        <span>Descuento total</span>
                        <strong>-{money(descuentoGlobal)}</strong>
                      </div>
                      <div className="carrito-resumen-row descuento-acumulado">
                        <span>Total descuentos</span>
                        <strong>-{money(descuentoTotalAplicado)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="descuento-global-block descuento-global-block--fixed">
                <span className="descuento-global-label">Descuento global</span>
                {descuentoTotalTipo === 'ninguno' ? (
                  <AppButton
                    id={ventasButtonId('descuento-global', 'crear')}
                    type="button"
                    tone="ghost"
                    size="sm"
                    className="descuento-action-link descuento-global-trigger"
                    onClick={openGlobalDiscountModal}
                  >
                    Aplicar descuento total
                  </AppButton>
                ) : (
                  <div className="descuento-global-active">
                    <span className="descuento-aplicado descuento-global-value">
                      Activo:{' '}
                      {descuentoTotalTipo === 'porcentaje'
                        ? `${toNumber(descuentoTotalValor)}%`
                        : money(descuentoTotalValor)}
                    </span>
                    <div className="descuento-global-actions">
                      <AppButton
                        id={ventasButtonId('descuento-global', 'editar')}
                        type="button"
                        tone="ghost"
                        size="sm"
                        className="descuento-action-link descuento-global-trigger"
                        onClick={openGlobalDiscountModal}
                      >
                        Editar
                      </AppButton>
                      <AppButton
                        id={ventasButtonId('descuento-global', 'quitar')}
                        type="button"
                        tone="ghost"
                        size="sm"
                        className="descuento-action-link descuento-global-trigger"
                        onClick={removeGlobalDiscount}
                      >
                        Quitar
                      </AppButton>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="ventas-footer">
              {paso === 1 ? (
                <AppButton id={ventasButtonId('paso', 'productos', 'siguiente')} type="button" onClick={goNext} disabled={carrito.length === 0}>Siguiente</AppButton>
              ) : (
                <>
                  <AppButton id={ventasButtonId('paso', 'pago', 'atras')} type="button" className="secundario" onClick={goBack}>Atrás</AppButton>
                  <AppButton id={ventasButtonId('venta', 'confirmar')} type="button" className="confirmar" onClick={confirmarVenta} disabled={submittingVenta}>{submittingVenta ? 'Confirmando...' : 'Confirmar venta'}</AppButton>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      <div
        className={`cliente-overlay ${selectorClienteAbierto ? 'open' : ''}`}
        aria-hidden={!selectorClienteAbierto}
      >
        <div className="cliente-overlay-backdrop" />
        <div className="cliente-drawer" ref={clienteDropdownRef}>
          <div className="cliente-dropdown-head">
            <h4>Seleccionar cliente</h4>
            <AppButton
              id={ventasButtonId('cliente', 'cerrar')}
              type="button"
              className="cliente-cerrar"
              onClick={() => setSelectorClienteAbierto(false)}
            >
              ✕
            </AppButton>
          </div>
          <div className="cliente-busqueda-wrap">
            <AppInput
              id={ventasFieldId('cliente', 'busqueda')}
              type="text"
              placeholder="Buscar cliente..."
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
            />
          </div>
          <div className="nuevo-cliente-btn-wrap">
            <AppButton
              id={ventasButtonId('cliente', 'nuevo', 'abrir')}
              type="button"
              tone="ghost"
              size="sm"
              className="nuevo-cliente-btn"
              onClick={abrirNuevoClienteModal}
            >
              + Ingresar nuevo cliente
            </AppButton>
          </div>
          <div className="cliente-dropdown-list full">
            {clientesFiltrados.length === 0 && (
              <p className="cliente-sin-resultados">Sin resultados</p>
            )}
            {clientesFiltrados.map((c) => (
              <AppButton
                id={ventasButtonId('cliente', 'opcion', c.id ?? c.nombre)}
                key={c.id}
                type="button"
                className={`cliente-opcion ${String(clienteId) === String(c.id) ? 'active' : ''}`}
                onClick={() => {
                  setClienteId(String(c.id));
                  setSelectorClienteAbierto(false);
                  setBusquedaCliente('');
                }}
              >
                {c.nombre}
              </AppButton>
            ))}
          </div>
        </div>
      </div>

      <DiscountModal
        key={[
          descuentoItemModal.open ? 'open' : 'closed',
          descuentoItemModal.itemId ?? 'none',
          descuentoItemModal.parte,
          descuentoItemModal.tipo,
          descuentoItemModal.valor,
          descuentoItemModal.base,
        ].join(':')}
        open={descuentoItemModal.open}
        title={descuentoItemModal.parte === 'packs' ? 'Descuento en empaques' : 'Descuento en unidades sueltas'}
        description="Selecciona el tipo de descuento para este producto."
        initialTipo={descuentoItemModal.tipo}
        initialValor={descuentoItemModal.valor}
        initialBase={descuentoItemModal.base}
        showBase
        onClose={closeDiscountModal}
        onApply={applyItemDiscount}
        idPrefix={ventasButtonId('descuento-item-modal', descuentoItemModal.parte)}
      />

      <DiscountModal
        key={[
          descuentoGlobalModal.open ? 'open' : 'closed',
          descuentoGlobalModal.tipo,
          descuentoGlobalModal.valor,
        ].join(':')}
        open={descuentoGlobalModal.open}
        title="Aplicar descuento total"
        description="Selecciona el tipo de descuento para toda la venta."
        initialTipo={descuentoGlobalModal.tipo}
        initialValor={descuentoGlobalModal.valor}
        onClose={closeGlobalDiscountModal}
        onApply={applyGlobalDiscount}
        idPrefix={ventasButtonId('descuento-global-modal')}
      />

      <div
        className={`venta-final-overlay ${ventaFinalizada ? 'open' : ''}`}
        aria-hidden={!ventaFinalizada}
      >
        <div className="venta-final-backdrop" onClick={cerrarVentaFinalDesdeBackdrop} />
        <div className="venta-final-modal" role="dialog" aria-modal="true" aria-label="Venta confirmada">
          <h4 className="venta-final-titulo">
            <span className="venta-final-check" aria-hidden="true">✓</span>
            Venta confirmada
          </h4>
          {ventaFinalizada && (
            <>
              <p className="venta-final-cliente">
                Cliente: <strong>{ventaFinalizada.clienteNombre}</strong>
              </p>
              <p className="venta-final-cliente">
                Teléfono: <strong>{ventaFinalizada.clienteTelefono || '-'}</strong>
              </p>
              <p className="venta-final-cliente">
                Horarios: <strong>{ventaFinalizada.clienteHorarios || '-'}</strong>
              </p>
              <p className="venta-final-cliente">
                Pagos: <strong>{(ventaFinalizada.pagos || []).length}</strong>
              </p>
              <ul className="venta-final-pagos">
                {(ventaFinalizada.pagos || []).map((pago, idx) => (
                  <li key={`pay-${idx}`}>
                    <span>{formatMedioPago(pago.medio_pago)}</span>
                    <strong>{money(pago.monto)}</strong>
                  </li>
                ))}
              </ul>
              <ul className="venta-final-items">
                {ventaFinalizada.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.nombre} x {item.unidadesSolicitadas}</span>
                    <div className="venta-final-item-valores">
                      <strong>{money(roundMoney(item.subtotalBase - item.descuentoAplicado))}</strong>
                      <small>{formatEmpaqueSplit(item)}</small>
                      {item.descuentoAplicado > 0 && (
                        <small className="linea-descuento">Desc: -{money(item.descuentoAplicado)}</small>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="venta-final-totales">
                <p>Subtotal <strong>{money(ventaFinalizada.subtotal)}</strong></p>
                <p>Descuento total <strong>-{money(ventaFinalizada.descuentoGlobal)}</strong></p>
                <p className="venta-final-total">Total <strong>{money(ventaFinalizada.total)}</strong></p>
              </div>
              {ventaFinalizada.cfe?.autoSent && (
                <p className="venta-final-cfe-status venta-final-cfe-status--ok">CFE emitido correctamente.</p>
              )}
              {ventaFinalizada.cfe?.autoAttempted && ventaFinalizada.cfe?.autoError && (
                <p className="venta-final-cfe-status venta-final-cfe-status--error" style={{ whiteSpace: 'pre-wrap' }}>
                  CFE no emitido: {ventaFinalizada.cfe.autoError}
                </p>
              )}
            </>
          )}
          <div className="venta-final-actions">
            <AppButton id={ventasButtonId('venta-final', 'nueva-venta')} type="button" className="secundario" onClick={iniciarNuevaVenta}>
              <img src="/newsale.svg" alt="" aria-hidden="true" />
              Nueva venta
            </AppButton>
            <AppButton
              id={ventasButtonId('venta-final', 'emitir-cfe')}
              type="button"
              className="cfe"
              onClick={emitirCfeVentaFinal}
              disabled={cfeLoading || !ventaFinalizada?.id}
              style={{ display: cfeHabilitado ? undefined : 'none' }}
            >
              {cfeLoading ? 'Emitiendo CFE...' : 'Emitir CFE'}
            </AppButton>
            <AppButton id={ventasButtonId('venta-final', 'whatsapp')} type="button" className="whatsapp" onClick={enviarTicketWhatsApp}>
              <img src="/whatsapp.svg" alt="" aria-hidden="true" />
              Enviar por WhatsApp
            </AppButton>
            <AppButton id={ventasButtonId('venta-final', 'pdf')} type="button" onClick={descargarTicketPdf}>
              <img src="/pdf.svg" alt="" aria-hidden="true" />
              PDF
            </AppButton>
            <AppButton id={ventasButtonId('venta-final', 'imprimir')} type="button" onClick={imprimirTicket}>
              <img src="/print.svg" alt="" aria-hidden="true" />
              Imprimir ticket
            </AppButton>
          </div>
        </div>
      </div>

      {/* ── Modal Nuevo Cliente completo ───────────────────────────────────────── */}
      {nuevoClienteModalOpen && (() => {
        const apParts = splitHora(nuevoClienteForm.horario_apertura);
        const ciParts = splitHora(nuevoClienteForm.horario_cierre);
        const raParts = splitHora(nuevoClienteForm.horario_reapertura);
        const rcParts = splitHora(nuevoClienteForm.horario_cierre_reapertura);
        const barrosFiltrados = nuevoClienteForm.departamento_id
          ? barriosCliente.filter((b) => String(b.departamento_id) === String(nuevoClienteForm.departamento_id))
          : barriosCliente;
        return (
          <div className="ncm-overlay" role="dialog" aria-modal="true" aria-label="Nuevo cliente">
            <div className="ncm-backdrop" onClick={() => setNuevoClienteModalOpen(false)} />
            <div className="ncm-panel">
              <div className="ncm-header">
                <h4>Nuevo cliente</h4>
                <button type="button" className="ncm-close" onClick={() => setNuevoClienteModalOpen(false)}>✕</button>
              </div>
              <form className="ncm-body" onSubmit={handleCrearCliente}>
                <label className="ncm-label">Nombre *
                  <AppInput
                    value={nuevoClienteForm.nombre}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, nombre: e.target.value }))}
                    placeholder="Nombre"
                    required
                    autoFocus
                  />
                </label>
                <label className="ncm-label">Tipo de documento
                  <AppSelect
                    value={nuevoClienteForm.tipo_documento}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, tipo_documento: e.target.value }))}
                  >
                    <option value="">Sin especificar</option>
                    <option value="RUT">RUT</option>
                    <option value="CI">Cédula de identidad</option>
                    <option value="PASAPORTE">Pasaporte</option>
                    <option value="DNI">DNI</option>
                    <option value="OTRO">Otro</option>
                  </AppSelect>
                </label>
                <label className="ncm-label">Número de documento
                  <AppInput
                    value={nuevoClienteForm.numero_documento}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, numero_documento: e.target.value }))}
                    placeholder="Número de documento"
                  />
                </label>
                <label className="ncm-label">Departamento
                  <AppSelect
                    value={nuevoClienteForm.departamento_id}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, departamento_id: e.target.value, barrio_id: '' }))}
                  >
                    <option value="">Sin departamento</option>
                    {departamentosCliente.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                  </AppSelect>
                </label>
                <label className="ncm-label">Ciudad
                  <AppSelect
                    value={nuevoClienteForm.barrio_id}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, barrio_id: e.target.value }))}
                    disabled={!nuevoClienteForm.departamento_id}
                  >
                    <option value="">Sin ciudad</option>
                    {barrosFiltrados.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </AppSelect>
                </label>
                <label className="ncm-label">Código postal
                  <AppInput
                    value={nuevoClienteForm.codigo_postal}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, codigo_postal: e.target.value }))}
                    placeholder="Código postal"
                  />
                </label>
                <label className="ncm-label">Dirección
                  <AppInput
                    value={nuevoClienteForm.direccion}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, direccion: e.target.value }))}
                    placeholder="Dirección"
                  />
                </label>
                <label className="ncm-label">Teléfono
                  <AppInput
                    value={nuevoClienteForm.telefono}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, telefono: e.target.value }))}
                    placeholder="Teléfono"
                  />
                </label>
                <label className="ncm-label">Mail
                  <AppInput
                    type="email"
                    value={nuevoClienteForm.correo}
                    onChange={(e) => setNuevoClienteForm((prev) => ({ ...prev, correo: e.target.value }))}
                    placeholder="Mail"
                  />
                </label>
                <label className="ncm-label">Horario apertura
                  <div className="ncm-time-row">
                    <AppSelect value={apParts.h} onChange={(e) => setNuevoClienteHorarioPart('horario_apertura', 'h', e.target.value)}>
                      <option value="">Hora</option>
                      {HORAS.map((h) => <option key={`ap-h-${h}`} value={h}>{h}</option>)}
                    </AppSelect>
                    <span>:</span>
                    <AppSelect value={apParts.m} onChange={(e) => setNuevoClienteHorarioPart('horario_apertura', 'm', e.target.value)}>
                      <option value="">Min</option>
                      {MINUTOS.map((m) => <option key={`ap-m-${m}`} value={m}>{m}</option>)}
                    </AppSelect>
                  </div>
                </label>
                <label className="ncm-label">Horario cierre
                  <div className="ncm-time-row">
                    <AppSelect value={ciParts.h} onChange={(e) => setNuevoClienteHorarioPart('horario_cierre', 'h', e.target.value)}>
                      <option value="">Hora</option>
                      {HORAS.map((h) => <option key={`ci-h-${h}`} value={h}>{h}</option>)}
                    </AppSelect>
                    <span>:</span>
                    <AppSelect value={ciParts.m} onChange={(e) => setNuevoClienteHorarioPart('horario_cierre', 'm', e.target.value)}>
                      <option value="">Min</option>
                      {MINUTOS.map((m) => <option key={`ci-m-${m}`} value={m}>{m}</option>)}
                    </AppSelect>
                  </div>
                </label>
                <label className="ncm-label ncm-checkbox-row">
                  <AppInput
                    type="checkbox"
                    checked={Boolean(nuevoClienteForm.tiene_reapertura)}
                    onChange={(e) => handleNuevoClienteReaperturaChange(e.target.checked)}
                  />
                  <span>Tiene reapertura</span>
                </label>
                {nuevoClienteForm.tiene_reapertura && (
                  <>
                    <label className="ncm-label">Horario reapertura
                      <div className="ncm-time-row">
                        <AppSelect value={raParts.h} onChange={(e) => setNuevoClienteHorarioPart('horario_reapertura', 'h', e.target.value)}>
                          <option value="">Hora</option>
                          {HORAS.map((h) => <option key={`ra-h-${h}`} value={h}>{h}</option>)}
                        </AppSelect>
                        <span>:</span>
                        <AppSelect value={raParts.m} onChange={(e) => setNuevoClienteHorarioPart('horario_reapertura', 'm', e.target.value)}>
                          <option value="">Min</option>
                          {MINUTOS.map((m) => <option key={`ra-m-${m}`} value={m}>{m}</option>)}
                        </AppSelect>
                      </div>
                    </label>
                    <label className="ncm-label">Cierre reapertura
                      <div className="ncm-time-row">
                        <AppSelect value={rcParts.h} onChange={(e) => setNuevoClienteHorarioPart('horario_cierre_reapertura', 'h', e.target.value)}>
                          <option value="">Hora</option>
                          {HORAS.map((h) => <option key={`rc-h-${h}`} value={h}>{h}</option>)}
                        </AppSelect>
                        <span>:</span>
                        <AppSelect value={rcParts.m} onChange={(e) => setNuevoClienteHorarioPart('horario_cierre_reapertura', 'm', e.target.value)}>
                          <option value="">Min</option>
                          {MINUTOS.map((m) => <option key={`rc-m-${m}`} value={m}>{m}</option>)}
                        </AppSelect>
                      </div>
                    </label>
                  </>
                )}
                <div className="ncm-footer">
                  <AppButton
                    type="button"
                    tone="ghost"
                    onClick={() => setNuevoClienteForm((prev) => ({
                      ...prev,
                      horario_apertura: '',
                      horario_cierre: '',
                      tiene_reapertura: false,
                      horario_reapertura: '',
                      horario_cierre_reapertura: '',
                    }))}
                    disabled={nuevoClienteSaving}
                  >
                    Limpiar horarios
                  </AppButton>
                  <AppButton type="button" tone="ghost" onClick={() => setNuevoClienteModalOpen(false)} disabled={nuevoClienteSaving}>
                    Cancelar
                  </AppButton>
                  <AppButton type="submit" disabled={nuevoClienteSaving || !nuevoClienteForm.nombre.trim()}>
                    {nuevoClienteSaving ? 'Guardando...' : 'Guardar cliente'}
                  </AppButton>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


