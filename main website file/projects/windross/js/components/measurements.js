
window.Measurements = function () {
    return `
        <div class="container fade-in" style="padding-top: 100px; padding-bottom: 50px;">
             <div style="max-width: 700px; margin: 0 auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 30px;">
                    <h2>Digital Measurements</h2>
                    <span style="color: var(--text-secondary)">Step 1 of 3</span>
                </div>

                <form class="measurement-form" onsubmit="event.preventDefault(); alert('Measurements Submitted!'); window.router.navigate('home')">
                    
                    <!-- Jacket Section -->
                    <div class="form-section">
                        <h3><i data-lucide="shirt"></i> Jacket Details</h3>
                        <div class="grid-2">
                             <div class="form-group">
                                <label>Standard Size</label>
                                <select>
                                    <option>36</option>
                                    <option>38</option>
                                    <option selected>40</option>
                                    <option>42</option>
                                    <option>44</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Fit Preference</label>
                                <select>
                                    <option>Slim</option>
                                    <option selected>Regular</option>
                                    <option>Relaxed</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Height (cm)</label>
                                <input type="number" placeholder="180">
                            </div>
                            <div class="form-group">
                                <label>Weight (kg)</label>
                                <input type="number" placeholder="75">
                            </div>
                        </div>
                    </div>

                    <!-- Trousers Section -->
                    <div class="form-section">
                        <h3><i data-lucide="scissors"></i> Trouser Details</h3>
                        <div class="grid-2">
                             <div class="form-group">
                                <label>Waist (inches)</label>
                                <input type="number" placeholder="32">
                            </div>
                            <div class="form-group">
                                <label>Inseam</label>
                                <select>
                                    <option>Short</option>
                                    <option selected>Regular</option>
                                    <option>Long</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="form-actions" style="margin-top: 40px; text-align: right;">
                        <button type="button" class="btn-secondary" onclick="window.history.back()">Back</button>
                        <button type="submit" class="btn-primary">Submit & Book</button>
                    </div>
                </form>
             </div>
        </div>
    `;
}
