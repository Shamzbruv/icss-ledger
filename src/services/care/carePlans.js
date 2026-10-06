/**
 * Client Care tiers.
 *
 * Every website subscription used to get the same handful of checks. Here each tier says which
 * real checks run for it and how much detail the report goes into. Everything listed under
 * `checks` is something we genuinely measure; `handledByUs` lists service we perform behind the
 * scenes (these are described, never reported as "results").
 */

// Higher rank = bigger plan. Each tier includes everything the one below it does.
const TIERS = {
    HOST_PRO: {
        code: 'HOST_PRO',
        rank: 1,
        name: 'Hosting Only',
        shortName: 'Hosting',
        promise: 'We keep your website online, secure and fast, and show you how many people visit it.',
        checks: ['UPTIME', 'SSL', 'PERF_LIGHT', 'HTTPS_REDIRECT', 'MOBILE_READY', 'ANALYTICS_TAG', 'PAGE_PROFILE', 'GA_TRAFFIC'],
        analytics: { sections: ['summary', 'topPages'], topPages: 3 },
        pageSections: ['google', 'glance'],
        handledByUs: [
            'Managed hosting for your website',
            'Your security padlock (SSL certificate) and backups',
            'This weekly health report, with visitor statistics from Google Analytics'
        ],
        stepUp: {
            to: 'Hosting + Domain Management',
            adds: [
                'we look after your domain (web address) renewals so it does not expire by accident',
                'we check your domain settings and business-email setup every week'
            ]
        }
    },
    HOST_DOM: {
        code: 'HOST_DOM',
        rank: 2,
        name: 'Hosting + Domain Management',
        shortName: 'Hosting + Domain',
        promise: 'We keep your website online, secure and fast, we look after your web address (domain), and we show you how people find and use your site.',
        checks: ['UPTIME', 'SSL', 'PERF_LIGHT', 'HTTPS_REDIRECT', 'MOBILE_READY', 'DOMAIN_EXPIRY', 'DNS', 'EMAIL_DNS', 'ANALYTICS_TAG', 'PAGE_PROFILE', 'GA_TRAFFIC'],
        analytics: { sections: ['summary', 'topPages', 'channels', 'devices'], topPages: 4 },
        pageSections: ['google', 'glance', 'contact'],
        handledByUs: [
            'Managed hosting for your website',
            'Your domain registration, renewals and billing',
            'Your security padlock (SSL certificate) and backups',
            'This weekly health report, with visitor statistics from Google Analytics'
        ],
        stepUp: {
            to: 'Web Maintenance',
            adds: [
                'we look for out-of-date software and weak security settings every week',
                'we test the links on your page and fix what we can, with up to five website updates a month'
            ]
        }
    },
    MAINT: {
        code: 'MAINT',
        rank: 3,
        name: 'Web Maintenance',
        shortName: 'Maintenance',
        promise: 'Everything in Hosting + Domain Management, plus we watch for security gaps and out-of-date software, and we make up to five updates to your website each month.',
        checks: ['UPTIME', 'SSL', 'PERF_LIGHT', 'PAGESPEED', 'HTTPS_REDIRECT', 'MOBILE_READY', 'DOMAIN_EXPIRY', 'DNS', 'EMAIL_DNS', 'SECURITY_HEADERS', 'MIXED_CONTENT', 'CMS_DETECT', 'PLUGIN_UPDATES', 'BROKEN_LINKS', 'SEO_BASICS', 'ANALYTICS_TAG', 'PAGE_PROFILE', 'GA_TRAFFIC'],
        analytics: { sections: ['summary', 'topPages', 'channels', 'devices', 'countries', 'daily'], topPages: 5 },
        pageSections: ['google', 'glance', 'contact', 'technical'],
        handledByUs: [
            'Managed hosting, domain renewals, SSL and backups',
            'Up to five website patches or updates every month',
            'Cloudflare security monitoring and performance monitoring',
            'This weekly health report, with visitor statistics from Google Analytics'
        ],
        stepUp: {
            to: 'Content Refresh',
            adds: [
                'unlimited edits and content updates to your existing website',
                'a page-by-page review of your content, with ideas to keep it fresh'
            ]
        }
    },
    REFRESH: {
        code: 'REFRESH',
        rank: 4,
        name: 'Content Refresh',
        shortName: 'Content Refresh',
        promise: 'Everything in Web Maintenance, plus unlimited edits and content updates, and a closer look at your pages so your website keeps working for you.',
        checks: ['UPTIME', 'SSL', 'PERF_LIGHT', 'PAGESPEED', 'HTTPS_REDIRECT', 'MOBILE_READY', 'DOMAIN_EXPIRY', 'DNS', 'EMAIL_DNS', 'SECURITY_HEADERS', 'MIXED_CONTENT', 'CMS_DETECT', 'PLUGIN_UPDATES', 'BROKEN_LINKS', 'SEO_BASICS', 'IMAGES_ALT', 'SITEMAP_ROBOTS', 'CONTENT_PAGES', 'ANALYTICS_TAG', 'PAGE_PROFILE', 'GA_TRAFFIC'],
        analytics: { sections: ['summary', 'engagement', 'topPages', 'channels', 'devices', 'countries', 'daily'], topPages: 6 },
        pageSections: ['google', 'glance', 'contact', 'technical', 'pages', 'content'],
        handledByUs: [
            'Managed hosting, domain renewals, SSL and backups',
            'Unlimited edits and content updates to your existing website',
            'Up to five website patches or updates every month',
            'Cloudflare security monitoring and performance monitoring',
            'This weekly health report, with visitor statistics from Google Analytics'
        ],
        stepUp: null
    }
};

const BY_NAME = new Map();
Object.values(TIERS).forEach(t => BY_NAME.set(t.name.toLowerCase(), t));
[
    ['professional hosting', 'HOST_PRO'],
    ['hosting + domain', 'HOST_DOM'],
    ['website content refresh', 'REFRESH']
].forEach(([name, code]) => BY_NAME.set(name, TIERS[code]));

// Other care plans (apps, automations, legacy plans) run whatever their checklist template lists.
const OTHER_PLAN_NAMES = {
    MONITOR: 'App Monitoring', AUTO_BIZ: 'Business Automation', AUTO_IND: 'Industry Automation',
    GD: 'Graphic Design'
};

/** The website tier for a service, or null when it is not a website plan. */
function resolveTier(service = {}) {
    const code = service.service_meta_json?.plan_code;
    if (code && TIERS[code]) return TIERS[code];
    const name = String(service.service_plans?.name || '').trim().toLowerCase();
    return BY_NAME.get(name) || null;
}

function isWebsiteTier(service) {
    return !!resolveTier(service);
}

const TITLES = /^(mr|mrs|ms|miss|dr|prof|sir|madam|rev|pastor|apostle|bishop)\.?$/i;
const BUSINESS_WORDS = /\b(restaurant|salon|academy|services?|bar|hub|ltd|limited|llc|inc|company|co|store|shop|catering|family|group|studio|clinic|school|church|ministries|foundation|enterprises?|solutions|agency|boutique|cafe|café|bakery|hotel|resort|spa|gym|centre|center|skin|beauty|technical|care|jamaica|ja)\b/i;

/** How to address the reader: a first name when we are confident, otherwise the business name. */
function greetingFor(client = {}, service = {}) {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const contact = clean(service.service_meta_json?.contact_name);
    const source = contact || clean(client.name);
    if (!source) return 'there';
    if (!contact && BUSINESS_WORDS.test(source)) return `${source} team`;
    const parts = source.split(' ');
    if (parts.length === 1) return parts[0];
    if (TITLES.test(parts[0])) return `${parts[0]} ${parts[1]}`;
    return parts[0];
}

module.exports = { TIERS, OTHER_PLAN_NAMES, resolveTier, isWebsiteTier, greetingFor };
