const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main website file', 'index.html');
let content = fs.readFileSync(file, 'utf8');

// 1. Inject Honeypot & Timing inputs into all forms
content = content.replace(/<form([^>]*)>/g, (match, attrs) => {
    return `<form${attrs}>\n  <!-- Spam Protection -->\n  <input type="text" name="website_url_hp" style="display:none" tabindex="-1">\n  <input type="hidden" name="form_start_time" class="form_start_time" value="">\n`;
});

// 2. Wire Contact Form (Lines ~3790)
content = content.replace(
    `contactForm.addEventListener('submit', function (e) {`,
    `contactForm.addEventListener('submit', function (e) {\n        e.preventDefault();`
);
content = content.replace(
    /const mailto = `mailto:iCreatesolutions.ja@gmail.com` \+\s*`\?subject=\$\{encodeURIComponent\(subject\)\}` \+\s*`&body=\$\{encodeURIComponent\(bodyLines\.join\('\\n'\)\)\}`;[\s\S]*?window\.location\.href = mailto;/m,
    `const payload = {
          lead_type: 'Contact Form',
          name: name,
          email: email,
          message: message,
          description: subject,
          honeypot: contactForm.querySelector('[name="website_url_hp"]').value,
          submission_time_ms: Date.now() - parseInt(contactForm.querySelector('.form_start_time').value || Date.now())
        };
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sending...';
        submitBtn.disabled = true;

        CRM.submitLead(payload).then(() => {
          CRM.showSuccess();
          contactForm.reset();
          submitBtn.innerHTML = originalText;
          submitBtn.disabled = false;
        }).catch(() => {
          const mailto = \`mailto:iCreatesolutions.ja@gmail.com?subject=\$\{encodeURIComponent(subject)}&body=\$\{encodeURIComponent(bodyLines.join('\\n'))}\`;
          window.location.href = mailto;
          submitBtn.innerHTML = originalText;
          submitBtn.disabled = false;
        });`
);

// 3. Wire Service Modal
content = content.replace(
    /function submitServiceModal\(event\) {[\s\S]*?const mailto = `mailto:icreatesolutions\.ja@gmail\.com`[\s\S]*?window\.location\.href = mailto;/m,
    `function submitServiceModal(event) {
      event.preventDefault();
      const form = event.target;
      const serviceType = document.getElementById('service-type-input').value;

      const name = form.querySelector('input[placeholder="Your Name"]').value;
      const business = form.querySelector('input[placeholder="Business Name"]').value;
      const phone = form.querySelector('input[placeholder="Phone Number"]').value;
      const email = form.querySelector('input[placeholder="Email Address"]').value;
      const selects = form.querySelectorAll('select');
      const projectStage = selects[0] ? selects[0].value : '';
      const timeline = selects[1] ? selects[1].value : '';
      const budget = selects[2] ? selects[2].value : '';
      const description = form.querySelector('textarea').value;
      const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
      const selectedNeeds = Array.from(checkboxes).map(cb => cb.value).join(', ');

      const payload = {
        lead_type: 'Service Inquiry',
        service_needed: serviceType,
        name: name,
        business_name: business,
        phone: phone,
        email: email,
        project_stage: projectStage,
        timeline: timeline,
        budget: budget,
        description: description,
        selected_needs: Array.from(checkboxes).map(cb => cb.value),
        honeypot: form.querySelector('[name="website_url_hp"]').value,
        submission_time_ms: Date.now() - parseInt(form.querySelector('.form_start_time').value || Date.now())
      };

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending...';
      btn.disabled = true;

      CRM.submitLead(payload).then(() => {
        closeServiceModal();
        CRM.showSuccess();
        btn.innerHTML = originalText;
        btn.disabled = false;
        form.reset();
      }).catch(() => {
        const bodyLines = [
          \`Service Requested: \${serviceType}\`,
          \`Name: \${name}\`,
          \`Email: \${email}\`
        ];
        const mailto = \`mailto:icreatesolutions.ja@gmail.com?subject=\$\{encodeURIComponent('New Inquiry')}&body=\$\{encodeURIComponent(bodyLines.join('\\n'))}\`;
        window.location.href = mailto;
        btn.innerHTML = originalText;
        btn.disabled = false;
      });`
);

// 4. Package Form Fix
content = content.replace(
    /function submitPackageForm\(e, packageName, formNum\) {[\s\S]*?window\.location\.href = mailto;[\s\S]*?btn\.disabled = true;\s*gtag\('event', 'generate_lead', \{ method: 'email', form_id: 'package_form' \}\);\s*}/m,
    `function submitPackageForm(e, packageName, formNum) {
      e.preventDefault();
      const form = e.target;
      var name = document.getElementById('pkg' + formNum + '-name').value.trim();
      var email = document.getElementById('pkg' + formNum + '-email').value.trim();
      var phone = document.getElementById('pkg' + formNum + '-phone').value.trim();

      const payload = {
        lead_type: 'Package Inquiry',
        package_name: packageName,
        name: name,
        email: email,
        phone: phone,
        honeypot: form.querySelector('[name="website_url_hp"]').value,
        submission_time_ms: Date.now() - parseInt(form.querySelector('.form_start_time').value || Date.now())
      };

      var btn = form.querySelector('button[type="submit"]');
      var originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending...';
      btn.disabled = true;

      CRM.submitLead(payload).then(() => {
        CRM.showSuccess();
        btn.innerHTML = originalText;
        btn.disabled = false;
        form.reset();
        gtag('event', 'generate_lead', { method: 'email', form_id: 'package_form' });
      }).catch(() => {
        const bodyLines = ["Package Inquiry: " + packageName, "Name: " + name, "Email: " + email, "Phone: " + phone];
        const mailto = \`mailto:icreatesolutions.ja@gmail.com?subject=\$\{encodeURIComponent('New Package Inquiry: ' + packageName)}&body=\$\{encodeURIComponent(bodyLines.join('\\n'))}\`;
        window.location.href = mailto;
        btn.innerHTML = originalText;
        btn.disabled = false;
      });
    }`
);

// 5. Package Form WhatsApp Fix
content = content.replace(
    /function submitPackageFormWhatsApp\(packageName, formNum\) {[\s\S]*?gtag\('event', 'generate_lead', \{ method: 'whatsapp', form_id: 'package_form' \}\);\s*}/m,
    `function submitPackageFormWhatsApp(packageName, formNum) {
      const form = document.getElementById('pkg' + formNum + '-form');
      var name = document.getElementById('pkg' + formNum + '-name').value.trim();
      var email = document.getElementById('pkg' + formNum + '-email').value.trim();
      var phone = document.getElementById('pkg' + formNum + '-phone').value.trim();

      if (!name || !phone) { 
        alert("Please enter your name and phone number first."); 
        return; 
      }

      const payload = {
        lead_type: 'Package Inquiry (WhatsApp)',
        package_name: packageName,
        name: name,
        email: email,
        phone: phone,
        honeypot: form.querySelector('[name="website_url_hp"]').value,
        submission_time_ms: Date.now() - parseInt(form.querySelector('.form_start_time').value || Date.now())
      };
      
      CRM.submitLead(payload);

      var text = \`Hi iCreate Solutions! 👋\\n\\nI'm interested in the *\${packageName}* package.\\n\\n*My Details:*\\nName: \${name}\\nEmail: \${email || 'Not provided'}\\nPhone/WhatsApp: \${phone}\\n\\nPlease let me know the next steps!\`;
      window.open(\`https://wa.me/18765857469?text=\$\{encodeURIComponent(text)}\`, '_blank');
      gtag('event', 'generate_lead', { method: 'whatsapp', form_id: 'package_form' });
    }`
);

// 6. Fix Audit Form
content = content.replace(
    /function submitAuditForm\(e\) {[\s\S]*?btn\.disabled = true;\s*}/m,
    `function submitAuditForm(e) {
      e.preventDefault();
      var form = document.getElementById('audit-form');
      var name = document.getElementById('audit-name').value.trim();
      var email = document.getElementById('audit-email').value.trim();
      var url = document.getElementById('audit-url').value.trim();
      var business = document.getElementById('audit-business').value.trim();
      var goal = document.getElementById('audit-goal').value;

      if (!name || !email || !url || !goal) return;

      const payload = {
        lead_type: 'Free Website Audit',
        name: name,
        email: email,
        website_url: url,
        business_name: business,
        goal: goal,
        honeypot: form.querySelector('[name="website_url_hp"]').value,
        submission_time_ms: Date.now() - parseInt(form.querySelector('.form_start_time').value || Date.now())
      };

      var btn = document.getElementById('audit-submit-btn');
      var originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending...';
      btn.disabled = true;

      CRM.submitLead(payload).then(() => {
        CRM.showSuccess();
        btn.innerHTML = originalText;
        btn.disabled = false;
        form.reset();
      }).catch(() => {
        const bodyLines = ["Name: "+name, "Email: "+email, "URL: "+url];
        const mailto = \`mailto:icreatesolutions.ja@gmail.com?subject=\$\{encodeURIComponent('Website Audit Request')}&body=\$\{encodeURIComponent(bodyLines.join('\\n'))}\`;
        window.location.href = mailto;
        btn.innerHTML = originalText;
        btn.disabled = false;
      });
    }`
);

fs.writeFileSync(file, content, 'utf8');
console.log('CRM functions and honeypots successfully injected.');
