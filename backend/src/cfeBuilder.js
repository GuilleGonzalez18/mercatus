import { query } from './db.js';
import {
  round2, round4, formatDate, formatDateTime,
  getIteIndFact, getFmaPago, getGlosaMP, getCodMP,
  getRcpTipoDoc, getCFETipo, validateRut, getUniMed, getCodiTpoCod,
  calcDescuentoGlobal, distributeGlobalDiscount,
} from './cfeHelpers.js';

export async function buildCFE(ventaId) {
  const ventaQ = await query(
    `SELECT v.*,
            c.nombre AS cliente_nombre, c.tipo_documento, c.numero_documento,
            c.direccion AS cliente_direccion, c.correo AS cliente_correo,
            c.codigo_postal AS cliente_cp,
            COALESCE(b.nombre, c.ciudad) AS cliente_ciudad,
            COALESCE(dep.nombre, depc.nombre) AS cliente_departamento
     FROM public.ventas v
     LEFT JOIN public.clientes c ON c.id = v.cliente_id
     LEFT JOIN public.barrios b ON b.id = c.barrio_id
     LEFT JOIN public.departamentos dep ON dep.id = c.departamento_id
     LEFT JOIN public.departamentos depc ON depc.id = b.departamento_id
     WHERE v.id = $1`,
    [ventaId]
  );
  if (!ventaQ.rowCount) throw new Error(`Venta ${ventaId} no encontrada`);
  const venta = ventaQ.rows[0];

  const detalleQ = await query(
    `SELECT vd.id, vd.cantidad, vd.precio_unitario,
            vd.packs, vd.unidades_sueltas, vd.unidades_por_empaque, vd.tipo_empaque,
            vd.precio_empaque, vd.precio_unidad, vd.modo_venta,
            vd.descuento_tipo, vd.descuento_valor, vd.descuento_aplicado,
            vd.descuento_packs_tipo, vd.descuento_packs_valor, vd.descuento_packs_aplicado,
            p.id AS producto_id, p.nombre AS producto_nombre, p.ean, p.unidad,
            p.iva_id, ti.codigo AS iva_codigo, ti.porcentaje AS iva_porcentaje
     FROM public.venta_detalle vd
     INNER JOIN public.productos p ON p.id = vd.producto_id
     LEFT JOIN public.tipos_iva ti ON ti.id = p.iva_id
     WHERE vd.venta_id = $1
     ORDER BY vd.id ASC`,
    [ventaId]
  );

  const empresaQ = await query(
    `SELECT nombre, razon_social, rut, direccion, telefono, correo,
            giro, ciudad, departamento, cfe_ambiente
     FROM public.config_empresa LIMIT 1`
  );
  const empresa = empresaQ.rows[0] || {};

  if (!empresa.ciudad || !empresa.departamento) {
    throw new Error('Ciudad y Departamento del emisor son requeridos para emitir CFE. Configurar en Ajustes → Empresa.');
  }

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

  // Validar formato de RUT cuando se emite eFactura
  if (
    esFactura &&
    String(cliente.tipo_documento || '').toUpperCase() === 'RUT' &&
    !validateRut(cliente.numero_documento)
  ) {
    throw new Error(`RUT inválido: "${cliente.numero_documento}". El RUT debe tener entre 9 y 12 dígitos.`);
  }

  let totNoGrav = 0;
  let totNetoMin = 0;
  let totNetoBasica = 0;
  let totIvaMin = 0;
  let totIvaBasica = 0;

  // --- Primera pasada: construir líneas brutas ---
  const rawLines = [];

  for (const row of detalleQ.rows) {
    const packs = Number(row.packs ?? 0);
    const sueltas = Number(row.unidades_sueltas ?? 0);
    const packSize = Math.max(1, Number(row.unidades_por_empaque || 1));
    const precioEmpaque = round4(row.precio_empaque || 0);
    const precioUnidad = round4(row.precio_unidad || row.precio_unitario);
    const indFact = getIteIndFact(row.iva_codigo);
    const porcentaje = Number(row.iva_porcentaje || 0) / 100;
    const codeTipo = getCodiTpoCod(row.ean);
    const codValue = codeTipo === 'INT1' ? String(row.producto_id) : String(row.ean);
    const nombreItem = String(row.producto_nombre || '').slice(0, 80);

    const hasPacks = packs > 0 && precioEmpaque > 0;
    const hasSueltas = sueltas > 0;
    const hasOldData = !hasPacks && !hasSueltas;

    // Para la línea de empaques expresamos en unidades totales con descripción del empaque
    const unidadesPacks = packs * packSize;
    const montoPacksBruto = hasPacks ? round2(unidadesPacks * precioUnidad) : 0;
    const montoSueltasBruto = hasSueltas ? round2(sueltas * precioUnidad) : 0;

    // Usar descuentos almacenados directamente (independientes por packs/sueltas)
    const descuentoSueltasAplicado = round2(row.descuento_aplicado || 0);
    const descuentoPacksAplicado = round2(row.descuento_packs_aplicado || 0);

    const lineBase = { indFact, porcentaje, codeTipo, codValue, nombreItem };
    const uniMedUnidad = getUniMed(row.unidad);

    if (hasOldData) {
      const cantidad = Number(row.cantidad || 1);
      const precioU = round2(row.precio_unitario);
      const monto = round2(cantidad * precioU);
      rawLines.push({ ...lineBase, cantidad, precio: precioU, monto, descItem: descuentoSueltasAplicado, uniMed: uniMedUnidad, dscItem: '' });
    } else {
      if (hasPacks) {
        const tipoEmpaque = row.tipo_empaque || 'Empaque';
        const dscItem = `${packs} ${tipoEmpaque}${packs !== 1 ? 's' : ''} x ${packSize} unidades`;
        rawLines.push({ ...lineBase, cantidad: unidadesPacks, precio: precioUnidad, monto: montoPacksBruto, descItem: descuentoPacksAplicado, uniMed: uniMedUnidad, dscItem });
      }
      if (hasSueltas) {
        rawLines.push({ ...lineBase, cantidad: sueltas, precio: precioUnidad, monto: montoSueltasBruto, descItem: descuentoSueltasAplicado, uniMed: uniMedUnidad, dscItem: '' });
      }
    }
  }

  // --- Calcular descuento global y distribuirlo ---
  const baseNetaItems = round2(rawLines.reduce((acc, l) => acc + l.monto - l.descItem, 0));
  const descTotalTipo = venta.descuento_total_tipo || 'ninguno';
  const descTotalValorRaw = Number(venta.descuento_total_valor || 0);
  const descGlobalAmount = calcDescuentoGlobal(descTotalTipo, descTotalValorRaw, baseNetaItems);

  // --- Segunda pasada: construir detalle CFE con descuento total por línea ---
  const netasLinea = rawLines.map((l) => round2(l.monto - l.descItem));
  const globalPorLinea = distributeGlobalDiscount(netasLinea, descGlobalAmount);
  const detalle = [];

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const descGlobalLinea = globalPorLinea[i];

    const descTotal = round2(l.descItem + descGlobalLinea);
    const montoNeto = round2(l.monto - descTotal);

    if (l.indFact === 2 && l.porcentaje > 0) {
      const neto = round2(montoNeto / (1 + l.porcentaje));
      totNetoMin += neto;
      totIvaMin += round2(montoNeto - neto);
    } else if (l.indFact === 3 && l.porcentaje > 0) {
      const neto = round2(montoNeto / (1 + l.porcentaje));
      totNetoBasica += neto;
      totIvaBasica += round2(montoNeto - neto);
    } else {
      totNoGrav += montoNeto;
    }

    const descPct = l.monto > 0 ? round2((descTotal / l.monto) * 100) : 0;
    const itemLine = {
      IteCodiTpoCod: l.codeTipo,
      IteCodiCod: l.codValue,
      IteIndFact: String(l.indFact),
      IteNomItem: l.nombreItem,
      IteDscItem: l.dscItem || '',
      IteCantidad: l.cantidad.toFixed(3),
      IteUniMed: l.uniMed,
      ItePrecioUnitario: l.precio.toFixed(4),
      IteMontoItem: round2(l.monto - descTotal).toFixed(2),
    };
    // IteDescuentoPct y IteDescuentoMonto son opcionales — solo incluir si hay descuento real
    if (descTotal > 0) {
      itemLine.IteDescuentoPct = descPct.toFixed(2);
      itemLine.IteDescuentoMonto = descTotal.toFixed(2);
    }
    detalle.push(itemLine);
  }

  totNoGrav = round2(totNoGrav);
  totNetoMin = round2(totNetoMin);
  totNetoBasica = round2(totNetoBasica);
  totIvaMin = round2(totIvaMin);
  totIvaBasica = round2(totIvaBasica);
  const totTotal = round2(totNoGrav + totNetoMin + totNetoBasica + totIvaMin + totIvaBasica);

  const pagosQ = await query(
    `SELECT medio_pago FROM public.pagos WHERE venta_id = $1 ORDER BY id ASC LIMIT 1`,
    [ventaId]
  );
  const medioPago = pagosQ.rowCount
    ? pagosQ.rows[0].medio_pago
    : venta.medio_pago || 'efectivo';

  const rcpTipoDoc = getRcpTipoDoc(cliente.tipo_documento);
  // Determinar código de país según tipo de documento
  function getRcpCodPais(tipoDoc) {
    const t = Number(tipoDoc);
    if (t === 2 || t === 3) return 'UY'; // RUT o CI → Uruguay
    if (t === 6) return '';               // DNI AR/BR/CL/PY → depende del país, dejar vacío
    if (t === 1 || t === 5 || t === 7) return ''; // NIE, Pasaporte, NIFE → no determinado
    if (t === 4) return '99';             // Otros → código genérico ISO 3166-1
    return '';
  }
  const receptor =
    esFactura || rcpTipoDoc
      ? {
          RcpTipoDocRecep: rcpTipoDoc ? String(rcpTipoDoc) : '',
          RcpTipoDocDscRecep: '',
          RcpCodPaisRecep: getRcpCodPais(rcpTipoDoc),
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
        }
      : null;

  return {
    ambiente: empresa.cfe_ambiente === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBAS',
    Master: {
      CFETipoCFE: tipoCFE,
      CFESerie: '',
      CFENro: '',
      CFEFchEmis: formatDate(venta.fecha),
      CFEMntBruto: '1',
      CFEFmaPago: getFmaPago(medioPago),
      CFEFchVenc: formatDate(venta.fecha_entrega) || formatDate(venta.fecha),
      CFETipoTraslado: '1',
      CFEAdenda: venta.observacion || '',
      CFENumReferencia: String(venta.id),
      CFEImpFormato: '2',
      CFEIdCompra: '',
      CFEIdCompraApodo: '',
      CFEExpClaVenta: '',
      CFEExpModVenta: '',
      CFEExpViaTransporte: '',
      CFETpoOperacion: '1',
      CFEQrCode: '3',
      CFERepImpresa: '2',
      CFEInfAdicional: '',
      CFECobranzaPropia: '',
      CFESecretoProfesional: '',
      CFEPagoCuentaTerceros: '',
      CFEIndCompraME: '',
      CFENombreLogo: '',
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
    Receptor: receptor ?? {
      RcpTipoDocRecep: '',
      RcpTipoDocDscRecep: '',
      RcpCodPaisRecep: '',
      RcpDocRecep: '',
      RcpRznSocRecep: 'CONSUMIDOR FINAL',
      RcpDirRecep: '',
      RcpCiudadRecep: '',
      RcpDeptoRecep: '',
      RcpCP: '',
      RcpCorreoRecep: '',
      RcpInfAdiRecep: '',
      RcpDirPaisRecep: '',
      RcpDstEntregaRecep: '',
    },
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
      TotMntPagar: totTotal.toFixed(2),
      MedPagCodMP: getCodMP(medioPago),
      MedPagGlosaMP: getGlosaMP(medioPago),
    },
    Mandante: {
      MndTipDoc: '',
      MndTipDocDsc: '',
      MndCodPais: '',
      MndNroDocumento: '',
      MndRazSocial: '',
      MndEncriptar: '',
    },
    Detalle: detalle,
    Referencia: [],
  };
}
