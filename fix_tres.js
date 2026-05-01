const supabase = require('./src/db');
const { generateInvoicePDF } = require('./src/services/pdfService');
const { sendInvoiceEmail } = require('./src/services/emailService');
const { getInvoiceEmailContent } = require('./src/services/emailTemplates');

async function fix() {
    try {
        const clientId = '1caec460-30be-466a-87e0-b22372f66236';
        
        // 1. Get Client and Service
        const { data: service } = await supabase.from('client_services').select('*, service_plans(*)').eq('client_id', clientId).single();
        const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
        
        const invoiceNumber = 'INV-ICSS-' + Math.floor(Math.random() * 9000 + 1000);
        const totalAmount = 34.50; // $30 + 15% tax
        
        // 2. Create Invoice
        const { data: invoice, error: invErr } = await supabase.from('invoices').insert({
            company_id: service.company_id,
            client_id: client.id,
            client_service_id: service.id,
            invoice_number: invoiceNumber,
            issue_date: new Date().toISOString(),
            due_date: new Date().toISOString(),
            total_amount: totalAmount,
            remaining_amount: 0,
            status: 'paid',
            payment_status: 'PAID',
            is_subscription: true,
            billing_cycle: 'monthly',
            plan_name: service.service_plans.name,
            notes: 'Automated Subscription Renewal'
        }).select().single();
        
        if (invErr) throw invErr;
        
        // 3. Create Item
        const currentMonthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
        const { data: items, error: itmErr } = await supabase.from('invoice_items').insert({
            invoice_id: invoice.id,
            description: `${service.service_plans.name} - ${currentMonthName}`,
            quantity: 1,
            unit_price: 30.00
        }).select();
        
        if (itmErr) throw itmErr;

        // 4. Generate PDF
        console.log('Generating PDF...');
        const pdfBuffer = await generateInvoicePDF(invoice, client, items);
        
        // 5. Send Email
        console.log('Sending Email to', client.email);
        const emailContent = getInvoiceEmailContent(invoice, client);
        await sendInvoiceEmail(
            client.email,
            emailContent.subject,
            emailContent.text,
            emailContent.html,
            pdfBuffer,
            invoiceNumber
        );
        
        console.log('Successfully generated and sent invoice ' + invoiceNumber);
    } catch (err) {
        console.error('Error:', err);
    }
}
fix();
