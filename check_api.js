async function run() {
    try {
        const res1 = await fetch('http://localhost:3000/api/companies');
        const companies = await res1.json();
        console.log("Companies:", companies);
        if (companies && companies.length > 0) {
            const cid = companies[0].id;
            const res2 = await fetch(`http://localhost:3000/api/accounting/dashboard/widgets?company_id=${cid}`);
            const body = await res2.text();
            console.log("Widgets Raw:", body);
        }
    } catch (e) { console.error("Error:", e); }
}
run();
