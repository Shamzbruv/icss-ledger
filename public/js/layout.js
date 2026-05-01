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

    // --- GLOBAL MODALS (Alerts/Confirms) ---
    // Inject if they don't already exist (to prevent duplicates with older pages)
    if (!document.getElementById('alertModal')) {
        const modalHtml = `
            <!-- CUSTOM CONFIRM MODAL -->
            <div id="confirmModal" class="modal-overlay d-none">
                <div class="modal-content confirm-modal">
                    <div class="modal-body">
                        <span id="confirmIcon" class="confirm-icon">
                            <i class="fas fa-exclamation-triangle text-warning"></i>
                        </span>
                        <h3 id="confirmTitle" class="confirm-title">Are you sure?</h3>
                        <p id="confirmMessage" class="confirm-message">This action cannot be undone.</p>
                        <div class="d-flex gap-2 justify-content-center">
                            <button id="cancelBtn" class="btn btn-secondary w-100">Cancel</button>
                            <button id="confirmBtn" class="btn btn-danger w-100">Confirm</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- CUSTOM ALERT MODAL -->
            <div id="alertModal" class="modal-overlay d-none">
                <div class="modal-content confirm-modal">
                    <div class="modal-body">
                        <span id="alertIcon" class="confirm-icon">
                            <i class="fas fa-check-circle text-success"></i>
                        </span>
                        <h3 id="alertTitle" class="confirm-title">Success</h3>
                        <p id="alertMessage" class="confirm-message">Operation completed.</p>
                        <div class="d-flex justify-content-center">
                            <button id="alertOkBtn" class="btn btn-primary w-100">OK</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    window.showAlert = function(message, type = 'success', title = null) {
        if (!document.getElementById('alertModal')) return alert(message);
        return new Promise((resolve) => {
            const modal = document.getElementById('alertModal');
            const titleEl = document.getElementById('alertTitle');
            const msgEl = document.getElementById('alertMessage');
            const iconEl = document.getElementById('alertIcon');
            const okBtn = document.getElementById('alertOkBtn');

            msgEl.innerText = message;

            let iconHtml = '';
            let defaultTitle = '';
            let btnClass = 'btn-primary';

            if (type === 'success') {
                iconHtml = '<i class="fas fa-check-circle text-success"></i>';
                defaultTitle = 'Success';
                btnClass = 'btn-success';
            } else if (type === 'error') {
                iconHtml = '<i class="fas fa-times-circle text-danger"></i>';
                defaultTitle = 'Error';
                btnClass = 'btn-danger';
            } else {
                iconHtml = '<i class="fas fa-info-circle text-info"></i>';
                defaultTitle = 'Info';
                btnClass = 'btn-primary';
            }

            iconEl.innerHTML = iconHtml;
            titleEl.innerText = title || defaultTitle;
            okBtn.className = `btn ${btnClass} w-100`;

            modal.classList.remove('d-none');

            const handleOk = () => {
                modal.classList.add('d-none');
                okBtn.removeEventListener('click', handleOk);
                resolve();
            };
            okBtn.addEventListener('click', handleOk);
        });
    };

    window.showConfirm = function(message, type = 'info', confirmText = 'OK') {
        if (!document.getElementById('confirmModal')) return Promise.resolve(confirm(message));
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            const titleEl = document.getElementById('confirmTitle');
            const msgEl = document.getElementById('confirmMessage');
            const iconEl = document.getElementById('confirmIcon');
            const confirmBtn = document.getElementById('confirmBtn');
            const cancelBtn = document.getElementById('cancelBtn');

            msgEl.innerText = message;
            confirmBtn.innerText = confirmText;

            if (type === 'danger') {
                iconEl.innerHTML = '<i class="fas fa-exclamation-triangle text-danger"></i>';
                titleEl.innerText = 'Confirmation Required';
                confirmBtn.className = 'btn btn-danger w-100';
            } else {
                iconEl.innerHTML = '<i class="fas fa-info-circle text-info"></i>';
                titleEl.innerText = 'Confirmation';
                confirmBtn.className = 'btn btn-primary w-100';
            }

            modal.classList.remove('d-none');

            const handleConfirm = () => {
                modal.classList.add('d-none');
                cleanup();
                resolve(true);
            };

            const handleCancel = () => {
                modal.classList.add('d-none');
                cleanup();
                resolve(false);
            };

            const cleanup = () => {
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
            };

            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
        });
    };

});

