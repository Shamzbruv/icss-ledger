/**
 * Configurator Service
 * "The Backend in the Browser"
 * Handles state, pricing, and business logic.
 */

class ConfiguratorService {
    constructor() {
        this.state = {
            fabric: null,
            jacket: {},
            trousers: {}
        };
        this.listeners = [];
        this.isLoading = false;
    }

    // --- Data Fetching (Simulating API) ---

    async getFabrics() {
        this._setLoading(true);
        return new Promise(resolve => {
            setTimeout(() => {
                this._setLoading(false);
                resolve(window.DB_Fabrics);
            }, 600); // Simulate network latency
        });
    }

    async getStyles() {
        // No loading needed for static styles usually, but for consistency:
        return window.DB_Styles;
    }

    // --- State Management ---

    initNewConfig() {
        // Set defaults
        this.state = {
            fabric: window.DB_Fabrics[0], // Default to first
            jacket: window.ConfigRules.getDefaultsForFabric('Business').jacket,
            trousers: window.ConfigRules.getDefaultsForFabric('Business').trousers
        };
        this._notify();
    }

    selectFabric(fabricId) {
        const fabric = window.DB_Fabrics.find(f => f.id === fabricId);
        if (!fabric) return;

        this.state.fabric = fabric;

        // Reset styles to smart defaults for this fabric type
        const defaults = window.ConfigRules.getDefaultsForFabric(fabric.category);
        this.state.jacket = { ...this.state.jacket, ...defaults.jacket };
        this.state.trousers = { ...this.state.trousers, ...defaults.trousers };

        this._notify();
    }

    updateOption(category, subCategory, optionId) {
        // simple validation
        const compatibility = window.ConfigRules.checkCompatibility(this.state, subCategory, optionId);

        if (compatibility !== true) {
            alert(compatibility); // Simple feedback for now
            return false;
        }

        if (category === 'jacket') {
            this.state.jacket[subCategory] = optionId;
        } else if (category === 'trousers') {
            this.state.trousers[subCategory] = optionId;
        }

        this._notify();
        return true;
    }

    // --- Business Logic ---

    getTotalPrice() {
        if (!this.state.fabric) return 0;
        let total = this.state.fabric.price;

        // Add Jacket Upcharges
        // Note: In a real app we'd look up options by ID to get price. 
        // For simplicity we'll just check specific high-value items or fetch from DB
        const styles = window.DB_Styles;

        // Helper to find price
        const findPrice = (cat, sub, id) => {
            const opt = styles[cat][sub].find(o => o.id === id);
            return opt ? opt.price : 0;
        };

        // Jacket
        total += findPrice('jacket', 'closure', this.state.jacket.closure);
        total += findPrice('jacket', 'lapel', this.state.jacket.lapel);
        total += findPrice('jacket', 'pockets', this.state.jacket.pockets);
        total += findPrice('jacket', 'construction', this.state.jacket.construction);

        // Trousers
        total += findPrice('trousers', 'waistband', this.state.trousers.waistband);

        return total;
    }

    getSummary() {
        return {
            fabricName: this.state.fabric.name,
            totalPrice: this.getTotalPrice(),
            details: {
                jacket: this.state.jacket,
                trousers: this.state.trousers
            }
        };
    }

    // --- Reactive System ---

    subscribe(callback) {
        this.listeners.push(callback);
    }

    _notify() {
        const data = {
            state: this.state,
            price: this.getTotalPrice(),
            isLoading: this.isLoading
        };
        this.listeners.forEach(cb => cb(data));
    }

    _setLoading(bool) {
        this.isLoading = bool;
        this._notify();
    }
}

// Global Instance
window.configurator = new ConfiguratorService();
