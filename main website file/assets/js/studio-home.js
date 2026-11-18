// Keep saved links to the original planner tools and industry forms working.
const plannerAnchors = new Set(['#quote','#solution-finder','#project-estimator','#pkg1-form','#pkg2-form','#pkg3-form','#newsletter-form','#process']);
function routePlannerLink() {
    const service = new URLSearchParams(location.search).get('service');
    if (service || plannerAnchors.has(location.hash)) {
        location.replace('/project-planner.html' + location.search + (location.hash || '#services'));
    } else if (location.hash === '#audit-cta') {
        location.replace('/contact?service=Website%20review');
    }
}
routePlannerLink();
window.addEventListener('hashchange',routePlannerLink);
document.querySelectorAll('a[href^="/project-planner.html"]').forEach(link => {
    const target = new URL(link.href);
    const campaign = new URLSearchParams(location.search);
    for (const [key,value] of campaign) if (key.startsWith('utm_') && !target.searchParams.has(key)) target.searchParams.set(key,value);
    link.href = target.href;
});

// Retain the website's existing analytics preference on the redesigned homepage.
function startAnalytics() {
    window.dataLayer = window.dataLayer || [];
    function track(){ window.dataLayer.push(arguments); }
    track('js', new Date());
    track('config','G-63WCDFCGPR');
    for (const src of ['https://www.googletagmanager.com/gtag/js?id=G-63WCDFCGPR','https://t.contentsquare.net/uxa/0dae5c250254a.js']) {
        const script = document.createElement('script');
        script.async = true;
        script.src = src;
        document.head.append(script);
    }
}
let consent;
try { consent = localStorage.getItem('cookieConsent'); } catch {}
if (consent === 'accepted') startAnalytics();
else if (!consent) {
    const notice = document.createElement('aside');
    notice.className = 'edition-cookie';
    notice.setAttribute('aria-label','Analytics preferences');
    notice.innerHTML = '<p>Allow analytics to help us improve the website? <a href="/terms.html#privacy-policy">Privacy policy</a></p><button type="button" value="accepted">Accept</button><button type="button" value="declined">Decline</button>';
    notice.addEventListener('click', event => {
        if (event.target.tagName !== 'BUTTON') return;
        const choice = event.target.value;
        try { localStorage.setItem('cookieConsent',choice); } catch {}
        if (choice === 'accepted') startAnalytics();
        notice.remove();
    });
    document.body.append(notice);
}
