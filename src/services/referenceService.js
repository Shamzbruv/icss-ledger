/**
 * Generates a Smart Bank Transfer Reference Code.
 * Format: ICSS-{CLIENT_3}-{INV}-{SERVICE}-{PCT}P
 * 
 * @param {string} clientName - Full name of the client
 * @param {number|string} invoiceNumber - Invoice number
 * @param {string} serviceCode - Code like 'WEB', 'APP'
 * @param {number} percentage - Payment percentage (e.g. 40)
 * @returns {string} The generated reference code
 */
function generateReferenceCode(clientName, invoiceNumber, serviceCode, percentage) {
    // 1. Company Code
    const companyCode = 'ICSS';

    // 2. Client Code: First 3 letters, uppercase, stripped of non-alpha
    const cleanClientName = clientName.replace(/[^a-zA-Z]/g, '').toUpperCase();
    const clientCode = cleanClientName.substring(0, 3) || 'CLI';

    // 3. Invoice Number
    const invCode = invoiceNumber.toString();

    // 4. Service Code
    const servCode = (serviceCode || 'CUST').toUpperCase();

    // 5. Percentage
    const pctCode = `${percentage}P`;

    return `${companyCode}-${clientCode}-${invCode}-${servCode}-${pctCode}`;
}

/**
 * Parses a reference code into its components.
 * 
 * @param {string} refCode 
 * @returns {Object|null} { company, client, invoice, service, percentage } or null if invalid format
 */
function parseReferenceCode(refCode) {
    if (!refCode) return null;

    // Regex: ICSS-REC-2401-WEB-40P
    // Parts: [ICSS, REC, 2401, WEB, 40P]
    const parts = refCode.split('-');
    if (parts.length !== 5) return null;

    const percentageVal = parseInt(parts[4].replace('P', ''), 10);

    return {
        company: parts[0],
        clientCode: parts[1],
        invoiceNumber: parts[2], // Keep as string initially
        serviceCode: parts[3],
        percentage: isNaN(percentageVal) ? 0 : percentageVal
    };
}

module.exports = { generateReferenceCode, parseReferenceCode };
