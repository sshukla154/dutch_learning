/* Tabs: a tablist of buttons shows the panel each one names and hides the others. Tablists can sit inside panels. */
(function () {
  'use strict';

  const tabsOf = (list) => [...list.querySelectorAll('[role="tab"]')];

  function select(list, tab, focus) {
    tabsOf(list).forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.dataset.tab);
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
  }

  document.querySelectorAll('[role="tablist"]').forEach((list) => {
    list.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab && list.contains(tab)) select(list, tab, false);
    });
    list.addEventListener('keydown', (e) => {
      const tabs = tabsOf(list);
      const at = tabs.indexOf(document.activeElement);
      if (at < 0) return;
      const target = { ArrowRight: tabs[(at + 1) % tabs.length], ArrowLeft: tabs[(at - 1 + tabs.length) % tabs.length], Home: tabs[0], End: tabs[tabs.length - 1] }[e.key];
      if (!target) return;
      e.preventDefault();
      select(list, target, true);
    });
  });

  // A link such as page.html#verbs opens that panel, and the tabs around it.
  function openFromHash() {
    let id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    let panel = id ? document.getElementById(id) : null;
    while (panel) {
      const tab = document.querySelector(`[role="tab"][data-tab="${CSS.escape(panel.id)}"]`);
      if (tab) select(tab.closest('[role="tablist"]'), tab, false);
      panel = panel.parentElement ? panel.parentElement.closest('[role="tabpanel"]') : null;
    }
  }
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
})();
