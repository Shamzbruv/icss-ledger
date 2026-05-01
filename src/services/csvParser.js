const fs = require('fs');

/**
 * Normalizes a raw string into a consistent format.
 */
function normalizeString(str) {
    if (!str) return '';
    return str.trim();
}

/**
 * Attempts to parse date formats intuitively, including DD/MM/YYYY vs MM/DD/YYYY ambiguity checks.
 * Returns an object with the parsed ISO date and any warnings.
 */
function parseDate(dateStr, formatHint = null) {
    if (!dateStr) return { date: null, warning: 'AMOUNT_INVALID' }; // Reusing for missing but typically DATE_INVALID

    const normalized = dateStr.trim();
    // Check if it's already ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return { date: normalized };
    }

    // Check for DD/MM/YYYY or MM/DD/YYYY
    const slashMatch = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (slashMatch) {
        const part1 = parseInt(slashMatch[1], 10);
        const part2 = parseInt(slashMatch[2], 10);
        const year = slashMatch[3];

        let day, month;
        let warning = null;

        if (formatHint === 'DD/MM/YYYY') {
            day = part1; month = part2;
        } else if (formatHint === 'MM/DD/YYYY') {
            month = part1; day = part2;
        } else {
            // Ambiguous
            if (part1 > 12) {
                // Must be DD/MM
                day = part1; month = part2;
            } else if (part2 > 12) {
                // Must be MM/DD
                month = part1; day = part2;
            } else {
                // Both <= 12, ambiguous default to DD/MM as it's common in JM, but warn
                day = part1; month = part2;
                warning = 'DATE_AMBIGUOUS';
            }
        }

        if (month > 12 || day > 31) return { date: null, warning: 'DATE_INVALID' };

        return {
            date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            warning
        };
    }

    // Try native Date parsing for string like "02-Mar-2026"
    const parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) {
        return {
            date: parsed.toISOString().split('T')[0]
        };
    }

    return { date: null, warning: 'DATE_INVALID' };
}

/**
 * Parses amounts like $1,234.56, -123.45, (123.45)
 */
function parseAmount(amountStr) {
    if (!amountStr) return null;
    let normalized = amountStr.toString().trim();

    // Handle parentheses for negatives
    if (normalized.startsWith('(') && normalized.endsWith(')')) {
        normalized = '-' + normalized.substring(1, normalized.length - 1);
    }

    // Remove currency symbols and commas
    normalized = normalized.replace(/[JUS\$£€,]/g, '').trim();

    const amount = parseFloat(normalized);
    if (isNaN(amount)) return null;

    return amount;
}

/**
 * Basic Dialect detection for CSV
 */
function detectDelimiter(text) {
    const lines = text.split('\n').slice(0, 10);
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };

    lines.forEach(line => {
        ['\,', '\;', '\t', '\|'].forEach(char => {
            // Very naive split counting, assumes no quotes for basic heuristic
            counts[char] += (line.match(new RegExp(`\\${char}`, 'g')) || []).length;
        });
    });

    let bestChar = ',';
    let max = 0;
    for (const [char, count] of Object.entries(counts)) {
        if (count > max) {
            max = count;
            bestChar = char;
        }
    }
    return bestChar;
}

/**
 * RFC 4180 parsing for a single line
 */
function splitCSVLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Skip escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

/**
 * Main Parse Function
 */
async function parseBulkInput({ rawText, fileBuffer, sourceType, parseSettings = {} }) {
    let content = rawText;
    if (fileBuffer) {
        content = fileBuffer.toString('utf8');
    }

    if (!content) return { lines: [], warnings: [] };

    const delimiter = parseSettings.delimiter || detectDelimiter(content);
    const hasHeader = parseSettings.hasHeader !== false;

    const rawLines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

    let headers = [];
    let startIndex = 0;

    if (hasHeader && rawLines.length > 0) {
        headers = splitCSVLine(rawLines[0], delimiter).map(h => h.trim().toLowerCase());
        startIndex = 1;
    } else {
        // Generate generic headers Column1, Column2...
        const maxCols = splitCSVLine(rawLines[0], delimiter).length;
        headers = Array.from({ length: maxCols }, (_, i) => `column${i + 1}`);
    }

    const parsedLines = [];
    const globalWarnings = new Set();
    const isAmbiguousCheckedForBlock = { checked: false, isDDMM: true }; // heuristic

    // Determine expected columns mapping
    const colMap = {
        date: headers.findIndex(h => h.includes('date')),
        description: headers.findIndex(h => h.includes('desc') || h.includes('memo') || h.includes('payee')),
        vendor: headers.findIndex(h => h.includes('vendor') || h.includes('merchant')),
        amount: headers.findIndex(h => h === 'amount'),
        debit: headers.findIndex(h => h === 'debit' || h.includes('money out')),
        credit: headers.findIndex(h => h === 'credit' || h.includes('money in')),
        currency: headers.findIndex(h => h.includes('currency') || h === 'ccy'),
        category: headers.findIndex(h => h.includes('category') || h.includes('account'))
    };

    for (let i = startIndex; i < rawLines.length; i++) {
        const row = splitCSVLine(rawLines[i], delimiter);
        const sourceFields = {};
        headers.forEach((h, idx) => {
            sourceFields[headers[idx] || `column${idx + 1}`] = row[idx] || '';
        });

        const raw = { row_number: i + (hasHeader ? 0 : 1), source_fields: sourceFields };
        let normalized = {};
        const warnings = [];

        // DATE
        let rawDate = '';
        if (colMap.date !== -1 && row[colMap.date]) {
            rawDate = row[colMap.date];
        } else if (sourceType === 'clipboard' && Object.values(colMap).every(v => v === -1)) {
            // Heuristic fallback for headerless TSV: assume col 1 is date
            rawDate = row[0] || '';
        }

        const dateParseResult = parseDate(rawDate, parseSettings.dateFormatHint);
        if (dateParseResult.date) {
            normalized.txn_date = dateParseResult.date;
        }
        if (dateParseResult.warning) {
            warnings.push(dateParseResult.warning);
            globalWarnings.add(dateParseResult.warning);
        }

        // DESCRIPTION & VENDOR
        let desc = '';
        if (colMap.description !== -1 && row[colMap.description]) desc = row[colMap.description];
        else if (colMap.vendor === -1 && row[1]) desc = row[1]; // fallback

        let vendor = '';
        if (colMap.vendor !== -1 && row[colMap.vendor]) vendor = row[colMap.vendor];
        else if (colMap.description !== -1 && !desc) vendor = row[2] || ''; // fallback

        normalized.description = desc.trim().toUpperCase();
        normalized.counterparty_name = vendor ? vendor.trim().toUpperCase() : normalized.description;

        // AMOUNT (Signed)
        let amt = null;
        if (colMap.amount !== -1 && row[colMap.amount]) {
            amt = parseAmount(row[colMap.amount]);
        } else if (colMap.debit !== -1 || colMap.credit !== -1) {
            const deb = colMap.debit !== -1 ? parseAmount(row[colMap.debit]) || 0 : 0;
            const cred = colMap.credit !== -1 ? parseAmount(row[colMap.credit]) || 0 : 0;
            if (cred > 0) amt = cred;
            else if (deb > 0) amt = -Math.abs(deb);
        } else if (sourceType === 'clipboard' && Object.values(colMap).every(v => v === -1)) {
            // Heuristic
            amt = parseAmount(row[row.length - 2] || row[2]);
        }

        if (amt === null || isNaN(amt)) {
            warnings.push('AMOUNT_INVALID');
        } else {
            normalized.amount_signed = amt;
            // Negative typically means money_out for expenses, positive money_in.
            // Some bank statements are inverted. Configurable via parseSettings.invertPositives.
            if (parseSettings.invertPositives) {
                normalized.direction = amt > 0 ? 'money_out' : 'money_in';
            } else {
                normalized.direction = amt < 0 ? 'money_out' : 'money_in';
            }
        }

        // CURRENCY
        let ccy = parseSettings.defaultCurrency || 'JMD';
        if (colMap.currency !== -1 && row[colMap.currency]) {
            ccy = row[colMap.currency].trim().toUpperCase() || ccy;
        } else if (colMap.amount !== -1 && row[colMap.amount]) {
            if (row[colMap.amount].includes('US$')) ccy = 'USD';
            if (row[colMap.amount].includes('J$')) ccy = 'JMD';
        }
        normalized.currency = ccy;

        // CATEGORY
        let category = '';
        if (colMap.category !== -1 && row[colMap.category]) {
            category = row[colMap.category].trim();
        }
        normalized.category = category;

        normalized.source_type = sourceType;

        parsedLines.push({
            raw,
            normalized,
            parse_status: warnings.length > 0 && warnings.some(w => w.includes('INVALID')) ? 'error' : 'parsed',
            warnings
        });
    }

    if (delimiter !== ',' && delimiter !== '\t') {
        globalWarnings.add('DELIMITER_UNCERTAIN');
    }

    return {
        lines: parsedLines,
        warnings: Array.from(globalWarnings)
    };
}

module.exports = {
    parseBulkInput,
    parseDate,
    parseAmount
};
