/*
 * VRCW - ui-controls.js
 * Resident shared UI controls used by multiple classic scripts and inline handlers.
 */

function getGlassSelectOptions(el) {
  return el.querySelector('.glass-select-options') || el.__glassSelectOptions || null;
}

function portalGlassSelectOptions(el, opts) {
  if (!opts || opts.__glassSelectOwner) return;
  opts.__glassSelectOwner = el;
  opts.__glassSelectPlaceholder = document.createComment('glass-select-options');
  el.__glassSelectOptions = opts;
  opts.parentNode.insertBefore(opts.__glassSelectPlaceholder, opts);
  document.body.appendChild(opts);
}

function restoreGlassSelectOptions(opts) {
  if (!opts || !opts.__glassSelectOwner) return;
  const owner = opts.__glassSelectOwner;
  const placeholder = opts.__glassSelectPlaceholder;
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.insertBefore(opts, placeholder);
    placeholder.parentNode.removeChild(placeholder);
  }
  owner.__glassSelectOptions = null;
  opts.__glassSelectOwner = null;
  opts.__glassSelectPlaceholder = null;
}

function resetGlassSelectOptions(opts) {
  if (!opts) return;
  opts.style.removeProperty('position');
  opts.style.removeProperty('top');
  opts.style.removeProperty('left');
  opts.style.removeProperty('right');
  opts.style.removeProperty('width');
  opts.style.removeProperty('max-height');
  opts.style.removeProperty('overflow-y');
  opts.style.removeProperty('opacity');
  opts.style.removeProperty('transform');
  opts.style.removeProperty('pointer-events');
  opts.style.removeProperty('transition');
  restoreGlassSelectOptions(opts);
}

function positionGlassSelectOptions(el) {
  const opts = getGlassSelectOptions(el);
  if (!opts) return;

  const r = el.getBoundingClientRect();
  const width = Math.max(r.width, 160);
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

  if (el.closest('.search-box-glass') && !isMobile) {
    // Search bar lives inside a blurred glass container. In Chromium,
    // backdrop-filter can become a containing block for position: fixed,
    // which double-applies the search bar offset on desktop and sends the
    // dropdown off-screen. Keep desktop search dropdowns anchored to their select.
    opts.style.position = 'absolute';
    opts.style.top = 'calc(100% + 10px)';
    opts.style.left = '0';
    opts.style.right = 'auto';
    opts.style.width = width + 'px';
    return;
  }

  if (isMobile && el.closest('.search-box-glass')) {
    portalGlassSelectOptions(el, opts);
  }

  const margin = 8;
  const bottomReserve = isMobile ? 72 : margin;
  const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
  const naturalHeight = opts.scrollHeight || opts.offsetHeight || 240;
  const belowTop = r.bottom + 4;
  const belowSpace = window.innerHeight - bottomReserve - belowTop - margin;
  const aboveSpace = r.top - margin - 4;
  const openAbove = isMobile && belowSpace < Math.min(naturalHeight, 180) && aboveSpace > belowSpace;
  const maxHeight = Math.max(120, Math.min(naturalHeight, openAbove ? aboveSpace : belowSpace));

  opts.style.setProperty('position', 'fixed', 'important');
  opts.style.setProperty('top', (openAbove ? Math.max(margin, r.top - 4 - maxHeight) : belowTop) + 'px', 'important');
  opts.style.setProperty('left', left + 'px', 'important');
  opts.style.setProperty('right', 'auto', 'important');
  opts.style.setProperty('width', width + 'px', 'important');
  opts.style.setProperty('max-height', maxHeight + 'px', 'important');
  opts.style.setProperty('overflow-y', naturalHeight > maxHeight ? 'auto' : 'hidden', 'important');
  opts.style.setProperty('opacity', '1', 'important');
  opts.style.setProperty('transform', 'translateY(0)', 'important');
  opts.style.setProperty('pointer-events', 'auto', 'important');
  opts.style.setProperty('transition', 'none', 'important');
}

function toggleGlassSelect(e, el) {
  e.stopPropagation();
  const isNowActive = !el.classList.contains('active');

  document.querySelectorAll('.glass-select.active').forEach(s => {
    if (s !== el) {
      s.classList.remove('active');
      resetGlassSelectOptions(getGlassSelectOptions(s));
    }
  });

  el.classList.toggle('active', isNowActive);

  if (isNowActive) {
    positionGlassSelectOptions(el);
  } else {
    resetGlassSelectOptions(getGlassSelectOptions(el));
  }
}

function selectGlassOption(e, el, val, callbackName) {
  e.stopPropagation();
  const select = el.closest('.glass-select') || el.parentNode.__glassSelectOwner;
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

  getGlassSelectOptions(select).querySelectorAll('.glass-option').forEach(opt => opt.classList.remove('selected'));
  el.classList.add('selected');
  select.classList.remove('active');
  resetGlassSelectOptions(getGlassSelectOptions(select));

  if (callbackName && typeof window[callbackName] === 'function') {
    window[callbackName]();
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.glass-select').forEach(s => {
    s.classList.remove('active');
    resetGlassSelectOptions(getGlassSelectOptions(s));
  });
});

VRCW.registerModule('uiControls', {
  toggleGlassSelect,
  selectGlassOption,
});
renderAppVersionInfo();
