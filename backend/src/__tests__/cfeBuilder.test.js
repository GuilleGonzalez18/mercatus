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

function setupMocks(detalleRows, ventaOverrides = {}) {
  callIndex = 0;
  mockResponses = [
    { rowCount: 1, rows: [{ ...ventaBase, ...ventaOverrides }] },
    { rowCount: detalleRows.length, rows: detalleRows },
    { rowCount: 1, rows: [empresaBase] },
    { rowCount: 1, rows: pagoBase },
  ];
  queryMock.mock.resetCalls();
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('buildCFE — líneas por producto (packs y sueltas)', () => {

  it('packs + sueltas del mismo producto → 2 líneas separadas en Detalle', async () => {
    // Nuevo diseño: packs y sueltas son rawLines distintas, nunca se agrupan
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
    assert.equal(cfe.Detalle.length, 2, 'Packs y sueltas del mismo producto = 2 líneas CFE');
  });

  it('packs + sueltas mismo producto → línea packs lleva sufijo -P para evitar merge en Dynamica', async () => {
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
    const [lineaPacks, lineaSueltas] = cfe.Detalle;
    assert.equal(lineaPacks.IteCodiCod, '1-P',    'línea packs: sufijo -P');
    assert.equal(lineaPacks.IteCodiTpoCod, 'INT1', 'línea packs: tipo INT1');
    assert.equal(lineaSueltas.IteCodiCod, '1',    'línea sueltas: código original sin sufijo');
  });

  it('packs + sueltas mismo producto → verificación matemática por línea', async () => {
    // Pack:   6 empaques × 4 uds = 24 uds, precio 373, monto 8952, desc 8952 → neto 0.00
    // Sueltas: 4 uds × 373 = 1492, desc 298.40 → neto 1193.60
    // TotMntPagar = 0 + 1193.60 = 1193.60
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
    const [pack, sueltas] = cfe.Detalle;

    assert.equal(pack.IteCantidad, '24.000',          '6 packs × 4 uds = 24 unidades');
    assert.equal(pack.ItePrecioUnitario, '373.0000',  '1492 / 4 = 373');
    assert.equal(pack.IteMontoItem, '0.00',           '8952 − 8952 = 0');
    assert.equal(pack.IteDescuentoPct, '100.00',      '100% de descuento en packs');
    assert.equal(pack.IteDescuentoMonto, '8952.00');

    assert.equal(sueltas.IteCantidad, '4.000');
    assert.equal(sueltas.ItePrecioUnitario, '373.0000');
    assert.equal(sueltas.IteMontoItem, '1193.60',     '1492 − 298.40');
    assert.equal(sueltas.IteDescuentoPct, '20.00',    '20% de descuento en sueltas');
    assert.equal(sueltas.IteDescuentoMonto, '298.40');

    assert.equal(cfe.Totales.TotMntPagar, '1193.60', 'TotMntPagar = suma de ambas líneas');
  });

  it('packs + sueltas mismo producto → IteDscItem en packs, vacío en sueltas', async () => {
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
    const [pack, sueltas] = cfe.Detalle;
    assert.equal(pack.IteDscItem, '6 Empaques x 4 unidades', 'línea packs: descripción de empaque');
    assert.equal(sueltas.IteDscItem, '', 'línea sueltas: sin descripción extra');
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
        precio_empaque: 1,
        precio_unidad: 373,
        descuento_packs_aplicado: 0,
      }),
      makeDetalleRow({
        producto_id: 2,
        producto_nombre: 'Otro Producto',
        packs: 3,
        unidades_sueltas: 0,
        precio_empaque: 1,
        precio_unidad: 333,
        descuento_packs_aplicado: 0,
      }),
    ]);
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle.length, 2, 'Productos distintos deben generar 2 líneas');
  });

});

describe('buildCFE — diferenciación de código -P en packs', () => {

  it('solo packs sin sueltas del mismo producto → IteCodiCod sin sufijo -P', async () => {
    setupMocks([
      makeDetalleRow({
        packs: 3,
        unidades_sueltas: 0,
        precio_empaque: 100,
        precio_unidad: 25,
        descuento_packs_aplicado: 0,
      }),
    ]);
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle.length, 1);
    assert.equal(cfe.Detalle[0].IteCodiCod, '1', 'Sin sueltas coexistentes: sin sufijo -P');
  });

  it('dos productos: uno con packs+sueltas, otro solo packs → sufijo -P solo en el primero', async () => {
    // prod1: packs + sueltas → pack line lleva -P; sueltas line conserva código
    // prod2: solo packs, sin sueltas → sin sufijo
    setupMocks([
      makeDetalleRow({
        producto_id: 1,
        packs: 2,
        unidades_sueltas: 3,
        precio_empaque: 100,
        precio_unidad: 25,
        descuento_packs_aplicado: 0,
        descuento_aplicado: 0,
      }),
      makeDetalleRow({
        id: 2,
        producto_id: 2,
        producto_nombre: 'Producto B',
        packs: 5,
        unidades_sueltas: 0,
        precio_empaque: 200,
        precio_unidad: 50,
        descuento_packs_aplicado: 0,
      }),
    ]);
    const cfe = await buildCFE(1);
    // rawLines: [prod1-packs(-P), prod1-sueltas, prod2-packs]
    assert.equal(cfe.Detalle.length, 3, '2 packs + 1 sueltas = 3 líneas');
    assert.equal(cfe.Detalle[0].IteCodiCod, '1-P', 'prod1 packs: sufijo -P porque tiene sueltas');
    assert.equal(cfe.Detalle[1].IteCodiCod, '1',   'prod1 sueltas: código original');
    assert.equal(cfe.Detalle[2].IteCodiCod, '2',   'prod2 packs: sin sufijo (no tiene sueltas)');
  });

});

describe('buildCFE — fix double-counting de descuentos globales', () => {

  it('descuento_total_valor = suma exacta de items → descGlobalAmount = 0 (sin distribución extra)', async () => {
    // Si descuento_total_valor == Σ(descItem en rawLines), no hay descuento global real.
    // Con el bug anterior esto se distribuía igual, pagando el descuento dos veces.
    setupMocks(
      [makeDetalleRow({ unidades_sueltas: 10, precio_unidad: 10, descuento_aplicado: 50 })],
      { descuento_total_valor: 50 },
    );
    const cfe = await buildCFE(1);
    // monto = 100, descItem = 50, descGlobal = 0 → montoNeto = 50
    assert.equal(cfe.Detalle[0].IteMontoItem, '50.00');
    assert.equal(cfe.Detalle[0].IteDescuentoMonto, '50.00');
  });

  it('descuento_total_valor > items → descuento global = solo la diferencia', async () => {
    // 50 de item + 50 de descuento global adicional almacenados como 100 en total
    setupMocks(
      [makeDetalleRow({ unidades_sueltas: 50, precio_unidad: 10, descuento_aplicado: 50 })],
      { descuento_total_valor: 100 },
    );
    const cfe = await buildCFE(1);
    // monto = 500, descItem = 50, descGlobal = 50 → descTotal = 100, neto = 400
    assert.equal(cfe.Detalle[0].IteMontoItem, '400.00');
    assert.equal(cfe.Detalle[0].IteDescuentoMonto, '100.00');
  });

  it('venta-110 equivalent: descuento de ítem no se redistribuye como descuento global', async () => {
    // Reproduce el bug original: 3 productos, solo el primero tiene descuento de ítem.
    // descuento_total_valor = 50 (= solo ítem A). Con fix: descGlobalAmount = 0.
    // Bug anterior: 50 se distribuía sobre los 3 → TotMntPagar = 100 en lugar de 150.
    setupMocks(
      [
        makeDetalleRow({ id: 1, producto_id: 1, unidades_sueltas: 10, precio_unidad: 10, descuento_aplicado: 50 }),
        makeDetalleRow({ id: 2, producto_id: 2, producto_nombre: 'B', unidades_sueltas: 6,  precio_unidad: 10, descuento_aplicado: 0 }),
        makeDetalleRow({ id: 3, producto_id: 3, producto_nombre: 'C', unidades_sueltas: 4,  precio_unidad: 10, descuento_aplicado: 0 }),
      ],
      { descuento_total_valor: 50 },
    );
    const cfe = await buildCFE(1);
    assert.equal(cfe.Detalle[0].IteMontoItem, '50.00',  'prod A: 100 − 50 = 50');
    assert.equal(cfe.Detalle[1].IteMontoItem, '60.00',  'prod B: sin descuento global extra');
    assert.equal(cfe.Detalle[2].IteMontoItem, '40.00',  'prod C: sin descuento global extra');
    assert.equal(cfe.Totales.TotMntPagar, '150.00',     'total correcto = 50+60+40, no 100');
  });

});
