import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// NL_CORE_PATH lets a planted-mistake copy be tested; without it the real script is used.
export const coreSource = readFileSync(process.env.NL_CORE_PATH ?? new URL('../HTML/assets/nl-core.js', import.meta.url), 'utf8');

export const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (Object.hasOwn(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
export const blockedStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

// Runs nl-core.js in a sandbox. `window` is the sandbox itself, as in a browser, so bare globals and window.* agree.
export function loadCore(storage, extra = {}) {
  const sandbox = { localStorage: storage, ...extra };
  sandbox.window = extra.window ?? {};
  vm.runInNewContext(coreSource, sandbox);
  return sandbox.window.NL;
}
