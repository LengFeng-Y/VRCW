/*
 * VRCW - ui-controls.js
 * Resident shared UI controls used by multiple classic scripts and inline handlers.
 */

function toggleGlassSelect(e, el) {
  e.stopPropagation();
  const isNowActive = !el.classList.contains('active');

  document.querySelectorAll('.glass-select.active').forEach(s => {
    if (s !== el) {
      s.classList.remove('active');
      const o = s.querySelector('.glass-select-options');
      if (o) { o.style.position = ''; o.style.top = ''; o.style.left = ''; o.style.width = ''; }
    }
  });

  el.classList.toggle('active', isNowActive);

  if (isNowActive) {
    const opts = el.querySelector('.glass-select-options');
    if (opts) {
      const r = el.getBoundingClientRect();
      opts.style.position = 'fixed';
      opts.style.top = (r.bottom + 4) + 'px';
      opts.style.left = r.left + 'px';
      opts.style.width = Math.max(r.width, 160) + 'px';
      opts.style.right = '';
    }
  } else {
    const opts = el.querySelector('.glass-select-options');
    if (opts) { opts.style.position = ''; opts.style.top = ''; opts.style.left = ''; opts.style.width = ''; }
  }
}

function selectGlassOption(e, el, val, callbackName) {
  e.stopPropagation();
  const select = el.closest('.glass-select');
  if (!select) return;
  const input = select.querySelector('input[type="hidden"]');
  const label = select.querySelector('.selected-label');
  if (input) input.value = val;
  if (label) label.textContent = el.textContent;

  const i18nKey = el.getAttribute('data-i18n');
  if (label && i18nKey) {
    label.setAttribute('data-i18n', i18nKey);
    const translated = t(i18nKey);
    if (translated) label.textContent = translated;
  } else if (label) {
    label.removeAttribute('data-i18n');
  }

  select.querySelectorAll('.glass-option').forEach(opt => opt.classList.remove('selected'));
  el.classList.add('selected');
  select.classList.remove('active');
  const opts = select.querySelector('.glass-select-options');
  if (opts) { opts.style.position = ''; opts.style.top = ''; opts.style.left = ''; opts.style.width = ''; }

  if (callbackName && typeof window[callbackName] === 'function') {
    window[callbackName]();
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.glass-select').forEach(s => {
    s.classList.remove('active');
    const o = s.querySelector('.glass-select-options');
    if (o) { o.style.position = ''; o.style.top = ''; o.style.left = ''; o.style.width = ''; }
  });
});

VRCW.registerModule('uiControls', {
  toggleGlassSelect,
  selectGlassOption,
});
renderAppVersionInfo();
