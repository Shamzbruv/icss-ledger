// CONFIG is now loaded globally via script tag
const CONFIG = window.CONFIG;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Supabase (requires SDK in HTML or dynamic import)
    // For simplicity, we assume Supabase is loaded via CDN in the HTML files
    const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    window.supabaseClient = supabase;

    // 2. Check Authentication
    const { data: { session } } = await supabase.auth.getSession();

    // If no session and not on login page, redirect
    if (!session && !window.location.pathname.includes('login.html')) {
        window.location.href = '/login.html';
        return;
    }

    // 3. Inject FontAwesome if not already present
    if (!document.querySelector('link[href*="font-awesome"]')) {
        const fa = document.createElement('link');
        fa.rel = 'stylesheet';
        fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
        document.head.appendChild(fa);
    }

    const component = `
    <header class="app-header">
        <div class="container header-content">
            <div class="brand-section">
                <!-- <img src="assets/icss-logo.png" alt="ICSS Logo" class="brand-logo"> -->
                <h1 class="app-title"><a href="/dashboard" style="color: white; text-decoration: none;">ICSS Command Center</a></h1>
            </div>
            <button class="menu-toggle" id="menuToggle">
                <i class="fas fa-bars"></i>
            </button>
            <nav class="main-nav" id="mainNav">
                <a href="/dashboard" class="nav-link ${window.location.pathname === '/' || window.location.pathname === '/dashboard' ? 'active' : ''}">Dashboard</a>
                <a href="/invoices" class="nav-link ${window.location.pathname.includes('invoices') ? 'active' : ''}">Invoices</a>
                <a href="/client-care-pulse" class="nav-link ${window.location.pathname.includes('client-care') ? 'active' : ''}">Client Care</a>
                <a href="/accounting" class="nav-link ${window.location.pathname.includes('accounting') ? 'active' : ''}">Accounting</a>
                <button id="logoutBtn" class="btn btn-outline-light btn-sm" style="margin-left: 10px; text-transform: none; font-weight: 500;">Logout</button>
            </nav>
        </div>
    </header>
    `;

    // Insert at the beginning of body
    document.body.insertAdjacentHTML('afterbegin', component);

    // Mobile Menu Toggle Logic
    const menuToggle = document.getElementById('menuToggle');
    const mainNav = document.getElementById('mainNav');
    if (menuToggle && mainNav) {
        menuToggle.addEventListener('click', () => {
            mainNav.classList.toggle('active');
            menuToggle.classList.toggle('active');
            const icon = menuToggle.querySelector('i');
            if (mainNav.classList.contains('active')) {
                icon.classList.replace('fa-bars', 'fa-times');
            } else {
                icon.classList.replace('fa-times', 'fa-bars');
            }
        });

        // Close menu when clicking links
        mainNav.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                mainNav.classList.remove('active');
                menuToggle.classList.remove('active');
                const icon = menuToggle.querySelector('i');
                icon.classList.replace('fa-times', 'fa-bars');
            });
        });
    }

    // 4. Inject Back to Top Button
    const bttButton = document.createElement('button');
    bttButton.className = 'back-to-top';
    bttButton.id = 'backToTop';
    bttButton.innerHTML = '<i class="fas fa-chevron-up"></i>';
    document.body.appendChild(bttButton);

    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
            bttButton.classList.add('active');
        } else {
            bttButton.classList.remove('active');
        }
    });

    bttButton.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Add Logout Handler
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.href = '/login.html';
        });
    }
});

