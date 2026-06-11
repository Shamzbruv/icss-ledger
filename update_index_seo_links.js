const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main website file', 'index.html');
let content = fs.readFileSync(file, 'utf8');

const linkMap = {
    "Web Development": "web-development.html",
    "Mobile Apps": "mobile-app-development.html",
    "Graphic Design & Logo": "graphic-design.html",
    "Business Automation": "business-automation.html"
};

// We will inject the "Learn More" links below the "Get a Quote" buttons in the services section.
// A safe way is to find the exact button for each service and append an anchor tag right after it.

for (const [serviceName, url] of Object.entries(linkMap)) {
    const buttonRegex = new RegExp(`(<button onclick="openServiceModal\\('${serviceName}'\\)"[^>]*>.*?<\\/button>)`, 'g');
    const learnMoreLink = `\n              <a href="${url}" class="mt-3 block text-center text-cyan-500 hover:text-cyan-400 font-medium text-sm transition underline underline-offset-4">Learn More About ${serviceName}</a>`;
    
    // Replace by adding the link right after the button
    content = content.replace(buttonRegex, `$1${learnMoreLink}`);
}

// Update the Footer links
content = content.replace(/<li><a class="text-gray-300 hover:text-cyan-300 transition" href="#services">Web Development<\/a><\/li>/, `<li><a class="text-gray-300 hover:text-cyan-300 transition" href="web-development.html">Web Development</a></li>`);
content = content.replace(/<li><a class="text-gray-300 hover:text-cyan-300 transition" href="#services">Mobile Apps<\/a><\/li>/, `<li><a class="text-gray-300 hover:text-cyan-300 transition" href="mobile-app-development.html">Mobile Apps</a></li>`);
content = content.replace(/<li><a class="text-gray-300 hover:text-cyan-300 transition" href="#services">Business Automation<\/a><\/li>/, `<li><a class="text-gray-300 hover:text-cyan-300 transition" href="business-automation.html">Business Automation</a></li>`);
content = content.replace(/<li><a class="text-gray-300 hover:text-cyan-300 transition" href="#services">Graphic Design & Logo<\/a><\/li>/, `<li><a class="text-gray-300 hover:text-cyan-300 transition" href="graphic-design.html">Graphic Design & Logo</a></li>`);

fs.writeFileSync(file, content, 'utf8');
console.log('index.html updated with SEO links');
