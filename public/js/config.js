const CONFIG = {
    SUPABASE_URL: "https://bfhyuohoukpqvyfhqugm.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_qn5EaD-4JuCY2iT9JUuIQQ_0Rnh3b6F",
    // Dynamic Base URL for backend API
    get API_BASE_URL() {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
            return "http://localhost:3000"; // Local Backend Port
        }
        return "https://icss-ledger-production.up.railway.app"; // Production Backend
    }
};

// Attach to window for global access (simplifies inline script usage)
window.CONFIG = CONFIG;

// End of config.js
