/**
 * cfeBuilder.test.js — Tests unitarios para buildCFE (lógica de agrupación de líneas)
 * Corre con: node --test src/__tests__/cfeBuilder.test.js
 *
 * Usa mock.module (Node ≥ 22) para simular db.js sin conexión a PostgreSQL.
 * Cubre: packs+sueltas mismo producto, solo packs, hasOldData, dos productos distintos.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// ─── Mock de db.js ANTES de importar cfeBuilder ──────────────────────────────
let callIndex = 0;
let mockResponses = [];
const queryMock = mock.fn(async () => mockResponses[callIndex++]);

await mock.module('../db.js', { namedExports: { query: queryMock } });
const { buildCFE } = await import('../cfeBuilder.js');

// ─── Fixtures base ────────────────────────────────────────────────────────────
const ventaBase = {
  id: 1,
  cliente_nombre: 'Consumidor Final',
  tipo_documento: null,
  numero_documento: null,
  cliente_direccion: null,
  cliente_correo: null,
  cliente_ciudad: 'Montevideo',
  cliente_departamento: 'Montevideo',
  descuento_total_tipo: 'ninguno',
  descuento_total_valor: 0,
  fecha: '2026-01-15',
  fecha_entrega: null,
  medio_pago: 'efectivo',
  observacion: '',
};

const empresaBase = {
  nombre: 'Empresa Test',
  razon_social: 'Empresa Test S.A.',
  rut: '123456789012',
  direccion: 'Calle Test 123',
  telefono: '098000000',
  correo: 'test@test.com',
  giro: 'Comercio',
  ciudad: 'Montevideo',
  departamento: 'Montevideo',
  cfe_ambiente: 'PRUEBAS',
};

const pagoBase = [{ medio_pago: 'efectivo' }];

function makeDetalleRow(overrides = {}) {
  return {
    id: 1,
    cantidad: 1,
    precio_unitario: 373,
    packs: 0,
    unidades_sueltas: 0,
    unidades_por_empaque: 4,
    tipo_empaque: 'Empaque',
    precio_empaque: 0,
    precio_unidad: 373,
    modo_venta: 'sueltas',
    descuento_tipo: null,
    descuento_valor: 0,
    descuento_aplicado: 0,
    descuento_packs_tipo: null,
    descuento_packs_valor: 0,
    descuento_packs_aplicado: 0,
    producto_id: 1,
    producto_nombre: 'Producto Test',
    ean: null,
    unidad: 'UND',
    iva_id: 1,
    iva_codigo: '3',       // IVA básica → getIteIndFact('3') = 3
    iva_porcentaje: 22,
    ...overrides,
  };
}

function setupMocks(detalleRows) {
  callIndex = 0;
  mockResponses = [
    { rowCount: 1, rows: [ventaBase] },
    { rowCount: detalleRows.length, rows: detalleRows },
    { rowCount: 1, rows: [empresaBase] },
    { rowCount: 1, rows: pagoBase },
  ];
  queryMock.mock.resetCalls();
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('buildCFE — agrupación de líneas por producto', () => {

  it('packs + sueltas del mismo producto → 1 sola línea en Detalle', async () => {
    setupMocks([
      makeDetalleRow({
        packs: 6,
        unidades_sueltas: 4,
        precio_empaque: 1492,   // precio por 1 empaque (4 uds × $373)
        precio_unidad: 373,
        descuento_aplicado: 298.40,     // sueltas 20%
        descuento_packs_aplicado: 8952, // packs 100% (6 × 1492)
      }),
    ]);
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle.length, 1, 'Debe haber exactamente 1 línea en Detalle');
  });

  it('packs + sueltas mismo producto → IteDescuentoPct es 88.58, no 100.00', async () => {
    setupMocks([
      makeDetalleRow({
        packs: 6,
        unidades_sueltas: 4,
        precio_empaque: 1492,
        precio_unidad: 373,
        descuento_aplicado: 298.40,
        descuento_packs_aplicado: 8952,
      }),
    ]);
    const cfe = await buildCFE(1);
    const linea = cfe.Detalle[0];
    assert.notEqual(linea.IteDescuentoPct, '100.00', 'IteDescuentoPct no debe ser 100.00');
    assert.equal(linea.IteDescuentoPct, '88.57');
  });

  it('packs + sueltas mismo producto → verificación matemática completa', async () => {
    // packs: 6 x 4 = 24 unidades a $373 → monto packs = 6×1492 = 8952, desc 8952 (100%)
    // sueltas: 4 unidades a $373 → monto 1492, desc 298.40 (20%)
    // totalMonto = 10444, totalDescTotal = 9250.40, montoNeto = 1193.60
    // descPct = 9250.40 / 10444 * 100 = 88.57%
    setupMocks([
      makeDetalleRow({
        packs: 6,
        unidades_sueltas: 4,
        precio_empaque: 1492,
        precio_unidad: 373,
        descuento_aplicado: 298.40,
        descuento_packs_aplicado: 8952,
      }),
    ]);
    const cfe = await buildCFE(1);
    const linea = cfe.Detalle[0];

    assert.equal(linea.IteCantidad, '28.000',          '24 pack-units + 4 sueltas = 28 unidades');
    assert.equal(linea.ItePrecioUnitario, '373.0000',  'precio promedio ponderado = 10444/28 = 373');
    assert.equal(linea.IteMontoItem, '1193.60',        'monto neto = 10444 - 9250.40');
    assert.equal(linea.IteDescuentoMonto, '9250.40',   'descuento total acumulado');
    assert.equal(linea.IteDescuentoPct, '88.57',       'porcentaje real de descuento');
    assert.equal(cfe.Totales.TotMntPagar, '1193.60',   'TotMntPagar = IteMontoItem');
  });

  it('packs + sueltas mismo producto → IteDscItem vacío (mezcla, no aplica descripción)', async () => {
    setupMocks([
      makeDetalleRow({
        packs: 6,
        unidades_sueltas: 4,
        precio_empaque: 1492,
        precio_unidad: 373,
        descuento_aplicado: 298.40,
        descuento_packs_aplicado: 8952,
      }),
    ]);
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle[0].IteDscItem, '');
  });

  it('solo packs (sin sueltas) → 1 línea con IteDscItem preservado', async () => {
    setupMocks([
      makeDetalleRow({
        packs: 6,
        unidades_sueltas: 0,
        precio_empaque: 1492,
        precio_unidad: 373,
        descuento_aplicado: 0,
        descuento_packs_aplicado: 0,
      }),
    ]);
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle.length, 1);
    assert.equal(cfe.Detalle[0].IteDscItem, '6 Empaques x 4 unidades',
      'Solo packs: preservar descripción de empaque');
  });

  it('producto modo hasOldData (solo cantidad) → 1 línea, resultado idéntico al anterior', async () => {
    // packs=0, sueltas=0 → hasOldData path: usa cantidad y precio_unitario
    setupMocks([
      makeDetalleRow({
        packs: 0,
        unidades_sueltas: 0,
        cantidad: 4,
        precio_unitario: 373,
        descuento_aplicado: 0,
      }),
    ]);
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle.length, 1);
    assert.equal(cfe.Detalle[0].IteMontoItem, '1492.00', '4 × 373 = 1492');
    assert.ok(!cfe.Detalle[0].IteDescuentoPct, 'Sin descuento no debe incluir IteDescuentoPct');
  });

  it('dos productos distintos → 2 líneas separadas sin agrupar', async () => {
    setupMocks([
      makeDetalleRow({
        producto_id: 1,
        packs: 2,
        unidades_sueltas: 0,
        precio_empaque: 1,  // > 0
        precio_unidad: 373,
        descuento_packs_aplicado: 0,
      }),
      makeDetalleRow({
        producto_id: 2,
        producto_nombre: 'Otro Producto',
        packs: 3,
        unidades_sueltas: 0,
        precio_empaque: 1,  // > 0
        precio_unidad: 333,
        descuento_packs_aplicado: 0,
      }),
    ]);
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle.length, 2, 'Productos distintos deben generar 2 líneas');
  });

});
