(() => {
    let installPrompt;
    let installed = false;
    const standalone = window.matchMedia('(display-mode: standalone)');
    const isInstalled = () => installed || standalone.matches || navigator.standalone === true;
    const update = () => {
        document.documentElement.classList.toggle('is-standalone', isInstalled());
        document.querySelectorAll('[data-app-install]').forEach(button => { button.hidden = isInstalled(); });
    };
    const showInstructions = () => {
        let dialog = document.getElementById('app-install-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'app-install-dialog';
            dialog.className = 'app-install-dialog';
            dialog.setAttribute('aria-labelledby', 'app-install-title');
            dialog.setAttribute('aria-describedby', 'app-install-instructions');
            const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const mobile = /Android/.test(navigator.userAgent);
            const instructions = ios
                ? 'Open Command Center in Safari, tap Share, then Add to Home Screen. Enable Open as Web App if shown, then tap Add.'
                : mobile
                    ? 'Open your browser menu and choose Install app or Add to Home screen. If you opened this inside another app, open it in Chrome first.'
                    : 'Use the install icon in your browser’s address bar or choose Install app from the browser menu. You can also keep using Command Center in this tab.';
            dialog.innerHTML = '<h2 id="app-install-title">Install Command Center</h2><p id="app-install-instructions"></p><button type="button">Got it</button>';
            dialog.querySelector('p').textContent = instructions;
            dialog.querySelector('button').addEventListener('click', () => dialog.close());
            document.body.appendChild(dialog);
        }
        dialog.showModal();
    };
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault(); installPrompt = event; update();
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null; installed = true;
        document.querySelectorAll('[data-app-install]').forEach(button => { button.hidden = true; });
    });
    standalone.addEventListener?.('change', update);
    document.addEventListener('icss:layout-ready', update);
    document.addEventListener('click', async event => {
        const button = event.target.closest?.('[data-app-install]');
        if (!button || isInstalled()) return;
        if (!installPrompt) { showInstructions(); return; }
        const prompt = installPrompt; installPrompt = null;
        button.disabled = true;
        try { await prompt.prompt(); await prompt.userChoice; }
        catch { showInstructions(); }
        finally { button.disabled = false; }
    });
    const start = () => {
        update();
        if ('serviceWorker' in navigator && window.isSecureContext) {
            navigator.serviceWorker.register('/command-center-sw.js', { scope: '/', updateViaCache: 'none' })
                .catch(error => console.warn('Command Center offline screen unavailable:', error.message));
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
