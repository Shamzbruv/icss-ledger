// CRM Integration Script
// Handles UTM tracking, lead submission, and success modals.

const CRM = {
    utmData: {},
    init() {
        this.captureUTM();
        this.injectModals();
        this.initExitIntent();
        this.initFormTiming();
    },

    initFormTiming() {
        const now = Date.now().toString();
        document.querySelectorAll('.form_start_time').forEach(el => {
            el.value = now;
        });
    },

    captureUTM() {
        const params = new URLSearchParams(window.location.search);
        this.utmData = {
            utm_source: params.get('utm_source') || '',
            utm_medium: params.get('utm_medium') || '',
            utm_campaign: params.get('utm_campaign') || '',
            utm_content: params.get('utm_content') || '',
            utm_term: params.get('utm_term') || '',
            referrer: document.referrer || '',
            page_url: window.location.href,
            landing_page: sessionStorage.getItem('landing_page') || window.location.href
        };
        
        if(!sessionStorage.getItem('landing_page')) {
            sessionStorage.setItem('landing_page', window.location.href);
        }
    },

    async submitLead(payload) {
        // Add UTM and common data. Preserve honeypot and time if present.
        const fullPayload = {
            ...payload,
            ...this.utmData,
            submission_time_ms: payload.submission_time_ms ?? 0,
            honeypot: payload.honeypot ?? '',
            source: payload.source || 'Website Form'
        };

        try {
            const res = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullPayload)
            });
            
            if(!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Submission failed');
            }
            return true;
        } catch(e) {
            console.error('Lead capture error:', e);
            throw e; // Must throw so callers trigger their catch blocks
        }
    },

    injectModals() {
        const modalHtml = `
            <div id="crm-success-modal" class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] hidden">
                <div class="bg-blue-900 border border-cyan-400 rounded-2xl p-8 max-w-sm text-center">
                    <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fas fa-check text-white text-3xl"></i>
                    </div>
                    <h3 class="text-2xl font-bold text-white mb-2">Request Received!</h3>
                    <p class="text-gray-300 mb-6">Thank you for reaching out. A member of our team will contact you shortly.</p>
                    <button onclick="document.getElementById('crm-success-modal').classList.add('hidden')" class="bg-cyan-500 text-blue-900 font-bold py-2 px-6 rounded-full hover:bg-cyan-400">
                        Awesome
                    </button>
                </div>
            </div>

            <div id="crm-exit-popup" class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] hidden transition-opacity duration-300">
                <div class="bg-gray-900 border border-cyan-400 rounded-2xl p-8 max-w-md text-center relative overflow-hidden">
                    <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-400 to-blue-500"></div>
                    <button onclick="document.getElementById('crm-exit-popup').classList.add('hidden')" class="absolute top-4 right-4 text-gray-400 hover:text-white">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                    <div class="w-16 h-16 bg-cyan-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-cyan-400">
                        <i class="fas fa-lightbulb text-cyan-400 text-3xl"></i>
                    </div>
                    <h3 class="text-2xl font-bold text-white mb-3">Wait! Don't leave empty-handed.</h3>
                    <p class="text-gray-300 mb-6 text-sm">Before you go, let us show you exactly how a professional digital presence can attract more clients and automate your business. Claim your free digital growth strategy.</p>
                    <a href="#audit-cta" onclick="document.getElementById('crm-exit-popup').classList.add('hidden'); gtag('event','select_content',{content_name:'Exit Intent Audit CTA'})" class="block w-full bg-cyan-500 text-blue-900 font-bold py-3 px-6 rounded-full hover:bg-cyan-400 mb-3 transition">
                        Get My Free Strategy
                    </a>
                    <button onclick="document.getElementById('crm-exit-popup').classList.add('hidden')" class="text-gray-500 text-xs hover:text-gray-300">
                        No thanks, I'm good.
                    </button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    initExitIntent() {
        let popupShown = false;
        
        // Show on exit intent (mouse leaves window top)
        document.addEventListener('mouseleave', (e) => {
            if (e.clientY < 0 && !popupShown && !sessionStorage.getItem('exit_popup_seen')) {
                this.showExitPopup();
                popupShown = true;
            }
        });

        // Or show after 15 seconds if not seen
        setTimeout(() => {
            if (!popupShown && !sessionStorage.getItem('exit_popup_seen')) {
                this.showExitPopup();
                popupShown = true;
            }
        }, 15000);
    },

    showExitPopup() {
        document.getElementById('crm-exit-popup').classList.remove('hidden');
        sessionStorage.setItem('exit_popup_seen', 'true');
    },

    showSuccess() {
        document.getElementById('crm-success-modal').classList.remove('hidden');
    }
};

// Expose CRM globally so inline scripts can use window.CRM and CRM.*
window.CRM = CRM;

document.addEventListener('DOMContentLoaded', () => CRM.init());
