
window.Home = function() {
    return `
        <section class="hero">
            <div class="hero-content fade-in">
                <h1>Tailored to Perfection.</h1>
                <p>Experience the ultimate in bespoke menswear. Design your custom suit with Windross today.</p>
                <div class="hero-actions">
                    <button class="btn-primary" onclick="window.router.navigate('customize')">Start Designing</button>
                    <button class="btn-secondary" onclick="window.router.navigate('book')">Book Consultation</button>
                </div>
            </div>
            <div class="hero-bg">
                <!-- Placeholder for high-end suit image -->
                <div class="overlay"></div>
            </div>
        </section>

        <section class="features container">
            <div class="feature-card">
                <i data-lucide="ruler"></i>
                <h3>Precise Fit</h3>
                <p>Digital measurement technology ensures a perfect fit from the comfort of your home.</p>
            </div>
            <div class="feature-card">
                <i data-lucide="scissors"></i>
                <h3>Expert Craftsmanship</h3>
                <p>Hand-finished details and premium Italian fabrics.</p>
            </div>
            <div class="feature-card">
                <i data-lucide="clock"></i>
                <h3>Fast Turnaround</h3>
                <p>From design to delivery in as little as 3 weeks.</p>
            </div>
        </section>
    `;
}
