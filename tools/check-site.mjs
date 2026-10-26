#!/usr/bin/env node
// Static checks for the site: privacy, requests on page load, links, page states, fonts.
// Usage: node tools/check-site.mjs [--root DIR] [--history] [--self-test]
// The private words are read from the file named by NL_PRIVATE_TERMS_FILE and never stored in the repo.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const SITE = 'HTML/';
const HOME = 'DUTCH_Learning.html';
// These keep their own CSS and logic: they link the tokens only, so inline style and script stay allowed.
const OWN_CSS_PAGES = new Set(['dutch_stories.html', 'bouw_learning.html', 'bouw_games.html', 'common_dutch_words_game.html']);
const CLICK_HOSTS = [
  { host: 'www.google.com', path: '/search' },
  { host: 'www.youtube.com', path: '/' },
  { host: 'www.inburgeringonline.nl', path: '/' },
];
const TEXT_EXT = /\.(html|js|mjs|css|md|txt|json)$/i;
const NOREPLY = /^(\d+\+[\w-]+@users\.noreply\.github\.com|noreply@github\.com)$/;
const ATTRIBUTION = /co-authored-by|generated with|\bclaude\b|\banthropic\b/i;
const GENERIC_PRIVATE = [
  [/\b[A-Za-z]:\\/, 'a Windows drive path'],
  [/\/Users\//, 'a /Users/ path'],
  [/onedrive/i, 'a OneDrive reference'],
  [/(?<![\w.+-])[\w.+-]+@(?!users\.noreply\.github\.com)[\w-]+(\.[\w-]+)+/, 'an email address'],
];
const RUNTIME_REQUEST = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|\bimport\s*\(/;
const MIN_PAGES = 20;

const text = (files, path) => files.get(path)?.toString('utf8') ?? '';
const finding = (rule, file, detail) => ({ rule, file, detail });
const attrOf = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};
const isExternal = (url) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^https?:/i.test(url);
const isSkippable = (url) => !url || url.startsWith('#') || /^(mailto:|tel:|data:|javascript:)/i.test(url);

// Resolves a relative URL against the file that contains it and reports whether a tracked file has that exact name.
function resolves(files, fromFile, url) {
  const clean = url.split(/[?#]/)[0];
  if (!clean) return true;
  return files.has(posix.normalize(posix.join(posix.dirname(fromFile), decodeURIComponent(clean))));
}

function checkCss(files, file, css, findings) {
  if (/@import/i.test(css)) findings.push(finding('load-external', file, '@import in CSS'));
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) {
    const url = m[2].trim();
    if (isSkippable(url)) continue;
    if (isExternal(url)) findings.push(finding('load-external', file, `CSS url() to ${url}`));
    else if (!resolves(files, file, url)) findings.push(finding('link-broken', file, `CSS url() ${url} does not match a file`));
  }
}

function checkPage(files, file, html, findings) {
  const name = basename(file);
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [...bare.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], body: m[2] }));
  const styles = [...bare.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const markup = bare.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2').replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');

  const nlRefs = /assets\/nl-(core|tokens|theme|theme-init)\./.test(markup);
  const navTags = scripts.filter((s) => /assets\/site-nav\.js/.test(attrOf(s.attrs, 'src') ?? '')).length;
  const converted = nlRefs;
  const isHome = name === HOME;
  const ownCss = OWN_CSS_PAGES.has(name);

  for (const m of markup.matchAll(/<(link|script|img|iframe|source|base|a)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    const url = attrOf(m[2], tag === 'link' || tag === 'a' || tag === 'base' ? 'href' : 'src');
    const rel = (attrOf(m[2], 'rel') ?? '').toLowerCase();
    if (tag === 'link' && /preconnect|dns-prefetch|prefetch|preload/.test(rel)) findings.push(finding('load-external', file, `link rel=${rel}`));
    if (tag === 'iframe') findings.push(finding('load-external', file, 'iframe'));
    if (url === undefined || isSkippable(url)) continue;
    if (tag === 'a') {
      if (!isExternal(url)) {
        if (!resolves(files, file, url)) findings.push(finding('link-broken', file, `href ${url} does not match a file`));
        continue;
      }
      let u;
      try { u = new URL(url.startsWith('//') ? `https:${url}` : url); } catch { findings.push(finding('anchor-host', file, `unparseable ${url}`)); continue; }
      if (!CLICK_HOSTS.some((h) => u.hostname === h.host && u.pathname.startsWith(h.path))) findings.push(finding('anchor-host', file, `link to ${u.hostname}${u.pathname}`));
      const tokens = new Set((attrOf(m[2], 'rel') ?? '').toLowerCase().split(/\s+/));
      if (converted && !(tokens.has('noopener') && tokens.has('noreferrer'))) findings.push(finding('anchor-rel', file, `external link without rel="noopener noreferrer": ${url.slice(0, 60)}`));
      continue;
    }
    if (isExternal(url)) findings.push(finding('load-external', file, `${tag} loads ${url}`));
    else if (!resolves(files, file, url)) findings.push(finding('link-broken', file, `${tag} ${url} does not match a file`));
  }

  styles.forEach((css) => checkCss(files, file, css, findings));
  for (const s of scripts) if (RUNTIME_REQUEST.test(s.body)) findings.push(finding('runtime-request', file, 'inline script makes a network request'));

  if (isHome && navTags) findings.push(finding('state', file, 'the home page must not carry the old top bar'));
  if (!isHome && converted && navTags) findings.push(finding('state', file, 'page loads both site-nav.js and the new shared files'));
  if (!isHome && !converted && navTags !== 1) findings.push(finding('state', file, `legacy page has ${navTags} site-nav.js tags, expected 1`));
  if (!converted) return;

  const src = (re) => scripts.some((s) => re.test(attrOf(s.attrs, 'src') ?? '')) || re.test(markup);
  if (!src(/assets\/nl-theme-init\.js/)) findings.push(finding('state', file, 'missing nl-theme-init.js'));
  if (!/assets\/nl-tokens\.css/.test(markup)) findings.push(finding('state', file, 'missing nl-tokens.css'));
  if (ownCss) return;
  if (!/assets\/nl-theme\.css/.test(markup)) findings.push(finding('state', file, 'missing nl-theme.css'));
  if (!src(/assets\/nl-core\.js/)) findings.push(finding('state', file, 'missing nl-core.js'));
  if (styles.length || /<style\b/i.test(markup)) findings.push(finding('state', file, 'converted page has an inline <style>'));
  if (scripts.some((s) => !attrOf(s.attrs, 'src') && s.body.trim())) findings.push(finding('state', file, 'converted page has an inline script'));
  if (/\sstyle\s*=/i.test(markup)) findings.push(finding('state', file, 'converted page has a style attribute'));
  if (isHome) return;
  const dataPath = `${dirname(file)}/data/${name.replace(/\.html$/, '.js')}`;
  if (!files.has(dataPath)) { findings.push(finding('state', file, `missing ${dataPath}`)); return; }
  const sandbox = { window: {} };
  try { vm.runInNewContext(text(files, dataPath), sandbox, { timeout: 2000 }); } catch (e) { findings.push(finding('data-file', dataPath, `does not run: ${e.message}`)); return; }
  if (sandbox.window.NL_PAGE?.file !== name) findings.push(finding('file-mismatch', dataPath, `NL_PAGE.file is ${JSON.stringify(sandbox.window.NL_PAGE?.file)}, expected ${name}`));
}

function checkRegistry(files, findings) {
  const core = 'HTML/assets/nl-core.js';
  if (!files.has(core)) return;
  const names = [...text(files, core).matchAll(/\{\s*file:\s*'([^']+)'/g)].map((m) => m[1]);
  const seen = new Set();
  for (const n of names) {
    if (!/^[a-z0-9_]+\.html$/.test(n)) findings.push(finding('registry', core, `bad file name ${n}`));
    if (seen.has(n)) findings.push(finding('registry', core, `duplicate ${n}`));
    seen.add(n);
    if (!files.has(SITE + n)) findings.push(finding('registry', core, `${n} does not match a page`));
  }
  for (const p of files.keys()) {
    const m = /^HTML\/([^/]+\.html)$/.exec(p);
    if (m && m[1] !== HOME && !seen.has(m[1])) findings.push(finding('registry', p, 'page is not in the lesson registry'));
  }
}

function checkFonts(files, findings) {
  const dir = 'HTML/assets/fonts/';
  const fonts = [...files.keys()].filter((p) => p.startsWith(dir) && p.endsWith('.woff2'));
  if (!fonts.length) return;
  const listed = new Map();
  for (const line of text(files, `${dir}SOURCES.txt`).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+(\S+\.woff2)$/.exec(line.trim());
    if (m) listed.set(dir + m[2], m[1]);
  }
  for (const f of fonts) {
    const buf = files.get(f);
    if (!listed.has(f)) findings.push(finding('font-hash', f, 'not listed in SOURCES.txt'));
    else if (createHash('sha256').update(buf).digest('hex') !== listed.get(f)) findings.push(finding('font-hash', f, 'SHA-256 differs from SOURCES.txt'));
    if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') findings.push(finding('font-magic', f, 'does not start with wOF2'));
  }
  for (const f of listed.keys()) if (!files.has(f)) findings.push(finding('font-hash', f, 'listed in SOURCES.txt but missing'));
}

function checkPrivacy(files, terms, findings) {
  for (const [path, buf] of files) {
    if (!TEXT_EXT.test(path)) continue;
    const body = buf.toString('utf8');
    const lower = body.toLowerCase();
    for (const t of terms) if (lower.includes(t.toLowerCase())) findings.push(finding('private-term', path, 'contains a term from the private list'));
    if (path.startsWith('tools/')) continue;
    for (const [re, label] of GENERIC_PRIVATE) if (re.test(body)) findings.push(finding('private-generic', path, `contains ${label}`));
  }
}

export function checkSite(files, { terms = [], minPages = MIN_PAGES } = {}) {
  const findings = [];
  const pages = [...files.keys()].filter((p) => /^HTML\/[^/]+\.html$/.test(p));
  if (pages.length < minPages) findings.push(finding('coverage', SITE, `scanned ${pages.length} pages, expected at least ${minPages}`));
  for (const p of pages) checkPage(files, p, text(files, p), findings);
  for (const [p, buf] of files) {
    if (p.endsWith('.css')) checkCss(files, p, buf.toString('utf8'), findings);
    else if (/^HTML\/(assets|data)\/.+\.js$/.test(p) && RUNTIME_REQUEST.test(buf.toString('utf8')) && p !== 'HTML/assets/nl-core.js') findings.push(finding('runtime-request', p, 'script makes a network request'));
  }
  checkRegistry(files, findings);
  checkFonts(files, findings);
  checkPrivacy(files, terms, findings);
  return findings;
}

export function checkCommits(commits, terms = []) {
  const findings = [];
  for (const c of commits) {
    for (const e of [c.authorEmail, c.committerEmail]) if (!NOREPLY.test(e)) findings.push(finding('commit-identity', c.sha.slice(0, 7), `identity ${e}`));
    if (ATTRIBUTION.test(c.message)) findings.push(finding('commit-attribution', c.sha.slice(0, 7), 'message carries an attribution line'));
    const hay = `${c.message}\n${c.added}`.toLowerCase();
    for (const t of terms) if (hay.includes(t.toLowerCase())) findings.push(finding('private-history', c.sha.slice(0, 7), 'commit adds a term from the private list'));
  }
  return findings;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
}

function collect(root) {
  const files = new Map();
  let names;
  try { names = git(root, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean); } catch {
    names = [];
    const walk = (d) => { for (const e of readdirSync(join(root, d), { withFileTypes: true })) { if (e.name === '.git') continue; const rel = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) walk(rel); else names.push(rel); } };
    walk('');
  }
  for (const n of names) { const p = join(root, n); if (existsSync(p) && statSync(p).isFile()) files.set(n, readFileSync(p)); }
  return files;
}

function readCommits(root) {
  const out = git(root, ['log', 'origin/main..HEAD', '--format=%x1e%H%x1f%ae%x1f%ce%x1f%B%x1f', '-p']);
  return out.split('\x1e').filter(Boolean).map((chunk) => {
    const [sha, authorEmail, committerEmail, message, patch = ''] = chunk.split('\x1f');
    const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    return { sha, authorEmail, committerEmail, message, added };
  });
}

function loadTerms() {
  const file = process.env.NL_PRIVATE_TERMS_FILE;
  if (!file) throw new Error('NL_PRIVATE_TERMS_FILE is not set; point it at the private word list kept outside the repo');
  return readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function fixture() {
  const enc = (s) => Buffer.from(s, 'utf8');
  const font = Buffer.concat([enc('wOF2'), enc('font-bytes')]);
  const head = (extra = '') => `<!doctype html><html><head><meta charset="utf-8"><script src="assets/nl-theme-init.js"></script><link rel="stylesheet" href="assets/nl-tokens.css"><link rel="stylesheet" href="assets/nl-theme.css">${extra}</head>`;
  const files = new Map([
    ['HTML/DUTCH_Learning.html', enc(`${head()}<body><a href="a_page.html">A</a><a href="b_page.html">B</a><script src="assets/nl-core.js"></script></body></html>`)],
    ['HTML/a_page.html', enc('<!doctype html><html><head><meta charset="utf-8"></head><body><a href="DUTCH_Learning.html">home</a><script src="assets/site-nav.js"></script></body></html>')],
    ['HTML/b_page.html', enc(`${head()}<body><main id="app"></main><script src="data/b_page.js"></script><script src="assets/nl-core.js"></script></body></html>`)],
    ['HTML/data/b_page.js', enc("window.NL_PAGE = { file: 'b_page.html', groups: [] };")],
    ['HTML/assets/site-nav.js', enc('(function () {})();')],
    ['HTML/assets/nl-theme-init.js', enc('(function () {})();')],
    ['HTML/assets/nl-core.js', enc("NL.LESSONS = [ { file: 'a_page.html' }, { file: 'b_page.html' } ];")],
    ['HTML/assets/nl-tokens.css', enc("@font-face { font-family: X; src: url(fonts/x.woff2) format('woff2'); }")],
    ['HTML/assets/nl-theme.css', enc('body { margin: 0; }')],
    ['HTML/assets/fonts/x.woff2', font],
    ['HTML/assets/fonts/SOURCES.txt', enc(`${createHash('sha256').update(font).digest('hex')}  x.woff2\n`)],
    ['README.md', enc('# Fixture\n')],
  ]);
  return files;
}

const set = (files, path, fn) => { const next = new Map(files); next.set(path, Buffer.from(fn(text(files, path)), 'utf8')); return next; };
const without = (files, path) => { const next = new Map(files); next.delete(path); return next; };

export function selfTest() {
  const opts = { terms: ['zzprivate'], minPages: 3 };
  const cases = [
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<head>', '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">'))],
    ['load-external', (f) => set(f, 'HTML/assets/nl-theme.css', () => "@import url('https://fonts.googleapis.com/css2');")],
    ['load-external', (f) => set(f, 'HTML/assets/nl-tokens.css', () => 'body { background: url(https://example.com/x.png); }')],
    ['anchor-host', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<main', '<a href="https://evil.example/x" rel="noopener noreferrer">x</a><main'))],
    ['anchor-rel', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<main', '<a href="https://www.google.com/search?q=x">x</a><main'))],
    ['link-broken', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('DUTCH_Learning.html', 'missing.html'))],
    ['link-broken', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('DUTCH_Learning.html', 'dutch_learning.html'))],
    ['link-broken', (f) => set(f, 'HTML/assets/nl-tokens.css', (t) => t.replace('x.woff2', 'y.woff2'))],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('</body>', '<script src="assets/site-nav.js"></script></body>'))],
    ['state', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<script src="assets/site-nav.js"></script>', ''))],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<link rel="stylesheet" href="assets/nl-theme.css">', ''))],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<main', '<style>a{}</style><main'))],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<main', '<script>var x = 1;</script><main'))],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<main', '<main style="color:red"'))],
    ['file-mismatch', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace('b_page.html', 'a_page.html'))],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', (t) => t.replace('b_page.html', 'B_page.html'))],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', (t) => t.replace(", { file: 'b_page.html' }", ''))],
    ['font-hash', (f) => { const n = new Map(f); n.set('HTML/assets/fonts/x.woff2', Buffer.from('wOF2changed')); return n; }],
    ['font-hash', (f) => { const n = new Map(f); n.set('HTML/assets/fonts/extra.woff2', Buffer.from('wOF2extra')); return n; }],
    ['font-magic', (f) => { const bad = Buffer.from('XXXXfont'); const n = new Map(f); n.set('HTML/assets/fonts/x.woff2', bad); n.set('HTML/assets/fonts/SOURCES.txt', Buffer.from(`${createHash('sha256').update(bad).digest('hex')}  x.woff2\n`)); return n; }],
    ['private-term', (f) => set(f, 'README.md', (t) => `${t}ZZPrivate\n`)],
    ['private-generic', (f) => set(f, 'README.md', (t) => `${t}C:\\Users\\someone\n`)],
    ['private-generic', (f) => set(f, 'README.md', (t) => `${t}mail me at someone@example.com\n`)],
    ['runtime-request', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('</body>', '<script>fetch("x")</script></body>'))],
    ['coverage', (f) => without(without(f, 'HTML/a_page.html'), 'HTML/b_page.html')],
  ];
  const failures = [];
  const clean = checkSite(fixture(), opts);
  if (clean.length) failures.push(`clean fixture reports: ${JSON.stringify(clean)}`);
  for (const [rule, mutate] of cases) {
    const found = checkSite(mutate(fixture()), opts);
    if (!found.some((f) => f.rule === rule)) failures.push(`rule ${rule} did not fire (found: ${found.map((f) => f.rule).join(',') || 'nothing'})`);
  }
  const good = { sha: 'a'.repeat(40), authorEmail: '1+me@users.noreply.github.com', committerEmail: 'noreply@github.com', message: 'fix: x', added: '' };
  if (checkCommits([good], opts.terms).length) failures.push('a clean commit was rejected');
  const bad = [
    ['commit-identity', { ...good, authorEmail: 'me@example.com' }],
    ['commit-attribution', { ...good, message: 'fix: x\n\nCo-authored-by: someone' }],
    ['private-history', { ...good, added: 'a line with ZZPRIVATE inside' }],
  ];
  for (const [rule, commit] of bad) if (!checkCommits([commit], opts.terms).some((f) => f.rule === rule)) failures.push(`commit rule ${rule} did not fire`);
  return { cases: cases.length + bad.length + 1, failures };
}

function main() {
  const args = process.argv.slice(2);
  const out = (s) => process.stdout.write(`${s}\n`);
  if (args.includes('--self-test')) {
    const r = selfTest();
    out(r.failures.length ? r.failures.map((f) => `FAIL ${f}`).join('\n') : `self-test: ${r.cases} cases, every rule fires and the clean fixture passes`);
    process.exitCode = r.failures.length ? 1 : 0;
    return;
  }
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? args[rootIdx + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
  let terms;
  try { terms = loadTerms(); } catch (e) { out(`check-site: ${e.message}`); process.exitCode = 1; return; }
  const files = collect(root);
  const findings = checkSite(files, { terms });
  if (args.includes('--history')) findings.push(...checkCommits(readCommits(root), terms));
  for (const f of findings) out(`FAIL ${f.rule}  ${f.file}  ${f.detail}`);
  out(findings.length ? `check-site: ${findings.length} problem(s)` : `check-site: ok (${files.size} files)`);
  process.exitCode = findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
