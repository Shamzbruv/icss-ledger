// CONFIG is now loaded globally via script tag
const CONFIG = window.CONFIG;

document.addEventListener('DOMContentLoaded', async () => {
    const supabase = await window.ensureSupabaseClient();

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

    const sidebarStyle = document.createElement('link');
    sidebarStyle.rel = 'stylesheet';
    sidebarStyle.href = '/css/command-sidebar.css?v=20261118';
    document.head.appendChild(sidebarStyle);

    const component = `
    <header id="commandSidebar">
        <div class="side-inner">
            <div class="brand-section">
                <a href="/dashboard" class="brand-link" aria-label="ICSS Command Center dashboard">
                    <span class="brand-mark">IC</span>
                    <span class="brand-copy"><strong>ICSS</strong><small>Command Center</small></span>
                </a>
            </div>
            <button class="side-toggle" id="menuToggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="mainNav">
                <i class="fas fa-bars"></i>
            </button>
            <nav class="side-nav" id="mainNav" aria-label="Command Center">
                <a href="/dashboard" class="nav-link ${window.location.pathname === '/' || window.location.pathname === '/dashboard' ? 'active' : ''}"><i class="fas fa-gauge-high"></i><span>Dashboard</span></a>
                <a href="/prospects.html" class="nav-link ${['/prospects','/prospects.html'].includes(window.location.pathname) ? 'active' : ''}"><i class="fas fa-address-book"></i><span>Daily Prospects</span></a>
                <a href="/leads" class="nav-link ${window.location.pathname.includes('leads') ? 'active' : ''}"><i class="fas fa-user-plus"></i><span>Leads</span></a>
                <a href="/reviews-admin" class="nav-link ${window.location.pathname.includes('reviews') ? 'active' : ''}"><i class="fas fa-star"></i><span>Reviews</span></a>
                <a href="/link-hub-admin" class="nav-link ${window.location.pathname.includes('link-hub-admin') ? 'active' : ''}"><i class="fas fa-link"></i><span>Link Hub</span></a>
                <a href="/reveal-hunt-admin" class="nav-link ${window.location.pathname.includes('reveal-hunt') ? 'active' : ''}"><i class="fas fa-gift"></i><span>Reveal Hunt</span></a>
                <a href="/website-manager?section=portfolio" class="nav-link ${window.location.pathname.includes('website-manager') && !window.location.search.includes('careers') ? 'active' : ''}"><i class="fas fa-briefcase"></i><span>Website & Portfolio</span></a>
                <a href="/website-manager?section=careers" class="nav-link ${window.location.pathname.includes('website-manager') && window.location.search.includes('careers') ? 'active' : ''}"><i class="fas fa-users"></i><span>Careers & Referrals</span></a>
                <a href="/invoices" class="nav-link ${window.location.pathname.includes('invoices') ? 'active' : ''}"><svg class="invoice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 7h2M8 11h2m2 3v6m2-5h-3a1 1 0 0 0 0 2h2a1 1 0 0 1 0 2h-3"/></svg><span>Invoices</span></a>
                <a href="/contracts" class="nav-link ${window.location.pathname === '/contracts' ? 'active' : ''}"><i class="fas fa-file-signature"></i><span>Contracts</span></a>
                <a href="/partner-contracts" class="nav-link ${(window.location.pathname.includes('partner-contracts') || window.location.pathname.includes('halomanage-partnerships') || window.location.pathname.includes('referral-contracts')) ? 'active' : ''}"><i class="fas fa-handshake"></i><span>Partner Contracts</span></a>
                <a href="/client-care-pulse" class="nav-link ${window.location.pathname.includes('client-care') ? 'active' : ''}"><i class="fas fa-heart-pulse"></i><span>Client Care</span></a>
                <a href="/accounting" class="nav-link ${window.location.pathname.includes('accounting') ? 'active' : ''}"><i class="fas fa-chart-line"></i><span>Accounting</span></a>
                <button type="button" class="header-install" data-app-install aria-label="Install ICSS Command Center" title="Install Command Center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></svg><span>Install app</span></button>
                <button id="logoutBtn" class="header-logout" title="Logout" aria-label="Logout"><i class="fas fa-arrow-right-from-bracket"></i><span>Sign out</span></button>
            </nav>
        </div>
    </header>
    <button id="sideBackdrop" hidden tabindex="-1" aria-label="Close navigation"></button>
    `;

    // Insert at the beginning of body
    document.body.insertAdjacentHTML('afterbegin', component);

    mainNavLinks();
    document.dispatchEvent(new Event('icss:layout-ready'));
    function mainNavLinks() {
        document.querySelectorAll('#mainNav .nav-link').forEach(link => {
            link.title = link.textContent.trim();
            link.setAttribute('aria-label', link.textContent.trim());
            if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
        });
    }

    const toggle = document.getElementById('menuToggle');
    const nav = document.getElementById('mainNav');
    const sidebar = document.getElementById('commandSidebar');
    const backdrop = document.getElementById('sideBackdrop');
    const mobile = window.matchMedia('(max-width: 800px)');
    let compact = false, drawer = false;
    try { compact = localStorage.getItem('icss.sidebar.compact') === 'true'; } catch {}
    function renderSidebar() {
        const expanded = mobile.matches ? drawer : !compact;
        document.body.classList.add('with-command-sidebar');
        document.body.classList.toggle('sidebar-compact', compact);
        document.body.classList.toggle('sidebar-open', mobile.matches && drawer);
        nav.hidden = mobile.matches && !drawer;
        backdrop.hidden = !mobile.matches || !drawer;
        const label = expanded ? 'Collapse navigation' : 'Expand navigation';
        toggle.title = label;
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.querySelector('i').className = 'fas ' + (expanded ? 'fa-angles-left' : mobile.matches ? 'fa-bars' : 'fa-angles-right');
    }
    function closeDrawer() {
        if (!drawer) return;
        drawer = false;
        renderSidebar();
        toggle.focus();
    }
    toggle.addEventListener('click', () => {
        if (mobile.matches) drawer = !drawer;
        else {
            compact = !compact;
            try { localStorage.setItem('icss.sidebar.compact', String(compact)); } catch {}
        }
        renderSidebar();
    });
    backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closeDrawer();
    });
    sidebar.addEventListener('focusout', event => {
        if (drawer && event.relatedTarget && !sidebar.contains(event.relatedTarget)) {
            drawer = false;
            renderSidebar();
        }
    });
    mobile.addEventListener('change', () => { drawer = false; renderSidebar(); });
    renderSidebar();

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
