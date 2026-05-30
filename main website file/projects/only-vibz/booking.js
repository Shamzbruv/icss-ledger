// booking.js

document.addEventListener('DOMContentLoaded', () => {
    injectBookingModal();
    attachBookingListeners();
});

// 1. Inject the Modal HTML
function injectBookingModal() {
    const modalHTML = `
    <div id="bookingModalOverlay" class="booking-modal-overlay">
        <div class="booking-modal">
            <button class="modal-close" onclick="closeBooking()">&times;</button>
            
            <div class="modal-header">
                <h2 id="modalTitle">Book Your Vibes 🇯🇲</h2>
                <p id="modalSubtitle">Let's get your journey started!</p>
            </div>

            <form id="bookingForm" class="booking-form" onsubmit="handleBookingSubmit(event)">
                <input type="hidden" id="excursionName" value="General Inquiry">
                
                <div class="form-group">
                    <label>Your Name *</label>
                    <input type="text" id="guestName" placeholder="e.g. Sarah Jenkins" required>
                </div>

                <div class="form-group">
                    <label>Pick-up Location *</label>
                    <input type="text" id="pickupLocation" placeholder="Hotel, Villa, or Cruise Port" required>
                </div>

                <div class="form-group">
                    <label>Date of Trip *</label>
                    <input type="date" id="tripDate" required>
                </div>

                <div class="form-group" style="display: flex; gap: 10px;">
                    <div style="flex: 1;">
                        <label>Adults 👨‍👩‍👧</label>
                        <select id="adultsCount">
                            <option value="1">1</option>
                            <option value="2" selected>2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                            <option value="6">6</option>
                            <option value="7+">7+</option>
                        </select>
                    </div>
                    <div style="flex: 1;">
                        <label>Kids 🧒</label>
                        <select id="kidsCount">
                            <option value="0" selected>0</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4+">4+</option>
                        </select>
                    </div>
                </div>

                <div class="form-group" id="customTripGroup" style="display:none;">
                    <label>Where do you want to go? 📍</label>
                    <textarea id="customTripDetails" placeholder="List the places you want to visit (e.g. Blue Hole, then Scotchies...)"></textarea>
                </div>

                <div class="form-group">
                    <label>Any Special Requests / Notes?</label>
                    <textarea id="specialRequests" placeholder="Birthday celebration? Allergies? Let us know!"></textarea>
                </div>

                <button type="submit" class="btn-whatsapp-submit">
                    <i class="fa-brands fa-whatsapp"></i> Send to Adrian
                </button>
            </form>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// 2. Open/Close Logic
window.openBooking = function (tourName, isCustom = false) {
    const modal = document.getElementById('bookingModalOverlay');
    const title = document.getElementById('modalTitle');
    const excursionInput = document.getElementById('excursionName');
    const subtitle = document.getElementById('modalSubtitle');
    const customGroup = document.getElementById('customTripGroup');

    modal.classList.add('active');
    excursionInput.value = tourName;

    if (isCustom) {
        title.innerHTML = "Build Your Own Trip 🛠️";
        subtitle.innerText = "Tell us where you want to go!";
        customGroup.style.display = 'block';
    } else {
        title.innerHTML = `Book: ${tourName} 🌴`;
        subtitle.innerText = "Great choice! Fill in the details below.";
        customGroup.style.display = 'none';

        // Clear the custom details if switching back to normal tour
        document.getElementById('customTripDetails').value = '';
    }
}

window.closeBooking = function () {
    const modal = document.getElementById('bookingModalOverlay');
    modal.classList.remove('active');
}

// Close on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('bookingModalOverlay');
    if (e.target === modal) {
        closeBooking();
    }
});

// 3. Attach Listeners to existing API buttons
function attachBookingListeners() {
    // We'll update html to call openBooking() directly, 
    // but we can also look for specific classes if needed.
}

// 4. Handle Submit & Format WhatsApp Message
window.handleBookingSubmit = function (e) {
    e.preventDefault();

    const PHONE_NUMBER = "18763120047"; // Adrian's Number

    // Gather Data
    const excursion = document.getElementById('excursionName').value;
    const name = document.getElementById('guestName').value;
    const location = document.getElementById('pickupLocation').value;
    const date = document.getElementById('tripDate').value;
    const adults = document.getElementById('adultsCount').value;
    const kids = document.getElementById('kidsCount').value;
    const notes = document.getElementById('specialRequests').value;
    const customDetails = document.getElementById('customTripDetails').value;

    // Build Message
    let message = `Wah gwaan, Adrian! 👋 I'm ready for the vibes! 🇯🇲\n\n`;

    if (excursion === "Custom Trip") {
        message += `*I want to Build My Own Trip!* 🛠️\n`;
        if (customDetails) message += `*Places to visit:* ${customDetails}\n`;
    } else {
        message += `*Excursion:* ${excursion} 🌴\n`;
    }

    message += `*Name:* ${name} 👤\n`;
    message += `*Date:* ${date} 🗓️\n`;
    message += `*Pickup:* ${location} 🏨\n`;
    message += `*Crew:* ${adults} Adults, ${kids} Kids 👨‍👩‍👧‍👦\n`;

    if (notes) {
        message += `\n*Note:* ${notes} 📝\n`;
    }

    message += `\nLet me know the price! Respect! 👊`;

    // Encode and Open
    const url = `https://wa.me/${PHONE_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');

    // Optional: Close modal after sending
    closeBooking();
}
