document.addEventListener('DOMContentLoaded', () => {
  // Set Form Timer
  const formTimer = document.querySelector('.form_start_time');
  if(formTimer) formTimer.value = Date.now().toString();

  // Star Rating Logic (RTL hack handling)
  const stars = document.querySelectorAll('#star-container i');
  const ratingInput = document.getElementById('review-rating');
  
  // Initialize stars visually to 5
  stars.forEach(s => s.classList.add('active'));

  stars.forEach(star => {
    star.addEventListener('click', (e) => {
      const val = parseInt(e.target.getAttribute('data-val'));
      ratingInput.value = val;
      // Because of RTL, stars are rendered 5 4 3 2 1
      stars.forEach(s => {
        if(parseInt(s.getAttribute('data-val')) <= val) {
          s.classList.add('active');
          s.style.color = '#facc15';
        } else {
          s.classList.remove('active');
          s.style.color = '#4b5563';
        }
      });
    });

    // Hover effects reset by CSS mostly, but we can enforce it
    star.addEventListener('mouseenter', (e) => {
      const val = parseInt(e.target.getAttribute('data-val'));
      stars.forEach(s => {
        if(parseInt(s.getAttribute('data-val')) <= val) s.style.color = '#facc15';
        else s.style.color = '#4b5563';
      });
    });

    star.addEventListener('mouseleave', () => {
      const val = parseInt(ratingInput.value);
      stars.forEach(s => {
        if(parseInt(s.getAttribute('data-val')) <= val) s.style.color = '#facc15';
        else s.style.color = '#4b5563';
      });
    });
  });

  // Submit Form
  document.getElementById('review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('review-submit-btn');
    const form = e.target;
    
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Submitting...';
    btn.disabled = true;

    const payload = {
      name: document.getElementById('review-name').value.trim(),
      business_name: document.getElementById('review-business').value.trim(),
      website_url: document.getElementById('review-url').value.trim(),
      service_completed: document.getElementById('review-service').value,
      message: document.getElementById('review-message').value.trim(),
      rating: document.getElementById('review-rating').value,
      honeypot: document.querySelector('[name="website_url_hp"]').value,
      submission_time_ms: Date.now() - parseInt(document.querySelector('.form_start_time').value || Date.now())
    };

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if(res.ok) {
        form.style.display = 'none';
        document.getElementById('review-success').classList.remove('hidden');
      } else {
        const data = await res.json();
        alert('Error: ' + (data.error || 'Failed to submit review'));
      }
    } catch(err) {
      alert('Network error while submitting. Please try again.');
    } finally {
      btn.innerHTML = 'Submit Review';
      btn.disabled = false;
    }
  });

  // Load Reviews
  async function loadReviews() {
    const feed = document.getElementById('reviews-feed');
    try {
      const res = await fetch('/api/reviews');
      if(!res.ok) throw new Error('Failed to fetch reviews');
      
      const reviews = await res.json();
      document.getElementById('reviews-count').textContent = `${reviews.length} Review${reviews.length !== 1 ? 's' : ''}`;

      feed.innerHTML = '';

      if(reviews.length === 0) {
        feed.innerHTML = `
          <div class="text-center py-16 bg-gray-800 border border-gray-700 rounded-xl">
            <i class="fas fa-comment-dots text-5xl text-gray-600 mb-4"></i>
            <h3 class="text-xl font-bold text-gray-300">No reviews yet</h3>
            <p class="text-gray-500 mt-2">Reviews will appear here once customers submit feedback.</p>
          </div>
        `;
        return;
      }

      reviews.forEach(r => {
        const dateStr = new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Build stars string
        let starsHtml = '';
        for(let i=1; i<=5; i++) {
          if(i <= r.rating) starsHtml += '<i class="fas fa-star text-yellow-400"></i>';
          else starsHtml += '<i class="far fa-star text-gray-600"></i>';
        }

        // Safe HTML encoding
        const safeName = escapeHTML(r.name);
        const safeBusiness = r.business_name ? escapeHTML(r.business_name) : '';
        const safeService = escapeHTML(r.service_completed || 'Project');
        const safeMsg = escapeHTML(r.message).replace(/\n/g, '<br>');

        const el = document.createElement('div');
        el.className = 'bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-md transition hover:border-gray-600';
        el.innerHTML = `
          <div class="flex flex-col sm:flex-row sm:items-start justify-between mb-4 gap-2">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-xl font-bold shadow-inner">
                ${safeName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 class="font-bold text-lg leading-tight">${safeName}</h3>
                ${safeBusiness ? `<p class="text-sm text-cyan-400">${safeBusiness}</p>` : ''}
              </div>
            </div>
            <div class="flex flex-col sm:items-end gap-1">
              <div class="flex gap-1 text-sm" title="${r.rating} out of 5 stars">${starsHtml}</div>
              <div class="text-xs text-gray-500">${dateStr}</div>
            </div>
          </div>
          <p class="text-gray-300 leading-relaxed mb-4">${safeMsg}</p>
          <div class="flex items-center gap-2 text-xs font-medium text-gray-400 bg-gray-900 inline-block px-3 py-1.5 rounded-full border border-gray-700">
            <i class="fas fa-tag text-cyan-600"></i> ${safeService}
          </div>
        `;
        feed.appendChild(el);
      });
    } catch(e) {
      feed.innerHTML = '<div class="text-center py-10 text-red-400">Failed to load reviews. Please try again later.</div>';
    }
  }

  function escapeHTML(str) {
    if(!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  loadReviews();
});
