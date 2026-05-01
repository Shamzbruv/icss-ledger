document.addEventListener('DOMContentLoaded', async () => {
    try {
        const supabase = await window.ensureSupabaseClient();

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
                    const { data, error } = await supabase.auth.signInWithPassword({
                        email,
                        password
                    });

                    if (error) {
                        throw error;
                    }

                    // Successful login
                    console.log('Login successful:', data);

                    // Supabase handles persistence automatically based on its internal logic.
                    window.location.href = 'dashboard';

                } catch (err) {
                    console.error('Login error:', err.message);
                    loginError.textContent = err.message || 'Invalid email or password.';
                    loginError.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Sign In';
                }
            });
        }

        // Check if user is already logged in and on the login page
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                if (window.location.pathname.endsWith('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/login')) {
                    console.log('Session found, redirecting to dashboard');
                    window.location.href = 'dashboard';
                }
            }
        };

        checkSession();
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
});
