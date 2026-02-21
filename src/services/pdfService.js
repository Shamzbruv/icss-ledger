const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const SERVICE_NAMES = {
    'WEB': 'Website Development',
    'APP': 'App Development',
    'GD': 'Graphic Designs',
    'HOST_PRO': 'Professional Hosting',
    'HOST_DOM': 'Hosting + Domain',
    'MAINT': 'Web Maintenance',
    'MONITOR': 'App Monitoring',
    'AUTO_BIZ': 'Business Automation',
    'AUTO_IND': 'Industry Automation',
    'REFRESH': 'Content Refresh',
    'CON': 'Consultation',
    'CUST': 'Custom Service'
};

/**
 * Formats a date string to MM/DD/YYYY safely (ignoring timezones)
 */
function formatDateSafe(dateStr) {
    if (!dateStr) return "";
    // If it's a YYYY-MM-DD string, parse it manually
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        const [_, y, m, d] = match;
        return `${parseInt(m)}/${parseInt(d)}/${y}`;
    }
    // Fallback
    try {
        const d = new Date(dateStr);
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    } catch (e) {
        return dateStr;
    }
}

/**
 * 
 * @param {Object} invoiceData 
 * @param {Object} clientData 
 * @param {Array} items 
 * @returns {Promise<Buffer>}
 */
function generateInvoicePDF(invoiceData, clientData, items) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 0, size: 'LETTER' }); // No default margin, we'll control it
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                let pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // --- HELPER WRAPPERS ---
            const width = doc.page.width;
            const height = doc.page.height;

            // --- 1. HEADER CURVES (Orange/Blue) ---
            // Revised: Top-Right "Swoosh" only.

            // Orange Accent (Behind)
            doc.save();
            doc.moveTo(width * 0.5, 0)
                .quadraticCurveTo(width * 0.8, 80, width, 60)
                .lineTo(width, 0)
                .lineTo(width * 0.5, 0)
                .fillColor('#FF8C00')
                .fill();
            doc.restore();

            // Blue Main Curve (Top Right)
            doc.save();
            doc.moveTo(width * 0.6, 0)
                .quadraticCurveTo(width * 0.85, 60, width, 40)
                .lineTo(width, 0)
                .lineTo(width * 0.6, 0)
                .fillColor('#002B49')
                .fill();
            doc.restore();

            // --- 2. LOGO & COMPANY INFO (Left Header) ---
            const logoPath = path.join(__dirname, '../../public/assets/icss-logo.png');
            let logoY = 40;
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 40, 30, { width: 60 });
                logoY = 100;
            }

            // Company Name
            doc.fillColor('#002B49')
                .fontSize(16)
                .font('Helvetica-Bold')
                .text('iCreate Solutions & Services', 40, logoY);

            // Company Contact
            doc.fontSize(9)
                .font('Helvetica')
                .fillColor('#333333')
                .text('Home Office', 40, logoY + 20)
                .text('St Andrew,', 40, logoY + 33)
                .text('Kingston, Jamaica', 40, logoY + 46)
                .text('876-585-7469', 40, logoY + 59)
                .text('www.icreatesolutionsandservices.com', 40, logoY + 72);

            // --- 3. INVOICE META (Right Header) ---
            const { computeInvoiceState } = require('./invoiceStateService');
            const state = computeInvoiceState(invoiceData, clientData);

            // --- 3. INVOICE META (Right Header) ---
            const metaX = 320;
            let metaY = 100;

            doc.fillColor('#002B49')
                .fontSize(12)
                .font('Helvetica-Bold')
                .text('INVOICE #', metaX, metaY)
                .text('DATE', metaX, metaY + 15)
                .text('STATUS', metaX, metaY + 30); // New Status Label

            // Adjust Y for subsequent fields
            let dateRowY = metaY + 45;

            if (state.pdfShowPaidDate) {
                doc.text('DATE PAID', metaX, dateRowY);
            } else if (state.pdfShowDueDate) {
                doc.text(invoiceData.is_subscription ? 'RENEWAL DATE' : 'DUE DATE', metaX, dateRowY);
            }

            doc.fillColor('#000000')
                .font('Helvetica')
                .text(state.invoiceNumber, metaX + 110, metaY, { width: 140, align: 'right' })
                .text(formatDateSafe(state.issueDate), metaX + 110, metaY + 15, { width: 140, align: 'right' })
                .fillColor(state.pdfWatermarkColor) // Use Theme Color for Status
                .font('Helvetica-Bold')
                .text(state.paymentStatus, metaX + 110, metaY + 30, { width: 140, align: 'right' }); // Status Value

            // Reset color/font for dates
            doc.fillColor('#000000').font('Helvetica');

            if (state.pdfShowPaidDate) {
                doc.text(formatDateSafe(state.paidAt), metaX + 110, dateRowY, { width: 140, align: 'right' });
            } else if (state.pdfShowDueDate) {
                const labelValue = invoiceData.is_subscription && state.renewalDate
                    ? formatDateSafe(state.renewalDate)
                    : formatDateSafe(state.dueDate);
                doc.text(labelValue, metaX + 110, dateRowY, { width: 140, align: 'right' });
            }


            // --- 4. BILL TO (Left) ---
            const billToY = 200;
            doc.fillColor('#002B49')
                .fontSize(12)
                .font('Helvetica-Bold')
                .text('BILL TO', 40, billToY)
                .moveDown(0.5);

            doc.fillColor('#000000')
                .fontSize(10)
                .font('Helvetica-Bold')
                .text(clientData.name, 40, billToY + 20)
                .font('Helvetica')
                .text(clientData.email)
                .text(clientData.address || '');

            // --- 5. ITEMS TABLE ---
            let tableTop = 300;

            // Header Background
            doc.rect(40, tableTop, width - 80, 25)
                .fillColor('#002B49')
                .fill();

            // Header Text
            doc.fillColor('#FFFFFF')
                .fontSize(9)
                .font('Helvetica-Bold');

            doc.text('DESCRIPTION', 50, tableTop + 8)
                .text('QTY', 340, tableTop + 8, { width: 40, align: 'center' })
                .text('PRICE', 400, tableTop + 8, { width: 80, align: 'right' })
                .text('AMOUNT', 480, tableTop + 8, { width: 80, align: 'right' });

            // Rows
            let y = tableTop + 35;
            doc.fillColor('#000000').font('Helvetica').fontSize(10);

            items.forEach((item, index) => {
                const totalItem = (item.quantity * item.unit_price).toFixed(2);
                doc.moveTo(40, y + 15).lineTo(width - 40, y + 15).lineWidth(0.5).strokeColor('#E0E0E0').stroke();

                doc.text(item.description, 50, y)
                    .text(item.quantity, 340, y, { width: 40, align: 'center' })
                    .text(`$${Number(item.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 400, y, { width: 80, align: 'right' })
                    .text(`$${Number(totalItem).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 480, y, { width: 80, align: 'right' });

                y += 25;
            });

            // --- 6. TOTALS ---
            const totalY = y + 10;
            doc.rect(width - 250, totalY, 210, 30)
                .fillColor('#002B49')
                .fill();

            doc.fillColor('#FFFFFF')
                .fontSize(12)
                .font('Helvetica-Bold')
                .text('TOTAL', width - 230, totalY + 8)
                .text(`$${Number(state.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, width - 140, totalY + 8, { align: 'right', width: 90 });


            // --- 7. PAYMENT SUMMARY (For DEPOSIT / PARTIAL / PAID) ---
            if (state.paymentStatus !== 'UNPAID') {
                const summaryY = totalY + 40;

                doc.fontSize(10).font('Helvetica-Bold').fillColor('#333');
                doc.text('PAYMENT SUMMARY', width - 230, summaryY);
                doc.rect(width - 230, summaryY + 12, 190, 0.5).strokeColor('#ccc').stroke();

                let currentY = summaryY + 20;

                state.emailSummaryRows.forEach(row => {
                    // EXACT MATCH: Show all rows including Status

                    doc.font('Helvetica').fontSize(9).fillColor('#555')
                        .text(row.label, width - 230, currentY);

                    doc.font('Helvetica-Bold').fillColor('#000')
                        .text(row.value, width - 100, currentY, { align: 'right', width: 60 });

                    currentY += 15;
                });
            }

            // --- 8. PAYMENT DETAILS (Left) ---
            const payY = y + 60;
            doc.fillColor('#002B49').fontSize(10).font('Helvetica-Bold').text('PAYMENT METHOD', 40, payY);

            doc.fillColor('#333333').font('Helvetica').fontSize(9).moveDown(0.5);
            doc.text('Account Holder: iCreate Solutions & Services');
            doc.text('Bank Name: FCIB (First Caribbean International Bank)');
            doc.text('Branch: KING STREET');
            doc.text('Account Number: 1002389240');

            if (invoiceData.reference_code) {
                doc.moveDown(0.5).font('Helvetica-Bold').text('Reference Code: ' + invoiceData.reference_code, { continued: false });
            }


            // --- 8. FOOTER CURVE ---
            doc.save();
            doc.moveTo(width / 2, height)
                .quadraticCurveTo(width * 0.75, height - 30, width, height - 50)
                .lineTo(width, height)
                .lineTo(width / 2, height)
                .fillColor('#002B49')
                .fill();
            doc.restore();

            // --- 9. TERMS & SIGNATURE ---
            const footerTextY = height - 180;

            doc.fillColor('#333333')
                .fontSize(10)
                .font('Helvetica-Bold')
                .text('TERMS & CONDITIONS', 40, footerTextY);

            doc.font('Helvetica').fontSize(9)
                .text('For detailed terms and conditions, please visit:', 40, footerTextY + 15)
                .fillColor('#002B49')
                .text('https://icreatesolutionsandservices.com/terms', 40, footerTextY + 28);

            const signaturePath = path.join(__dirname, '../../public/assets/signature.png');
            const sigWidth = 100;
            const sigX = width - 150;
            const sigY = height - 140;

            if (fs.existsSync(signaturePath)) {
                doc.image(signaturePath, sigX, sigY, { width: sigWidth });
            } else {
                doc.font('Helvetica-Oblique')
                    .fontSize(14)
                    .fillColor('#000000')
                    .text('S.Baker', sigX, sigY + 10, { width: sigWidth, align: 'center' });
            }

            doc.font('Helvetica').fontSize(8)
                .text('Authorized Signature', sigX, sigY + 50, { width: sigWidth, align: 'center' });


            // --- WATERMARK STAMP (Diagonal) ---
            doc.save();
            doc.rotate(-45, { origin: [width / 2, height / 2] });
            doc.fontSize(60)
                .font('Helvetica-Bold')
                .fillColor(state.pdfWatermarkColor)
                .opacity(0.12);

            // Draw stamp text centered
            doc.text(state.pdfWatermarkText, 0, height / 2 - 30, {
                width: width,
                align: 'center'
            });
            doc.restore();

            doc.end();
        } catch (err) {
            console.error(err);
            reject(err);
        }
    });
}

/**
 * Helper to get readable service name
 */
function getServiceName(code) {
    return SERVICE_NAMES[code] || code;
}

module.exports = { generateInvoicePDF, getServiceName };
