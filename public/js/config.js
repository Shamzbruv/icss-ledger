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

let supabaseClientPromise = null;
let runtimeAuthConfigPromise = null;
async function loadRuntimeAuthConfig() {
    if (!runtimeAuthConfigPromise) runtimeAuthConfigPromise = fetch(`${CONFIG.API_BASE_URL}/auth/config`, {
        cache: 'no-store', signal: AbortSignal.timeout(8000)
    }).then(async response => {
        // A separately hosted static frontend can retain its original public config.
        if (response.status === 404) return;
        const config = await response.json();
        if (!response.ok) throw new Error(config.error || 'Authentication configuration is unavailable.');
        if (!config.supabaseUrl || !config.supabaseKey) throw new Error('Authentication settings are incomplete.');
        CONFIG.SUPABASE_URL = config.supabaseUrl;
        CONFIG.SUPABASE_ANON_KEY = config.supabaseKey;
    }).catch(error => { runtimeAuthConfigPromise = null; throw error; });
    return runtimeAuthConfigPromise;
}

async function ensureSupabaseClient() {
    if (window.supabaseClient) {
        return window.supabaseClient;
    }

    if (!supabaseClientPromise) {
        supabaseClientPromise = (async () => {
            await loadRuntimeAuthConfig();
            const timeoutAt = Date.now() + 5000;

            while (!window.supabase?.createClient) {
                if (Date.now() >= timeoutAt) {
                    throw new Error('Supabase library not loaded');
                }

                await new Promise((resolve) => setTimeout(resolve, 25));
            }

            if (!window.supabaseClient) {
                window.supabaseClient = window.supabase.createClient(
                    CONFIG.SUPABASE_URL,
                    CONFIG.SUPABASE_ANON_KEY
                );
            }

            return window.supabaseClient;
        })().catch((error) => {
            supabaseClientPromise = null;
            throw error;
        });
    }

    return supabaseClientPromise;
}

window.ensureSupabaseClient = ensureSupabaseClient;

/**
 * Wrapper around standard fetch that automatically injects the Supabase JWT.
 * Required for calling protected /api/* endpoints.
 */
async function apiFetch(url, options = {}) {
    const supabaseClient = await ensureSupabaseClient();
    
    // Resolve full backend URL if it's a relative API route
    let fetchUrl = url;
    if (fetchUrl.startsWith('/api/')) {
        fetchUrl = `${CONFIG.API_BASE_URL}${fetchUrl}`;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
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
