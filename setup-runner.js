const fs = require('fs');
const path = require('path');

const servicesDir = 'D:\\repos\\ferco-posta\\backend\\src\\services';
const filePath = path.join(servicesDir, 'cfeBuilder.js');

const content = `import { query } from '../db.js';

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const tzOffset = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - tzOffset);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

function getIteIndFact(ivaCodigo) {
  const c = Number(ivaCodigo);
  if (c === 2) return 2;
  if (c === 3) return 3;
  return 1;
}

function getFmaPago(medioPago) {
  return String(medioPago || '').toLowerCase() === 'credito' ? '2' : '1';
}

function getGlosaMP(medioPago) {
  const m = String(medioPago || '').toLowerCase();
  if (m === 'credito') return 'CRÉDITO';
  if (m === 'debito') return 'DÉBITO';
  if (m === 'transferencia') return 'TRANSFERENCIA';
  return 'EFECTIVO';
}

function getCodMP(medioPago) {
  const m = String(medioPago || '').toLowerCase();
  if (m === 'credito') return '2';
  if (m === 'debito') return '3';
  if (m === 'transferencia') return '4';
  return '1';
}

function getRcpTipoDoc(tipoDoc) {
  const t = String(tipoDoc || '').toUpperCase();
  if (t === 'RUT') return 2;
  if (t === 'CI') return 3;
  if (t === 'PASAPORTE') return 5;
  if (t === 'DNI') return 6;
  if (t) return 4;
  return null;
}

function getCFETipo(cliente) {
  if (cliente && String(cliente.tipo_documento || '').toUpperCase() === 'RUT' && cliente.numero_documento) {
    return '111';
  }
  return '101';
}

function getUniMed(unidad) {
  const u = String(unidad || '').toUpperCase().slice(0, 4).trim();
  return u || 'UNID';
}

function getCodiTpoCod(ean) {
  if (!ean) return 'INT1';
  const len = String(ean).replace(/\\D/g, '').length;
  if (len === 13) return 'GTIN13';
  if (len === 12) return 'GTIN12';
  if (len === 8) return 'GTIN8';
  return 'INT1';
}

export async function buildCFE(ventaId) {
  const ventaQ = await query(
    \`SELECT v.*, 
            c.nombre AS cliente_nombre, c.tipo_documento, c.numero_documento,
            c.direccion AS cliente_direccion, c.correo AS cliente_correo,
            c.ciudad AS cliente_ciudad,
            dep.nombre AS cliente_departamento
     FROM public.ventas v
     LEFT JOIN public.clientes c ON c.id = v.cliente_id
     LEFT JOIN public.departamentos dep ON dep.id = c.departamento_id
     WHERE v.id = $1\`,
    [ventaId]
  );
  if (!ventaQ.rowCount) throw new Error(\`Venta \${ventaId} no encontrada\`);
  const venta = ventaQ.rows[0];

  const detalleQ = await query(
    \`SELECT vd.id, vd.cantidad, vd.precio_unitario,
            p.id AS producto_id, p.nombre AS producto_nombre, p.ean, p.unidad,
            p.iva_id, ti.codigo AS iva_codigo, ti.porcentaje AS iva_porcentaje
     FROM public.venta_detalle vd
     INNER JOIN public.productos p ON p.id = vd.producto_id
     LEFT JOIN public.tipos_iva ti ON ti.id = p.iva_id
     WHERE vd.venta_id = $1
     ORDER BY vd.id ASC\`,
    [ventaId]
  );

  const empresaQ = await query(
    \`SELECT nombre, razon_social, rut, direccion, telefono, correo,
            giro, ciudad, departamento
     FROM public.config_empresa LIMIT 1\`
  );
  const empresa = empresaQ.rows[0] || {};

  const cliente = {
    nombre: venta.cliente_nombre,
    tipo_documento: venta.tipo_documento,
    numero_documento: venta.numero_documento,
    direccion: venta.cliente_direccion,
    correo: venta.cliente_correo,
    ciudad: venta.cliente_ciudad,
    departamento: venta.cliente_departamento,
  };

  const tipoCFE = getCFETipo(cliente);
  const esFactura = tipoCFE === '111';

  let totNoGrav = 0;
  let totNetoMin = 0;
  let totNetoBasica = 0;
  let totIvaMin = 0;
  let totIvaBasica = 0;

  const detalle = detalleQ.rows.map((row) => {
    const cantidad = Number(row.cantidad || 1);
    const precioUnitario = round2(row.precio_unitario);
    const montoItem = round2(cantidad * precioUnitario);
    const indFact = getIteIndFact(row.iva_codigo);
    const porcentaje = Number(row.iva_porcentaje || 0) / 100;

    if (indFact === 2 && porcentaje > 0) {
      const neto = round2(montoItem / (1 + porcentaje));
      const iva = round2(montoItem - neto);
      totNetoMin += neto;
      totIvaMin += iva;
    } else if (indFact === 3 && porcentaje > 0) {
      const neto = round2(montoItem / (1 + porcentaje));
      const iva = round2(montoItem - neto);
      totNetoBasica += neto;
      totIvaBasica += iva;
    } else {
      totNoGrav += montoItem;
    }

    const codeTipo = getCodiTpoCod(row.ean);
    const codValue = codeTipo === 'INT1' ? String(row.producto_id) : String(row.ean);

    return {
      IteCodiTpoCod: codeTipo,
      IteCodiCod: codValue,
      IteIndFact: String(indFact),
      IteNomItem: String(row.producto_nombre || '').slice(0, 80),
      IteDscItem: '',
      IteCantidad: cantidad.toFixed(3),
      IteUniMed: getUniMed(row.unidad),
      ItePrecioUnitario: precioUnitario.toFixed(4),
      IteDescuentoPct: '0.00',
      IteDescuentoMonto: '0.00',
      IteMontoItem: montoItem.toFixed(2),
    };
  });

  totNoGrav = round2(totNoGrav);
  totNetoMin = round2(totNetoMin);
  totNetoBasica = round2(totNetoBasica);
  totIvaMin = round2(totIvaMin);
  totIvaBasica = round2(totIvaBasica);
  const totTotal = round2(totNoGrav + totNetoMin + totNetoBasica + totIvaMin + totIvaBasica);
  const totPagar = totTotal;

  const pagosQ = await query(
    \`SELECT medio_pago FROM public.pagos WHERE venta_id = $1 ORDER BY id ASC LIMIT 1\`,
    [ventaId]
  );
  const medioPago = pagosQ.rowCount ? pagosQ.rows[0].medio_pago : (venta.medio_pago || 'efectivo');

  const receptor = (() => {
    const rcpTipoDoc = getRcpTipoDoc(cliente.tipo_documento);
    if (!esFactura && !rcpTipoDoc) return null;
    return {
      RcpTipoDocRecep: rcpTipoDoc ? String(rcpTipoDoc) : '',
      RcpTipoDocDscRecep: '',
      RcpCodPaisRecep: (rcpTipoDoc === 2 || rcpTipoDoc === 3) ? 'UY' : '',
      RcpDocRecep: String(cliente.numero_documento || '').slice(0, 20),
      RcpRznSocRecep: String(cliente.nombre || '').slice(0, 150),
      RcpDirRecep: String(cliente.direccion || '').slice(0, 70),
      RcpCiudadRecep: String(cliente.ciudad || '').slice(0, 30),
      RcpDeptoRecep: String(cliente.departamento || '').slice(0, 30),
      RcpCP: '',
      RcpCorreoRecep: String(cliente.correo || '').slice(0, 100),
      RcpInfAdiRecep: '',
      RcpDirPaisRecep: '',
      RcpDstEntregaRecep: '',
    };
  })();

  return {
    ambiente: 'PRUEBAS',
    Master: {
      CFETipoCFE: tipoCFE,
      CFESerie: '',
      CFENro: '',
      CFEFchEmis: formatDateTime(venta.fecha),
      CFEMntBruto: '1',
      CFEFmaPago: getFmaPago(medioPago),
      CFEFchVenc: formatDate(fechaBase),
      CFETipoTraslado: '1',
      CFEAdenda: venta.observacion || '',
      CFENumReferencia: String(venta.id),
      CFEImpFormato: '2',
      CFEIdCompra: '',
      CFEIdCompraApodo: '',
      CFETpoOperacion: '1',
      CFEQrCode: '3',
      CFERepImpresa: '2',
      CFEInfAdicional: '',
    },
    Emisor: {
      EmiRznSoc: String(empresa.razon_social || empresa.nombre || '').slice(0, 150),
      EmiComercial: String(empresa.nombre || '').slice(0, 30),
      EmiGiroEmis: String(empresa.giro || '').slice(0, 60),
      EmiTelefono: String(empresa.telefono || '').slice(0, 20),
      EmiTelefono2: '',
      EmiCorreoEmisor: String(empresa.correo || '').slice(0, 80),
      EmiSucursal: '',
      EmiDomFiscal: String(empresa.direccion || '').slice(0, 60),
      EmiCiudad: String(empresa.ciudad || '').slice(0, 30),
      EmiDepartamento: String(empresa.departamento || '').slice(0, 30),
      EmiInfAdicional: '',
    },
    Receptor: receptor,
    Totales: {
      TotTpoMoneda: 'UYU',
      TotTpoCambio: '',
      TotMntNoGrv: totNoGrav.toFixed(2),
      TotMntExpoyAsim: '0.00',
      TotMntImpuestoPerc: '0.00',
      TotMntIVaenSusp: '0.00',
      TotMntNetoIvaTasaMin: totNetoMin.toFixed(2),
      TotMntNetoIVATasaBasica: totNetoBasica.toFixed(2),
      TotMntNetoIVAOtra: '0.00',
      TotMntIVATasaMin: totIvaMin.toFixed(2),
      TotMntIVATasaBasica: totIvaBasica.toFixed(2),
      TotMntIVAOtra: '0.00',
      TotMntTotal: totTotal.toFixed(2),
      TotMontoNF: '0.00',
      TotMntPagar: totPagar.toFixed(2),
      MedPagCodMP: getCodMP(medioPago),
      MedPagGlosaMP: getGlosaMP(medioPago),
    },
    Detalle: detalle,
    Referencia: [],
  };
}
`;

try {
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✓ Successfully created cfeBuilder.js');
  console.log('  Location:', filePath);
  console.log('  Size:', fs.statSync(filePath).size, 'bytes');
} catch (err) {
  console.error('✗ Error:', err.message);
  process.exit(1);
}
`;

fs.writeFileSync('D:\\repos\\ferco-posta\\setup-cfe-file.js', setupCode, 'utf8');
