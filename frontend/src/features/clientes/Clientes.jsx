import { useEffect, useMemo, useState } from 'react';
import { FilterSlot } from '../../shared/lib/filterPanel';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../../core/api';
import { useConfig } from '../../core/ConfigContext';
import { usePermisos } from '../../core/PermisosContext';
import { getPrimaryRgb, loadLogoForPdf } from '../../shared/lib/pdfColors';
import './Clientes.css';
import { appAlert, appConfirm } from '../../shared/lib/appDialog';
import { RiFileExcel2Line } from 'react-icons/ri';
import { PiFilePdfBold } from 'react-icons/pi';
import { AiFillPrinter } from 'react-icons/ai';
import AppTable from '../../shared/components/table/AppTable';
import AppInput from '../../shared/components/fields/AppInput';
import AppSelect from '../../shared/components/fields/AppSelect';
import { formatHorarioCliente, horaConHoraVacia, normalizeHoraForSave, splitHora } from '../../shared/lib/horarios';
import AppButton from '../../shared/components/button/AppButton';
import { PRINT_FONT_FAMILY_CSS } from '../../shared/lib/typography';

// ── Modal Gestión de Ciudades y Departamentos ─────────────────────────────────

function UbicacionesModal({ departamentos, setDepartamentos, todosBarrios, setTodosBarrios, onClose }) {
  const [tabU, setTabU] = useState('departamentos');
  // Búsqueda y filtro
  const [busquedaDep, setBusquedaDep] = useState('');
  const [busquedaBar, setBusquedaBar] = useState('');
  const [filtroDepBar, setFiltroDepBar] = useState('');
  // Sub-modales de alta
  const [addDepOpen, setAddDepOpen] = useState(false);
  const [addBarOpen, setAddBarOpen] = useState(false);
  const [nuevoDepNombre, setNuevoDepNombre] = useState('');
  const [nuevoBarNombre, setNuevoBarNombre] = useState('');
  const [nuevoBarDepId, setNuevoBarDepId] = useState('');
  // Edición inline
  const [editDepId, setEditDepId] = useState(null);
  const [editDepNombre, setEditDepNombre] = useState('');
  const [editBarId, setEditBarId] = useState(null);
  const [editBarNombre, setEditBarNombre] = useState('');
  const [editBarDepId, setEditBarDepId] = useState('');
  const [errorU, setErrorU] = useState('');

  const showError = (msg) => { setErrorU(msg); setTimeout(() => setErrorU(''), 3500); };

  const depsFiltrados = useMemo(() =>
    departamentos.filter((d) => d.nombre.toLowerCase().includes(busquedaDep.toLowerCase().trim())),
    [departamentos, busquedaDep]
  );

  const barriosFiltrados = useMemo(() =>
    todosBarrios.filter((b) => {
      const matchNombre = b.nombre.toLowerCase().includes(busquedaBar.toLowerCase().trim());
      const matchDep = !filtroDepBar || String(b.departamento_id) === filtroDepBar;
      return matchNombre && matchDep;
    }),
    [todosBarrios, busquedaBar, filtroDepBar]
  );

  // Departamentos CRUD
  const crearDep = async () => {
    const nombre = nuevoDepNombre.trim();
    if (!nombre) return;
    try {
      const created = await api.createDepartamento({ nombre });
      setDepartamentos((prev) => [...prev, created].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNuevoDepNombre('');
      setAddDepOpen(false);
    } catch (e) { showError(e.message); }
  };

  const guardarEditDep = async (id) => {
    const nombre = editDepNombre.trim();
    if (!nombre) return;
    try {
      const updated = await api.updateDepartamento(id, { nombre });
      setDepartamentos((prev) => prev.map((d) => d.id === id ? updated : d));
      setEditDepId(null);
    } catch (e) { showError(e.message); }
  };

  const eliminarDep = async (dep) => {
    const ok = await appConfirm(`¿Eliminar departamento "${dep.nombre}"?`, { title: 'Eliminar departamento', confirmText: 'Eliminar', cancelText: 'Cancelar' });
    if (!ok) return;
    try {
      await api.deleteDepartamento(dep.id);
      setDepartamentos((prev) => prev.filter((d) => d.id !== dep.id));
    } catch (e) { showError(e.message); }
  };

  // Barrios CRUD
  const crearBar = async () => {
    const nombre = nuevoBarNombre.trim();
    if (!nombre) return;
    try {
      const created = await api.createBarrio({ nombre, departamento_id: nuevoBarDepId ? Number(nuevoBarDepId) : null });
      setTodosBarrios((prev) => [...prev, created].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNuevoBarNombre('');
      setNuevoBarDepId('');
      setAddBarOpen(false);
    } catch (e) { showError(e.message); }
  };

  const guardarEditBar = async (id) => {
    const nombre = editBarNombre.trim();
    if (!nombre) return;
    try {
      const updated = await api.updateBarrio(id, { nombre, departamento_id: editBarDepId ? Number(editBarDepId) : null });
      setTodosBarrios((prev) => prev.map((b) => b.id === id ? updated : b));
      setEditBarId(null);
    } catch (e) { showError(e.message); }
  };

  const eliminarBar = async (bar) => {
    const ok = await appConfirm(`¿Eliminar ciudad "${bar.nombre}"?`, { title: 'Eliminar ciudad', confirmText: 'Eliminar', cancelText: 'Cancelar' });
    if (!ok) return;
    try {
      await api.deleteBarrio(bar.id);
      setTodosBarrios((prev) => prev.filter((b) => b.id !== bar.id));
    } catch (e) { showError(e.message); }
  };

  return (
    <div className="ub-overlay" role="dialog" aria-modal="true">
      <div className="ub-backdrop" onClick={onClose} />
      <div className="ub-modal">
        <h4 className="ub-modal-title">Ciudades y Departamentos</h4>
        <div className="ub-tabs">
          <button type="button" className={`ub-tab-btn ${tabU === 'departamentos' ? 'active' : ''}`} onClick={() => setTabU('departamentos')}>Departamentos</button>
          <button type="button" className={`ub-tab-btn ${tabU === 'barrios' ? 'active' : ''}`} onClick={() => setTabU('barrios')}>Ciudades</button>
        </div>

        {errorU && <p className="ub-error">{errorU}</p>}

        {tabU === 'departamentos' && (
          <div className="ub-section">
            <div className="ub-controls-row">
              <AppInput
                value={busquedaDep}
                onChange={(e) => setBusquedaDep(e.target.value)}
                placeholder="Buscar departamento..."
                className="ub-search"
              />
              <AppButton type="button" onClick={() => { setNuevoDepNombre(''); setAddDepOpen(true); }}>
                Añadir
              </AppButton>
            </div>
            <ul className="ub-list">
              {depsFiltrados.map((d) => (
                <li key={d.id} className="ub-list-item">
                  {editDepId === d.id ? (
                    <>
                      <AppInput value={editDepNombre} onChange={(e) => setEditDepNombre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && guardarEditDep(d.id)} autoFocus />
                      <AppButton type="button" onClick={() => guardarEditDep(d.id)}>Guardar</AppButton>
                      <AppButton type="button" onClick={() => setEditDepId(null)}>Cancelar</AppButton>
                    </>
                  ) : (
                    <>
                      <span className="ub-item-name">{d.nombre}</span>
                      <AppButton type="button" className="edit-btn" onClick={() => { setEditDepId(d.id); setEditDepNombre(d.nombre); }}>Editar</AppButton>
                      <AppButton type="button" className="delete-btn" onClick={() => eliminarDep(d)}>Eliminar</AppButton>
                    </>
                  )}
                </li>
              ))}
              {depsFiltrados.length === 0 && <li className="ub-empty">{busquedaDep ? 'Sin resultados' : 'Sin departamentos'}</li>}
            </ul>
          </div>
        )}

        {tabU === 'barrios' && (
          <div className="ub-section">
            <div className="ub-controls-row">
              <AppInput
                value={busquedaBar}
                onChange={(e) => setBusquedaBar(e.target.value)}
                placeholder="Buscar ciudad..."
                className="ub-search"
              />
              <AppSelect value={filtroDepBar} onChange={(e) => setFiltroDepBar(e.target.value)} className="ub-filter-dep">
                <option value="">Todos los departamentos</option>
                {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </AppSelect>
              <AppButton type="button" onClick={() => { setNuevoBarNombre(''); setNuevoBarDepId(filtroDepBar); setAddBarOpen(true); }}>
                Añadir
              </AppButton>
            </div>
            <ul className="ub-list">
              {barriosFiltrados.map((b) => {
                const depNombre = departamentos.find((d) => d.id === b.departamento_id)?.nombre;
                return (
                  <li key={b.id} className="ub-list-item">
                    {editBarId === b.id ? (
                      <>
                        <AppInput value={editBarNombre} onChange={(e) => setEditBarNombre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && guardarEditBar(b.id)} autoFocus />
                        <AppSelect value={editBarDepId} onChange={(e) => setEditBarDepId(e.target.value)}>
                          <option value="">Sin departamento</option>
                          {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                        </AppSelect>
                        <AppButton type="button" onClick={() => guardarEditBar(b.id)}>Guardar</AppButton>
                        <AppButton type="button" onClick={() => setEditBarId(null)}>Cancelar</AppButton>
                      </>
                    ) : (
                      <>
                        <span className="ub-item-name">{b.nombre}{depNombre ? <small> — {depNombre}</small> : null}</span>
                        <AppButton type="button" className="edit-btn" onClick={() => { setEditBarId(b.id); setEditBarNombre(b.nombre); setEditBarDepId(b.departamento_id ? String(b.departamento_id) : ''); }}>Editar</AppButton>
                        <AppButton type="button" className="delete-btn" onClick={() => eliminarBar(b)}>Eliminar</AppButton>
                      </>
                    )}
                  </li>
                );
              })}
              {barriosFiltrados.length === 0 && <li className="ub-empty">{busquedaBar || filtroDepBar ? 'Sin resultados' : 'Sin ciudades'}</li>}
            </ul>
          </div>
        )}

        <AppButton type="button" className="export-modal-close" onClick={onClose}>Cerrar</AppButton>
      </div>

      {/* Sub-modal: Agregar Departamento */}
      {addDepOpen && (
        <div className="ub-sub-overlay" role="dialog" aria-modal="true" aria-label="Agregar departamento">
          <div className="ub-sub-backdrop" onClick={() => setAddDepOpen(false)} />
          <div className="ub-sub-modal">
            <h5 className="ub-sub-title">Agregar Departamento</h5>
            <AppInput
              value={nuevoDepNombre}
              onChange={(e) => setNuevoDepNombre(e.target.value)}
              placeholder="Nombre del departamento"
              onKeyDown={(e) => e.key === 'Enter' && crearDep()}
              autoFocus
            />
            <div className="ub-sub-actions">
              <AppButton type="button" onClick={() => setAddDepOpen(false)}>Cancelar</AppButton>
              <AppButton type="button" onClick={crearDep}>Guardar</AppButton>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal: Agregar Ciudad */}
      {addBarOpen && (
        <div className="ub-sub-overlay" role="dialog" aria-modal="true" aria-label="Agregar ciudad">
          <div className="ub-sub-backdrop" onClick={() => setAddBarOpen(false)} />
          <div className="ub-sub-modal">
            <h5 className="ub-sub-title">Agregar Ciudad</h5>
            <AppInput
              value={nuevoBarNombre}
              onChange={(e) => setNuevoBarNombre(e.target.value)}
              placeholder="Nombre de la ciudad"
              onKeyDown={(e) => e.key === 'Enter' && crearBar()}
              autoFocus
            />
            <AppSelect value={nuevoBarDepId} onChange={(e) => setNuevoBarDepId(e.target.value)}>
              <option value="">Sin departamento</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </AppSelect>
            <div className="ub-sub-actions">
              <AppButton type="button" onClick={() => setAddBarOpen(false)}>Cancelar</AppButton>
              <AppButton type="button" onClick={crearBar}>Guardar</AppButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Clientes() {
  const { empresa } = useConfig();
  const { can } = usePermisos();
  const puedeExportar = can('clientes', 'exportar');
  const puedeAgregar = can('clientes', 'agregar');
  const puedeEditar = can('clientes', 'editar');
  const puedeEliminar = can('clientes', 'eliminar');
  const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINUTOS = ['00', '15', '30', '45'];

  const [clientes, setClientes] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [todosBarrios, setTodosBarrios] = useState([]);
  const [stats, setStats] = useState({ total_clientes: 0, dep_mas_clientes: null, dep_mas_ventas: null });
  const [ubicacionesModalOpen, setUbicacionesModalOpen] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [sortBy, setSortBy] = useState('nombre');
  const [sortDir, setSortDir] = useState('asc');
  const [mostrarForm, setMostrarForm] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [clienteExpandidoId, setClienteExpandidoId] = useState(null);
  const [nuevo, setNuevo] = useState({
    nombre: '',
    rut: '',
    direccion: '',
    telefono: '',
    correo: '',
    horario_apertura: '',
    horario_cierre: '',
    tiene_reapertura: false,
    horario_reapertura: '',
    horario_cierre_reapertura: '',
    tipo_documento: '',
    numero_documento: '',
    departamento_id: '',
    barrio_id: '',
    codigo_postal: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [rows, deps, barrios, statsData] = await Promise.all([
          api.getClientes(),
          api.getDepartamentos(),
          api.getBarrios(),
          api.getClientesStats(),
        ]);
        setClientes(rows);
        setDepartamentos(deps);
        setTodosBarrios(barrios);
        setStats(statsData);
      } catch (error) {
        console.error('Error cargando clientes', error);
      }
    };
    load();
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) =>
      `${c.nombre || ''} ${c.rut || ''} ${c.numero_documento || ''}`.toLowerCase().includes(q)
    );
  }, [clientes, busqueda]);

  const clientesOrdenados = useMemo(() => {
    const list = [...filtrados];
    const dir = sortDir === 'asc' ? 1 : -1;
    const asText = (v) => String(v ?? '').toLowerCase();

    list.sort((a, b) => {
      switch (sortBy) {
        case 'rut':
          return asText(a.rut).localeCompare(asText(b.rut)) * dir;
        case 'direccion':
          return asText(a.direccion).localeCompare(asText(b.direccion)) * dir;
        case 'telefono':
          return asText(a.telefono).localeCompare(asText(b.telefono)) * dir;
        case 'correo':
          return asText(a.correo).localeCompare(asText(b.correo)) * dir;
        case 'horario_apertura':
          return asText(a.horario_apertura).localeCompare(asText(b.horario_apertura)) * dir;
        case 'horario_cierre':
          return asText(a.horario_cierre).localeCompare(asText(b.horario_cierre)) * dir;
        case 'nombre':
        default:
          return asText(a.nombre).localeCompare(asText(b.nombre)) * dir;
      }
    });

    return list;
  }, [filtrados, sortBy, sortDir]);

  const toggleSort = (column) => {
    if (sortBy === column) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(column);
    setSortDir('asc');
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setNuevo((prev) => ({ ...prev, [name]: value }));
  };

  const handleReaperturaChange = (checked) => {
    setNuevo((prev) => ({
      ...prev,
      tiene_reapertura: checked,
      horario_reapertura: checked ? prev.horario_reapertura : '',
      horario_cierre_reapertura: checked ? prev.horario_cierre_reapertura : '',
    }));
  };

  const setHorarioPart = (field, part, value) => {
    setNuevo((prev) => {
      const current = splitHora(prev[field]);
      const next = part === 'h' ? { ...current, h: value } : { ...current, m: value };
      return {
        ...prev,
        [field]: `${next.h}:${next.m}`,
      };
    });
  };

  const guardarCliente = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        nombre: nuevo.nombre,
        rut: nuevo.numero_documento || null,
        direccion: nuevo.direccion || null,
        telefono: nuevo.telefono || null,
        correo: nuevo.correo || null,
        horario_apertura: normalizeHoraForSave(nuevo.horario_apertura),
        horario_cierre: normalizeHoraForSave(nuevo.horario_cierre),
        tiene_reapertura: Boolean(nuevo.tiene_reapertura),
        horario_reapertura: nuevo.tiene_reapertura ? normalizeHoraForSave(nuevo.horario_reapertura) : null,
        horario_cierre_reapertura: nuevo.tiene_reapertura ? normalizeHoraForSave(nuevo.horario_cierre_reapertura) : null,
        tipo_documento: nuevo.tipo_documento || null,
        numero_documento: nuevo.numero_documento || null,
        departamento_id: nuevo.departamento_id ? Number(nuevo.departamento_id) : null,
        barrio_id: nuevo.barrio_id ? Number(nuevo.barrio_id) : null,
        ciudad: nuevo.barrio_id
          ? (todosBarrios.find((b) => String(b.id) === String(nuevo.barrio_id))?.nombre || null)
          : null,
        codigo_postal: nuevo.codigo_postal || null,
      };

      // Bloquear si el minuto fue seleccionado pero la hora no
      const camposHorario = [
        [nuevo.horario_apertura, 'apertura'],
        [nuevo.horario_cierre, 'cierre'],
        ...(nuevo.tiene_reapertura ? [
          [nuevo.horario_reapertura, 'reapertura'],
          [nuevo.horario_cierre_reapertura, 'cierre de reapertura'],
        ] : []),
      ];
      for (const [rawVal, label] of camposHorario) {
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
        await appAlert('Si el cliente tiene reapertura, completa también apertura y cierre principal.');
        return;
      }
      if (payload.tiene_reapertura && !payload.horario_reapertura && !payload.horario_cierre_reapertura) {
        await appAlert('Debes completar el horario de reapertura.');
        return;
      }
      if (payload.tiene_reapertura && (!payload.horario_reapertura || !payload.horario_cierre_reapertura)) {
        await appAlert('Debes completar ambos horarios de reapertura.');
        return;
      }

      if (editandoId) {
        const actualizado = await api.updateCliente(editandoId, payload);
        // Preserva campos de display (departamento_nombre, barrio_nombre) que el PUT no devuelve
        setClientes((prev) => prev.map((c) => (c.id === editandoId ? { ...c, ...actualizado } : c)));
      } else {
        let creado;
        try {
          creado = await api.createCliente(payload);
        } catch (createErr) {
          if (createErr.status === 409 && createErr.data?.cliente) {
            const { id: clienteEliminadoId, nombre: clienteEliminadoNombre } = createErr.data.cliente;
            const ok = await appConfirm(
              `El cliente "${clienteEliminadoNombre}" ya está registrado con ese documento pero fue eliminado. ¿Querés restaurarlo?`,
              { title: 'Cliente eliminado encontrado', confirmText: 'Restaurar', cancelText: 'Cancelar' }
            );
            if (!ok) return;
            const restaurado = await api.restaurarCliente(clienteEliminadoId);
            setClientes((prev) => [restaurado, ...prev]);
            setStats((prev) => ({ ...prev, total_clientes: prev.total_clientes + 1 }));
          } else {
            throw createErr;
          }
        }
        if (creado) setClientes((prev) => [creado, ...prev]);
      }

      setNuevo({
        nombre: '',
        rut: '',
        direccion: '',
        telefono: '',
        correo: '',
        horario_apertura: '',
        horario_cierre: '',
        tiene_reapertura: false,
        horario_reapertura: '',
        horario_cierre_reapertura: '',
        tipo_documento: '',
        numero_documento: '',
        departamento_id: '',
        barrio_id: '',
        codigo_postal: '',
      });
      setMostrarForm(false);
      setEditandoId(null);
    } catch (error) {
      await appAlert(`No se pudo guardar el cliente: ${error.message}`);
    }
  };

  const editarCliente = (cliente) => {
    setEditandoId(cliente.id);
    setClienteExpandidoId(null);
    setNuevo({
      nombre: cliente.nombre || '',
      numero_documento: cliente.numero_documento || cliente.rut || '',
      tipo_documento: cliente.tipo_documento || '',
      direccion: cliente.direccion || '',
      telefono: cliente.telefono || '',
      correo: cliente.correo || '',
      horario_apertura: cliente.horario_apertura || '',
      horario_cierre: cliente.horario_cierre || '',
      tiene_reapertura: Boolean(cliente.tiene_reapertura),
      horario_reapertura: cliente.horario_reapertura || '',
      horario_cierre_reapertura: cliente.horario_cierre_reapertura || '',
      departamento_id: cliente.departamento_id ? String(cliente.departamento_id) : '',
      barrio_id: cliente.barrio_id ? String(cliente.barrio_id) : '',
      codigo_postal: cliente.codigo_postal || '',
    });
    setMostrarForm(true);
  };

  const eliminarCliente = async (id) => {
    const ok = await appConfirm('¿Seguro que deseas eliminar este cliente?', {
      title: 'Eliminar cliente',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    try {
      await api.deleteCliente(id);
      setClientes((prev) => prev.filter((c) => c.id !== id));
      setClienteExpandidoId((prev) => (prev === id ? null : prev));
      if (editandoId === id) {
        setEditandoId(null);
        setMostrarForm(false);
        setNuevo({
          nombre: '',
          rut: '',
          direccion: '',
          telefono: '',
          correo: '',
          horario_apertura: '',
          horario_cierre: '',
          tiene_reapertura: false,
          horario_reapertura: '',
          horario_cierre_reapertura: '',
          tipo_documento: '',
          numero_documento: '',
          departamento_id: '',
          barrio_id: '',
          codigo_postal: '',
        });
      }
    } catch (error) {
      await appAlert(`No se pudo eliminar: ${error.message}`);
    }
  };

  const exportarPDF = async () => {
    const doc = new jsPDF();
    const fecha = new Date().toLocaleDateString();
    const logo = await loadLogoForPdf(empresa.logo_base64, '#ffffff');
    let startY = 30;
    if (logo) {
      doc.addImage(logo.dataUrl, 'JPEG', 10, 10, 40, 20);
      doc.setFontSize(16);
      doc.text('Lista de Clientes', 55, 22);
      doc.setFontSize(10);
      doc.text(`Emitido: ${fecha}`, 55, 28);
    } else {
      doc.setFontSize(16);
      doc.text('Lista de Clientes', 14, 18);
      doc.setFontSize(10);
      doc.text(`Emitido: ${fecha}`, 14, 24);
      startY = 30;
    }

    autoTable(doc, {
      startY,
      head: [['Nombre', 'Documento', 'Dirección', 'Teléfono', 'Mail', 'Horarios']],
      body: filtrados.map((c) => [
        c.nombre || '',
        c.numero_documento || c.rut || '',
        c.direccion || '',
        c.telefono || '',
        c.correo || '',
        formatHorarioCliente(c).replace(' y ', '\n'),
      ]),
      styles: { fontSize: 8.2, valign: 'middle', cellPadding: 2.2 },
      headStyles: { fillColor: getPrimaryRgb() },
      tableWidth: 'wrap',
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 18 },
        2: { cellWidth: 44 },
        3: { cellWidth: 20 },
        4: { cellWidth: 32 },
        5: { cellWidth: 36 },
      },
    });

    doc.save('clientes.pdf');
  };

  const exportarExcel = () => {
    const rowsHtml = filtrados.map((c, idx) => {
      const zebra = idx % 2 === 0 ? '#f7faff' : '#ffffff';
      return `
        <tr style="background:${zebra}">
          <td>${c.nombre || ''}</td>
          <td>${c.numero_documento || c.rut || ''}</td>
          <td>${c.direccion || ''}</td>
          <td>${c.telefono || ''}</td>
          <td>${c.correo || ''}</td>
          <td>${formatHorarioCliente(c)}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <html><head><meta charset="UTF-8" /></head><body>
        <table border="1" style="border-collapse:collapse;width:100%">
          <thead>
            <tr style="background:#375f8c;color:#fff">
              <th>Nombre</th><th>Documento</th><th>Dirección</th><th>Teléfono</th><th>Mail</th><th>Horarios</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body></html>
    `;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clientes.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const imprimirClientes = () => {
    const rows = filtrados.map((c) => `
      <tr>
        <td>${c.nombre || ''}</td>
        <td>${c.numero_documento || c.rut || ''}</td>
        <td>${c.direccion || ''}</td>
        <td>${c.telefono || ''}</td>
        <td>${c.correo || ''}</td>
        <td>${formatHorarioCliente(c)}</td>
      </tr>
    `).join('');
    const w = window.open('', '_blank', 'noopener,noreferrer,width=980,height=700');
    if (!w) return;
    w.document.write(`
      <html><head><title>Clientes</title>
      <style>
        body{font-family:${PRINT_FONT_FAMILY_CSS};padding:16px}
        h2{color:#375f8c}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #c8d3e5;padding:6px 8px;font-size:12px}
        th{background:#375f8c;color:#fff}
      </style></head>
      <body>
        <h2>Lista de clientes</h2>
        <table>
          <thead><tr>
            <th>Nombre</th><th>Documento</th><th>Dirección</th><th>Teléfono</th><th>Mail</th><th>Horarios</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  const abrirAlta = () => {
    setEditandoId(null);
    setNuevo({
      nombre: '',
      rut: '',
      direccion: '',
      telefono: '',
      correo: '',
      horario_apertura: '',
      horario_cierre: '',
      tiene_reapertura: false,
      horario_reapertura: '',
      horario_cierre_reapertura: '',
      tipo_documento: '',
      numero_documento: '',
      departamento_id: '',
      barrio_id: '',
      codigo_postal: '',
    });
    setMostrarForm(true);
  };

  const cerrarPanel = () => {
    setMostrarForm(false);
    setEditandoId(null);
    setNuevo({
      nombre: '',
      rut: '',
      direccion: '',
      telefono: '',
      correo: '',
      horario_apertura: '',
      horario_cierre: '',
      tiene_reapertura: false,
      horario_reapertura: '',
      horario_cierre_reapertura: '',
      tipo_documento: '',
      numero_documento: '',
      departamento_id: '',
      barrio_id: '',
      codigo_postal: '',
    });
  };

  const aperturaPartes = splitHora(nuevo.horario_apertura);
  const cierrePartes = splitHora(nuevo.horario_cierre);
  const reaperturaPartes = splitHora(nuevo.horario_reapertura);
  const cierreReaperturaPartes = splitHora(nuevo.horario_cierre_reapertura);

  const sortMark = (column) => (sortBy === column ? (sortDir === 'asc' ? '▲' : '▼') : '');

  const clientesColumns = [
    {
      key: 'nombre',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('nombre')}>
          Nombre {sortMark('nombre')}
        </button>
      ),
      mobileLabel: 'Nombre',
      render: (c) => c.nombre || '-',
    },
    {
      key: 'rut',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('rut')}>
          Documento {sortMark('rut')}
        </button>
      ),
      mobileLabel: 'Documento',
      render: (c) => c.numero_documento || c.rut || '-',
    },
    {
      key: 'direccion',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('direccion')}>
          Dirección {sortMark('direccion')}
        </button>
      ),
      mobileLabel: 'Dirección',
      mobileHide: true,
      render: (c) => c.direccion || '-',
    },
    {
      key: 'telefono',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('telefono')}>
          Teléfono {sortMark('telefono')}
        </button>
      ),
      mobileLabel: 'Teléfono',
      render: (c) => c.telefono || '-',
    },
    {
      key: 'correo',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('correo')}>
          Mail {sortMark('correo')}
        </button>
      ),
      mobileLabel: 'Mail',
      mobileHide: true,
      render: (c) => c.correo || '-',
    },
    {
      key: 'horario_apertura',
      header: (
        <button type="button" className="sort-header-btn" onClick={() => toggleSort('horario_apertura')}>
          Horarios {sortMark('horario_apertura')}
        </button>
      ),
      mobileLabel: 'Horarios',
      mobileHide: true,
      render: (c) => formatHorarioCliente(c),
    },
  ];

  return (
    <div className="clientes-main">
      <div className="clientes-toolbar">
        <AppInput
          type="text"
          className="buscar-cliente table-search-field"
          placeholder="Buscar por nombre o documento"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <FilterSlot>
          <>
            {puedeAgregar && (
              <AppButton
                type="button"
                className="icon-btn"
                title="Agregar cliente"
                onClick={abrirAlta}
              >
                <span>Añadir Clientes</span>
              </AppButton>
            )}
            <AppButton
              type="button"
              className="icon-btn"
              title="Gestionar ciudades y departamentos"
              onClick={() => setUbicacionesModalOpen(true)}
            >
              <span>Gestión Ciudades/Departamentos</span>
            </AppButton>
            {puedeExportar && (
              <AppButton type="button" className="icon-btn" title="Exportar" onClick={() => setExportModalOpen(true)}>
                <img src="/print.svg" alt="" aria-hidden="true" />
              </AppButton>
            )}
          </>
        </FilterSlot>
      </div>

      <div className="clientes-totales">
        <div className="clientes-total-card">
          <span>Total Clientes</span>
          <strong>{stats.total_clientes}</strong>
        </div>
        <div className="clientes-total-card">
          <span>Dep. con más clientes</span>
          <strong>{stats.dep_mas_clientes ?? '-'}</strong>
        </div>
        <div className="clientes-total-card">
          <span>Dep. donde más se vende</span>
          <strong>{stats.dep_mas_ventas ?? '-'}</strong>
        </div>
      </div>

      {exportModalOpen && (
        <div className="export-modal-overlay" role="dialog" aria-modal="true">
          <div className="export-modal-backdrop" onClick={() => setExportModalOpen(false)} />
          <div className="export-modal">
            <h4>Exportar clientes</h4>
            <p>Elige un formato:</p>
            <div className="export-modal-actions">
              <AppButton type="button" onClick={() => { exportarPDF(); setExportModalOpen(false); }}>
                <PiFilePdfBold />
                <span>PDF</span>
              </AppButton>
              <AppButton type="button" onClick={() => { exportarExcel(); setExportModalOpen(false); }}>
                <RiFileExcel2Line />
                <span>EXCEL</span>
              </AppButton>
              <AppButton type="button" onClick={() => { imprimirClientes(); setExportModalOpen(false); }}>
                <AiFillPrinter />
                <span>Impresora</span>
              </AppButton>
            </div>
            <AppButton type="button" className="export-modal-close" onClick={() => setExportModalOpen(false)}>
              Cerrar
            </AppButton>
          </div>
        </div>
      )}

      <AppTable
        stickyHeader
        columns={clientesColumns}
        rows={clientesOrdenados}
        rowKey="id"
        emptyMessage="No hay clientes"
        onRowClick={(c) => setClienteExpandidoId((prev) => (prev === c.id ? null : c.id))}
        rowClassName="cliente-row"
        expandedRowId={clienteExpandidoId}
        renderExpandedRow={(c) => (
          <div className="acciones-cliente-panel">
            {puedeEditar && (
            <AppButton
              type="button"
              className="edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                editarCliente(c);
              }}
            >
              Editar
            </AppButton>
            )}
            {puedeEliminar && (
            <AppButton
              type="button"
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                eliminarCliente(c.id);
              }}
            >
              Eliminar
            </AppButton>
            )}
          </div>
        )}
      />

      <div className={`side-panel-overlay ${mostrarForm ? 'open' : ''}`} aria-hidden={!mostrarForm}>
        <div className="side-panel-backdrop" onClick={cerrarPanel} />
        <aside className="side-panel">
          <div className="side-panel-header">
            <h3>{editandoId ? 'Editar cliente' : 'Nuevo cliente'}</h3>
            <button type="button" className="side-panel-close" onClick={cerrarPanel}>✕</button>
          </div>
          <form className="cliente-form" onSubmit={guardarCliente}>
            <label className="field-label">Nombre
              <AppInput name="nombre" value={nuevo.nombre} onChange={handleChange} placeholder="Nombre" required />
            </label>
            <label className="field-label">Tipo de documento
              <AppSelect name="tipo_documento" value={nuevo.tipo_documento || ''} onChange={handleChange}>
                <option value="">Sin especificar</option>
                <option value="RUT">RUT</option>
                <option value="CI">Cédula de identidad</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="DNI">DNI</option>
                <option value="OTRO">Otro</option>
              </AppSelect>
            </label>
            <label className="field-label">Número de documento
              <AppInput name="numero_documento" value={nuevo.numero_documento} onChange={handleChange} placeholder="Número de documento" />
            </label>
            <label className="field-label">Departamento
              <AppSelect
                name="departamento_id"
                value={nuevo.departamento_id || ''}
                onChange={(e) => setNuevo((prev) => ({ ...prev, departamento_id: e.target.value, barrio_id: '' }))}
              >
                <option value="">Sin departamento</option>
                {departamentos.map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </AppSelect>
            </label>
            <label className="field-label">Ciudad
              <AppSelect
                name="barrio_id"
                value={nuevo.barrio_id || ''}
                onChange={handleChange}
                disabled={!nuevo.departamento_id}
              >
                <option value="">Sin ciudad</option>
                {todosBarrios
                  .filter((b) => !nuevo.departamento_id || String(b.departamento_id) === String(nuevo.departamento_id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>{b.nombre}</option>
                  ))}
              </AppSelect>
            </label>
            <label className="field-label">Código postal
              <AppInput name="codigo_postal" value={nuevo.codigo_postal} onChange={handleChange} placeholder="Código postal" />
            </label>
            <label className="field-label">Dirección
              <AppInput name="direccion" value={nuevo.direccion} onChange={handleChange} placeholder="Dirección" />
            </label>
            <label className="field-label">Teléfono
              <AppInput name="telefono" value={nuevo.telefono} onChange={handleChange} placeholder="Teléfono" />
            </label>
            <label className="field-label">Mail
              <AppInput name="correo" value={nuevo.correo} onChange={handleChange} placeholder="Mail" type="email" />
            </label>
            <label className="field-label">Horario apertura
              <div className="time-selects">
                <AppSelect
                  value={aperturaPartes.h}
                  onChange={(e) => setHorarioPart('horario_apertura', 'h', e.target.value)}
                >
                  <option value="">Hora</option>
                  {HORAS.map((h) => <option key={`ap-h-${h}`} value={h}>{h}</option>)}
                </AppSelect>
                <span>:</span>
                <AppSelect
                  value={aperturaPartes.m}
                  onChange={(e) => setHorarioPart('horario_apertura', 'm', e.target.value)}
                >
                  <option value="">Min</option>
                  {MINUTOS.map((m) => <option key={`ap-m-${m}`} value={m}>{m}</option>)}
                </AppSelect>
              </div>
            </label>
            <label className="field-label">Horario cierre
              <div className="time-selects">
                <AppSelect
                  value={cierrePartes.h}
                  onChange={(e) => setHorarioPart('horario_cierre', 'h', e.target.value)}
                >
                  <option value="">Hora</option>
                  {HORAS.map((h) => <option key={`ci-h-${h}`} value={h}>{h}</option>)}
                </AppSelect>
                <span>:</span>
                <AppSelect
                  value={cierrePartes.m}
                  onChange={(e) => setHorarioPart('horario_cierre', 'm', e.target.value)}
                >
                  <option value="">Min</option>
                  {MINUTOS.map((m) => <option key={`ci-m-${m}`} value={m}>{m}</option>)}
                </AppSelect>
              </div>
            </label>
            <label className="field-label field-checkbox-inline">
              <AppInput
                type="checkbox"
                checked={Boolean(nuevo.tiene_reapertura)}
                onChange={(e) => handleReaperturaChange(e.target.checked)}
              />
              <span>Tiene reapertura</span>
            </label>
            {nuevo.tiene_reapertura && (
              <>
                <label className="field-label">Horario reapertura
                  <div className="time-selects">
                    <AppSelect
                      value={reaperturaPartes.h}
                      onChange={(e) => setHorarioPart('horario_reapertura', 'h', e.target.value)}
                    >
                      <option value="">Hora</option>
                      {HORAS.map((h) => <option key={`ra-h-${h}`} value={h}>{h}</option>)}
                    </AppSelect>
                    <span>:</span>
                    <AppSelect
                      value={reaperturaPartes.m}
                      onChange={(e) => setHorarioPart('horario_reapertura', 'm', e.target.value)}
                    >
                      <option value="">Min</option>
                      {MINUTOS.map((m) => <option key={`ra-m-${m}`} value={m}>{m}</option>)}
                    </AppSelect>
                  </div>
                </label>
                <label className="field-label">Cierre reapertura
                  <div className="time-selects">
                    <AppSelect
                      value={cierreReaperturaPartes.h}
                      onChange={(e) => setHorarioPart('horario_cierre_reapertura', 'h', e.target.value)}
                    >
                      <option value="">Hora</option>
                      {HORAS.map((h) => <option key={`rc-h-${h}`} value={h}>{h}</option>)}
                    </AppSelect>
                    <span>:</span>
                    <AppSelect
                      value={cierreReaperturaPartes.m}
                      onChange={(e) => setHorarioPart('horario_cierre_reapertura', 'm', e.target.value)}
                    >
                      <option value="">Min</option>
                      {MINUTOS.map((m) => <option key={`rc-m-${m}`} value={m}>{m}</option>)}
                    </AppSelect>
                  </div>
                </label>
              </>
            )}
            <AppButton
              type="button"
              className="limpiar-horarios-btn"
              onClick={() => setNuevo((prev) => ({
                ...prev,
                horario_apertura: '',
                horario_cierre: '',
                tiene_reapertura: false,
                horario_reapertura: '',
                horario_cierre_reapertura: '',
              }))}
            >
              Limpiar horarios
            </AppButton>
            <div className="cliente-form-actions">
              <AppButton type="submit">{editandoId ? 'Guardar cambios' : 'Guardar'}</AppButton>
              <AppButton type="button" onClick={cerrarPanel}>Cancelar</AppButton>
            </div>
          </form>
        </aside>
      </div>

      {ubicacionesModalOpen && (
        <UbicacionesModal
          departamentos={departamentos}
          setDepartamentos={setDepartamentos}
          todosBarrios={todosBarrios}
          setTodosBarrios={setTodosBarrios}
          onClose={() => setUbicacionesModalOpen(false)}
        />
      )}
    </div>
  );
}


