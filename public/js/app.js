document.addEventListener('DOMContentLoaded', async () => {
    // 1. Auto-set dates
    const today = new Date();
    const nextMonth = new Date();
    nextMonth.setDate(today.getDate() + 30);

    const dueDateInput = document.getElementById('dueDate');
    if (dueDateInput) {
        dueDateInput.value = nextMonth.toISOString().split('T')[0];
    }
    const renewalDateInput = document.getElementById('renewalDate');
    if (renewalDateInput) {
        renewalDateInput.value = nextMonth.toISOString().split('T')[0];
    }

    // 2. Fetch Clients
    await loadClients();

    // 4. Load Dashboard
    await loadInvoices();
});

// --- TOGGLES ---
// Expose functions to global scope for HTML onclick events
window.toggleClientMode = function () {
    const isNew = document.getElementById('clientNew').checked;
    const existing = document.getElementById('existingClientSection');
    const newClient = document.getElementById('newClientSection');

    if (isNew) {
        existing.classList.add('d-none');
        newClient.classList.remove('d-none');
    } else {
        existing.classList.remove('d-none');
        newClient.classList.add('d-none');
    }
};

window.toggleSubscription = function () {
    const isSub = document.getElementById('isSubscription').checked;
    const fields = document.getElementById('subscriptionFields');
    const dueDateContainer = document.getElementById('dueDateContainer');
    const dueDateInput = document.getElementById('dueDate');
    const renewalDateInput = document.getElementById('renewalDate');

    if (isSub) {
        fields.classList.remove('d-none');
        fields.classList.add('d-block');

        if (dueDateContainer) dueDateContainer.classList.add('d-none');
        if (dueDateInput) dueDateInput.required = false;

        // Auto-set renewal date to Today + 1 Month (matching backend logic)
        if (renewalDateInput) {
            const now = new Date();
            const nextMonth = new Date(now);
            nextMonth.setMonth(now.getMonth() + 1);
            renewalDateInput.value = nextMonth.toISOString().split('T')[0];
        }

    } else {
        fields.classList.add('d-none');
        fields.classList.remove('d-block');

        if (dueDateContainer) dueDateContainer.classList.remove('d-none');
        if (dueDateInput) dueDateInput.required = true;
    }
};

window.togglePercentage = function () {
    const type = document.getElementById('paymentType').value;
    const container = document.getElementById('pctContainer');

    if (container) {
        if (type === 'PARTIAL') {
            container.classList.remove('d-none');
            document.getElementById('paymentPercentage').value = 50;
        } else {
            container.classList.add('d-none');
            document.getElementById('paymentPercentage').value = 100;
        }
    }
};

window.togglePaymentStatus = function () {
    const status = document.getElementById('paymentStatus').value;
    const isSub = document.getElementById('isSubscription').checked;

    // Elements
    const depositFields = document.getElementById('depositFields');
    const partialFields = document.getElementById('partialFields');
    const paidFields = document.getElementById('paidFields');
    const dueDateContainer = document.getElementById('dueDateContainer');
    const pctContainer = document.getElementById('pctContainer');

    // Default: hide everything
    depositFields.classList.add('d-none');
    partialFields.classList.add('d-none');
    paidFields.classList.add('d-none');

    if (status === 'DEPOSIT') {
        depositFields.classList.remove('d-none');
        if (pctContainer) pctContainer.classList.add('d-none');
    } else if (status === 'PARTIAL') {
        partialFields.classList.remove('d-none');
    } else if (status === 'PAID') {
        paidFields.classList.remove('d-none');
        // Auto-set Date Paid to today
        document.getElementById('paidAt').value = new Date().toISOString().split('T')[0];
        // Hide Due Date if Paid
        if (dueDateContainer) dueDateContainer.classList.add('d-none');
    }

    // Re-show Due Date if not Paid and not Subscription
    if (status !== 'PAID' && !isSub) {
        if (dueDateContainer) dueDateContainer.classList.remove('d-none');
    }
};

// --- ITEM MANAGEMENT ---
window.addItem = function () {
    const div = document.createElement('div');
    div.className = 'item-row fade-in';
    div.innerHTML = `
        <input type="text" placeholder="Description of service or item" class="item-desc" required>
        <input type="number" placeholder="Qty" class="item-qty" value="1" required>
        <input type="number" placeholder="Price" class="item-price" step="0.01" required>
        <button type="button" class="remove-btn" onclick="removeItem(this)">✕</button>
    `;
    document.getElementById('itemsContainer').appendChild(div);
};

window.removeItem = function (btn) {
    const row = btn.parentElement;
    // Check if it's the only one
    if (document.querySelectorAll('.item-row').length > 1) {
        row.remove();
    } else {
        if (typeof showAlert === 'function') showAlert("You need at least one item.", 'info');
        else alert("You need at least one item.");
    }
};



// Enable/Disable Delete Button based on selection
document.addEventListener('DOMContentLoaded', () => {
    const clientSelect = document.getElementById('clientId');
    const deleteBtn = document.getElementById('deleteClientBtn');

    if (clientSelect && deleteBtn) {
        clientSelect.addEventListener('change', () => {
            if (clientSelect.value) {
                deleteBtn.disabled = false;
            } else {
                deleteBtn.disabled = true;
            }
        });
    }
});

window.deleteClient = async function () {
    const clientSelect = document.getElementById('clientId');
    const clientId = clientSelect.value;
    const clientName = clientSelect.options[clientSelect.selectedIndex].text;

    if (!clientId) {
        if (typeof showAlert === 'function') showAlert('Please select a client to delete.', 'error');
        else alert('Please select a client to delete.');
        return;
    }

    // Custom Confirmation (using window.confirm for now, or could use the custom modal if preferred)
    // The user requested "always have the option to delete", let's use a standard verify first.
    // If the user has a custom confirm modal (showConfirm), we should use that if available.
    // Checking previous context, user was implementing `showConfirm`.
    // Let's check if `showConfirm` is available in global scope (it might be in layout.js or index.html scripts).
    // Based on `client-care.html` reading, `showConfirm` is likely available or we can fallback.

    let confirmed = false;
    if (typeof showConfirm === 'function') {
        confirmed = await showConfirm(`Are you sure you want to delete ${clientName}?\n\nWARNING: This will permanently delete ALL invoices, services, and history for this client.`, 'danger', 'Delete Client');
    } else {
        confirmed = confirm(`Are you sure you want to delete ${clientName}?\n\nWARNING: This will permanently delete ALL invoices, services, and history for this client.`);
    }

    if (!confirmed) return;

    try {
        const deleteBtn = document.getElementById('deleteClientBtn');
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '⏳';

        const res = await fetch(`/api/clients/${clientId}`, {
            method: 'DELETE'
        });

        const data = await res.json();

        if (res.ok) {
            if (typeof showAlert === 'function') await showAlert('Client deleted successfully.', 'success');
            else alert('Client deleted successfully.');
            // Refresh
            await loadClients();
            // Reset invoice table if it was showing that client's invoices? 
            // The dashboard shows all invoices, but maybe we should reload that too.
            await loadInvoices();
        } else {
            if (typeof showAlert === 'function') showAlert('Error deleting client: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error deleting client: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error(err);
        if (typeof showAlert === 'function') showAlert('Failed to delete client.', 'error');
        else alert('Failed to delete client.');
    } finally {
        const deleteBtn = document.getElementById('deleteClientBtn');
        if (deleteBtn) {
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.disabled = true; // Selection is gone/reset
        }
    }
};

async function loadInvoices() {
    try {
        const tbody = document.getElementById('invoiceTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
            const response = await fetch('/api/invoices');
            if (response.ok) {
                const invoices = await response.json();
                if (invoices.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5">No recent invoices found.</td></tr>';
                } else {
                    tbody.innerHTML = '';
                    invoices.forEach(inv => {
                        const clientName = inv.clients ? inv.clients.name : 'Unknown';

                        // New Status Badge Logic
                        const status = inv.payment_status || (inv.status === 'paid' ? 'PAID' : 'UNPAID');
                        let badgeClass = 'bg-secondary';
                        if (status === 'PAID') badgeClass = 'bg-success';
                        if (status === 'DEPOSIT') badgeClass = 'bg-secondary'; // Fallback badge
                        if (status === 'PARTIAL') badgeClass = 'bg-warning';
                        if (status === 'UNPAID') badgeClass = 'bg-danger';

                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td data-label="Invoice #"><div class="cell-content">${inv.invoice_number}</div></td>
                            <td data-label="Client"><div class="cell-content">${clientName}</div></td>
                            <td data-label="Date Issued"><div class="cell-content">${new Date(inv.issue_date).toLocaleDateString()}</div></td>
                            <td data-label="Amount"><div class="cell-content">$${Number(inv.total_amount).toFixed(2)}</div></td>
                            <td data-label="Status"><div class="cell-content"><span class="badge ${badgeClass}">${status}</span></div></td>
                            <td data-label="Actions">
                                <div class="cell-content d-flex gap-2">
                                    <button class="btn btn-sm btn-outline-light" onclick="viewPDF('${inv.id}')" title="View PDF">View PDF</button>
                                    <button class="btn btn-sm btn-outline-light" onclick="resendInvoiceEmail('${inv.id}')" title="Resend Email">Resend</button>
                                    <button class="btn btn-sm btn-primary" onclick="updateStatusInvoice('${inv.id}', '${status}')">Update</button>
                                    <button class="btn btn-sm btn-danger" onclick="sendPaymentDeclinedAlert('${inv.id}')" title="Payment Declined">Decline Alert</button>
                                </div>
                            </td>
                         `;
                        tbody.appendChild(row);
                    });
                }
            } else {
                tbody.innerHTML = '<tr><td colspan="5">Error loading invoices. Server might be restarting?</td></tr>';
            }
        }
    } catch (e) {
        console.error('Error fetching invoices', e);
    }
}

async function loadClients() {
    try {
        const clientSelect = document.getElementById('clientId');
        if (clientSelect) {
            clientSelect.innerHTML = '<option value="">Loading...</option>';
            const response = await fetch('/api/clients');
            if (response.ok) {
                const clients = await response.json();
                clientSelect.innerHTML = '<option value="">-- Select Client --</option>';
                clients.forEach(client => {
                    const opt = document.createElement('option');
                    opt.value = client.id;
                    opt.innerText = `${client.name} (${client.email})`;
                    clientSelect.appendChild(opt);
                });
            } else {
                clientSelect.innerHTML = '<option value="">Error loading clients</option>';
            }
        }
    } catch (e) {
        console.error('Error fetching clients', e);
    }
}

document.getElementById('invoiceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageDiv = document.getElementById('message');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // UX: Loading State
    messageDiv.innerText = 'Creating invoice and sending email...';
    messageDiv.style.color = 'var(--secondary-color)';
    submitBtn.disabled = true;
    submitBtn.innerText = 'Processing...';

    // Get Values
    const dueDate = document.getElementById('dueDate').value;
    const notes = document.getElementById('notes').value;
    const serviceCode = document.getElementById('serviceCode').value;
    const paymentType = document.getElementById('paymentType').value;
    const paymentPercentage = document.getElementById('paymentPercentage') ? document.getElementById('paymentPercentage').value : 100;

    // Subscription Data
    const isSubscription = document.getElementById('isSubscription').checked;
    const billingCycle = document.getElementById('billingCycle').value;
    const renewalDate = document.getElementById('renewalDate').value;

    // Payment Status Fields
    const paymentStatus = document.getElementById('paymentStatus').value;
    const depositPercent = document.getElementById('depositPercent').value;
    const amountPaid = document.getElementById('amountPaid').value;
    const paidAt = document.getElementById('paidAt').value;

    // Client Data (Conditional)
    const isNewClient = document.getElementById('clientNew').checked;
    let clientId = document.getElementById('clientId').value;
    let newClientDetails = null;

    if (isNewClient) {
        const name = document.getElementById('newClientName').value;
        const email = document.getElementById('newClientEmail').value;
        const address = document.getElementById('newClientAddress').value;
        if (!name || !email) {
            if (typeof showAlert === 'function') showAlert('Please provide Name and Email for new client.', 'error');
            else alert('Please provide Name and Email for new client.');
            submitBtn.disabled = false;
            submitBtn.innerText = 'Create & Send Invoice';
            return;
        }
        newClientDetails = { name, email, address };
        clientId = 'NEW'; // Flag for server
    } else {
        if (!clientId) {
            if (typeof showAlert === 'function') showAlert('Please select a client.', 'error');
            else alert('Please select a client.');
            submitBtn.disabled = false;
            submitBtn.innerText = 'Create & Send Invoice';
            return;
        }
    }

    const itemRows = document.querySelectorAll('.item-row');
    const items = [];
    itemRows.forEach(row => {
        // UPDATED CLASS NAMES HERE
        const descInput = row.querySelector('.item-desc');
        const qtyInput = row.querySelector('.item-qty');
        const priceInput = row.querySelector('.item-price');

        const desc = descInput ? descInput.value : '';
        const qty = qtyInput ? parseFloat(qtyInput.value) : 0;
        const price = priceInput ? parseFloat(priceInput.value) : 0;

        if (desc && qty && price) {
            items.push({ description: desc, quantity: qty, price: price });
        }
    });

    if (items.length === 0) {
        messageDiv.innerText = 'Please add at least one item.';
        messageDiv.style.color = 'var(--danger-color)';
        submitBtn.disabled = false;
        submitBtn.innerText = 'Create & Send Invoice';
        return;
    }

    try {
        const response = await fetch('/api/invoices/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId,
                newClientDetails, // Send this if mode is new
                dueDate,
                notes,
                items,
                serviceCode,
                paymentType,
                paymentPercentage,
                isSubscription,
                isRenewal: isSubscription ? document.getElementById('isRenewal').checked : false,
                planName,
                billingCycle,
                renewalDate,
                // New Fields
                paymentStatus,
                depositPercent: paymentStatus === 'DEPOSIT' ? depositPercent : null,
                amountPaid: paymentStatus === 'PARTIAL' ? amountPaid : null,
                paidAt: paymentStatus === 'PAID' ? paidAt : null
            })
        });

        const data = await response.json();
        if (response.ok) {
            messageDiv.innerText = 'Success! Invoice created and email sent.';
            messageDiv.style.color = 'var(--success-color)';
            document.getElementById('invoiceForm').reset();

            // Reset UI state
            toggleClientMode();
            toggleSubscription();
            togglePercentage();

            // Refresh
            await loadInvoices();
            if (isNewClient) await loadClients(); // Refresh dropdown

            setTimeout(() => {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Create & Send Invoice';
                messageDiv.innerText = '';
            }, 3000);
        } else {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (err) {
        console.error(err);
        messageDiv.innerText = 'Error: ' + err.message;
        messageDiv.style.color = 'var(--danger-color)';
        submitBtn.disabled = false;
        submitBtn.innerText = 'Create & Send Invoice';
    }
});

// --- STATUS MANAGEMENT ---
window.updateStatusInvoice = function (id, currentStatus) {
    const modal = document.getElementById('statusUpdateModal');
    const idInput = document.getElementById('updateInvoiceId');
    const statusSelect = document.getElementById('modalPaymentStatus');
    const depositPercentInput = document.getElementById('modalDepositPercent');
    const amountPaidInput = document.getElementById('modalAmountPaid');

    if (!modal) return;

    // Reset fields
    idInput.value = id;
    statusSelect.value = currentStatus.toUpperCase();
    depositPercentInput.value = '';
    amountPaidInput.value = '';

    // Show modal
    modal.classList.remove('d-none');
    toggleModalStatusFields();
};

window.closeStatusModal = function () {
    const modal = document.getElementById('statusUpdateModal');
    if (modal) modal.classList.add('d-none');
};

window.toggleModalStatusFields = function () {
    const status = document.getElementById('modalPaymentStatus').value;
    const depositFields = document.getElementById('modalDepositFields');
    const partialFields = document.getElementById('modalPartialFields');

    depositFields.classList.add('d-none');
    partialFields.classList.add('d-none');

    if (status === 'DEPOSIT') {
        depositFields.classList.remove('d-none');
    } else if (status === 'PARTIAL') {
        partialFields.classList.remove('d-none');
    }
};

window.submitStatusUpdate = async function () {
    const id = document.getElementById('updateInvoiceId').value;
    const status = document.getElementById('modalPaymentStatus').value;
    const depositPercent = document.getElementById('modalDepositPercent').value;
    const amountPaid = document.getElementById('modalAmountPaid').value;
    const submitBtn = document.getElementById('modalSubmitBtn');

    // Simple validation
    if (status === 'DEPOSIT' && !depositPercent) {
        if (typeof showAlert === 'function') showAlert('Please enter a deposit percentage.', 'error');
        else alert('Please enter a deposit percentage.');
        return;
    }
    if (status === 'PARTIAL' && !amountPaid) {
        if (typeof showAlert === 'function') showAlert('Please enter the amount paid.', 'error');
        else alert('Please enter the amount paid.');
        return;
    }

    try {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Updating...';

        const res = await fetch('/api/invoices/resend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                invoiceId: id,
                paymentStatus: status,
                depositPercent: status === 'DEPOSIT' ? depositPercent : null,
                amountPaid: status === 'PARTIAL' ? amountPaid : null
            })
        });

        if (res.ok) {
            if (typeof showAlert === 'function') await showAlert('Invoice status updated and email resent!', 'success');
            else alert('Invoice status updated and email resent!');
            closeStatusModal();
            loadInvoices();
        } else {
            const err = await res.json();
            if (typeof showAlert === 'function') showAlert('Error: ' + err.error, 'error');
            else alert('Error: ' + err.error);
        }
    } catch (err) {
        if (typeof showAlert === 'function') showAlert('Failed to update: ' + err.message, 'error');
        else alert('Failed to update: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Update & Resend';
    }
};

window.viewPDF = function (id) {
    window.open(`/api/invoices/download/${id}`, '_blank');
};

// --- LIVE PREVIEW LOGIC (Single Source of Truth) ---
let previewDebounceTimer;
let previewAbortController;

// Delegated Listener for Form Inputs (Handles dynamic items too)
const invoiceForm = document.getElementById('invoiceForm');
if (invoiceForm) {
    invoiceForm.addEventListener('input', handlePreviewTrigger);
    invoiceForm.addEventListener('change', handlePreviewTrigger);
}

function handlePreviewTrigger(e) {
    // triggers on any input/select/textarea change
    if (e.target.matches('input, select, textarea')) {
        clearTimeout(previewDebounceTimer);
        previewDebounceTimer = setTimeout(fetchPreviewState, 500);
    }
}

async function fetchPreviewState() {
    // 1. UI Loading State
    const spinner = document.getElementById('previewSpinner');
    const timestamp = document.getElementById('emailPreviewTimestamp');
    if (spinner) spinner.style.display = 'inline-block';
    if (timestamp) timestamp.style.opacity = '0.5';

    // Hide any previous errors (inject error box if missing)
    let errorBox = document.getElementById('previewErrorBox');
    if (!errorBox) {
        errorBox = document.createElement('div');
        errorBox.id = 'previewErrorBox';
        errorBox.className = 'alert alert-danger mt-2 d-none';
        const container = document.querySelector('.preview-tabs');
        if (container) container.parentNode.insertBefore(errorBox, container.nextSibling);
    }
    errorBox.classList.add('d-none');

    // 2. Abort previous request
    if (previewAbortController) {
        previewAbortController.abort();
    }
    previewAbortController = new AbortController();

    try {
        // 3. Gather Data (Comprehensive)
        const isClientNew = document.getElementById('clientNew').checked;
        const client = {};

        if (isClientNew) {
            client.name = document.getElementById('newClientName').value || 'New Client';
            client.email = document.getElementById('newClientEmail').value || 'client@example.com';
        } else {
            const select = document.getElementById('clientId');
            const opt = select.options[select.selectedIndex];
            client.name = opt ? opt.text : 'Client';
            client.id = select.value;
        }

        const items = Array.from(document.querySelectorAll('.item-row')).map(row => ({
            description: row.querySelector('.item-desc').value,
            quantity: parseFloat(row.querySelector('.item-qty').value) || 0,
            price: parseFloat(row.querySelector('.item-price').value) || 0
        }));

        const total = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);

        const invoice = {
            invoice_number: 'INV-PREVIEW',
            issue_date: new Date().toISOString(),
            due_date: document.getElementById('dueDate').value,
            renewal_date: document.getElementById('renewalDate').value,
            service_code: document.getElementById('serviceCode').value,
            total_amount: total,
            payment_status: document.getElementById('paymentStatus').value,
            deposit_percent: parseFloat(document.getElementById('depositPercent').value) || null,
            amount_paid: parseFloat(document.getElementById('amountPaid').value) || 0,
            is_subscription: document.getElementById('isSubscription').checked,
            is_renewal: document.getElementById('isRenewal').checked,
            plan_name: document.getElementById('planName')?.value || '',
            billing_cycle: document.getElementById('billingCycle')?.value || ''
        };

        // 4. API Call
        const res = await fetch('/api/invoices/preview-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice, client }),
            signal: previewAbortController.signal
        });

        if (!res.ok) throw new Error('Preview computation failed');

        const state = await res.json();
        renderPreview(state);

    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('Preview Error:', e);
        if (errorBox) {
            errorBox.textContent = `Preview unavailable: ${e.message}`;
            errorBox.classList.remove('d-none');
        }
    } finally {
        if (spinner) spinner.style.display = 'none';
        if (timestamp) timestamp.style.opacity = '1';
    }
}

function renderPreview(state) {
    // 1. PDF Preview
    const pdfStatusEl = document.getElementById('pdfPreviewStatus'); // Contextual status in PDF preview?
    // Note: invoiceStateService returns pdfWatermarkText which includes status info

    const pdfWatermarkEl = document.getElementById('pdfWatermarkPreview');
    if (pdfWatermarkEl) {
        pdfWatermarkEl.innerText = state.pdfWatermarkText;
        pdfWatermarkEl.style.color = state.pdfWatermarkColor;
        pdfWatermarkEl.style.borderColor = state.pdfWatermarkColor;
    }

    const prevInvNum = document.getElementById('previewInvoiceNum');
    if (prevInvNum) prevInvNum.innerText = state.invoiceNumber;

    const prevTotal = document.getElementById('previewTotal');
    if (prevTotal) prevTotal.innerText = state.totalAmountFormatted;

    const prevDueDateLine = document.getElementById('previewDueDateLine');
    const prevDueDate = document.getElementById('previewDueDate');
    if (prevDueDateLine) {
        if (state.pdfShowPaidDate) {
            prevDueDateLine.innerHTML = `<strong>Date Paid:</strong> <span>${new Date(state.paidAt).toLocaleDateString()}</span>`;
            prevDueDateLine.classList.remove('d-none');
        } else if (state.pdfShowDueDate && state.dueDate) {
            prevDueDateLine.innerHTML = `<strong>Due Date:</strong> <span>${new Date(state.dueDate).toLocaleDateString()}</span>`;
            prevDueDateLine.classList.remove('d-none');
        } else {
            prevDueDateLine.classList.add('d-none');
        }
    }

    // 2. Email Preview (Use Backend Summary)
    const emailSubjectEl = document.getElementById('previewSubject'); // Matches HTML ID
    if (emailSubjectEl) emailSubjectEl.textContent = state.emailSubjectText;

    const emailClientEl = document.getElementById('previewClientName');
    if (emailClientEl) emailClientEl.textContent = state.clientName;

    // Build Summary Table from Backend Rows
    const summaryContainer = document.getElementById('previewSummaryRows');
    if (summaryContainer) {
        summaryContainer.innerHTML = state.emailSummaryRows.map(row => `
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee;">
                <span style="color: #666;">${row.label}:</span>
                <span style="font-weight: 500;">${row.value}</span>
            </div>
        `).join('');
    }

    // 3. Timestamp
    const ts = document.getElementById('emailPreviewTimestamp');
    if (ts) ts.innerText = `Preview updated at ${new Date().toLocaleTimeString()}`;
}

// Ensure Initial Load
fetchPreviewState();

// --- INITIALIZATION ---
loadClients();
loadInvoices();

window.resendInvoiceEmail = async function (id) {
    if (typeof showConfirm === 'function') {
        const confirmed = await showConfirm('Are you sure you want to resend this invoice to the client?', 'info', 'Resend Invoice');
        if (!confirmed) return;
    } else {
        if (!confirm('Are you sure you want to resend this invoice to the client?')) return;
    }

    try {
        if (typeof showAlert === 'function') {
            showAlert('Resending invoice...', 'info');
        }
        
        const res = await fetch('/api/invoices/resend-email-only', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: id })
        });
        
        if (res.ok) {
            if (typeof showAlert === 'function') await showAlert('Invoice email resent successfully!', 'success');
            else alert('Invoice email resent successfully!');
        } else {
            const err = await res.json();
            if (typeof showAlert === 'function') showAlert('Error: ' + err.error, 'error');
            else alert('Error: ' + err.error);
        }
    } catch (err) {
        if (typeof showAlert === 'function') showAlert('Failed to resend: ' + err.message, 'error');
        else alert('Failed to resend: ' + err.message);
    }
};

window.sendPaymentDeclinedAlert = async function(id) {
    if (typeof showConfirm === 'function') {
        const confirmed = await showConfirm('Are you sure you want to send a Payment Declined alert to this client?', 'info', 'Payment Declined');
        if (!confirmed) return;
    } else {
        if (!confirm('Are you sure you want to send a Payment Declined alert to this client?')) return;
    }

    try {
        if (typeof showAlert === 'function') {
            showAlert('Sending decline alert...', 'info');
        }
        
        const res = await fetch('/api/invoices/payment-declined', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: id })
        });
        
        if (res.ok) {
            if (typeof showAlert === 'function') await showAlert('Payment Declined email sent to the client!', 'success');
            else alert('Payment Declined email sent to the client!');
            loadInvoices(); // Refresh the invoice listing to reflect status if any
        } else {
            const err = await res.json();
            if (typeof showAlert === 'function') showAlert('Error: ' + err.error, 'error');
            else alert('Error: ' + err.error);
        }
    } catch (err) {
        if (typeof showAlert === 'function') showAlert('Failed to send alert: ' + err.message, 'error');
        else alert('Failed to send alert: ' + err.message);
    }
};
