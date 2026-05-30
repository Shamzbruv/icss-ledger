
window.Booking = function () {
    return `
        <div class="container fade-in" style="padding-top: 100px; padding-bottom: 50px;">
            <div style="max-width: 600px; margin: 0 auto; text-align: center;">
                <h2>Finalize Your Custom Suit</h2>
                <p style="color: var(--text-secondary); margin-bottom: 40px;">Choose how you would like to provide your measurements.</p>
                
                <div class="booking-options">
                    <!-- Option 1: Digital Measurements (Preferred) -->
                    <div class="booking-card" onclick="window.router.navigate('measurements')">
                        <div class="card-icon"><i data-lucide="scan-line"></i></div>
                        <h3>Digital Measurement</h3>
                        <p>Use our secure online form. Fast, easy, and free.</p>
                        <span class="badge recommended">Recommended</span>
                    </div>

                    <!-- Option 2: In-Store -->
                    <div class="booking-card" onclick="window.router.navigate('book-instore')">
                        <div class="card-icon"><i data-lucide="store"></i></div>
                        <h3>In-Store Consultation</h3>
                        <p>Book an appointment with our tailors.</p>
                        <span class="badge warning">Additional Cost Applies</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.BookInStore = function () {
    return `
         <div class="container fade-in" style="padding-top: 100px;">
            <div style="max-width: 500px; margin: 0 auto;">
                <div class="warning-banner">
                    <i data-lucide="alert-circle"></i>
                    <div>
                        <strong>Note:</strong> In-store measurements incur an additional service fee since you chose not to use the online system.
                    </div>
                </div>
                
                <h2>Book Appointment</h2>
                <form class="booking-form" onsubmit="event.preventDefault(); alert('Booking Request Sent!'); window.router.navigate('home')">
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" required min="2025-01-01">
                    </div>
                    <div class="form-group">
                        <label>Time</label>
                        <select>
                            <option>10:00 AM</option>
                            <option>02:00 PM</option>
                            <option>04:00 PM</option>
                        </select>
                    </div>
                    <button type="submit" class="btn-primary" style="width: 100%; margin-top: 20px;">Confirm Booking</button>
                    <button type="button" class="btn-secondary" style="width: 100%; margin-top: 10px;" onclick="window.history.back()">Back</button>
                </form>
            </div>
         </div>
    `;
}
