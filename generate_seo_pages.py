import os
import json

PAGES = [
    {
        "filename": "web-development.html",
        "title": "Custom Web Development Services | iCreate Solutions & Services",
        "h1": "Turn Your Ideas Into High-Converting Websites",
        "description": "Expert custom web development services globally. We build stunning, fast, and SEO-optimized websites that turn visitors into loyal customers.",
        "benefits": [
            {"title": "Custom Design", "desc": "No cookie-cutter templates. We design to match your brand's unique identity."},
            {"title": "SEO Optimized", "desc": "Built from the ground up with SEO best practices so you rank higher on Google."},
            {"title": "Lightning Fast", "desc": "Optimized code and assets ensure your website loads in milliseconds."}
        ],
        "faqs": [
            {"q": "How long does it take to build a custom website?", "a": "A standard business website typically takes 2-4 weeks, depending on complexity and features."},
            {"q": "Do you provide hosting?", "a": "Yes, we can handle the hosting, domain setup, and SSL certificates so you don't have to worry about the technical details."}
        ],
        "service_val": "Website Development"
    },
    {
        "filename": "mobile-app-development.html",
        "title": "Mobile App Development Services | iOS & Android Apps",
        "h1": "Launch Your Dream Mobile App on iOS & Android",
        "description": "Top-tier mobile app development services. We create beautiful, scalable, and intuitive mobile applications for businesses worldwide.",
        "benefits": [
            {"title": "Cross-Platform", "desc": "Reach both Apple and Android users with a single, highly-optimized codebase."},
            {"title": "User-Centric UI/UX", "desc": "Intuitive interfaces designed to keep users engaged and coming back."},
            {"title": "Scalable Architecture", "desc": "Built to handle thousands of users seamlessly as your business grows."}
        ],
        "faqs": [
            {"q": "Do you develop for both iOS and Android?", "a": "Yes! We specialize in cross-platform development using technologies like React Native and Flutter to deploy on both stores simultaneously."},
            {"q": "Will you help me submit to the App Store?", "a": "Absolutely. We guide you through the entire submission and review process for both Apple App Store and Google Play."}
        ],
        "service_val": "Mobile App"
    },
    {
        "filename": "business-automation.html",
        "title": "Business Process Automation Services | Save Time & Money",
        "h1": "Automate Your Workflows & Scale Your Business Faster",
        "description": "Stop doing manual work. Our business automation services connect your apps, capture leads, and streamline your operations automatically.",
        "benefits": [
            {"title": "Zapier & API Integrations", "desc": "Connect your CRM, email, and accounting software seamlessly."},
            {"title": "Automated Lead Capture", "desc": "Never miss a lead. Automatically route inquiries to your phone or CRM."},
            {"title": "Error Reduction", "desc": "Eliminate human error by letting secure scripts handle repetitive tasks."}
        ],
        "faqs": [
            {"q": "What tools can you automate?", "a": "We work with Zapier, Make, custom webhooks, and REST APIs to connect almost any modern software platform."},
            {"q": "How much time can I save?", "a": "Our clients typically save 10-20 hours a week by automating invoicing, lead follow-ups, and data entry."}
        ],
        "service_val": "Business Automation"
    },
    {
        "filename": "graphic-design.html",
        "title": "Professional Graphic Design & Branding Services",
        "h1": "Stand Out With Premium Graphic Design & Branding",
        "description": "Elevate your brand with our professional graphic design services. Logos, social media kits, and marketing materials that capture attention.",
        "benefits": [
            {"title": "Brand Identity", "desc": "Logos and style guides that perfectly communicate your company's values."},
            {"title": "Marketing Materials", "desc": "Flyers, business cards, and brochures designed to convert."},
            {"title": "Social Media Kits", "desc": "Engaging templates and graphics tailored for Instagram, Facebook, and LinkedIn."}
        ],
        "faqs": [
            {"q": "Will I own the rights to the designs?", "a": "Yes! Once the project is completed and paid for, you retain 100% full commercial rights to the final designs."},
            {"q": "How many revisions do I get?", "a": "We typically offer 2-3 revision rounds depending on the package you choose to ensure you're completely satisfied."}
        ],
        "service_val": "Graphic Design & Logo"
    },
    {
        "filename": "ecommerce-solutions.html",
        "title": "E-Commerce Website Development | Sell Online Successfully",
        "h1": "Build a Powerful Online Store That Drives Sales",
        "description": "Custom e-commerce solutions for product and service businesses. Secure payments, inventory management, and high-conversion checkouts.",
        "benefits": [
            {"title": "Secure Payments", "desc": "Integration with Stripe, PayPal, and local payment gateways for safe transactions."},
            {"title": "Inventory Management", "desc": "Easy-to-use dashboards to track your stock, orders, and customer details."},
            {"title": "Conversion Optimized", "desc": "Frictionless checkout processes designed to reduce cart abandonment."}
        ],
        "faqs": [
            {"q": "What platforms do you use for E-commerce?", "a": "We build custom stores and also specialize in Shopify, WooCommerce, and tailored full-stack solutions."},
            {"q": "Can you integrate local payment processors?", "a": "Yes, we can integrate regional payment gateways specific to your target audience."}
        ],
        "service_val": "Website Development"
    },
    {
        "filename": "cms-wordpress.html",
        "title": "WordPress & CMS Development Services | Easy to Manage",
        "h1": "Empower Your Team with a Custom CMS or WordPress Site",
        "description": "Take control of your content. We build custom CMS and WordPress websites that are easy to update, secure, and blazing fast.",
        "benefits": [
            {"title": "Easy Content Updates", "desc": "No coding required to update your blog, text, or images."},
            {"title": "Enhanced Security", "desc": "Hardened WordPress installations to protect against hacks and malware."},
            {"title": "Custom Plugins", "desc": "Need specific functionality? We can develop custom plugins just for your business."}
        ],
        "faqs": [
            {"q": "Do you provide training on how to use the CMS?", "a": "Yes, we provide video tutorials and 1-on-1 walkthroughs so your team feels confident managing the site."},
            {"q": "Is WordPress good for SEO?", "a": "Absolutely. When configured correctly with proper caching and SEO plugins, WordPress is one of the best platforms for ranking on Google."}
        ],
        "service_val": "Website Development"
    },
    {
        "filename": "custom-scripts.html",
        "title": "Custom Scripts & Web Scraping Services",
        "h1": "Solve Complex Problems with Custom Scripts & Data Scraping",
        "description": "Need custom backend logic or data extraction? Our developers build secure, efficient Python and Node.js scripts for your exact needs.",
        "benefits": [
            {"title": "Data Extraction", "desc": "Ethically scrape data from websites and compile it into clean CSV or database formats."},
            {"title": "Custom Backend Logic", "desc": "Algorithms and server-side scripts to process heavy data workloads."},
            {"title": "API Development", "desc": "Build custom APIs to allow your different software systems to talk to each other."}
        ],
        "faqs": [
            {"q": "What languages do you write scripts in?", "a": "We primarily use Python and Node.js for high-performance scripting and web scraping."},
            {"q": "Can you run scripts on a schedule?", "a": "Yes, we can deploy your scripts to cloud servers (like AWS or Heroku) to run automatically on daily or hourly cron schedules."}
        ],
        "service_val": "Other"
    }
]

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-63WCDFCGPR"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag() {{ dataLayer.push(arguments); }}
    gtag('js', new Date());
    gtag('config', 'G-63WCDFCGPR');
  </script>
  <meta charset="utf-8" />
  <meta content="width=device-width, initial-scale=1.0" name="viewport" />
  <title>{title}</title>
  <link href="https://i.postimg.cc/ZKJvnxxH/Untitled-design.png" rel="icon" type="image/png" />
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="https://fonts.googleapis.com" rel="preconnect" />
  <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">

  <!-- SEO Meta Tags -->
  <meta name="description" content="{description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://icreatesolutionsandservices.com/{filename}">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:image" content="https://i.postimg.cc/ZKJvnxxH/Untitled-design.png">
  <link rel="canonical" href="https://icreatesolutionsandservices.com/{filename}">

  <style>
    .hero-bg {{
        background: linear-gradient(135deg, rgba(10,26,58,0.95) 0%, rgba(0,51,102,0.95) 100%), url('https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80');
        background-size: cover;
        background-position: center;
    }}
  </style>
</head>
<body class="bg-gray-900 text-white font-sans antialiased min-h-screen flex flex-col">

  <!-- Header -->
  <header class="primary-bg py-4 sticky top-0 z-50 border-b border-gray-800 shadow-md">
    <div class="container mx-auto px-6 flex justify-between items-center">
      <a href="index.html" class="flex items-center space-x-2 group">
        <i class="fas fa-cubes text-cyan-500 text-3xl group-hover:rotate-12 transition"></i>
        <span class="text-2xl font-bold tracking-tight text-white">ICREATE <span class="text-cyan-500">Solutions</span></span>
      </a>
      <a href="index.html" class="text-gray-300 hover:text-cyan-400 transition flex items-center gap-2">
        <i class="fas fa-arrow-left"></i> Back to Home
      </a>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="hero-bg py-24 digital-static relative overflow-hidden">
    <div class="container mx-auto px-6 text-center relative z-10">
      <h1 class="text-4xl md:text-6xl font-bold mb-6 text-white tracking-tight">{h1}</h1>
      <p class="text-xl md:text-2xl text-gray-300 max-w-3xl mx-auto mb-10 leading-relaxed">{description}</p>
      <div class="flex flex-col sm:flex-row justify-center items-center gap-4">
        <a href="#lead-form" class="bg-cyan-500 hover:bg-cyan-400 text-black px-8 py-4 rounded-full font-bold text-lg transition-all shadow-[0_0_20px_rgba(0,245,255,0.4)] transform hover:-translate-y-1">
          Get Started Today
        </a>
        <a href="index.html#services" class="text-white border border-gray-500 hover:border-white px-8 py-4 rounded-full font-medium transition">
          View All Services
        </a>
      </div>
    </div>
  </section>

  <!-- Benefits Section -->
  <section class="py-20 bg-gray-900">
    <div class="container mx-auto px-6">
      <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">Why Choose Us?</h2>
        <div class="w-24 h-1 bg-cyan-500 mx-auto rounded-full"></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        {benefits_html}
      </div>
    </div>
  </section>

  <!-- FAQ Section -->
  <section class="py-20 bg-gray-800 border-y border-gray-700">
    <div class="container mx-auto px-6 max-w-4xl">
      <div class="text-center mb-12">
        <h2 class="text-3xl font-bold mb-4">Frequently Asked Questions</h2>
      </div>
      <div class="space-y-6">
        {faqs_html}
      </div>
    </div>
  </section>

  <!-- Lead Capture Form -->
  <section id="lead-form" class="py-20 bg-gray-900">
    <div class="container mx-auto px-6 max-w-3xl">
      <div class="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 p-8 md:p-12 rounded-2xl shadow-2xl">
        <div class="text-center mb-8">
          <h2 class="text-3xl font-bold mb-2">Ready to start your project?</h2>
          <p class="text-gray-400">Fill out the form below and we'll get back to you within 24 hours.</p>
        </div>
        
        <div id="landing-success" class="hidden bg-green-900/50 border border-green-500 text-green-200 p-4 rounded-lg mb-6 text-center">
          <i class="fas fa-check-circle text-2xl mb-2 text-green-400 block"></i>
          Thanks! We've received your request and will be in touch shortly.
        </div>

        <form id="landing-contact-form" class="space-y-4">
          <!-- Honeypot -->
          <input type="text" name="website_url_hp" style="display:none" tabindex="-1">
          <input type="hidden" name="form_start_time" class="form_start_time" value="">
          
          <input type="hidden" id="ld-service" value="{service_val}">

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" id="ld-name" placeholder="Your Name *" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition">
            <input type="text" id="ld-business" placeholder="Business Name" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition">
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="email" id="ld-email" placeholder="Email Address *" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition">
            <input type="tel" id="ld-phone" placeholder="Phone / WhatsApp" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition">
          </div>
          <div>
            <textarea id="ld-message" placeholder="Tell us about your project... *" required rows="4" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"></textarea>
          </div>

          <button type="submit" id="ld-submit-btn" class="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-4 rounded-lg transition-all shadow-lg transform hover:-translate-y-0.5">
            Submit Request <i class="fas fa-paper-plane ml-2"></i>
          </button>
        </form>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="border-t border-gray-800 py-8 text-center text-gray-500 mt-auto bg-gray-900">
    <div class="container mx-auto px-6">
      <p>&copy; 2026 ICREATE Solutions & Services. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/crm-integration.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      // Set Form Timer
      const formTimer = document.querySelector('.form_start_time');
      if(formTimer) formTimer.value = Date.now().toString();

      document.getElementById('landing-contact-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('ld-submit-btn');
        const form = e.target;
        const originalText = btn.innerHTML;
        
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Submitting...';
        btn.disabled = true;

        const payload = {
          lead_type: 'SEO Landing Page Inquiry',
          name: document.getElementById('ld-name').value.trim(),
          business_name: document.getElementById('ld-business').value.trim(),
          email: document.getElementById('ld-email').value.trim(),
          phone: document.getElementById('ld-phone').value.trim(),
          service_needed: document.getElementById('ld-service').value,
          description: document.getElementById('ld-message').value.trim(),
          honeypot: document.querySelector('[name="website_url_hp"]').value,
          submission_time_ms: Date.now() - parseInt(document.querySelector('.form_start_time').value || Date.now())
        };

        try {
          // If CRM.submitLead exists, use it to capture UTMs too
          if (window.CRM && window.CRM.submitLead) {
              await CRM.submitLead(payload);
          } else {
              const res = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              if(!res.ok) throw new Error('Submission failed');
          }
          
          form.style.display = 'none';
          document.getElementById('landing-success').classList.remove('hidden');
          
          // Optional GA4 ping
          if(window.gtag) gtag('event', 'generate_lead', { method: 'landing_page', form_id: 'seo_lp' });
          
        } catch(err) {
          alert('Network error while submitting. Please try again or use the Contact page.');
          btn.innerHTML = originalText;
          btn.disabled = false;
        }
      });
    });
  </script>
</body>
</html>"""

def build_pages():
    out_dir = os.path.join(os.path.dirname(__file__), 'main website file')
    for p in PAGES:
        # Build benefits HTML
        b_html = ""
        for b in p['benefits']:
            b_html += f"""
        <div class="bg-gray-800 p-8 rounded-xl border border-gray-700 hover:border-cyan-500 transition-all hover:-translate-y-1">
          <div class="w-12 h-12 bg-cyan-900/30 text-cyan-500 rounded-lg flex items-center justify-center text-2xl mb-6">
            <i class="fas fa-check"></i>
          </div>
          <h3 class="text-xl font-bold mb-3">{b['title']}</h3>
          <p class="text-gray-400">{b['desc']}</p>
        </div>"""
        
        # Build FAQs HTML
        f_html = ""
        for f in p['faqs']:
            f_html += f"""
        <div class="bg-gray-900 p-6 rounded-lg border border-gray-700">
          <h4 class="text-lg font-bold mb-2 text-cyan-400">{f['q']}</h4>
          <p class="text-gray-300">{f['a']}</p>
        </div>"""
        
        html_content = TEMPLATE.format(
            filename=p['filename'],
            title=p['title'],
            h1=p['h1'],
            description=p['description'],
            benefits_html=b_html,
            faqs_html=f_html,
            service_val=p['service_val']
        )
        
        filepath = os.path.join(out_dir, p['filename'])
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f"Generated {p['filename']}")

if __name__ == '__main__':
    build_pages()
