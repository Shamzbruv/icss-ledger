// Bound SDK work as well as HTTP requests: a stale refresh session must not
// leave the sign-in button disabled indefinitely.
const withAuthTimeout = (work, milliseconds = 12000) => {
    let timer;
    return Promise.race([
        Promise.resolve().then(work),
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error('Authentication timed out. Please try again.');
                error.name = 'TimeoutError';
                reject(error);
            }, milliseconds);
        })
    ]).finally(() => clearTimeout(timer));
};

const initializeAuth = async () => {
    try {
        const loginForm = document.getElementById('loginForm');
        const loginError = document.getElementById('loginError');
        const submitBtn = document.getElementById('submitBtn');

        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;

                // Update UI to loading state
                submitBtn.disabled = true;
                submitBtn.innerHTML = 'Signing In <span class="loading-dots"></span>';
                loginError.style.display = 'none';

                try {
                    // Ask the server first; an unavailable provider should return a
                    // clear error without waiting for browser session recovery.
                    const response = await fetch(`${window.CONFIG.API_BASE_URL}/auth/login`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(18000)
                    });
                    if (response.status === 404) throw new Error('The sign-in endpoint is unavailable. Please reload the page and try again.');
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
                    if (!result.session?.access_token || !result.session?.refresh_token) {
                        throw new Error('The authentication service did not return a session. Please try again.');
                    }
                    const supabase = await withAuthTimeout(() => window.ensureSupabaseClient());
                    const saved = await withAuthTimeout(() => supabase.auth.setSession({
                        access_token: result.session.access_token,
                        refresh_token: result.session.refresh_token
                    }));
                    if (saved.error) throw saved.error;
                    if (!saved.data?.session) throw new Error('No authenticated session was created. Please try again.');
                    window.location.href = '/dashboard';

                } catch (err) {
                    console.error('Login error:', err.message);
                    loginError.textContent = ['TimeoutError','AbortError'].includes(err.name) ? 'The authentication service did not respond. Please check that the ICSS Supabase project is active and try again.' : err.message || 'Unable to sign in.';
                    loginError.style.display = 'block';
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Sign In';
                }
            });
        }

        // Check if user is already logged in and on the login page
        const checkSession = async () => {
            const supabase = await withAuthTimeout(() => window.ensureSupabaseClient());
            const { data: { session } } = await withAuthTimeout(() => supabase.auth.getSession());
            if (session) {
                if (window.location.pathname.endsWith('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/login')) {
                    console.log('Session found, redirecting to dashboard');
                    window.location.href = '/dashboard';
                }
            }
        };

        checkSession().catch(error => {
            // A stale saved session must not replace the result of a new login.
            console.warn('Saved session check failed:', error.message);
        });
    } catch (err) {
        console.error('Auth bootstrap error:', err);
        const loginError = document.getElementById('loginError');
        const submitBtn = document.getElementById('submitBtn');

        if (loginError) {
            loginError.textContent = err.message || 'Unable to initialize login.';
            loginError.style.display = 'block';
        }

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Sign In';
        }
    }
};

// type="module" implies deferred execution, so DOM elements are ready.
initializeAuth();
