const { generateInvoicePDF } = require('./src/services/pdfService');
const fs = require('fs');

async function test() {
    const invoiceData = {
        is_subscription: false,
        reference_code: 'REF-12345'
    };
    const clientData = {
        name: 'John Doe',
        email: 'john@example.com',
        address: '123 Test St'
    };
    const items = [
        { description: 'Project Planning + System Architecture (customer flow, ordering logic, measurements)', quantity: 1, unit_price: 20000 },
        { description: 'Custom UI/UX Design + Multi-Page Frontend Development (premium Windross styling + responsiveness)', quantity: 1, unit_price: 45000 },
        { description: 'Made-to-Measure Measurement System (male/female flows, structured measurement fields, validation)', quantity: 1, unit_price: 30000 },
        { description: 'Order Flow Development (multi-step checkout: measurements > shipping > payment', quantity: 1, unit_price: 25000 },
        { description: 'Pricing / Region / Currency Logic Setup (structured totals + pricing configuration)', quantity: 1, unit_price: 12000 },
        { description: 'Backend Server Development + Database Setup (orders, customers, measurements, status tracking)', quantity: 1, unit_price: 28000 },
        { description: 'Automation: PDF Invoice/Order Summary Generation + Email Confirmation System', quantity: 1, unit_price: 12000 },
        { description: 'Testing, Bug Fixes, Final Optimization + Launch Support', quantity: 1, unit_price: 8000 }
    ];

    try {
        const buffer = await generateInvoicePDF(invoiceData, clientData, items);
        fs.writeFileSync('test_invoice.pdf', buffer);
        console.log('PDF generated at test_invoice.pdf');
    } catch (e) {
        console.error(e);
    }
}
test();
