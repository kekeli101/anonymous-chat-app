const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('#site-nav');
const modal = document.querySelector('.photo-modal');
const modalTitle = document.querySelector('#modal-title');
const modalClose = document.querySelector('.modal-close');

menuToggle?.addEventListener('click', () => {
  const isOpen = siteNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.firstChild.textContent = isOpen ? 'Close ' : 'Menu ';
});

document.querySelectorAll('.site-nav a').forEach((link) => {
  link.addEventListener('click', () => {
    siteNav.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    if (menuToggle) menuToggle.firstChild.textContent = 'Menu ';
  });
});

document.querySelectorAll('.photo-tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    modalTitle.textContent = `${tile.dataset.photo} — coming soon.`;
    modal.hidden = false;
    modalClose.focus();
  });
});

function closeModal() {
  modal.hidden = true;
}

modalClose?.addEventListener('click', closeModal);
modal?.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
});
