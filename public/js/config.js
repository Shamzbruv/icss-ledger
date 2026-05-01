const CONFIG = {
    SUPABASE_URL: "https://bfhyuohoukpqvyfhqugm.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_qn5EaD-4JuCY2iT9JUuIQQ_0Rnh3b6F",
    // Dynamic Base URL for backend API
    get API_BASE_URL() {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
            return "http://localhost:3000"; // Local Backend Port
        }
        return ""; // Production/Remote Backend (Relative Path)
    }
};

// Attach to window for global access (simplifies inline script usage)
window.CONFIG = CONFIG;

/**
 * Wrapper around standard fetch that automatically injects the Supabase JWT.
 * Required for calling protected /api/* endpoints.
 */
async function apiFetch(url, options = {}) {
    if (!window.supabaseClient) {
        throw new Error('Supabase client not initialized');
    }
    
    // Resolve full backend URL if it's a relative API route
    let fetchUrl = url;
    if (fetchUrl.startsWith('/api/')) {
        fetchUrl = `${CONFIG.API_BASE_URL}${fetchUrl}`;
    }

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    
    if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    
    return fetch(fetchUrl, { ...options, headers });
}

window.apiFetch = apiFetch;

// End of config.js
