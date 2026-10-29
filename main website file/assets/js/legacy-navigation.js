(() => {
  const routes = {home:'/',services:'/services',portfolio:'/portfolio',about:'/about',contact:'/contact','project-estimator':'/contact'};
  document.querySelectorAll('nav a, footer a, #mobile-menu a').forEach(a => {
    const match = a.getAttribute('href')?.match(/^(?:index\.html)?#([\w-]+)$/);
    if (match && routes[match[1]]) a.href = routes[match[1]];
    if (a.href.includes('linkedin.com/in/shamar-baker')) a.href='https://www.linkedin.com/company/icreate-solutions-services/';
  });
  const links = document.querySelector('footer ul');
  if (links && !document.querySelector('footer a[href="/work-with-icss"]')) {
    const li=document.createElement('li'),a=document.createElement('a');a.href='/work-with-icss';a.textContent='Work with ICSS';a.className='text-gray-300 hover:text-cyan-300 transition';li.append(a);links.append(li);
  }
})();
