# Plan de Optimización de Performance — Frontend

> Fecha: 2026-05-22  
> Contexto: El flujo del sistema demora. Se identificaron re-renders innecesarios y falta de memoización en los componentes más pesados.

---

## Estado actual

`Ventas.jsx` ya está bien optimizado: usa `memo`, `useCallback`, `useMemo`, `useDeferredValue`.  
Los problemas críticos están en **Productos.jsx**, **VentasHistorial.jsx** y **Dashboard.jsx**.

---

## Prioridad 1 — HIGH (aplicar primero)

### 1. `productosFiltrados` sin `useMemo` — Productos.jsx ~L751

**Problema:** `productosFiltrados` se recalcula en cada render del componente, incluso cuando el usuario solo tipea en el formulario de nuevo producto. Como `sortedProductos` depende de él, el sort también se re-ejecuta en cada keystroke.

**Fix:**
```jsx
const productosFiltrados = useMemo(
  () => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) =>
      `${p.nombre || ''} ${p.ean || ''}`.toLowerCase().includes(q)
    );
  },
  [productos, busqueda]
);
```

---

### 2. `productosColumns` sin `useMemo` — Productos.jsx ~L866

**Problema:** Array grande con JSX y arrow functions adentro, reconstruido en cada render. Depende de `toggleSort`, `sortMark`, `verCosto`, `verGanancia`, `calcularGananciaUnidad`.

**Fix:**
```jsx
const productosColumns = useMemo(() => [
  // ... definición actual sin cambios ...
], [toggleSort, sortMark, verCosto, verGanancia]);
```

Requiere también estabilizar `toggleSort` (ver ítem 6).

---

### 3. `ventasColumns` sin `useMemo` — VentasHistorial.jsx ~L1304

**Problema:** El array más costoso del proyecto. Cierra sobre ~8 variables de estado (`sortBy`, `sortDir`, `updatingEntregaId`, `cancelandoVentaId`, `eliminandoVentaId`, `loadingCfeId`, `cfeHabilitado`, `printingId`). Se reconstruye en cada render, incluso al cambiar filtros de fecha.

**Fix:**
```jsx
const ventasColumns = useMemo(() => [
  // ... definición actual sin cambios ...
], [toggleSort, sortMark, updatingEntregaId, cancelandoVentaId, eliminandoVentaId, loadingCfeId, cfeHabilitado, printingId]);
```

Requiere también estabilizar `toggleSort` (ver ítem 6).

---

### 4. `ventasCarritoAbierto` en deps de `contenidoPantalla` — Dashboard.jsx ~L701 ⚠️ MÁS GRAVE

**Problema:** `contenidoPantalla` es un `useMemo` que incluye `ventasCarritoAbierto` en su array de dependencias porque pasa `carritoDrawerOpen` como prop a `<Ventas>`. Cada vez que el usuario abre/cierra el carrito, React detecta cambio en deps → devuelve nueva referencia de elemento → **`<Ventas>` hace unmount + remount completo**, perdiendo todo el estado local del componente.

**Fix:** Sacar `ventasCarritoAbierto` y `onToggleCarritoDrawer` del memo. Pasarlos fuera o via contexto:
```jsx
// contenidoPantalla no incluye carritoDrawerOpen en deps
const contenidoPantalla = useMemo(() => {
  switch (pantalla) {
    case 'nueva-venta': return <Ventas user={user} productos={productos} setProductos={setProductos} onCarritoCountChange={setVentasCarritoCount} onCloseCarritoDrawer={handleCloseCarritoDrawer} />;
    // ...
  }
}, [pantalla, user, productos, setProductos, handleCloseCarritoDrawer]); // SIN ventasCarritoAbierto

// carritoDrawerOpen se pasa por separado, fuera del memo:
const ventasConDrawer = pantalla === 'nueva-venta'
  ? React.cloneElement(contenidoPantalla, { carritoDrawerOpen: ventasCarritoAbierto })
  : contenidoPantalla;
```

O mejor: pasar `ventasCarritoAbierto` via un contexto liviano separado.

---

### 5. Sin virtualización en `AppTable` — AppTable.jsx ~L130

**Problema:** `rows.map(...)` monta todos los elementos en el DOM. Con 200+ productos o 500+ ventas, el navegador pinta y mantiene en memoria cientos de nodos DOM innecesariamente.

**Fix (cuando sea prioritario):** Integrar `@tanstack/virtual` en `AppTable`:
```bash
npm install @tanstack/react-virtual
```
```jsx
import { useVirtualizer } from '@tanstack/react-virtual';
// Reemplazar rows.map() con el virtualizer dentro del scroll container
```

> Este cambio es el más invasivo. Dejarlo para después de los ítems 1-4.

---

## Prioridad 2 — MEDIUM

### 6. `toggleSort` sin `useCallback` — Productos.jsx ~L824 / VentasHistorial.jsx ~L311

**Problema:** `toggleSort` es una función `const` que se recrea en cada render. Como es dep de los arrays de columnas (ítems 2 y 3), invalida esos memos si no está estabilizada.

**Fix:**
```jsx
const toggleSort = useCallback((column) => {
  if (sortBy === column) {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  } else {
    setSortBy(column);
    setSortDir('asc');
  }
}, [sortBy]);
```

---

### 7. `renderExpandedVenta` doble-wrapped — VentasHistorial.jsx ~L1913

**Problema:** Se pasa como `renderExpandedRow={(v) => renderExpandedVenta(v)}` (wrapper innecesario), y `renderExpandedVenta` tampoco está en `useCallback`.

**Fix:**
```jsx
// Estabilizar la función:
const renderExpandedVenta = useCallback((v) => { /* ... */ }, [cancelandoVentaId, eliminandoVentaId, /* deps */]);

// Pasar directo, sin wrapper:
<AppTable renderExpandedRow={renderExpandedVenta} ... />
```

---

### 8. `opcionesMenu` sin `useMemo` — Dashboard.jsx ~L580

**Problema:** Se recalcula en cada render de `DashboardInner`. El componente re-renderiza con cada cambio del badge del carrito (`ventasCarritoCount`).

**Fix:**
```jsx
const opcionesMenu = useMemo(
  () => OPCIONES.filter((op) => {
    if (op.key === 'usuarios' || op.key === 'control-stock') return esPropietario;
    if (op.key === 'mi-usuario') return !esPropietario;
    if (op.key === 'estadisticas') return esPropietario;
    return true;
  }),
  [esPropietario]
);
```

---

### 9. `renderExpandedRow` inline en `Productos` — Productos.jsx ~L1216

**Problema:** `renderExpandedRow={(p) => (<div>...handleEditar(p)...handleEliminar(p.id)...</div>)}` crea nueva función en cada render, invalidando el `memo` de `AppTable` si lo tuviera.

**Fix:**
```jsx
const renderExpandedProducto = useCallback((p) => (
  <div>
    {/* contenido actual */}
  </div>
), [handleEditar, handleEliminar]);

<AppTable renderExpandedRow={renderExpandedProducto} ... />
```

---

## Prioridad 3 — LOW

### 10. Funciones puras dentro del componente

Mover al scope del módulo (fuera del componente):

- `calcularGananciaUnidad` — Productos.jsx ~L833
- `normalizarEstadoEntrega` — VentasHistorial.jsx ~L227

```jsx
// Mover esto ANTES del export default function Productos() {
function calcularGananciaUnidad(producto) { /* ... */ }
```

---

### 11. `React.lazy` en las features del Dashboard

**Problema:** Dashboard importa todas las features al inicio aunque el usuario no las use.

**Fix:**
```jsx
// En Dashboard.jsx, reemplazar imports estáticos:
const VentasHistorial = lazy(() => import('./features/ventas/VentasHistorial'));
const Productos       = lazy(() => import('./features/productos/Productos'));
const Clientes        = lazy(() => import('./features/clientes/Clientes'));
const Estadisticas    = lazy(() => import('./features/estadisticas/Estadisticas'));
const ControlStock    = lazy(() => import('./features/controlstock/ControlStock'));
const Auditoria       = lazy(() => import('./features/auditoria/Auditoria'));
const Usuarios        = lazy(() => import('./features/usuarios/Usuarios'));

// Envolver el render en Suspense:
<Suspense fallback={<div className="dashboard-loading">Cargando...</div>}>
  {contenidoPantalla}
</Suspense>
```

---

### 12. `useTransition` en buscadores pesados

Candidatos: buscador de productos en Productos.jsx, filtros de fecha en VentasHistorial.jsx.

```jsx
const [isPending, startTransition] = useTransition();

const handleBusqueda = (e) => {
  startTransition(() => setBusqueda(e.target.value));
};
```

> `useDeferredValue` ya hace algo similar en Ventas.jsx — aplicar el mismo patrón en los otros.

---

## Orden de ejecución sugerido

| Paso | Ítem | Archivo | Esfuerzo |
|------|------|---------|----------|
| 1 | #6 `toggleSort` useCallback | Productos + VentasHistorial | 5 min |
| 2 | #1 `productosFiltrados` useMemo | Productos.jsx | 5 min |
| 3 | #2 `productosColumns` useMemo | Productos.jsx | 10 min |
| 4 | #3 `ventasColumns` useMemo | VentasHistorial.jsx | 10 min |
| 5 | #4 `ventasCarritoAbierto` fuera del memo | Dashboard.jsx | 20 min |
| 6 | #7 `renderExpandedVenta` useCallback | VentasHistorial.jsx | 10 min |
| 7 | #8 `opcionesMenu` useMemo | Dashboard.jsx | 5 min |
| 8 | #9 `renderExpandedProducto` useCallback | Productos.jsx | 5 min |
| 9 | #10 funciones puras al módulo scope | Productos + VentasHistorial | 5 min |
| 10 | #11 React.lazy en Dashboard | Dashboard.jsx | 30 min |
| 11 | #12 useTransition en buscadores | Productos + VentasHistorial | 10 min |
| 12 | #5 Virtualización AppTable | AppTable.jsx | 2-4 hs |
