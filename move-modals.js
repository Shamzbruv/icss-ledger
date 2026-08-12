const fs = require('fs');
let html = fs.readFileSync('main website file/index.html', 'utf8');

const startModals = html.indexOf('<div class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 hidden"\r\n    id="consultation-modal">') !== -1 ? 
  html.indexOf('<div class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 hidden"\r\n    id="consultation-modal">') :
  html.indexOf('<div class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 hidden"\n    id="consultation-modal">');

const endModals = html.indexOf('<footer class="primary-bg');

if (startModals !== -1 && endModals !== -1) {
  const modals = html.slice(startModals, endModals);
  html = html.slice(0, startModals) + html.slice(endModals);
  html = html.replace('</footer>', '</footer>\n\n' + modals);
  fs.writeFileSync('main website file/index.html', html);
  console.log('Modals moved successfully.');
} else {
  console.log('Failed to find markers.');
}
