import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeDocument, walk, byClass } from './fake-dom.mjs';
import { coreSource, memoryStorage } from './load-core.mjs';

const practiceSource = readFileSync(process.env.NL_PRACTICE_PATH ?? new URL('../HTML/assets/nl-practice.js', import.meta.url), 'utf8');

const SENTENCES = [
  { nl: 'Ik werk vandaag.', en: 'I work today.', pron: 'ik vehrk fahn-dahkh', tags: ['werken', 'werk'] },
  { nl: 'Ik eet brood.', en: 'I eat bread.', pron: 'ik ayt broht', tags: ['eten', 'brood'] },
  { nl: 'Zij werkt hier.', en: 'She works here.', pron: 'zay vehrkt heer', tags: ['werken', 'werk'] },
];
const group = (words, extra = {}) => ({ title: 'Zinnen', en: 'Sentences', words, ...extra });

function start(groups = [group(SENTENCES)], opts = { search: true }) {
  const document = fakeDocument();
  const sandbox = { localStorage: memoryStorage(), document, window: {} };
  vm.runInNewContext(coreSource, sandbox);
  vm.runInNewContext(practiceSource, sandbox);
  const host = document.createElement('div');
  sandbox.window.NL.practice(host, groups, opts);
  return host;
}
const rows = (host) => byClass(host, 'practice-row');
const nlText = (row) => byClass(row, 'practice-nl')[0];
const pronText = (row) => byClass(row, 'practice-pron')[0];
const revealButton = (row, index) => byClass(row, 'reveal')[index];
const control = (host, label) => walk(host).find((n) => n.tag === 'button' && n.text === label);
const stat = (panel, label) => byClass(panel, 'practice-stats')[0].children.find((s) => s.children[0] === `${label}: `).children[1].text;
const type = (input, value) => { input.value = value; input.listeners.input.forEach((fn) => fn({ target: input })); };
const visible = (host) => rows(host).filter((r) => !r.hidden).length;
const numbered = (n) => Array.from({ length: n }, (_, i) => ({ nl: `Woord ${i + 1}`, en: `Word ${i + 1}`, pron: `pron ${i + 1}` }));

test('every sentence starts with the English visible and the Dutch and pronunciation hidden', () => {
  const host = start();
  assert.equal(rows(host).length, 3);
  for (const row of rows(host)) {
    assert.equal(nlText(row).hidden, true);
    assert.equal(pronText(row).hidden, true);
    assert.equal(revealButton(row, 0).text, 'Toon Nederlands');
    assert.equal(revealButton(row, 0).attrs['aria-expanded'], 'false');
  }
  assert.deepEqual(rows(host).map((r) => byClass(r, 'practice-en')[0].text), SENTENCES.map((s) => s.en));
});

test('a reveal button shows its own answer, says so, and hides it again', () => {
  const host = start();
  const [first, second] = rows(host);
  revealButton(first, 0).click();
  assert.equal(nlText(first).hidden, false);
  assert.equal(nlText(first).text, 'Ik werk vandaag.');
  assert.equal(pronText(first).hidden, true, 'the pronunciation stays hidden');
  assert.equal(nlText(second).hidden, true, 'another sentence is not touched');
  assert.equal(revealButton(first, 0).text, 'Verberg Nederlands');
  assert.equal(revealButton(first, 0).attrs['aria-expanded'], 'true');
  revealButton(first, 0).click();
  assert.equal(nlText(first).hidden, true);
  assert.equal(revealButton(first, 0).attrs['aria-expanded'], 'false');
});

test('the group buttons reveal and hide everything, only the Dutch, or only the pronunciation, and the row buttons follow', () => {
  const host = start();
  control(host, 'Toon Nederlands').click();
  assert.ok(rows(host).every((r) => !nlText(r).hidden && pronText(r).hidden));
  assert.ok(rows(host).every((r) => revealButton(r, 0).text === 'Verberg Nederlands' && revealButton(r, 1).text === 'Toon uitspraak'));
  control(host, 'Toon uitspraak').click();
  assert.ok(rows(host).every((r) => !nlText(r).hidden && !pronText(r).hidden));
  control(host, 'Verberg Nederlands').click();
  assert.ok(rows(host).every((r) => nlText(r).hidden && !pronText(r).hidden));
  control(host, 'Verberg uitspraak').click();
  control(host, 'Toon alles').click();
  assert.ok(rows(host).every((r) => !nlText(r).hidden && !pronText(r).hidden));
  control(host, 'Verberg alles').click();
  assert.ok(rows(host).every((r) => nlText(r).hidden && pronText(r).hidden && revealButton(r, 0).attrs['aria-expanded'] === 'false'));
});

test('the counters follow the reveals: rows fully revealed, and the share of all answers shown', () => {
  const host = start();
  const [panel] = byClass(host, 'practice');
  assert.deepEqual([stat(panel, 'Zinnen'), stat(panel, 'Onthuld'), stat(panel, 'Voortgang')], ['3', '0', '0%']);
  revealButton(rows(host)[0], 0).click();
  assert.deepEqual([stat(panel, 'Onthuld'), stat(panel, 'Voortgang')], ['0', '17%'], 'one answer of six is 17% and no sentence is complete');
  revealButton(rows(host)[0], 1).click();
  assert.deepEqual([stat(panel, 'Onthuld'), stat(panel, 'Voortgang')], ['1', '33%']);
  control(host, 'Toon alles').click();
  assert.deepEqual([stat(panel, 'Onthuld'), stat(panel, 'Voortgang')], ['3', '100%']);
  assert.equal(byClass(host, 'track-fill')[0].style.width, '100%');
  control(host, 'Verberg alles').click();
  assert.deepEqual([stat(panel, 'Onthuld'), stat(panel, 'Voortgang')], ['0', '0%']);
  assert.equal(byClass(host, 'track-fill')[0].style.width, '0%');
});

test('each group is its own panel with its own counters, controls and anchor', () => {
  const host = start([group(SENTENCES.slice(0, 2), { title: 'Eerste' }), group(SENTENCES.slice(2), { title: 'Tweede' })]);
  const panels = byClass(host, 'practice');
  assert.deepEqual(panels.map((p) => p.attrs.id), ['g0', 'g1']);
  assert.deepEqual(panels.map((p) => byClass(p, 'panel-label')[0].children[0].text), ['Eerste · Sentences', 'Tweede · Sentences']);
  control(panels[1], 'Toon alles').click();
  assert.deepEqual([stat(panels[0], 'Onthuld'), stat(panels[1], 'Onthuld')], ['0', '1']);
  assert.ok(rows(panels[0]).every((r) => nlText(r).hidden));
});

test('search looks at the English, the hidden Dutch, the pronunciation and the labels, and says when nothing matches', () => {
  const host = start();
  const [input] = walk(host).filter((n) => n.tag === 'input');
  const [empty] = byClass(host, 'empty');
  assert.equal(empty.hidden, true);
  type(input, 'bread');
  assert.equal(visible(host), 1);
  type(input, 'WERKT');
  assert.equal(visible(host), 1, 'the Dutch is searched while it is still hidden');
  type(input, 'broht');
  assert.equal(visible(host), 1, 'so is the pronunciation');
  type(input, 'werken');
  assert.equal(visible(host), 2, 'and the labels');
  type(input, 'zzz');
  assert.equal(visible(host), 0);
  assert.equal(empty.hidden, false);
  type(input, '  ');
  assert.equal(visible(host), 3);
  assert.equal(empty.hidden, true);
});

test('a page without search has no search box', () => {
  assert.equal(walk(start([group(SENTENCES)], {})).filter((n) => n.tag === 'input').length, 0);
});

test('labels name what they are and a count of distinct values can be shown', () => {
  const host = start([group(SENTENCES)], { tagLabels: ['Werkwoord', 'Zelfstandig naamwoord'], unique: { index: 0, label: 'Unieke werkwoorden' } });
  assert.deepEqual(byClass(rows(host)[1], 'tag').map((t) => t.text), ['Werkwoord: eten', 'Zelfstandig naamwoord: brood']);
  assert.equal(stat(byClass(host, 'practice')[0], 'Unieke werkwoorden'), '2');
});

test('the rows can be called something else than sentences', () => {
  const host = start([group(numbered(3))], { unit: 'Woorden' });
  assert.equal(stat(byClass(host, 'practice')[0], 'Woorden'), '3');
});

test('each row can be listened to, and a row without a pronunciation has one reveal button and still reaches 100%', () => {
  const host = start([group([{ nl: 'Hallo.', en: 'Hello.' }, SENTENCES[0]])]);
  const [bare, full] = rows(host);
  const [panel] = byClass(host, 'practice');
  assert.equal(byClass(bare, 'play')[0].attrs['data-say'], 'Hallo.');
  assert.equal(byClass(bare, 'reveal').length, 1);
  assert.equal(byClass(full, 'reveal').length, 2);
  control(host, 'Toon alles').click();
  assert.equal(nlText(bare).hidden, false);
  assert.deepEqual([stat(panel, 'Onthuld'), stat(panel, 'Voortgang')], ['2', '100%']);
});

test('together mode: one button per row shows or hides the Dutch and the pronunciation at once', () => {
  const host = start([group(SENTENCES)], { together: true });
  const [row] = rows(host);
  const [panel] = byClass(host, 'practice');
  assert.equal(byClass(row, 'reveal').length, 1);
  assert.equal(revealButton(row, 0).text, 'Toon antwoord');
  revealButton(row, 0).click();
  assert.ok(!nlText(row).hidden && !pronText(row).hidden);
  assert.equal(revealButton(row, 0).text, 'Verberg antwoord');
  assert.deepEqual([stat(panel, 'Onthuld'), stat(panel, 'Voortgang')], ['1', '33%']);
  assert.equal(walk(host).filter((n) => n.tag === 'button' && n.text === 'Toon uitspraak').length, 0);
  control(host, 'Verberg alles').click();
  assert.ok(nlText(row).hidden && pronText(row).hidden);
  assert.equal(revealButton(row, 0).text, 'Toon antwoord');
});

test('a long list shows 50 rows at a time and offers more, a short one shows everything', () => {
  const host = start([group(numbered(120))], { search: true });
  const [more] = walk(host).filter((n) => n.tag === 'button' && String(n.text).startsWith('Toon meer'));
  assert.equal(visible(host), 50);
  assert.equal(more.hidden, false);
  assert.equal(more.text, 'Toon meer (nog 70)');
  more.click();
  assert.equal(visible(host), 100);
  assert.equal(more.text, 'Toon meer (nog 20)');
  more.click();
  assert.equal(visible(host), 120);
  assert.equal(more.hidden, true);

  const short = start([group(numbered(60))]);
  assert.equal(visible(short), 60);
  assert.equal(walk(short).find((n) => String(n.text).startsWith('Toon meer')).hidden, true);
});

test('searching a long list pages the matches and starts again at the first page', () => {
  const host = start([group(numbered(120))], { search: true });
  const [input] = walk(host).filter((n) => n.tag === 'input');
  const more = walk(host).find((n) => String(n.text).startsWith('Toon meer'));
  more.click();
  assert.equal(visible(host), 100);
  type(input, 'woord');
  assert.equal(visible(host), 50, 'a new search goes back to the first 50 matches');
  assert.equal(more.text, 'Toon meer (nog 70)');
  type(input, 'woord 11');
  assert.equal(visible(host), 11, 'ten from 110 to 119 and word 11 itself');
  assert.equal(more.hidden, true);
  assert.equal(byClass(host, 'empty')[0].hidden, true);
});

test('notes of a group sit under its heading', () => {
  const host = start([group(SENTENCES, { notes: [{ label: 'Tip', text: 'Say it aloud' }] })]);
  const [tip] = byClass(host, 'tip');
  assert.equal(tip.children[0].text, 'Tip: ');
  assert.equal(tip.children[1], 'Say it aloud');
});
