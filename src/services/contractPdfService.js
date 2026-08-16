const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { buildContractData, renderContractSections, formatDateLong, ACKNOWLEDGEMENTS } = require('./contractTemplate');

const NAVY = '#0B2447';
const DARK = '#222222';
const GRAY = '#666666';
const ORANGE = '#FF8C00';

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
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18)
        .text(block.text, margin, doc.y, { width: contentWidth, align: 'center' });
      doc.moveDown(1);
      break;
    case 'h1':
      ensureSpace(doc, 30);
      doc.moveDown(0.8);
      doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(9)
        .text(block.text, margin, doc.y, { width: contentWidth, characterSpacing: 1.2 });
      doc.moveDown(0.2);
      break;
    case 'h2':
      ensureSpace(doc, 30);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14)
        .text(block.text, margin, doc.y, { width: contentWidth });
      doc.moveTo(margin, doc.y + 4).lineTo(margin + contentWidth, doc.y + 4).strokeColor('#dddddd').lineWidth(1).stroke();
      doc.moveDown(0.8);
      break;
    case 'h3':
      ensureSpace(doc, 24);
      doc.moveDown(0.4);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5)
        .text(block.text, margin, doc.y, { width: contentWidth });
      doc.moveDown(0.3);
      break;
    case 'p':
      doc.fillColor(DARK).font('Helvetica').fontSize(9.3)
        .text(block.text, margin, doc.y, { width: contentWidth, align: 'justify', lineGap: 1.5 });
      doc.moveDown(0.5);
      break;
    case 'ul':
      block.items.forEach((item) => {
        doc.fillColor(DARK).font('Helvetica').fontSize(9.3)
          .text(`•  ${item}`, margin + 12, doc.y, { width: contentWidth - 12, lineGap: 1.5 });
      });
      doc.moveDown(0.5);
      break;
    case 'ol':
      block.items.forEach((item, idx) => {
        doc.fillColor(DARK).font('Helvetica').fontSize(9.3)
          .text(`${idx + 1}.  ${item}`, margin + 12, doc.y, { width: contentWidth - 12, lineGap: 1.5 });
      });
      doc.moveDown(0.5);
      break;
    case 'field':
      ensureSpace(doc, 16);
      if (block.long) {
        doc.font('Helvetica-Bold').fontSize(9.3).fillColor(NAVY).text(`${block.label}:`, margin, doc.y, { width: contentWidth });
        doc.font('Helvetica').fontSize(9.3).fillColor(DARK).text(String(block.value ?? ''), margin, doc.y, { width: contentWidth, align: 'justify', lineGap: 1.5 });
        doc.moveDown(0.5);
      } else {
        doc.font('Helvetica-Bold').fontSize(9.3).fillColor(NAVY).text(`${block.label}:  `, margin, doc.y, { continued: true, width: contentWidth });
        doc.font('Helvetica').fillColor(DARK).text(String(block.value ?? ''));
        doc.moveDown(0.35);
      }
      break;
    default:
      break;
  }
}

function drawAcknowledgements(doc, contract, ctx) {
  const { margin, contentWidth } = ctx;
  const ack = contract.acknowledgements || {};

  ensureSpace(doc, 60);
  doc.moveDown(0.5);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text('ACKNOWLEDGEMENTS', margin, doc.y, { width: contentWidth });
  doc.moveTo(margin, doc.y + 4).lineTo(margin + contentWidth, doc.y + 4).strokeColor('#dddddd').lineWidth(1).stroke();
  doc.moveDown(0.8);

  ACKNOWLEDGEMENTS.forEach((item) => {
    const checked = ack[item.key] === true;
    ensureSpace(doc, 30);
    doc.fillColor(checked ? '#1a7f37' : '#999999').font('Helvetica-Bold').fontSize(10)
      .text(checked ? '☑  ' : '☐  ', margin, doc.y, { continued: true, width: contentWidth });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5).text(item.title);
    doc.fillColor(DARK).font('Helvetica').fontSize(9)
      .text(item.text(contract), margin + 18, doc.y, { width: contentWidth - 18, lineGap: 1.5 });

    if (item.items) {
      item.items.forEach((sub) => {
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
          .text(`–  ${sub}`, margin + 30, doc.y, { width: contentWidth - 30, lineGap: 1 });
      });
    }
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
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text('SIGNATURES', margin, doc.y, { width: contentWidth });
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
    .text('Authorized Signature — I Create Solutions & Services', leftX, doc.y, { width: colWidth });
  doc.text(`Signed: ${formatDateLong(data.companySignedAt) || formatDateLong(new Date())}`, leftX, doc.y, { width: colWidth });

  // --- Client signature (right) ---
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
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#aa6600').text('Pending client signature', rightX, rightY + 25, { width: colWidth });
    rightY += 62;
  }

  doc.moveTo(rightX, rightY).lineTo(rightX + colWidth, rightY).strokeColor('#aaaaaa').lineWidth(0.75).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK)
    .text(isSigned ? (contract.signer_legal_name || data.clientName) : data.clientName, rightX, rightY + 6, { width: colWidth });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Client Signature', rightX, doc.y, { width: colWidth });
  doc.text(isSigned ? `Signed: ${formatDateLong(contract.signed_at) || ''}` : 'Not yet signed', rightX, doc.y, { width: colWidth });

  doc.y = Math.max(leftY, doc.y) + 10;

  // --- Audit trail (only once signed) ---
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
 * Generates the full Project Service Agreement PDF for a contract row.
 * Uses `terms_snapshot_json` (frozen at send-time) when present so the PDF always
 * reflects exactly what the client was shown, falling back to the live row for drafts
 * that have never been sent.
 * @param {Object} contract - a `contracts` table row
 * @returns {Promise<Buffer>}
 */
function generateContractPDF(contract) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER', bufferPages: true });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const sourceData = contract.terms_snapshot_json || contract;
      const data = buildContractData(sourceData);
      const sections = renderContractSections(data);

      const margin = 50;
      const width = doc.page.width;
      const contentWidth = width - margin * 2;
      const ctx = { margin, contentWidth };

      // --- Header ---
      const logoPath = path.join(__dirname, '../../public/assets/icss-logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin, 40, { width: 44 });
      }
      doc.fillColor(NAVY).fontSize(14).font('Helvetica-Bold').text('I Create Solutions & Services', margin + 55, 44, { width: contentWidth - 200 });
      doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
        .text('Home Office, St Andrew, Kingston, Jamaica  •  876-585-7469  •  www.icreatesolutionsandservices.com', margin + 55, 62, { width: contentWidth - 200 });

      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('SERVICE AGREEMENT', margin, 100, { width: contentWidth, align: 'right' });
      const refLine = data.agreementReference ? `Ref: ${data.agreementReference}` : '';
      const statusLine = contract.status ? `Status: ${String(contract.status).toUpperCase()}` : '';
      doc.fillColor(GRAY).fontSize(8).font('Helvetica')
        .text([refLine, statusLine].filter(Boolean).join('   •   '), margin, 116, { width: contentWidth, align: 'right' });

      doc.moveTo(margin, 140).lineTo(width - margin, 140).strokeColor('#dddddd').lineWidth(1).stroke();
      doc.y = 155;

      sections.forEach((block) => drawBlock(doc, block, ctx));
      drawAcknowledgements(doc, contract, ctx);
      drawSignatures(doc, contract, data, ctx);

      // --- Footer with page numbers on every page ---
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.height - 40;
        doc.fontSize(7.5).fillColor('#999999').font('Helvetica')
          .text(
            `${data.agreementReference || 'ICSS Service Agreement'}   •   Page ${i - range.start + 1} of ${range.count}   •   Generated ${new Date().toLocaleDateString('en-US')}`,
            margin, bottom, { width: contentWidth, align: 'center' }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateContractPDF };
