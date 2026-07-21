/**
 * Fallback e-CF PDF generator (pdfkit-based).
 *
 * Used when Citrus's representacionImpresa endpoint returns no content —
 * primarily in the Simulación environment.  The layout mirrors the official
 * Citrus-generated PDF so it can serve as a usable preview.
 */
import PDFDocument from 'pdfkit';
import type { IEcfLineItem } from '../models/ElectronicInvoice';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface TenantInfoForPdf {
  razonSocial: string;
  rnc: string;
  phone?: string;
  nombreComercial?: string;
}

export interface InvoiceDataForPdf {
  eNCF: string;
  tipo: string;
  totalFactura: number;
  totalImpuestos: number;
  tipoPago?: string;
  lineItems?: IEcfLineItem[];
  buyerRnc?: string;
  buyerName?: string;
  issuedAt: Date;
  codigoSeguridad?: string;
  fechaFirmaDigital?: Date;
  urlCodigoQr?: string;
  numeroFacturaInterna?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ORANGE = '#E85C25';
const BLACK  = '#1A1A1A';
const GRAY   = '#666666';
const LINE_GRAY = '#CCCCCC';
const FILL_LIGHT = '#FFF4EF';
const ROW_ALT = '#F9F9F9';

const TIPO_PAGO_LABELS: Record<string, string> = {
  '1': 'Contado',
  '2': 'Crédito',
  '3': 'Tarjeta',
  '4': 'Transferencia',
  '5': 'Cheque',
  '6': 'Mixto',
};

const TIPO_ECF_LABELS: Record<string, string> = {
  E31: 'FACTURA DE CRÉDITO FISCAL ELECTRÓNICA',
  E32: 'FACTURA DE CONSUMO ELECTRÓNICA',
  E33: 'FACTURA CON VALOR FISCAL ELECTRÓNICA',
  E34: 'NOTA DE CRÉDITO ELECTRÓNICA',
  E41: 'COMPRAS ELECTRÓNICAS',
  E43: 'GASTOS MENORES ELECTRÓNICOS',
  E44: 'REGÍMENES ESPECIALES ELECTRÓNICOS',
  E45: 'GUBERNAMENTALES ELECTRÓNICOS',
  E46: 'EXPORTACIONES ELECTRÓNICAS',
  E47: 'PAGOS EXTERIOR ELECTRÓNICOS',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateShort(d: Date): string {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function fmtDateTime(d: Date): string {
  const date = fmtDateShort(d);
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  const ss   = String(d.getSeconds()).padStart(2, '0');
  return `${date.replace(/\//g, '-')} ${hh}:${min}:${ss}`;
}

// ─── PDF generator ────────────────────────────────────────────────────────────

export function generateFallbackPdf(
  invoice: InvoiceDataForPdf,
  tenant: TenantInfoForPdf,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: invoice.eNCF, Author: tenant.razonSocial },
    });

    doc.on('data',  (chunk: Buffer) => chunks.push(chunk));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin    = 50;
    const pageW     = doc.page.width - margin * 2;  // usable width
    let   y         = margin;

    // ── Invoice type header ─────────────────────────────────────────────────
    const tipoLabel = TIPO_ECF_LABELS[invoice.tipo] ?? `e-CF Tipo ${invoice.tipo}`;

    doc
      .fontSize(12)
      .fillColor(ORANGE)
      .font('Helvetica-Bold')
      .text(tipoLabel, margin, y, { width: pageW, align: 'center' });
    y += 18;

    doc
      .moveTo(margin, y).lineTo(margin + pageW, y)
      .strokeColor(ORANGE).lineWidth(1.5).stroke();
    y += 10;

    // ── Two-column: issuer (left) | invoice meta (right) ───────────────────
    const colW   = pageW / 2 - 8;
    const leftX  = margin;
    const rightX = margin + pageW / 2 + 8;
    const blockStartY = y;

    // --- Issuer block -------------------------------------------------------
    doc.fontSize(9).fillColor(BLACK).font('Helvetica-Bold')
      .text(tenant.razonSocial.toUpperCase(), leftX, y, { width: colW });
    y += 13;

    if (tenant.nombreComercial && tenant.nombreComercial !== tenant.razonSocial) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica')
        .text(tenant.nombreComercial, leftX, y, { width: colW });
      y += 11;
    }

    doc.fontSize(8).fillColor(BLACK).font('Helvetica')
      .text(`RNC: ${tenant.rnc}`, leftX, y, { width: colW });
    y += 11;

    doc.text('República Dominicana', leftX, y, { width: colW });
    y += 11;

    if (tenant.phone) {
      doc.text(`Telefono: ${tenant.phone}`, leftX, y, { width: colW });
      y += 11;
    }

    // --- Invoice meta block (right) -----------------------------------------
    let ry = blockStartY;
    const lblW = 90;

    const metaRows: [string, string][] = [
      ['e-NCF:',           invoice.eNCF],
      ['Moneda:',          'Peso Dominicano'],
      ['Condicion:',       TIPO_PAGO_LABELS[invoice.tipoPago ?? ''] ?? '—'],
      ['Número Factura:',  invoice.numeroFacturaInterna ?? '—'],
      ['Fecha Emisión:',   fmtDateShort(invoice.issuedAt)],
    ];

    for (const [label, value] of metaRows) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
        .text(label, rightX, ry, { width: lblW });
      doc.fontSize(8).fillColor(BLACK).font('Helvetica')
        .text(value, rightX + lblW, ry, { width: colW - lblW });
      ry += 13;
    }

    y = Math.max(y, ry) + 8;

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.moveTo(margin, y).lineTo(margin + pageW, y)
      .strokeColor(LINE_GRAY).lineWidth(0.5).stroke();
    y += 8;

    // ── Buyer block ─────────────────────────────────────────────────────────
    const buyerLblW = 120;

    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
      .text('Documento Comprador:', leftX, y, { width: buyerLblW });
    doc.fontSize(8).fillColor(BLACK).font('Helvetica')
      .text(invoice.buyerRnc ?? '', leftX + buyerLblW, y, { width: colW - buyerLblW });

    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
      .text('Razon Social Comprador:', rightX, y, { width: buyerLblW });
    doc.fontSize(8).fillColor(BLACK).font('Helvetica')
      .text(invoice.buyerName ?? '', rightX + buyerLblW, y, { width: colW - buyerLblW });
    y += 16;

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.moveTo(margin, y).lineTo(margin + pageW, y)
      .strokeColor(LINE_GRAY).lineWidth(0.5).stroke();
    y += 8;

    // ── Line items table ─────────────────────────────────────────────────────
    const C_QTY   = { x: margin,                  w: 32 };
    const C_GROSS = { x: margin + pageW - 85,      w: 85 };
    const C_ITBIS = { x: margin + pageW - 85 - 75, w: 75 };
    const C_NET   = { x: margin + pageW - 85 - 75 - 75, w: 75 };
    const C_DESC  = { x: margin + 32, w: pageW - 32 - 75 - 75 - 85 };

    // Table header
    doc.rect(margin, y, pageW, 14).fillColor('#EFEFEF').fill();

    doc.fontSize(7.5).fillColor(BLACK).font('Helvetica-Bold');
    doc.text('Cant.',          C_QTY.x  + 2, y + 3, { width: C_QTY.w,  align: 'left'  });
    doc.text('Descripción',    C_DESC.x + 2, y + 3, { width: C_DESC.w, align: 'left'  });
    doc.text('Valor Neto',     C_NET.x,      y + 3, { width: C_NET.w,  align: 'right' });
    doc.text('ITBIS',          C_ITBIS.x,    y + 3, { width: C_ITBIS.w,align: 'right' });
    doc.text('Total',          C_GROSS.x,    y + 3, { width: C_GROSS.w,align: 'right' });
    y += 14;

    const items = invoice.lineItems ?? [];
    let rowIdx  = 0;
    for (const item of items) {
      const rowH = 13;
      if (rowIdx % 2 === 0) {
        doc.rect(margin, y, pageW, rowH).fillColor(ROW_ALT).fill();
      }
      doc.fontSize(7.5).fillColor(BLACK).font('Helvetica');
      doc.text(fmt(item.qty),                    C_QTY.x  + 2, y + 2, { width: C_QTY.w,  align: 'left'  });
      doc.text(item.description,                 C_DESC.x + 2, y + 2, { width: C_DESC.w, align: 'left'  });
      doc.text(fmt(item.netPrice),               C_NET.x,      y + 2, { width: C_NET.w,  align: 'right' });
      doc.text(fmt(item.itbisAmount),            C_ITBIS.x,    y + 2, { width: C_ITBIS.w,align: 'right' });
      doc.text(`DOP$ ${fmt(item.grossAmount)}`,  C_GROSS.x,    y + 2, { width: C_GROSS.w,align: 'right' });
      y += rowH;

      doc.moveTo(margin, y).lineTo(margin + pageW, y)
        .strokeColor(LINE_GRAY).lineWidth(0.3).stroke();
      rowIdx++;
    }

    y += 10;

    // ── Totals ──────────────────────────────────────────────────────────────
    const totW = 230;
    const totX = margin + pageW - totW;
    const labW = 120;
    const valW = totW - labW;

    doc.moveTo(totX, y).lineTo(margin + pageW, y)
      .strokeColor(LINE_GRAY).lineWidth(0.5).stroke();
    y += 6;

    const netSubtotal = invoice.totalFactura - invoice.totalImpuestos;

    const totRows: [string, string][] = [
      ['SubTotal Gravado:', fmt(netSubtotal)],
      ['Total ITBIS:',      fmt(invoice.totalImpuestos)],
    ];

    for (const [label, value] of totRows) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
        .text(label, totX, y, { width: labW, align: 'right' });
      doc.fontSize(8).fillColor(BLACK).font('Helvetica')
        .text(value, totX + labW, y, { width: valW, align: 'right' });
      y += 12;
    }

    // Grand total row
    doc.rect(totX, y, totW, 15).fillColor(FILL_LIGHT).fill();
    doc.fontSize(9).fillColor(ORANGE).font('Helvetica-Bold')
      .text('Total:', totX, y + 3, { width: labW, align: 'right' });
    doc.fontSize(9).fillColor(ORANGE).font('Helvetica-Bold')
      .text(`DOP$ ${fmt(invoice.totalFactura)}`, totX + labW, y + 3, { width: valW, align: 'right' });
    y += 20;

    // ── Security footer ──────────────────────────────────────────────────────
    y += 6;
    doc.moveTo(margin, y).lineTo(margin + pageW, y)
      .strokeColor(LINE_GRAY).lineWidth(0.5).stroke();
    y += 8;

    if (invoice.codigoSeguridad) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
        .text('Codigo de Seguridad: ', margin, y, { continued: true })
        .fillColor(BLACK).font('Helvetica')
        .text(invoice.codigoSeguridad);
      y += 11;
    }

    if (invoice.fechaFirmaDigital) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
        .text('Fecha Firma Digital: ', margin, y, { continued: true })
        .fillColor(BLACK).font('Helvetica')
        .text(fmtDateTime(invoice.fechaFirmaDigital));
      y += 11;
    }

    // Simulation disclaimer
    y += 6;
    doc.fontSize(7).fillColor(GRAY).font('Helvetica')
      .text(
        'Representación impresa generada localmente — ambiente de simulación. No tiene validez fiscal.',
        margin, y,
        { width: pageW, align: 'center' },
      );

    doc.end();
  });
}
