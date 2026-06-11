const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main website file', 'index.html');
let content = fs.readFileSync(file, 'utf8');

const reviewsSection = `
  <section id="reviews" class="py-16 primary-bg text-white digital-static">
    <div class="container mx-auto px-6">
      <div class="text-center mb-12 fade-in">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">What Our <span class="secondary-text">Clients</span> Say</h2>
        <p class="text-lg text-gray-300 max-w-2xl mx-auto">Real feedback from clients who trusted ICREATE Solutions &amp; Services with their projects.</p>
      </div>
      <div id="reviews-stats" class="flex items-center justify-center gap-4 mb-10">
        <a id="write-review-link"
          class="inline-flex items-center bg-cyan-500 hover:bg-cyan-400 text-black px-6 py-3 rounded-full font-bold transition-all transform hover:scale-105"
          href="reviews.html">
          See All Reviews &amp; Leave Feedback
        </a>
      </div>
      
      <div id="dynamic-reviews-feed" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div class="col-span-full text-center text-gray-500 py-10">
          <i class="fas fa-spinner fa-spin text-3xl mb-3"></i>
          <p>Loading reviews...</p>
        </div>
      </div>
    </div>
  </section>
`;

const reviewsScript = `
  <!-- ===== REVIEWS LOGIC ===== -->
  <script>
    document.addEventListener('DOMContentLoaded', async () => {
      try {
        const feed = document.getElementById('dynamic-reviews-feed');
        if(!feed) return;
        const res = await fetch('/api/reviews?limit=3');
        if(!res.ok) throw new Error('Failed');
        const reviews = await res.json();
        
        feed.innerHTML = '';
        if(reviews.length === 0) {
          feed.innerHTML = \`
            <div class="col-span-full text-center py-12 bg-gray-800 border border-gray-700 rounded-xl">
              <i class="fas fa-comment-dots text-5xl text-gray-600 mb-4"></i>
              <h3 class="text-xl font-bold text-gray-300">No reviews yet</h3>
              <p class="text-gray-500 mt-2">Reviews will appear here once customers submit feedback.</p>
            </div>
          \`;
          return;
        }

        reviews.forEach((r, idx) => {
          const dateStr = new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
          let starsHtml = '';
          for(let i=1; i<=5; i++) {
            if(i <= r.rating) starsHtml += '<i class="fas fa-star text-yellow-400"></i>';
            else starsHtml += '<i class="far fa-star text-gray-600"></i>';
          }
          
          const safeName = r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          const safeMsg = r.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

          const el = document.createElement('div');
          el.className = 'bg-gray-800 border border-gray-700 rounded-xl p-5 fade-in shadow-lg hover:border-gray-600 transition';
          el.style.animationDelay = \`\${idx * 0.1}s\`;
          el.innerHTML = \`
            <div class="flex items-center justify-between mb-2">
              <div class="font-semibold">\${safeName}</div>
              <div class="flex gap-1 text-sm" title="\${r.rating} / 5">\${starsHtml}</div>
            </div>
            <p class="text-gray-300 text-sm leading-relaxed">\${safeMsg}</p>
            <div class="text-xs text-gray-500 mt-3">\${dateStr}</div>
          \`;
          feed.appendChild(el);
        });
      } catch(e) {
        const feed = document.getElementById('dynamic-reviews-feed');
        if(feed) feed.innerHTML = '<div class="col-span-full text-center text-red-400">Failed to load reviews.</div>';
      }
    });
  </script>
`;

content = content.replace('<section class="py-20 bg-white" id="about">', reviewsSection + '\n  <section class="py-20 bg-white" id="about">');
content = content.replace('<!-- ===== COOKIE CONSENT BANNER ===== -->', reviewsScript + '\n  <!-- ===== COOKIE CONSENT BANNER ===== -->');

fs.writeFileSync(file, content, 'utf8');
console.log('Reviews injected');
