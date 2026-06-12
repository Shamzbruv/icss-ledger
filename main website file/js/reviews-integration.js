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

      feed.innerHTML = ''; // Safe to clear empty state

      if(reviews.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'text-center py-16 bg-gray-800 border border-gray-700 rounded-xl';
        
        const icon = document.createElement('i');
        icon.className = 'fas fa-comment-dots text-5xl text-gray-600 mb-4';
        
        const h3 = document.createElement('h3');
        h3.className = 'text-xl font-bold text-gray-300';
        h3.textContent = 'No reviews yet';
        
        const p = document.createElement('p');
        p.className = 'text-gray-500 mt-2';
        p.textContent = 'Reviews will appear here once customers submit feedback.';
        
        emptyDiv.appendChild(icon);
        emptyDiv.appendChild(h3);
        emptyDiv.appendChild(p);
        feed.appendChild(emptyDiv);
        return;
      }

      reviews.forEach(r => {
        const dateStr = new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        
        const el = document.createElement('div');
        el.className = 'bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-md transition hover:border-gray-600';
        
        // Header container
        const header = document.createElement('div');
        header.className = 'flex flex-col sm:flex-row sm:items-start justify-between mb-4 gap-2';
        
        // Left part of header
        const leftHeader = document.createElement('div');
        leftHeader.className = 'flex items-center gap-4';
        
        const avatar = document.createElement('div');
        avatar.className = 'w-12 h-12 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-xl font-bold shadow-inner';
        avatar.textContent = (r.name || 'A').charAt(0).toUpperCase();
        
        const nameContainer = document.createElement('div');
        const nameH3 = document.createElement('h3');
        nameH3.className = 'font-bold text-lg leading-tight';
        nameH3.textContent = r.name || 'Anonymous';
        nameContainer.appendChild(nameH3);
        
        if (r.business_name) {
          const bizP = document.createElement('p');
          bizP.className = 'text-sm text-cyan-400';
          bizP.textContent = r.business_name;
          nameContainer.appendChild(bizP);
        }
        
        leftHeader.appendChild(avatar);
        leftHeader.appendChild(nameContainer);
        
        // Right part of header
        const rightHeader = document.createElement('div');
        rightHeader.className = 'flex flex-col sm:items-end gap-1';
        
        const starsContainer = document.createElement('div');
        starsContainer.className = 'flex gap-1 text-sm';
        starsContainer.title = r.rating + ' out of 5 stars';
        for(let i=1; i<=5; i++) {
          const star = document.createElement('i');
          if(i <= r.rating) {
            star.className = 'fas fa-star text-yellow-400';
          } else {
            star.className = 'far fa-star text-gray-600';
          }
          starsContainer.appendChild(star);
        }
        
        const dateDiv = document.createElement('div');
        dateDiv.className = 'text-xs text-gray-500';
        dateDiv.textContent = dateStr;
        
        rightHeader.appendChild(starsContainer);
        rightHeader.appendChild(dateDiv);
        
        header.appendChild(leftHeader);
        header.appendChild(rightHeader);
        
        // Message body
        const msgP = document.createElement('p');
        msgP.className = 'text-gray-300 leading-relaxed mb-4';
        const lines = (r.message || '').split('\n');
        lines.forEach((line, index) => {
          msgP.appendChild(document.createTextNode(line));
          if (index < lines.length - 1) {
            msgP.appendChild(document.createElement('br'));
          }
        });
        
        // Footer tag
        const tagDiv = document.createElement('div');
        tagDiv.className = 'flex items-center gap-2 text-xs font-medium text-gray-400 bg-gray-900 inline-block px-3 py-1.5 rounded-full border border-gray-700';
        
        const tagIcon = document.createElement('i');
        tagIcon.className = 'fas fa-tag text-cyan-600';
        tagDiv.appendChild(tagIcon);
        tagDiv.appendChild(document.createTextNode(' ' + (r.service_completed || 'Project')));
        
        el.appendChild(header);
        el.appendChild(msgP);
        el.appendChild(tagDiv);
        
        feed.appendChild(el);
      });
    } catch(e) {
      feed.textContent = 'Failed to load reviews. Please try again later.';
      feed.className = 'text-center py-10 text-red-400';
    }
  }

  // escapeHTML is no longer needed since we use textContent
  // function escapeHTML(str) { ... }

  loadReviews();
});
