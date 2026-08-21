const WEBSITE_PLAN_CATALOG = {
    'P-9FL12940T1207713ENECQJ4A': {
        code: 'HOST_PRO',
        name: 'Hosting Only',
        billingCycle: 'monthly',
        legacyNames: ['Professional Hosting'],
        price: 30,
        careFrequency: 'weekly',
        features: ['Managed website hosting', 'cPanel when supported by the website stack', 'Weekly website health report', 'Google Analytics traffic analysis', 'SSL and backups']
    },
    'P-5XH29947G9064044FNECQMQY': {
        code: 'HOST_DOM',
        name: 'Hosting + Domain Management',
        billingCycle: 'monthly',
        legacyNames: ['Hosting + Domain'],
        price: 38,
        careFrequency: 'weekly',
        features: ['Managed website hosting', 'Domain registration, renewals and billing managed by iCreate', 'cPanel when supported by the website stack', 'Weekly website health report', 'Google Analytics traffic analysis', 'SSL and backups']
    },
    'P-5LN44950730912624NECQLRQ': {
        code: 'MAINT',
        name: 'Web Maintenance',
        billingCycle: 'monthly',
        legacyNames: [],
        price: 49.99,
        careFrequency: 'weekly',
        features: ['Everything in Hosting + Domain Management', 'Up to five website patches or updates monthly', 'Cloudflare security monitoring', 'Performance monitoring', 'Weekly website health report', 'Google Analytics traffic analysis']
    },
    'P-00F6350522773701SNECR4RI': {
        code: 'REFRESH',
        name: 'Content Refresh',
        billingCycle: 'monthly',
        legacyNames: ['Website Content Refresh'],
        price: 67.99,
        careFrequency: 'weekly',
        features: ['Everything in Web Maintenance', 'Unlimited edits and content updates to the existing website', 'Cloudflare security integration and monitoring', 'Weekly website health report', 'Google Analytics traffic analysis']
    },
    'P-3ME55562GX964564ENECRUBA': { code: 'MONITOR', name: 'App Monitoring', legacyNames: [], price: 150, careFrequency: 'monthly', billingCycle: 'monthly', features: [] },
    'P-7347581535896321PNECRW6A': { code: 'GD', name: 'Graphic Design', legacyNames: [], price: 80, careFrequency: 'monthly', billingCycle: 'monthly', features: [] },
    'P-1PR36418LS475621RNECRZJY': { code: 'AUTO_BIZ', name: 'Business Automation', legacyNames: [], price: 120, careFrequency: 'monthly', billingCycle: 'monthly', features: [] },
    'P-5CM47756734472516NECR24Q': { code: 'AUTO_IND', name: 'Industry Automation', legacyNames: [], price: 250, careFrequency: 'monthly', billingCycle: 'monthly', features: [] },
    'P-5U310187T43711805NIVMAJQ': { code: 'EMAIL', name: 'Expand Email Plan', legacyNames: [], price: 63, careFrequency: 'yearly', billingCycle: 'yearly', features: [] }
};

function getPlanByPayPalId(planId) {
    return WEBSITE_PLAN_CATALOG[planId] || null;
}

function findCatalogPlan({ planId, name, amount } = {}) {
    if (planId && WEBSITE_PLAN_CATALOG[planId]) return WEBSITE_PLAN_CATALOG[planId];
    const normalizedName = String(name || '').trim().toLowerCase();
    if (normalizedName) {
        const byName = Object.values(WEBSITE_PLAN_CATALOG).find(plan =>
            [plan.name, ...(plan.legacyNames || [])].some(candidate => normalizedName.includes(candidate.toLowerCase()) || candidate.toLowerCase().includes(normalizedName))
        );
        if (byName) return byName;
    }
    const numericAmount = Number(amount);
    if (numericAmount > 0) {
        return Object.values(WEBSITE_PLAN_CATALOG).find(plan =>
            Math.abs(plan.price - numericAmount) < 0.02 || Math.abs((plan.price * 1.15) - numericAmount) < 0.02
        ) || null;
    }
    return null;
}

module.exports = { WEBSITE_PLAN_CATALOG, getPlanByPayPalId, findCatalogPlan };
