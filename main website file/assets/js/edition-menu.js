const menuButton = document.querySelector('.edition-nav button');
if (menuButton) {
    const menu = document.getElementById('edition-menu');
    menuButton.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        menuButton.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && menu.classList.contains('open')) {
            menu.classList.remove('open');
            menuButton.setAttribute('aria-expanded','false');
            menuButton.focus();
        }
    });
}
