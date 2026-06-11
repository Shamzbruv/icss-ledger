fetch('https://icreatesolutionsandservices.com/js/auth.js', {
    headers: { 'If-None-Match': 'W/"bf3-19e8e691968"' }
}).then(res => {
    console.log("Status:", res.status);
}).catch(console.error);
