/*
 * VRCW - ui-controls.js
 * Resident shared UI controls used by multiple classic scripts and inline handlers.
 */

function resetGlassSelectOptions(opts) {
  if (!opts) return;
  opts.style.position = '';
  opts.style.top = '';
  opts.style.left = '';
  opts.style.right = '';
  opts.style.width = '';
}

function positionGlassSelectOptions(el) {
  const opts = el.querySelector('.glass-select-options');
  if (!opts) return;

  const r = el.getBoundingClientRect();
  const width = Math.max(r.width, 160);

  if (el.closest('.search-box-glass')) {
    // Search bar lives inside a blurred glass container. In Chromium,
    // backdrop-filter can become a containing block for position: fixed,
    // which double-applies the search bar offset on desktop and sends the
    // dropdown off-screen. Keep search dropdowns anchored to their select.
    opts.style.position = 'absolute';
    opts.style.top = 'calc(100% + 10px)';
    opts.style.left = '0';
    opts.style.right = 'auto';
    opts.style.width = width + 'px';
    return;
  }

  const margin = 8;
  const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
  opts.style.position = 'fixed';
  opts.style.top = (r.bottom + 4) + 'px';
  opts.style.left = left + 'px';
  opts.style.right = 'auto';
  opts.style.width = width + 'px';
}

function toggleGlassSelect(e, el) {
  e.stopPropagation();
  const isNowActive = !el.classList.contains('active');

  document.querySelectorAll('.glass-select.active').forEach(s => {
    if (s !== el) {
      s.classList.remove('active');
      resetGlassSelectOptions(s.querySelector('.glass-select-options'));
    }
  });

  el.classList.toggle('active', isNowActive);

  if (isNowActive) {
    positionGlassSelectOptions(el);
  } else {
    resetGlassSelectOptions(el.querySelector('.glass-select-options'));
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
  resetGlassSelectOptions(select.querySelector('.glass-select-options'));

  if (callbackName && typeof window[callbackName] === 'function') {
    window[callbackName]();
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.glass-select').forEach(s => {
    s.classList.remove('active');
    resetGlassSelectOptions(s.querySelector('.glass-select-options'));
  });
});

VRCW.registerModule('uiControls', {
  toggleGlassSelect,
  selectGlassOption,
});
renderAppVersionInfo();
