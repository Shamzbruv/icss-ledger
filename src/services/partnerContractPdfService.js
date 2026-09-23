const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { buildPartnerContractData, renderPartnerContractSections, formatDateLong, ACKNOWLEDGEMENTS } = require('./partnerContractTemplate');

const NAVY = '#101b3d';
const DARK = '#222222';
const GRAY = '#666666';
const TEAL = '#129c86';

function ensureSpace(doc, needed, marginBottom = 60) {
  const bottom = doc.page.height - marginBottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

function drawBlock(doc, block, ctx) {
  const { margin, contentWidth } = ctx;
  switch (block.type) {
    case 'title':
      ensureSpace(doc, 40);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16)
        .text(block.text, margin, doc.y, { width: contentWidth, align: 'center' });
      doc.moveDown(1);
      break;
    case 'h2':
      ensureSpace(doc, 30);
      doc.moveDown(0.6);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12.5)
        .text(block.text, margin, doc.y, { width: contentWidth });
      doc.moveTo(margin, doc.y + 4).lineTo(margin + contentWidth, doc.y + 4).strokeColor('#dddddd').lineWidth(1).stroke();
      doc.moveDown(0.6);
      break;
    case 'h3':
      ensureSpace(doc, 24);
      doc.moveDown(0.3);
      doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(10)
        .text(block.text, margin, doc.y, { width: contentWidth });
      doc.moveDown(0.25);
      break;
    case 'p':
      doc.fillColor(DARK).font('Helvetica').fontSize(9)
        .text(block.text, margin, doc.y, { width: contentWidth, align: 'justify', lineGap: 1.5 });
      doc.moveDown(0.4);
      break;
    case 'ul':
      block.items.forEach((item) => {
        doc.fillColor(DARK).font('Helvetica').fontSize(9)
          .text(`•  ${item}`, margin + 12, doc.y, { width: contentWidth - 12, lineGap: 1.5 });
      });
      doc.moveDown(0.4);
      break;
    case 'field':
      ensureSpace(doc, 16);
      if (block.long) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(`${block.label}:`, margin, doc.y, { width: contentWidth });
        doc.font('Helvetica').fontSize(9).fillColor(DARK).text(String(block.value ?? ''), margin, doc.y, { width: contentWidth, align: 'justify', lineGap: 1.5 });
        doc.moveDown(0.4);
      } else {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(`${block.label}:  `, margin, doc.y, { continued: true, width: contentWidth });
        doc.font('Helvetica').fillColor(DARK).text(String(block.value ?? ''));
        doc.moveDown(0.3);
      }
      break;
    default:
      break;
  }
}

function drawAcknowledgements(doc, contract, data, ctx) {
  const { margin, contentWidth } = ctx;
  const ack = contract.acknowledgements || {};

  ensureSpace(doc, 60);
  doc.moveDown(0.5);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('ACKNOWLEDGEMENTS', margin, doc.y, { width: contentWidth });
  doc.moveTo(margin, doc.y + 4).lineTo(margin + contentWidth, doc.y + 4).strokeColor('#dddddd').lineWidth(1).stroke();
  doc.moveDown(0.7);

  ACKNOWLEDGEMENTS.forEach((item) => {
    const checked = ack[item.key] === true;
    ensureSpace(doc, 30);
    doc.fillColor(checked ? '#1a7f37' : '#999999').font('Helvetica-Bold').fontSize(10)
      .text(checked ? '☑  ' : '☐  ', margin, doc.y, { continued: true, width: contentWidth });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5).text(item.title);
    doc.fillColor(DARK).font('Helvetica').fontSize(9)
      .text(item.text(data), margin + 18, doc.y, { width: contentWidth - 18, lineGap: 1.5 });
    doc.moveDown(0.5);
  });
}

function drawSignatures(doc, contract, data, ctx) {
  const { margin, contentWidth } = ctx;
  const colWidth = (contentWidth - 30) / 2;
  const leftX = margin;
  const rightX = margin + colWidth + 30;

  ensureSpace(doc, 170);
  doc.moveDown(0.5);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('SIGNATURES', margin, doc.y, { width: contentWidth });
  doc.moveTo(margin, doc.y + 4).lineTo(margin + contentWidth, doc.y + 4).strokeColor('#dddddd').lineWidth(1).stroke();
  doc.moveDown(1);

  const blockTop = doc.y;

  // --- Company signature (left) ---
  const signaturePath = path.join(__dirname, '../../public/assets/signature.png');
  let leftY = blockTop;
  if (fs.existsSync(signaturePath)) {
    doc.image(signaturePath, leftX, leftY, { width: 110 });
    leftY += 62;
  } else {
    doc.font('Helvetica-Oblique').fontSize(16).fillColor(DARK).text(data.companySignerName, leftX, leftY + 20, { width: colWidth });
    leftY += 62;
  }
  doc.moveTo(leftX, leftY).lineTo(leftX + colWidth, leftY).strokeColor('#aaaaaa').lineWidth(0.75).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(data.companySignerName, leftX, leftY + 6, { width: colWidth });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text(`Authorized Signature — ${data.companyName}`, leftX, doc.y, { width: colWidth });
  doc.text(`Signed: ${formatDateLong(contract.company_signed_at || new Date())}`, leftX, doc.y, { width: colWidth });

  // --- Partner signature (right) ---
  let rightY = blockTop;
  const isSigned = contract.status === 'signed' && contract.signature_data;

  if (isSigned && contract.signature_type === 'drawn' && String(contract.signature_data).startsWith('data:image')) {
    try {
      const base64 = contract.signature_data.split(',')[1];
      const imgBuffer = Buffer.from(base64, 'base64');
      doc.image(imgBuffer, rightX, rightY, { width: 130, height: 55, fit: [130, 55] });
      rightY += 62;
    } catch (e) {
      doc.font('Helvetica-Oblique').fontSize(16).fillColor(DARK).text(contract.signer_legal_name || '', rightX, rightY + 20, { width: colWidth });
      rightY += 62;
    }
  } else if (isSigned) {
    doc.font('Helvetica-Oblique').fontSize(18).fillColor(DARK).text(contract.signature_data || contract.signer_legal_name || '', rightX, rightY + 15, { width: colWidth });
    rightY += 62;
  } else {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#aa6600').text('Pending partner signature', rightX, rightY + 25, { width: colWidth });
    rightY += 62;
  }

  doc.moveTo(rightX, rightY).lineTo(rightX + colWidth, rightY).strokeColor('#aaaaaa').lineWidth(0.75).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK)
    .text(isSigned ? (contract.signer_legal_name || data.partnerName) : data.partnerName, rightX, rightY + 6, { width: colWidth });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Partner Signature', rightX, doc.y, { width: colWidth });
  doc.text(isSigned && contract.signed_at ? `Signed: ${formatDateLong(contract.signed_at)}` : 'Not yet signed', rightX, doc.y, { width: colWidth });

  doc.y = Math.max(leftY, doc.y) + 10;

  if (isSigned) {
    ensureSpace(doc, 60);
    doc.moveDown(0.8);
    doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(8).text('AUDIT TRAIL', margin, doc.y, { width: contentWidth });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY);
    doc.text(`Signed At: ${contract.signed_at ? new Date(contract.signed_at).toLocaleString('en-US') : 'N/A'}`, margin, doc.y, { width: contentWidth });
    doc.text(`IP Address: ${contract.signer_ip || 'N/A'}`, margin, doc.y, { width: contentWidth });
    if (contract.signer_user_agent) {
      doc.text(`Device: ${String(contract.signer_user_agent).slice(0, 160)}`, margin, doc.y, { width: contentWidth });
    }
  }
}

/**
 * Generates the Partner Agreement PDF for a `partner_contracts` row. Mirrors
 * contractPdfService.js: uses `terms_snapshot_json` (frozen at send-time) when present.
 * @param {Object} contract - a `partner_contracts` table row
 * @returns {Promise<Buffer>}
 */
function generatePartnerContractPDF(contract) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER', bufferPages: true });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const sourceData = contract.terms_snapshot_json || contract;
      const data = buildPartnerContractData(sourceData);
      const sections = renderPartnerContractSections(data.templateId, data);

      const margin = 50;
      const width = doc.page.width;
      const contentWidth = width - margin * 2;
      const ctx = { margin, contentWidth };

      // --- Header ---
      const logoPath = path.join(__dirname, '../../public/assets/icss-logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin, 40, { width: 44 });
      }
      doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold').text(data.companyName, margin + 55, 44, { width: contentWidth - 200 });
      doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
        .text(`${data.productName} Partner Agreement  •  icreatesolutionsandservices.com`, margin + 55, 62, { width: contentWidth - 200 });

      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('PARTNER AGREEMENT', margin, 100, { width: contentWidth, align: 'right' });
      const refLine = data.agreementReference ? `Ref: ${data.agreementReference}` : '';
      const statusLine = contract.status ? `Status: ${String(contract.status).toUpperCase()}` : '';
      doc.fillColor(GRAY).fontSize(8).font('Helvetica')
        .text([refLine, statusLine].filter(Boolean).join('   •   '), margin, 116, { width: contentWidth, align: 'right' });

      doc.moveTo(margin, 140).lineTo(width - margin, 140).strokeColor('#dddddd').lineWidth(1).stroke();
      doc.y = 155;

      sections.forEach((block) => drawBlock(doc, block, ctx));
      drawAcknowledgements(doc, contract, data, ctx);
      drawSignatures(doc, contract, data, ctx);

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.height - 40;
        doc.fontSize(7.5).fillColor('#999999').font('Helvetica')
          .text(
            `${data.agreementReference || 'Partner Agreement'}   •   Page ${i - range.start + 1} of ${range.count}   •   Generated ${new Date().toLocaleDateString('en-US')}`,
            margin, bottom, { width: contentWidth, align: 'center' }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePartnerContractPDF };
