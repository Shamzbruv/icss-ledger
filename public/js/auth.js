// CONFIG is now loaded globally via script tag
const CONFIG = window.CONFIG;

// Initialize Supabase client
const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
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
            // Check if we are on the login page
            if (window.location.pathname.endsWith('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/login')) {
                console.log('Session found, redirecting to dashboard');
                window.location.href = 'dashboard';
            }
        } else {
            // If NOT logged in, and trying to access protected pages?
            // Since we removed server-side guards, we should add a guard here for non-login pages
            // But let's stick to the zip file logic first which only had the redirect-if-logged-in part in the file I saw.
            // Actually, I should probably add a guard for dashboard.html if I'm editing this file, 
            // BUT the user wants the "old code". I will stick to the provided logic but ensure it covers the login page check.
        }
    };

    checkSession();
});

// Global export
export { supabase };
