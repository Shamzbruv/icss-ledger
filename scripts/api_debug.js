const http = require('http');
const fs = require('fs');

async function fetchLog(url) {
    return new Promise(resolve => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
    });
}

async function run() {
    const id = "123b8bee-baab-4763-a152-680cb80981e8";
    const coa = await fetchLog('http://localhost:3000/api/accounting/coa?company_id=' + id);
    const exp = await fetchLog('http://localhost:3000/api/accounting/expenses?company_id=' + id);

    fs.writeFileSync('fetch.log', `COA: ${coa}\nEXP: ${exp}`);
}

run();
