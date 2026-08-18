/**
 * Shared logic for the "Request Missing Info" flow: figuring out which
 * Client Care details are still blank for a service, and the copy explaining
 * why each one is needed. Used by both the admin-triggered request email
 * (src/routes/infoRequests.js) and the public update-info page it links to.
 */

const WEBSITE_PLAN_CODES = new Set(['HOST_PRO', 'HOST_DOM', 'MAINT', 'REFRESH']);
const WEBSITE_PLAN_NAMES = new Set(['Hosting Only', 'Hosting + Domain Management', 'Professional Hosting', 'Hosting + Domain', 'Web Maintenance', 'Content Refresh', 'Website Content Refresh']);

// How long an info-update link stays valid after being emailed.
const TOKEN_TTL_DAYS = 30;

function isWebsitePlanMeta(meta, planName) {
    return WEBSITE_PLAN_CODES.has(meta?.plan_code) || WEBSITE_PLAN_NAMES.has(planName || '');
}

// Every field we might ask a client for, with plain-language copy explaining
// why we're asking (shown both in the request email and on the update page,
// so it never reads like a cold, unexplained data grab).
const FIELD_DEFS = [
    {
        key: 'contact_name',
        label: 'Your name (main contact)',
        why: "So we know who we're speaking with when we reach out.",
        websiteOnly: false,
        isMissing: (meta) => !meta.contact_name
    },
    {
        key: 'contact_phone',
        label: 'A phone or WhatsApp number',
        why: 'So we can reach you quickly if something ever needs urgent attention — like your site going down.',
        websiteOnly: false,
        isMissing: (meta) => !meta.contact_phone
    },
    {
        key: 'birthday',
        label: 'Your birthday (month & day)',
        why: 'So we can send you a little birthday note — on us!',
        websiteOnly: false,
        isMissing: (meta) => !meta.birthday_month || !meta.birthday_day
    },
    {
        key: 'website_url',
        label: 'Your website URL',
        why: 'So we can run uptime, SSL, and performance checks against the right site.',
        websiteOnly: true,
        isMissing: (meta) => !meta.website_url
    },
    {
        key: 'domain',
        label: 'Your domain name',
        why: "So we can monitor your domain's SSL certificate, DNS, and secure-redirect health.",
        websiteOnly: true,
        isMissing: (meta) => !meta.domain
    },
    {
        key: 'ga_property_id',
        label: 'Your Google Analytics 4 Property ID',
        why: "So we can include your real traffic (visitors, sessions, page views) in your weekly report. It's the numeric ID from GA4 Admin → Property Settings — not the \"G-\" measurement ID — and the property needs to grant Viewer access to our reporting service account.",
        websiteOnly: true,
        isMissing: (meta) => !meta.ga_property_id
    }
];

function computeMissingFields(meta, planName) {
    meta = meta || {};
    const websitePlan = isWebsitePlanMeta(meta, planName);
    return FIELD_DEFS.filter((field) => (!field.websiteOnly || websitePlan) && field.isMissing(meta));
}

module.exports = {
    FIELD_DEFS,
    TOKEN_TTL_DAYS,
    isWebsitePlanMeta,
    computeMissingFields
};
