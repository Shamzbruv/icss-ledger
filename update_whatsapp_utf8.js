const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main website file', 'index.html');
let content = fs.readFileSync(file, 'utf8');

// 1. Fix UTF-8 encoding issues globally
const utf8Map = {
    'ΓÇô': '–', // en dash
    'ΓÇó': '•', // bullet point
    'ΓåÆ': '→', // right arrow
    '├ù': '×', // multiply/close
    '┬⌐': '©', // copyright
    'Γÿà': '★' // star
};

for (const [broken, fixed] of Object.entries(utf8Map)) {
    const regex = new RegExp(broken, 'g');
    content = content.replace(regex, fixed);
}

// 2. Fix submitServiceModalWhatsApp
const newSubmitServiceModalWhatsApp = `async function submitServiceModalWhatsApp(event) {
      if(event) event.preventDefault();
      
      const form = document.querySelector('#service-modal form');
      if(!form) return;
      if(!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      
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
        lead_type: 'Service Lead (WhatsApp)',
        name: name.trim(),
        business_name: business.trim(),
        email: email.trim(),
        phone: phone.trim(),
        service_needed: serviceType,
        description: \`Needs: \${selectedNeeds}\\nStage: \${projectStage}\\nTimeline: \${timeline}\\nBudget: \${budget}\\n\\nDetails: \${description.trim()}\`,
        source: 'Service Modal (WhatsApp)'
      };

      try {
        if (window.CRM && window.CRM.submitLead) {
          await window.CRM.submitLead(payload);
        }
      } catch (err) {
        console.error('CRM capture failed for WhatsApp lead:', err);
        // Do not block WhatsApp redirection
      }

      const message = \`*New Service Inquiry: \${serviceType}*\\n\\n*Client Details:*\\nName: \${name}\\nBusiness: \${business}\\nPhone: \${phone}\\nEmail: \${email}\\n\\n*Project Scope:*\\nNeeds: \${selectedNeeds || 'None selected'}\\nStage: \${projectStage}\\nTimeline: \${timeline}\\nBudget: \${budget}\\n\\n*Description:*\\n\${description}\`;
      const whatsappNumber = '18765857469';
      const url = \`https://wa.me/\${whatsappNumber}?text=\${encodeURIComponent(message)}\`;
      window.open(url, '_blank');
      closeServiceModal();
    }`;

// Replace submitServiceModalWhatsApp using a regex that captures the entire function block
content = content.replace(/function submitServiceModalWhatsApp\(event\) \{[\s\S]*?closeServiceModal\(\);\s*\}/, newSubmitServiceModalWhatsApp);

// 3. Fix submitSolutionFormWhatsApp
const newSubmitSolutionFormWhatsApp = `async function submitSolutionFormWhatsApp(event, element) {
      if(event) event.preventDefault();
      
      const form = element.closest('form');
      if(!form) return;
      if(!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const onsubmitAttr = form.getAttribute('onsubmit');
      let serviceName = "Industry Service";
      if(onsubmitAttr) {
        const match = onsubmitAttr.match(/'([^']+)'/);
        if(match) serviceName = match[1];
      }

      const name = form.querySelector('input[placeholder="Your Name"]').value;
      const business = form.querySelector('input[placeholder="Business Name"]').value;
      const phone = form.querySelector('input[placeholder="Phone Number"]').value;
      const email = form.querySelector('input[placeholder="Email Address"]').value;
      const selects = form.querySelectorAll('select');
      const projectStage = selects[0] ? selects[0].value : '';
      const timeline = selects[1] ? selects[1].value : '';
      const budget = selects[2] ? selects[2].value : '';
      const painPoints = form.querySelector('textarea').value;
      const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
      const selectedNeeds = Array.from(checkboxes).map(cb => cb.value).join(', ');

      const payload = {
        lead_type: \`Industry Lead (\${serviceName}) (WhatsApp)\`,
        name: name.trim(),
        business_name: business.trim(),
        email: email.trim(),
        phone: phone.trim(),
        service_needed: serviceName,
        description: \`Needs: \${selectedNeeds}\\nStage: \${projectStage}\\nTimeline: \${timeline}\\nBudget: \${budget}\\n\\nPain Points: \${painPoints.trim()}\`,
        source: 'Industry Lead (WhatsApp)'
      };

      try {
        if (window.CRM && window.CRM.submitLead) {
          await window.CRM.submitLead(payload);
        }
      } catch (err) {
        console.error('CRM capture failed for Industry WhatsApp lead:', err);
      }

      const message = \`*New Industry Inquiry for \${serviceName}*\\n\\n*Client Details:*\\nName: \${name}\\nBusiness: \${business}\\nPhone: \${phone}\\nEmail: \${email}\\n\\n*Project Scope:*\\nKey Needs: \${selectedNeeds || 'None selected'}\\nStage: \${projectStage}\\nTimeline: \${timeline}\\nBudget: \${budget}\\n\\n*Primary Pain Point:*\\n\${painPoints}\`;
      const whatsappNumber = '18765857469';
      const url = \`https://wa.me/\${whatsappNumber}?text=\${encodeURIComponent(message)}\`;
      window.open(url, '_blank');
      closeSolutionModal();
    }`;

// Replace submitSolutionFormWhatsApp
content = content.replace(/function submitSolutionFormWhatsApp\(event, element\) \{[\s\S]*?closeSolutionModal\(\);\s*\}/, newSubmitSolutionFormWhatsApp);

fs.writeFileSync(file, content, 'utf8');
console.log('Successfully updated index.html');
