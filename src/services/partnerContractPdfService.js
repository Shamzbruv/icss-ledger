const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { buildPartnerContractData, renderPartnerContractSections, formatDateLong, getAcknowledgements } = require('./partnerContractTemplate');
const { REFERRAL_COMPANY_POSITION } = require('./referralContractTemplate');

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

/**
 * Draws text that may contain **bold** markers. pdfkit has no inline styles, so the text is
 * written in segments that continue on the same line. Rich paragraphs are left-aligned (justify
 * does not combine with continued segments).
 */
function drawRichText(doc, text, x, width, { size = 9, color = DARK, lineGap = 1.5 } = {}) {
  const raw = String(text ?? '');
  if (!raw.includes('**')) {
    doc.fillColor(color).font('Helvetica').fontSize(size)
      .text(raw, x, doc.y, { width, align: 'justify', lineGap });
    return;
  }
  // Empty segments (text that starts or ends with **) are dropped first: the final segment must be
  // a real piece of text, or pdfkit never ends the line and the next paragraph overprints it.
  const segments = raw.split('**').map((value, index) => ({ value, bold: index % 2 === 1 })).filter((segment) => segment.value !== '');
  segments.forEach((segment, index) => {
    doc.fillColor(color).font(segment.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const options = { width, align: 'left', lineGap, continued: index < segments.length - 1 };
    if (index === 0) doc.text(segment.value, x, doc.y, options);
    else doc.text(segment.value, options);
  });
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
      ensureSpace(doc, 64); // keep a heading together with the text that follows it
      doc.moveDown(0.6);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12.5)
        .text(block.text, margin, doc.y, { width: contentWidth });
      doc.moveTo(margin, doc.y + 4).lineTo(margin + contentWidth, doc.y + 4).strokeColor('#dddddd').lineWidth(1).stroke();
      doc.moveDown(0.6);
      break;
    case 'h3':
      ensureSpace(doc, 56);
      doc.moveDown(0.3);
      doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(10)
        .text(block.text, margin, doc.y, { width: contentWidth });
      doc.moveDown(0.25);
      break;
    case 'p':
      ensureSpace(doc, 24);
      drawRichText(doc, block.text, margin, contentWidth);
      doc.moveDown(0.4);
      break;
    case 'ul':
      block.items.forEach((item) => {
        ensureSpace(doc, 16);
        const startY = doc.y;
        doc.fillColor(DARK).font('Helvetica').fontSize(9).text('•', margin + 12, startY, { width: 10 });
        doc.y = startY;
        drawRichText(doc, item, margin + 26, contentWidth - 26);
      });
      doc.moveDown(0.4);
      break;
    case 'ol':
      block.items.forEach((item, index) => {
        ensureSpace(doc, 16);
        const startY = doc.y;
        doc.fillColor(DARK).font('Helvetica').fontSize(9).text(`${String.fromCharCode(97 + (index % 26))}.`, margin + 12, startY, { width: 16 });
        doc.y = startY;
        drawRichText(doc, item, margin + 30, contentWidth - 30);
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
      // 'signatures-intro' is drawn together with the signature boxes (see drawSignatures).
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

  getAcknowledgements(data.templateId).forEach((item) => {
    const checked = ack[item.key] === true;
    ensureSpace(doc, 30);
    const top = doc.y;
    drawCheckbox(doc, margin, top + 0.5, checked);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5).text(item.title, margin + 18, top, { width: contentWidth - 18 });
    doc.fillColor(DARK).font('Helvetica').fontSize(9)
      .text(item.text(data), margin + 18, doc.y, { width: contentWidth - 18, lineGap: 1.5 });
    doc.moveDown(0.5);
  });
}

// The built-in PDF fonts have no ☑/☐ glyphs (they print as "&"), so the box is drawn as a shape.
function drawCheckbox(doc, x, y, checked) {
  const size = 9;
  doc.save();
  doc.lineWidth(0.9).strokeColor(checked ? '#1a7f37' : '#999999').rect(x, y, size, size).stroke();
  if (checked) {
    doc.lineWidth(1.6).lineCap('round').lineJoin('round').strokeColor('#1a7f37')
      .moveTo(x + 2, y + 4.7).lineTo(x + 3.9, y + 6.8).lineTo(x + 7.2, y + 2.1).stroke();
  }
  doc.restore();
}

function drawLabelValue(doc, label, value, x, width) {
  if (!value) return;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text(`${label}: `, x, doc.y, { continued: true, width });
  doc.font('Helvetica').fillColor(DARK).text(String(value), { width });
}

function signatureImage(doc, contract, isSigned, x, y, colWidth) {
  if (isSigned && contract.signature_type === 'drawn' && String(contract.signature_data).startsWith('data:image')) {
    try {
      const imgBuffer = Buffer.from(contract.signature_data.split(',')[1], 'base64');
      doc.image(imgBuffer, x, y, { width: 130, height: 55, fit: [130, 55] });
      return;
    } catch (e) {
      // fall through to typed rendering
    }
  }
  if (isSigned) {
    doc.font('Helvetica-Oblique').fontSize(18).fillColor(DARK)
      .text(contract.signature_type === 'typed' ? (contract.signature_data || contract.signer_legal_name || '') : (contract.signer_legal_name || ''), x, y + 15, { width: colWidth });
    return;
  }
  doc.font('Helvetica-Oblique').fontSize(9).fillColor('#aa6600').text('Pending partner signature', x, y + 25, { width: colWidth });
}

function drawSignatures(doc, contract, data, sections, ctx) {
  const { margin, contentWidth } = ctx;
  const referral = data.kind === 'referral';
  const colWidth = (contentWidth - 30) / 2;
  const leftX = margin;
  const rightX = margin + colWidth + 30;
  const extra = contract.signer_extra_json || {};

  ensureSpace(doc, referral ? 330 : 170);
  doc.moveDown(0.5);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('SIGNATURES', margin, doc.y, { width: contentWidth });
  doc.moveTo(margin, doc.y + 4).lineTo(margin + contentWidth, doc.y + 4).strokeColor('#dddddd').lineWidth(1).stroke();
  doc.moveDown(0.7);

  const intro = (sections || []).find((b) => b.type === 'signatures-intro');
  if (intro) {
    drawRichText(doc, intro.text, margin, contentWidth);
    doc.moveDown(0.8);
  } else {
    doc.moveDown(0.3);
  }

  const blockTop = doc.y;

  // --- Company signature (left) ---
  if (referral) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(`FOR ${data.companyName.toUpperCase()}`, leftX, blockTop, { width: colWidth });
  }
  const sigTop = referral ? blockTop + 14 : blockTop;
  const signaturePath = path.join(__dirname, '../../public/assets/signature.png');
  let leftY = sigTop;
  if (fs.existsSync(signaturePath)) {
    doc.image(signaturePath, leftX, leftY, { width: 110 });
    leftY += 62;
  } else {
    doc.font('Helvetica-Oblique').fontSize(16).fillColor(DARK).text(data.companySignerName, leftX, leftY + 20, { width: colWidth });
    leftY += 62;
  }
  doc.moveTo(leftX, leftY).lineTo(leftX + colWidth, leftY).strokeColor('#aaaaaa').lineWidth(0.75).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(data.companySignerName, leftX, leftY + 6, { width: colWidth });
  if (referral) {
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`Position: ${REFERRAL_COMPANY_POSITION}`, leftX, doc.y, { width: colWidth });
  }
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text(`Authorized Signature — ${data.companyName}`, leftX, doc.y, { width: colWidth });
  doc.text(`Signed: ${formatDateLong(contract.company_signed_at || new Date())}`, leftX, doc.y, { width: colWidth });
  const leftBottom = doc.y;

  // --- Partner signature (right) ---
  const isSigned = contract.status === 'signed' && contract.signature_data;
  if (referral) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('REFERRAL PARTNER', rightX, blockTop, { width: colWidth });
  }
  signatureImage(doc, contract, isSigned, rightX, sigTop, colWidth);
  const rightLineY = sigTop + 62;
  doc.moveTo(rightX, rightLineY).lineTo(rightX + colWidth, rightLineY).strokeColor('#aaaaaa').lineWidth(0.75).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK)
    .text(isSigned ? (contract.signer_legal_name || data.partnerName) : data.partnerName, rightX, rightLineY + 6, { width: colWidth });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(referral ? 'Referral Partner Signature' : 'Partner Signature', rightX, doc.y, { width: colWidth });
  if (referral) {
    drawLabelValue(doc, 'Address', extra.address || data.partnerAddress || '—', rightX, colWidth);
    drawLabelValue(doc, 'Telephone', extra.phone || data.partnerPhone || '—', rightX, colWidth);
    drawLabelValue(doc, 'Email', data.partnerEmail, rightX, colWidth);
    if (extra.trn) drawLabelValue(doc, 'TRN / Identification No.', extra.trn, rightX, colWidth);
  }
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text(isSigned && contract.signed_at ? `Signed: ${formatDateLong(contract.signed_at)}` : 'Not yet signed', rightX, doc.y, { width: colWidth });

  doc.y = Math.max(leftBottom, doc.y) + 12;

  // --- Optional witness (typed on the signing page) ---
  if (referral && extra.witness_name) {
    ensureSpace(doc, 70);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('WITNESS (OPTIONAL)', margin, doc.y, { width: contentWidth });
    doc.moveDown(0.3);
    doc.font('Helvetica-Oblique').fontSize(16).fillColor(DARK).text(extra.witness_signature || extra.witness_name, margin, doc.y, { width: colWidth });
    doc.moveTo(margin, doc.y + 2).lineTo(margin + colWidth, doc.y + 2).strokeColor('#aaaaaa').lineWidth(0.75).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(extra.witness_name, margin, doc.y + 6, { width: colWidth });
    if (extra.witness_signed_at) {
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`Date: ${formatDateLong(extra.witness_signed_at)}`, margin, doc.y, { width: colWidth });
    }
    doc.moveDown(0.6);
  }

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
 * Handles both the HaloManage role agreements and the general Referral Partner Commission
 * Agreement (lettered clauses, bold figures, signer details and optional witness).
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
      const referral = data.kind === 'referral';

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
        .text(`${referral ? data.docLabel : `${data.productName} Partner Agreement`}  •  icreatesolutionsandservices.com`, margin + 55, 62, { width: contentWidth - 200 });

      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(referral ? 'REFERRAL AGREEMENT' : 'PARTNER AGREEMENT', margin, 100, { width: contentWidth, align: 'right' });
      const refLine = data.agreementReference ? `Ref: ${data.agreementReference}` : '';
      const statusLine = contract.status ? `Status: ${String(contract.status).toUpperCase()}` : '';
      doc.fillColor(GRAY).fontSize(8).font('Helvetica')
        .text([refLine, statusLine].filter(Boolean).join('   •   '), margin, 116, { width: contentWidth, align: 'right' });

      doc.moveTo(margin, 140).lineTo(width - margin, 140).strokeColor('#dddddd').lineWidth(1).stroke();
      doc.y = 155;

      sections.forEach((block) => drawBlock(doc, block, ctx));
      drawAcknowledgements(doc, contract, data, ctx);
      drawSignatures(doc, contract, data, sections, ctx);

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.height - 40;
        // The footer sits inside the bottom margin. Without zeroing it first, pdfkit starts a brand-new
        // page for every footer line, leaving one blank page after each real page.
        const savedBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.fontSize(7.5).fillColor('#999999').font('Helvetica')
          .text(
            `${data.agreementReference || (referral ? 'Referral Agreement' : 'Partner Agreement')}   •   Page ${i - range.start + 1} of ${range.count}   •   Generated ${new Date().toLocaleDateString('en-US')}`,
            margin, bottom, { width: contentWidth, align: 'center' }
          );
        doc.page.margins.bottom = savedBottomMargin;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePartnerContractPDF };
