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
const RUNTIME_REQUEST = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|\bimport\s*\(|\bnew\s+Image\b|\bEventSource\b|createElement\(\s*['"](?:script|iframe|img|link|embed|object)['"]/;
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
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { return false; }
  return files.has(posix.normalize(posix.join(posix.dirname(fromFile), decoded)));
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

// An element opening tag; quoted attribute values may contain ">".
const TAG = /<([a-z][a-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const URL_ATTRS = ['src', 'srcset', 'poster', 'data', 'href', 'xlink:href', 'action', 'formaction'];
const LOADING_REL = /(?:^|\s)(?:stylesheet|icon|apple-touch-icon|preload|prefetch|modulepreload|preconnect|dns-prefetch|manifest)(?:\s|$)/;

function urlsOf(attrs) {
  const urls = [];
  for (const name of URL_ATTRS) {
    const value = attrOf(attrs, name);
    if (value === undefined) continue;
    if (name === 'srcset') urls.push(...value.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean));
    else urls.push(value);
  }
  return urls;
}

function checkAnchor(files, file, attrs, converted, findings) {
  const url = attrOf(attrs, 'href');
  if (url === undefined) return;
  if (/^\s*javascript:/i.test(url)) { findings.push(finding('anchor-host', file, 'javascript: link')); return; }
  if (isSkippable(url)) return;
  if (!isExternal(url)) {
    if (!resolves(files, file, url)) findings.push(finding('link-broken', file, `href ${url} does not match a file`));
    return;
  }
  let u;
  try { u = new URL(url.startsWith('//') ? `https:${url}` : url); } catch { findings.push(finding('anchor-host', file, `unparseable ${url}`)); return; }
  if (!CLICK_HOSTS.some((h) => u.hostname === h.host && u.pathname.startsWith(h.path))) findings.push(finding('anchor-host', file, `link to ${u.hostname}${u.pathname}`));
  const tokens = new Set((attrOf(attrs, 'rel') ?? '').toLowerCase().split(/\s+/));
  if (converted && !(tokens.has('noopener') && tokens.has('noreferrer'))) findings.push(finding('anchor-rel', file, `external link without rel="noopener noreferrer": ${url.slice(0, 60)}`));
}

// A refresh to a page on this site is a redirect; a refresh anywhere else leaves the site without a click.
function checkRefresh(files, file, content, findings) {
  const target = /url\s*=\s*['"]?([^'";]+)/i.exec(content)?.[1]?.trim();
  if (!target) return;
  if (isExternal(target) || /^\s*javascript:/i.test(target)) findings.push(finding('load-external', file, `meta refresh to ${target}`));
  else if (!resolves(files, file, target)) findings.push(finding('link-broken', file, `meta refresh ${target} does not match a file`));
}

function checkPage(files, file, html, findings, { site = true } = {}) {
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

  for (const m of markup.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const rel = (attrOf(attrs, 'rel') ?? '').toLowerCase();
    if (tag === 'iframe' || tag === 'frame') findings.push(finding('load-external', file, tag));
    if (tag === 'meta' && /refresh/i.test(attrOf(attrs, 'http-equiv') ?? '')) checkRefresh(files, file, attrOf(attrs, 'content') ?? '', findings);
    const style = attrOf(attrs, 'style');
    if (style) checkCss(files, file, style, findings);
    if (tag === 'a') { checkAnchor(files, file, attrs, converted, findings); continue; }
    if (tag === 'link' && /preconnect|dns-prefetch|prefetch|preload/.test(rel)) findings.push(finding('load-external', file, `link rel=${rel}`));
    // A canonical or alternate link names another address but loads nothing.
    if (tag === 'link' && !LOADING_REL.test(rel)) continue;
    for (const url of urlsOf(attrs)) {
      if (isSkippable(url)) continue;
      if (isExternal(url)) findings.push(finding('load-external', file, `${tag} loads ${url}`));
      else if (!resolves(files, file, url)) findings.push(finding('link-broken', file, `${tag} ${url} does not match a file`));
    }
  }

  styles.forEach((css) => checkCss(files, file, css, findings));
  for (const s of scripts) if (RUNTIME_REQUEST.test(s.body)) findings.push(finding('runtime-request', file, 'inline script makes a network request'));
  if (!site) return;

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
  if (!src(/assets\/nl-page\.js/)) findings.push(finding('state', file, 'missing nl-page.js'));
  const dataPath =`${dirname(file)}/data/${name.replace(/\.html$/, '.js')}`;
  if (!files.has(dataPath)) { findings.push(finding('state', file, `missing ${dataPath}`)); return; }
  const sandbox = { window: {} };
  try { vm.runInNewContext(text(files, dataPath), sandbox, { timeout: 2000 }); } catch (e) { findings.push(finding('data-file', dataPath, `does not run: ${e.message}`)); return; }
  const data = sandbox.window.NL_PAGE;
  if (data?.file !== name) findings.push(finding('file-mismatch', dataPath, `NL_PAGE.file is ${JSON.stringify(data?.file)}, expected ${name}`));
  const symbolIds = new Set([...markup.matchAll(/<symbol\b[^>]*\sid\s*=\s*["']s-([a-z0-9-]+)["']/gi)].map((m) => m[1]));
  checkPageData(dataPath, data, findings, symbolIds);
}

// The renderer trusts this shape, so a typo in a data file is caught here instead of on the page.
function checkPageData(path, data, findings, symbolIds) {
  const bad = (detail) => findings.push(finding('data-file', path, detail));
  if (!Array.isArray(data?.groups) || !data.groups.length) { bad('groups must be a non-empty array'); return; }
  data.groups.forEach((g, i) => {
    if (typeof g.title !== 'string' || typeof g.en !== 'string') bad(`group ${i + 1} needs title and en`);
    if (!Array.isArray(g.words) || !g.words.length) { bad(`group ${i + 1} has no words`); return; }
    g.words.forEach((w, k) => {
      if (typeof w?.nl !== 'string' || !w.nl.trim() || typeof w.en !== 'string' || !w.en.trim()) bad(`group ${i + 1} word ${k + 1} needs nl and en`);
      for (const key of ['pron', 'enPron', 'say', 'photo', 'sym', 'icons', 'hintEn', 'hintNl', 'hintSay']) if (w?.[key] !== undefined && typeof w[key] !== 'string') bad(`group ${i + 1} word ${k + 1}: ${key} must be a string`);
      if (w?.shape !== undefined && !(typeof w.shape === 'string' && symbolIds.has(w.shape))) bad(`group ${i + 1} word ${k + 1}: shape ${JSON.stringify(w.shape)} has no symbol in the page`);
      if (w?.tags !== undefined && !(Array.isArray(w.tags) && w.tags.every((t) => typeof t === 'string'))) bad(`group ${i + 1} word ${k + 1}: tags must be a list of strings`);
      if (w?.sound !== undefined && !(typeof w.sound?.label === 'string' && typeof w.sound?.say === 'string')) bad(`group ${i + 1} word ${k + 1}: sound needs a label and a say`);
    });
  });
}

function checkRegistry(files, findings) {
  const core = 'HTML/assets/nl-core.js';
  if (!files.has(core)) {
    const used = [...files.keys()].some((p) => /^HTML\/[^/]+\.html$/.test(p) && /assets\/nl-core\.js/.test(text(files, p)));
    if (used) findings.push(finding('registry', core, 'a page loads nl-core.js but the file is missing'));
    return;
  }
  // The list is read by running the script, the way a browser sees it, not by pattern matching its source.
  const sandbox = { window: {} };
  try { vm.runInNewContext(text(files, core), sandbox, { timeout: 2000 }); } catch (e) { findings.push(finding('registry', core, `does not run: ${e.message}`)); return; }
  const lessons = sandbox.window.NL?.LESSONS;
  if (!Array.isArray(lessons)) { findings.push(finding('registry', core, 'NL.LESSONS is not a list')); return; }
  const names = lessons.map((l) => String(l?.file));
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
  // Pages outside HTML/ (the root redirect) are served too, so they get the same request and link checks.
  for (const p of files.keys()) if (/\.html$/i.test(p) && !pages.includes(p) && !p.startsWith('tools/')) checkPage(files, p, text(files, p), findings, { site: false });
  for (const [p, buf] of files) {
    if (p.endsWith('.css')) checkCss(files, p, buf.toString('utf8'), findings);
    else if (/^HTML\/(assets|data)\/.+\.js$/.test(p) && RUNTIME_REQUEST.test(buf.toString('utf8'))) findings.push(finding('runtime-request', p, 'script makes a network request'));
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
    ['HTML/b_page.html', enc(`${head()}<body><main id="app"></main><script src="data/b_page.js"></script><script src="assets/nl-core.js"></script><script src="assets/nl-page.js"></script></body></html>`)],
    ['HTML/data/b_page.js', enc("window.NL_PAGE = { file: 'b_page.html', groups: [ { title: 'T', en: 'T', words: [ { nl: 'a', en: 'b' } ] } ] };")],
    ['HTML/assets/site-nav.js', enc('(function () {})();')],
    ['HTML/assets/nl-theme-init.js', enc('(function () {})();')],
    ['HTML/assets/nl-page.js', enc('(function () {})();')],
    ['HTML/assets/nl-core.js', enc("window.NL = { LESSONS: [ { file: 'a_page.html' }, { file: 'b_page.html' } ] };")],
    ['index.html', enc('<!doctype html><html><head><meta http-equiv="refresh" content="0; url=HTML/DUTCH_Learning.html"></head><body><a href="HTML/DUTCH_Learning.html">open</a></body></html>')],
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
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<script src="assets/nl-page.js"></script>', ''))],
    ['file-mismatch', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace('b_page.html', 'a_page.html'))],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace('groups: [', 'grups: ['))],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("nl: 'a'", "nl: ''"))],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("en: 'b' }", "en: 'b', photo: 5 }"))],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("{ nl: 'a', en: 'b' }", ''))],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("en: 'b' }", "en: 'b', sym: 5 }")), /sym must be a string/],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("en: 'b' }", "en: 'b', hintNl: 5 }")), /hintNl must be a string/],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("en: 'b' }", "en: 'b', tags: 'land' }")), /tags must be a list of strings/],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("en: 'b' }", "en: 'b', shape: 'zz' }")), /shape "zz" has no symbol in the page/],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', (t) => t.replace("en: 'b' }", "en: 'b', sound: { label: 'x' } }")), /sound needs a label and a say/],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', (t) => t.replace('b_page.html', 'B_page.html')), /bad file name B_page\.html/],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', (t) => t.replace("{ file: 'b_page.html' }", "{ file: 'a_page.html' }")), /duplicate a_page\.html/],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', (t) => t.replace("{ file: 'b_page.html' } ]", "{ file: 'b_page.html' }, { file: 'ghost.html' } ]")), /ghost\.html does not match a page/],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', (t) => t.replace(", { file: 'b_page.html' }", '')), /page is not in the lesson registry/],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', () => 'window.NL = { LESSONS: 5 };'), /not a list/],
    ['registry', (f) => set(f, 'HTML/assets/nl-core.js', () => 'throw new Error("x");'), /does not run/],
    ['registry', (f) => without(f, 'HTML/assets/nl-core.js'), /nl-core\.js but the file is missing/],
    ['load-external', (f) => set(f, 'HTML/assets/nl-theme.css', () => '@import "https://example.com/x.css";'), /@import/],
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<head>', '<head><link rel="preconnect" href="https://example.com">')), /rel=preconnect/],
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><iframe src="DUTCH_Learning.html"></iframe>')), /iframe/],
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><img srcset="a.png 1x, https://example.com/b.png 2x">')), /img loads https:\/\/example\.com\/b\.png/],
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><video poster="https://example.com/p.png"></video>')), /video loads/],
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><object data="https://example.com/o"></object>')), /object loads/],
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><img alt="a>b" src="https://example.com/x.png">')), /img loads/],
    ['load-external', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><div style="background:url(https://example.com/x.png)"></div>')), /CSS url\(\) to/],
    ['load-external', (f) => set(f, 'index.html', (t) => t.replace('url=HTML/DUTCH_Learning.html', 'url=https://example.com/')), /meta refresh to/],
    ['link-broken', (f) => set(f, 'index.html', (t) => t.replace('url=HTML/DUTCH_Learning.html', 'url=HTML/gone.html')), /meta refresh HTML\/gone\.html/],
    ['link-broken', (f) => set(f, 'index.html', (t) => t.replace('<a href="HTML/DUTCH_Learning.html">', '<a href="HTML/gone.html">')), /href HTML\/gone\.html/],
    ['link-broken', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('data/b_page.js', 'data/zz.js')), /script data\/zz\.js/],
    ['link-broken', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('assets/nl-theme.css', 'assets/nl-theme2.css')), /link assets\/nl-theme2\.css/],
    ['link-broken', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><img src="x.png">')), /img x\.png/],
    ['link-broken', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('DUTCH_Learning.html', '100%.html')), /100%\.html/],
    ['anchor-host', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><a href="https://">x</a>')), /unparseable/],
    ['anchor-host', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('<body>', '<body><a href="javascript:alert(1)">x</a>')), /javascript: link/],
    ['state', (f) => set(f, 'HTML/DUTCH_Learning.html', (t) => t.replace('</body>', '<script src="assets/site-nav.js"></script></body>')), /home page must not carry/],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<script src="assets/nl-theme-init.js"></script>', '')), /missing nl-theme-init\.js/],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<link rel="stylesheet" href="assets/nl-tokens.css">', '')), /missing nl-tokens\.css/],
    ['state', (f) => set(f, 'HTML/b_page.html', (t) => t.replace('<script src="assets/nl-core.js"></script>', '')), /missing nl-core\.js/],
    ['state', (f) => without(f, 'HTML/data/b_page.js'), /missing HTML\/data\/b_page\.js/],
    ['data-file', (f) => set(f, 'HTML/data/b_page.js', () => 'throw new Error("x");'), /does not run/],
    ['runtime-request', (f) => set(f, 'HTML/assets/nl-core.js', (t) => `${t}\nfetch("x");`), /script makes a network request/],
    ['runtime-request', (f) => set(f, 'HTML/data/b_page.js', (t) => `${t}\nnew Image().src = "x";`), /network request/],
    ['runtime-request', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('</body>', '<script>new EventSource("x")</script></body>')), /inline script/],
    ['runtime-request', (f) => set(f, 'HTML/a_page.html', (t) => t.replace('</body>', '<script>document.createElement("script")</script></body>')), /inline script/],
    ['font-hash', (f) => set(f, 'HTML/assets/fonts/SOURCES.txt', (t) => `${t}${'0'.repeat(64)}  gone.woff2\n`), /listed in SOURCES\.txt but missing/],
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
  // A case may also name the detail it must produce, so another rule firing on the same mistake cannot hide a dead one.
  for (const [rule, mutate, detail] of cases) {
    const found = checkSite(mutate(fixture()), opts);
    if (!found.some((f) => f.rule === rule && (!detail || detail.test(f.detail)))) failures.push(`rule ${rule}${detail ? ` ${detail}` : ''} did not fire (found: ${found.map((f) => `${f.rule}: ${f.detail}`).join('; ') || 'nothing'})`);
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
