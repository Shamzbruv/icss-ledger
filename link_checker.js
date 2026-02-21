const fs = require('fs');
const path = require('path');

const rootDir = '/Users/Bakers/Documents/iCreate_Softwares/ICSS Command Center';
const filesToCheck = ['index.html', 'portfolio.html', 'subscriptions.html', 'terms.html'];

const report = {
    brokenLinks: [],
    missingAssets: [],
    warnings: []
};

filesToCheck.forEach(file => {
    const filePath = path.join(rootDir, file);
    if (!fs.existsSync(filePath)) {
        report.warnings.push(`File not found: ${file}`);
        return;
    }

    console.log(`Scanning ${file}...`);
    const content = fs.readFileSync(filePath, 'utf8');

    // Regex for href
    const hrefRegex = /href=["']([^"']+)["']/g;
    let match;
    while ((match = hrefRegex.exec(content)) !== null) {
        const href = match[1];
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('http')) continue;
        if (href.startsWith('/command')) continue; // App route

        const absolutePath = path.resolve(rootDir, href.replace(/^\//, ''));
        if (!fs.existsSync(absolutePath)) {
            report.brokenLinks.push({ file, href });
        }
    }

    // Regex for src
    const srcRegex = /src=["']([^"']+)["']/g;
    while ((match = srcRegex.exec(content)) !== null) {
        const src = match[1];
        if (!src || src.startsWith('http') || src.startsWith('data:')) continue;
        if (src.startsWith('/command')) continue; // App route

        const absolutePath = path.resolve(rootDir, src.replace(/^\//, ''));
        if (!fs.existsSync(absolutePath)) {
            report.missingAssets.push({ file, src });
        }
    }
});

console.log('--- SCAN REPORT ---');
if (report.brokenLinks.length === 0 && report.missingAssets.length === 0) {
    console.log('✅ No broken links or missing assets found.');
} else {
    if (report.brokenLinks.length > 0) {
        console.log('❌ Broken Links:');
        report.brokenLinks.forEach(item => console.log(`  [${item.file}] -> ${item.href}`));
    }
    if (report.missingAssets.length > 0) {
        console.log('❌ Missing Assets:');
        report.missingAssets.forEach(item => console.log(`  [${item.file}] -> ${item.src}`));
    }
}
