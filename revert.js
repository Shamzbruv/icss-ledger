const fs = require('fs');
let html = fs.readFileSync('main website file/index.html', 'utf8');

const target = `<section class="py-12 primary-bg digital-static border-t border-cyan-300/10">
    <div class="container mx-auto px-6">
      <div class="max-w-4xl mx-auto bg-[#050F1F] bg-opacity-60 border border-cyan-300/20 rounded-2xl p-8 md:p-12 text-center fade-in">
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-4">Stay <span class="secondary-text">Updated</span>
        </h2>
        <p class="text-lg text-gray-300 max-w-2xl mx-auto mb-8">Subscribe to our newsletter for the latest updates, tech
          insights, and exclusive offers.</p>`;

const replacement = `<section class="pt-16 pb-0 bg-white">
    <div class="container mx-auto px-6">
      <div class="max-w-4xl mx-auto bg-gray-100 rounded-2xl p-8 md:p-12 text-center fade-in">
        <h2 class="text-3xl md:text-4xl font-bold primary-text mb-4">Stay <span class="secondary-text">Updated</span>
        </h2>
        <p class="text-lg text-gray-600 max-w-2xl mx-auto mb-8">Subscribe to our newsletter for the latest updates, tech
          insights, and exclusive offers.</p>`;

html = html.replace(target, replacement);

fs.writeFileSync('main website file/index.html', html);
console.log('Replaced successfully');
