/**
 * customize.js
 * Logic for the standalone Customizer App (customize.html)
 */

document.addEventListener('DOMContentLoaded', async () => {

    // 1. Initialize Service
    if (!window.configurator) {
        window.configurator = new ConfiguratorService();
    }

    // Start fresh config
    window.configurator.initNewConfig();

    // 2. Load Data
    const trayContainer = document.getElementById('tray-content');

    // Initial Load: Fabrics
    // For this MVP we act as if "Fabric" step is always active first.
    // In a full app we'd handle stepping (Jacket -> Trousers etc)
    const fabrics = await window.configurator.getFabrics();
    renderTray(fabrics);

    // 3. UI Helper: Render Tray
    function renderTray(items) {
        if (!trayContainer) return;

        trayContainer.innerHTML = items.map(item => `
             <div class="option-card ${window.configurator.state.fabric && window.configurator.state.fabric.id === item.id ? 'selected' : ''}" 
                 data-id="${item.id}">
                <div class="swatch" style="background-image: url('${item.image}');"></div>
                <div>
                     <span class="label">${item.name}</span>
                     <span class="label">${item.category || 'Premium Fabric'}</span>
                </div>
                <div class="label" style="opacity:0.9">$${item.price}</div>
            </div>
        `).join('');

        // Attach listeners
        trayContainer.querySelectorAll('.option-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-id');
                window.configurator.selectFabric(id);
            });
        });
    }

    // 4. Subscribe to State Changes
    window.configurator.subscribe((data) => {
        // Update Price
        const priceEl = document.getElementById('dynamic-price');
        if (priceEl) priceEl.innerText = `$${data.price}`;

        // Update Preview
        const prevEl = document.getElementById('dynamic-preview');
        const placeholder = document.getElementById('preview-placeholder-text');

        if (data.state.fabric) {
            if (prevEl) {
                prevEl.src = data.state.fabric.image;
                prevEl.style.display = 'block';
            }
            if (placeholder) placeholder.style.display = 'none';
        }

        // Re-render tray to reflect selection (highlighting)
        // Note: For performance in a big list we'd just toggle classes, but re-render is fine here.
        if (fabrics) renderTray(fabrics);
    });

    console.log('Customizer App Initialized');
});
