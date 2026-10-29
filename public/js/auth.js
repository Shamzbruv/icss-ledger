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
                const stayLoggedIn = document.getElementById('stayLoggedIn').checked;

                // Update UI to loading state
                submitBtn.disabled = true;
                submitBtn.innerHTML = 'Signing In <span class="loading-dots"></span>';
                loginError.style.display = 'none';

                try {
                    const supabase = await window.ensureSupabaseClient();
                    const response = await fetch(`${window.CONFIG.API_BASE_URL}/auth/login`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(18000)
                    });
                    let session;
                    if (response.status === 404) {
                        const result = await supabase.auth.signInWithPassword({ email, password });
                        if (result.error) throw result.error;
                        session = result.data.session;
                    } else {
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
                        const saved = await supabase.auth.setSession({
                            access_token: result.session.access_token,
                            refresh_token: result.session.refresh_token
                        });
                        if (saved.error) throw saved.error;
                        session = saved.data.session;
                    }
                    if (!session) throw new Error('No authenticated session was created. Please try again.');
                    window.location.href = '/dashboard';

                } catch (err) {
                    console.error('Login error:', err.message);
                    loginError.textContent = ['TimeoutError','AbortError'].includes(err.name) ? 'The authentication service did not respond. Please check that the ICSS Supabase project is active and try again.' : err.message || 'Unable to sign in.';
                    loginError.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Sign In';
                }
            });
        }

        // Check if user is already logged in and on the login page
        const checkSession = async () => {
            const supabase = await window.ensureSupabaseClient();
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                if (window.location.pathname.endsWith('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/login')) {
                    console.log('Session found, redirecting to dashboard');
                    window.location.href = '/dashboard';
                }
            }
        };

        checkSession().catch(error => {
            if (loginError && !loginError.textContent) { loginError.textContent = error.message || 'Authentication is temporarily unavailable.'; loginError.style.display = 'block'; }
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
