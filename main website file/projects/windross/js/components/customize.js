
window.Customize = function () {
    return `
        <div class="customizer-layout fade-in">
            <!-- Top Pill Navigation -->
            <div class="customizer-nav">
                <button class="pill active">Fabric</button>
                <button class="pill">Jacket</button>
                <button class="pill">Trousers</button>
                <button class="pill">Waistcoat</button>
            </div>

            <!-- Central Preview Area -->
            <div class="preview-area">
                <div class="preview-placeholder">
                    <img src="https://images.unsplash.com/photo-1593030761757-71bd90dbe3e4?q=80&w=1500&auto=format&fit=crop" alt="Suit Preview" class="suit-preview">
                    <!-- In a real app, this would be a dynamic canvas or layered images -->
                </div>
            </div>

            <!-- Bottom Option Tray -->
            <div class="option-tray">
                <div class="tray-header">
                    <span>Select Fabric</span>
                    <span class="price-indicator">$899</span>
                </div>
                <div class="tray-scroll">
                    <!-- Fabric Options -->
                    <div class="option-card selected">
                        <div class="swatch" style="background: #2c2c2c;"></div>
                        <span class="label">Midnight Wool</span>
                    </div>
                    <div class="option-card">
                        <div class="swatch" style="background: #1a1a1a;"></div>
                        <span class="label">Charcoal Twill</span>
                    </div>
                    <div class="option-card">
                        <div class="swatch" style="background: #0f172a;"></div>
                        <span class="label">Navy Herringbone</span>
                    </div>
                    <div class="option-card">
                        <div class="swatch" style="background: #3f3f46;"></div>
                        <span class="label">Slate Grey</span>
                    </div>
                    <div class="option-card">
                        <div class="swatch" style="background: #52525b;"></div>
                        <span class="label">Light Grey</span>
                    </div>
                </div>
            </div>

            <!-- Floating Action Button for Next/Finish -->
            <div class="action-dock">
                <button class="btn-primary" onclick="window.router.navigate('measurement-choice')">
                    Finish & Measure <i data-lucide="arrow-right" style="display:inline; width:16px; margin-left:8px;"></i>
                </button>
            </div>
        </div>
    `;
}
