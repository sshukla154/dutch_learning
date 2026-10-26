/* Tabs: a tablist of buttons shows the panel each one names and hides the others. Tablists can sit inside panels. */
(function () {
  'use strict';

  // A tab without a panel (a "coming soon" placeholder) is not one to select.
  const tabsOf = (list) => [...list.querySelectorAll('[role="tab"]')].filter((t) => t.dataset.tab);

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
    // Each tab controls its panel and each panel is named by its tab.
    tabsOf(list).forEach((t) => {
      t.id = t.id || `tab-${t.dataset.tab}`;
      t.setAttribute('aria-controls', t.dataset.tab);
      const panel = document.getElementById(t.dataset.tab);
      if (panel) panel.setAttribute('aria-labelledby', t.id);
    });
    list.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab && tab.dataset.tab && list.contains(tab)) select(list, tab, false);
    });
    list.addEventListener('keydown', (e) => {
      // Browser shortcuts such as Alt+Left keep working.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
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
  function openFromHash(scroll) {
    let id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    const target = id ? document.getElementById(id) : null;
    let panel = target;
    while (panel) {
      const tab = document.querySelector(`[role="tab"][data-tab="${CSS.escape(panel.id)}"]`);
      if (tab) select(tab.closest('[role="tablist"]'), tab, false);
      panel = panel.parentElement ? panel.parentElement.closest('[role="tabpanel"]') : null;
    }
    // On load the browser scrolls to the address by itself; a later change has to be followed.
    if (scroll && target && typeof target.scrollIntoView === 'function') target.scrollIntoView();
  }
  openFromHash(false);
  window.addEventListener('hashchange', () => openFromHash(true));
})();
