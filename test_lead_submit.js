async function testLead() {
    try {
        console.log("Submitting test lead...");
        const res = await fetch('http://localhost:3000/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'System Test Lead',
                email: 'test@icreatesolutionsandservices.com',
                lead_type: 'Contact Form',
                message: 'Testing new backend logging and error handling.'
            })
        });
        
        const body = await res.text();
        console.log(`POST Response [${res.status}]:`, body);

        if (res.ok) {
            console.log("\nFetching stats...");
            const statRes = await fetch('http://localhost:3000/api/leads/stats');
            const statBody = await statRes.text();
            console.log(`STATS Response [${statRes.status}]:`, statBody);
        }
    } catch (err) {
        console.error("Test failed:", err.message);
    }
}
testLead();
