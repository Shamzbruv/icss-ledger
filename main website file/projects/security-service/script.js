// Mobile Menu Toggle
function toggleMenu() {
    const mobileMenu = document.getElementById('mobileMenu');
    mobileMenu.classList.toggle('active');
}

// Scroll Animation Observer
document.addEventListener('DOMContentLoaded', () => {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-up');
                entry.target.style.opacity = "1";
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Elements to animate
    const animateElements = document.querySelectorAll('.service-card, .stat-item, .tech-grid, .contact-box');
    animateElements.forEach(el => {
        el.style.opacity = "0"; // Initial state
        el.style.transform = "translateY(20px)";
        el.style.transition = "opacity 0.6s ease-out, transform 0.6s ease-out";
        observer.observe(el);
    });
});

// Accordion Functionality (for FAQ)
function setupAccordion() {
    const accordions = document.querySelectorAll('.accordion-item');

    accordions.forEach(item => {
        const header = item.querySelector('.accordion-header');

        header.addEventListener('click', () => {
            // Close others
            accordions.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });

            // Toggle current
            item.classList.toggle('active');
        });
    });
}

// Initialize things based on page content
document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.accordion-item')) {
        setupAccordion();
    }

    injectWhatsAppModal();
});

// WhatsApp Modal Logic
function injectWhatsAppModal() {
    const modalHTML = `
    <div class="wa-modal-overlay" id="waModal">
        <div class="wa-modal">
            <span class="wa-close" onclick="closeWAModal()">&times;</span>
            <div class="wa-header">
                <h2>Security Inquiry</h2>
                <p>Tell us what you need. We'll connect you with a specialist.</p>
            </div>
            <form id="waForm" onsubmit="submitWAForm(event)">
                <div class="wa-form-group">
                    <label>Your Name</label>
                    <input type="text" id="waName" class="wa-input" placeholder="John Doe" required>
                </div>
                
                <div class="wa-form-group">
                    <label>Service Area / Parish</label>
                    <input type="text" id="waLocation" class="wa-input" placeholder="E.g. Kingston, Spanish Town..." required>
                </div>

                <div class="wa-form-group">
                    <label>Service Needed</label>
                    <select id="waService" class="wa-select">
                        <option value="General Inquiry">General Inquiry</option>
                        <option value="Armed Security">Armed Security</option>
                        <option value="Unarmed Security">Unarmed Security</option>
                        <option value="VIP Escort">VIP & Escort</option>
                        <option value="Event Security">Event Security</option>
                        <option value="Mobile Patrol">Routine Check / Patrol</option>
                    </select>
                </div>

                <div class="wa-form-group">
                    <label>Details</label>
                    <textarea id="waMessage" class="wa-textarea" rows="3" placeholder="Describe your request..." required></textarea>
                </div>

                <button type="submit" class="wa-submit">
                    <i class="fa-brands fa-whatsapp"></i> Start Chat
                </button>
            </form>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function openWAModal() {
    const modal = document.getElementById('waModal');
    modal.classList.add('active');
}

function closeWAModal() {
    const modal = document.getElementById('waModal');
    modal.classList.remove('active');
}

function submitWAForm(e) {
    e.preventDefault();

    const name = document.getElementById('waName').value;
    const location = document.getElementById('waLocation').value;
    const service = document.getElementById('waService').value;
    const message = document.getElementById('waMessage').value;

    const formattedText = `*New Security Inquiry*%0A%0A*Name:* ${name}%0A*Location:* ${location}%0A*Service:* ${service}%0A*Details:* ${message}`;

    // Using the primary mobile number
    const number = "18763978331";

    window.open(`https://wa.me/${number}?text=${formattedText}`, '_blank');
    closeWAModal();
}
