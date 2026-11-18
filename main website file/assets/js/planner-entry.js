function openPlannerEntry() {
    if (location.hash === '#quote') window.openQuizModal('Studio homepage');
    const service = new URLSearchParams(location.search).get('service');
    if (service) {
        const title = [...document.querySelectorAll('#services h4')].find(heading => heading.textContent.trim() === service);
        const card = title?.closest('.solution-card-cursor');
        const form = card?.querySelector('.solution-form-container');
        if (form && !form.classList.contains('active')) {
            window.toggleSolutionForm(form.id);
            card.scrollIntoView({block:'center'});
        }
    }
}
window.addEventListener('DOMContentLoaded', openPlannerEntry);
window.addEventListener('hashchange', openPlannerEntry);
