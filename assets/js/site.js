/* Site behaviour: theme toggle, mobile menu, section fade-in, contact decoding.
   One deferred file, no dependencies. Every init function is idempotent, so a later block
   (or a test) can call it again.  window.Site = { decodeContacts, initMenu, initTheme, initFadeIn }

   Contact markup contract (partials/contact-link.html):
     <span class="js-contact" data-kind="email|phone" data-v="<reversed Base64 of the mailto/tel value>"
           data-d="<reversed Base64 of the text to show; optional>" data-label="<aria-label>">…</span>
*/
(function () {
  'use strict';

  var root = document.documentElement;

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function store(key, value) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
  }

  function stored(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /* -- Theme ------------------------------------------------------------- */
  function syncThemeButtons() {
    var pressed = root.classList.contains('dark') ? 'true' : 'false';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', pressed); });
  }

  function initTheme() {
    document.querySelectorAll('#theme-toggle, [data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('data-theme-toggle', '');
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        var dark = root.classList.toggle('dark');
        store('theme', dark ? 'dark' : 'light');
        syncThemeButtons();
      });
    });
    syncThemeButtons();
    if (!initTheme.watching && window.matchMedia) {
      initTheme.watching = true;
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (stored('theme')) return; // an explicit choice wins over the OS setting
        root.classList.toggle('dark', e.matches);
        syncThemeButtons();
      });
    }
  }

  /* -- Mobile menu ------------------------------------------------------- */
  function initMenu() {
    var btn = document.getElementById('menu-btn');
    var menu = document.getElementById('mobile-menu');
    if (!btn || !menu || btn.dataset.bound) return;
    btn.dataset.bound = '1';

    function setOpen(open, restoreFocus) {
      menu.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      var label = open ? btn.getAttribute('data-label-close') : btn.getAttribute('data-label-open');
      if (label) btn.setAttribute('aria-label', label);
      if (!open && restoreFocus) btn.focus();
    }

    btn.addEventListener('click', function () {
      setOpen(btn.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') setOpen(false, true);
    });
  }

  /* -- Section fade-in ---------------------------------------------------- */
  function initFadeIn() {
    var sections = document.querySelectorAll('section[data-animate]:not([data-fade-bound])');
    if (!sections.length) return;
    var reveal = function (el) { el.classList.add('fade-in-visible'); };
    var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!root.classList.contains('js') || calm || !('IntersectionObserver' in window)) {
      sections.forEach(reveal);
      return;
    }
    // A section reached through a link (#contact, menu, reload on an anchor) is shown at once, without the fade,
    // so the jump never lands on a blank or half-faded section.
    var showTarget = function () {
      var el = null;
      try { el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { /* malformed hash */ }
      var s = el && el.closest('section[data-animate]');
      if (s && !s.classList.contains('fade-in-visible')) { s.style.transition = 'none'; reveal(s); }
    };
    showTarget();
    window.addEventListener('hashchange', showTarget);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { reveal(entry.target); io.unobserve(entry.target); }
      });
    }, { threshold: 0.1 });
    sections.forEach(function (el) { el.setAttribute('data-fade-bound', ''); io.observe(el); });
  }

  /* -- Contact details (decoded in the browser, never in the HTML) -------- */
  function decode(v) {
    try { return atob(v).split('').reverse().join(''); } catch (e) { return ''; }
  }

  function decodeContacts() {
    document.querySelectorAll('.js-contact:not([data-decoded])').forEach(function (el) {
      var value = decode(el.getAttribute('data-v') || '');
      if (!value) return;
      var kind = el.getAttribute('data-kind');
      var a = document.createElement('a');
      a.href = (kind === 'phone' ? 'tel:' : 'mailto:') + value;
      a.textContent = decode(el.getAttribute('data-d') || '') || value;
      var label = el.getAttribute('data-label');
      if (label) a.setAttribute('aria-label', label);
      a.className = el.className.replace('js-contact', '').trim();
      a.setAttribute('data-decoded', '');
      el.replaceWith(a);
    });
  }

  window.Site = { decodeContacts: decodeContacts, initMenu: initMenu, initTheme: initTheme, initFadeIn: initFadeIn };

  onReady(function () {
    initTheme();
    initMenu();
    initFadeIn();
    decodeContacts();
  });
})();

/* == T5 == */
/* Language switcher on the home page: keep the #anchor. partials/lang-switch.html marks the links with
   data-keep-hash there; this copies location.hash onto them (on load, on hashchange and on click), so
   /#experience -> /es/#experience. The link's href in the HTML stays the plain translation URL. */
(function () {
  'use strict';

  function initLangSwitch() {
    document.querySelectorAll('a[data-lang-switch][data-keep-hash]').forEach(function (a) {
      if (a.dataset.hashBound) return;
      a.dataset.hashBound = '1';
      var base = a.getAttribute('href').split('#')[0];
      var sync = function () { a.setAttribute('href', base + location.hash); };
      sync();
      a.addEventListener('click', sync);
      window.addEventListener('hashchange', sync);
    });
  }

  window.Site = window.Site || {};
  window.Site.initLangSwitch = initLangSwitch;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLangSwitch);
  else initLangSwitch();
})();

/* == T7 == */
/* About dialog (partials/about.html): [data-dialog-open="<id>"] opens that <dialog> as a modal. Esc and the
   return of focus to the button are native; [data-dialog-close] and a click on the backdrop close it.
   Without <dialog> support the page gets html.no-dialog and the text is shown inline (site.css). */
(function () {
  'use strict';

  function initDialogs() {
    document.querySelectorAll('[data-dialog-open]').forEach(function (btn) {
      var d = document.getElementById(btn.getAttribute('data-dialog-open'));
      if (!d || btn.dataset.dialogBound) return;
      if (!d.showModal) { document.documentElement.classList.add('no-dialog'); return; }
      btn.dataset.dialogBound = '1';
      btn.addEventListener('click', function () { d.showModal(); });
      d.addEventListener('click', function (e) {
        if (e.target === d || e.target.closest('[data-dialog-close]')) d.close();
      });
    });
  }

  window.Site = window.Site || {};
  window.Site.initDialogs = initDialogs;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDialogs);
  else initDialogs();
})();
