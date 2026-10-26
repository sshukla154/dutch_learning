import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(process.env.NL_TABS_PATH ?? new URL('../HTML/assets/nl-tabs.js', import.meta.url), 'utf8');

// A small page: tabs "articles" and "verbs" in the main list; the "verbs" panel holds a second list with "regular" and "modal".
function page(hash = '') {
  const doc = { activeElement: null, ids: {}, lists: [], allTabs: [] };
  const role = (n) => n.attrs.role;
  const node = (tag, attrs = {}, parent = null) => {
    const n = {
      tag, attrs, dataset: {}, hidden: false, tabIndex: 0, parentElement: parent, kids: [], listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      contains(other) { for (let c = other; c; c = c.parentElement) if (c === this) return true; return false; },
      closest(selector) {
        const wanted = /\[role="(\w+)"\]/.exec(selector)[1];
        for (let c = this; c; c = c.parentElement) if (role(c) === wanted) return c;
        return null;
      },
      querySelectorAll(selector) { return /role="tab"/.test(selector) ? this.kids.filter((k) => role(k) === 'tab') : []; },
      focus() { doc.activeElement = this; },
    };
    parent?.kids.push(n);
    return n;
  };
  const list = (parent) => { const l = node('div', { role: 'tablist' }, parent); doc.lists.push(l); return l; };
  const tab = (l, id, selected) => { const t = node('button', { role: 'tab', 'aria-selected': String(selected) }, l); t.dataset.tab = id; t.tabIndex = selected ? 0 : -1; doc.allTabs.push(t); return t; };
  const panel = (id, parent, hidden) => { const p = node('section', { role: 'tabpanel', id }, parent); p.id = id; p.hidden = hidden; doc.ids[id] = p; return p; };

  const root = node('main');
  const main = list(root);
  const tArticles = tab(main, 'articles', true);
  const tVerbs = tab(main, 'verbs', false);
  const pArticles = panel('articles', root, false);
  const pVerbs = panel('verbs', root, true);
  const sub = list(pVerbs);
  const tRegular = tab(sub, 'regular', true);
  const tModal = tab(sub, 'modal', false);
  const pRegular = panel('regular', pVerbs, false);
  const pModal = panel('modal', pVerbs, true);

  const win = { listeners: {}, addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); } };
  const sandbox = {
    document: {
      get activeElement() { return doc.activeElement; },
      querySelectorAll: (s) => (/tablist/.test(s) ? doc.lists : []),
      querySelector: (s) => { const id = /data-tab="([^"]*)"/.exec(s)?.[1]; return doc.allTabs.find((t) => t.dataset.tab === id) ?? null; },
      getElementById: (id) => doc.ids[id] ?? null,
    },
    CSS: { escape: (s) => s },
    location: { hash },
    window: win,
  };
  vm.runInNewContext(source, sandbox);
  const fire = (target, type, extra = {}) => (target.listeners[type] ?? []).forEach((fn) => fn({ target, preventDefault() { this.prevented = true; }, ...extra }));
  return { doc, sandbox, win, fire, tArticles, tVerbs, tRegular, tModal, pArticles, pVerbs, pRegular, pModal, main, sub };
}
const state = (t) => [t.attrs['aria-selected'], t.tabIndex];

test('a tab shows its panel, hides the others in its list and is the only one reachable by keyboard', () => {
  const p = page();
  p.fire(p.tVerbs, 'click', {});
  p.fire(p.main, 'click', { target: p.tVerbs });
  assert.deepEqual([state(p.tArticles), state(p.tVerbs)], [['false', -1], ['true', 0]]);
  assert.deepEqual([p.pArticles.hidden, p.pVerbs.hidden], [true, false]);
});

test('a second tab list inside a panel works on its own', () => {
  const p = page();
  p.fire(p.sub, 'click', { target: p.tModal });
  assert.deepEqual([p.pRegular.hidden, p.pModal.hidden], [true, false]);
  assert.deepEqual([p.pArticles.hidden, p.pVerbs.hidden], [false, true], 'the outer list is not touched');
  assert.deepEqual([state(p.tArticles), state(p.tRegular), state(p.tModal)], [['true', 0], ['false', -1], ['true', 0]]);
});

test('arrow keys, Home and End move between tabs, wrap around and move focus', () => {
  const p = page();
  p.doc.activeElement = p.tArticles;
  p.fire(p.main, 'keydown', { key: 'ArrowRight' });
  assert.equal(p.doc.activeElement, p.tVerbs);
  assert.equal(p.pVerbs.hidden, false);
  p.fire(p.main, 'keydown', { key: 'ArrowRight' });
  assert.equal(p.doc.activeElement, p.tArticles, 'wraps from the last to the first');
  p.fire(p.main, 'keydown', { key: 'ArrowLeft' });
  assert.equal(p.doc.activeElement, p.tVerbs, 'and back');
  p.fire(p.main, 'keydown', { key: 'Home' });
  assert.equal(p.doc.activeElement, p.tArticles);
  p.fire(p.main, 'keydown', { key: 'End' });
  assert.equal(p.doc.activeElement, p.tVerbs);
});

test('other keys are left alone, and so is a key pressed outside the tabs', () => {
  const p = page();
  p.doc.activeElement = p.tArticles;
  const seen = [];
  (p.main.listeners.keydown ?? []).forEach((fn) => fn({ key: 'a', preventDefault() { seen.push('prevented'); } }));
  assert.deepEqual(seen, []);
  p.doc.activeElement = null;
  (p.main.listeners.keydown ?? []).forEach((fn) => fn({ key: 'ArrowRight', preventDefault() { seen.push('prevented'); } }));
  assert.deepEqual(seen, []);
  assert.equal(p.pVerbs.hidden, true);
});

test('a link to a panel inside a panel opens both levels', () => {
  const p = page('#modal');
  assert.deepEqual([p.pArticles.hidden, p.pVerbs.hidden, p.pRegular.hidden, p.pModal.hidden], [true, false, true, false]);
  assert.deepEqual([state(p.tVerbs), state(p.tModal)], [['true', 0], ['true', 0]]);
});

test('the address can change after the page loaded, and a bad or unknown one does nothing', () => {
  const p = page();
  p.sandbox.location.hash = '#verbs';
  p.win.listeners.hashchange.forEach((fn) => fn());
  assert.equal(p.pVerbs.hidden, false);
  for (const hash of ['#nope', '#%E0%A4%A', '#']) {
    p.sandbox.location.hash = hash;
    assert.doesNotThrow(() => p.win.listeners.hashchange.forEach((fn) => fn()), hash);
  }
  assert.equal(p.pVerbs.hidden, false, 'the open panel stays open');
});
