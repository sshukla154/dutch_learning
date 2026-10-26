// Just enough of a DOM to see which elements the shared scripts create, click them and see where focus goes.
export function fakeDocument() {
  const doc = { activeElement: null };
  const node = (tag) => {
    const n = {
      tag, attrs: {}, children: [], dataset: {}, style: {}, text: '', listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      click() { for (const fn of this.listeners.click ?? []) fn({ target: this, preventDefault() {} }); },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      set textContent(v) { this.text = String(v); },
      set className(v) { this.attrs.class = v; },
      focus() { doc.activeElement = this; },
    };
    const classes = () => String(n.attrs.class ?? '').split(/\s+/).filter(Boolean);
    n.classList = {
      add: (c) => { if (!classes().includes(c)) n.attrs.class = [...classes(), c].join(' '); },
      remove: (c) => { n.attrs.class = classes().filter((x) => x !== c).join(' '); },
      toggle: (c, force) => { if (force ?? !classes().includes(c)) n.classList.add(c); else n.classList.remove(c); },
      contains: (c) => classes().includes(c),
    };
    return n;
  };
  const app = node('main');
  Object.assign(doc, {
    createElement: node,
    createElementNS: (ns, tag) => Object.assign(node(tag), { ns }),
    documentElement: node('html'),
    getElementById: (id) => (id === 'app' ? app : null),
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
  });
  return doc;
}

export const walk = (n, out = []) => { out.push(n); for (const c of n.children ?? []) if (c && typeof c === 'object') walk(c, out); return out; };
export const byClass = (root, name) => walk(root).filter((n) => String(n.attrs.class ?? '').split(/\s+/).includes(name));
