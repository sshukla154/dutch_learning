// Just enough of a DOM to see which elements and attributes the shared scripts create.
export function fakeDocument() {
  const node = (tag) => ({
    tag, attrs: {}, children: [], dataset: {}, style: {}, text: '',
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener() {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    set textContent(v) { this.text = String(v); },
    set className(v) { this.attrs.class = v; },
    focus() {},
  });
  const app = node('main');
  return {
    createElement: node,
    documentElement: node('html'),
    getElementById: (id) => (id === 'app' ? app : null),
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

export const walk = (n, out = []) => { out.push(n); for (const c of n.children ?? []) if (typeof c === 'object') walk(c, out); return out; };
