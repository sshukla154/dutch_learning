import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeDocument, walk } from './fake-dom.mjs';

const read = (name) => readFileSync(new URL(`../HTML/assets/${name}`, import.meta.url), 'utf8');
const storage = { getItem: () => null, setItem() {} };

// Runs the shared script and the page builder against a fake page and returns the #app element.
function build(page, flash, prepare) {
  const document = fakeDocument();
  if (prepare) prepare(document);
  const sandbox = { document, localStorage: storage };
  sandbox.window = sandbox;
  sandbox.NL_PAGE = page;
  vm.runInNewContext(read('nl-core.js'), sandbox);
  if (flash !== undefined) sandbox.NL.LESSONS.find((l) => l.file === page.file).flash = flash;
  vm.runInNewContext(read('nl-page.js'), sandbox);
  return document.getElementById('app');
}

const word = (nl, en) => ({ nl, en });
const classes = (app, name) => walk(app).filter((n) => n.attrs.class === name);

test('a one-group page has no section chips and no stray text between the blocks', () => {
  const app = build({ file: 'greetings_learning.html', groups: [{ title: 'Woorden', en: 'Words', words: [word('Hoi', 'Hi'), word('Hallo', 'Hello')] }] });
  assert.ok(app.children.every((c) => c !== null && typeof c === 'object'), 'every child is an element');
  assert.equal(classes(app, 'chips').length, 0);
  assert.equal(classes(app, 'panel').length, 1);
  assert.equal(classes(app, 'word').length, 2);
});

test('a page with several groups gets one chip and one panel per group', () => {
  const app = build({ file: 'greetings_learning.html', groups: [
    { title: 'Een', en: 'One', words: [word('a', 'a1'), word('b', 'b1')] },
    { title: 'Twee', en: 'Two', fact: 'A fact', words: [word('c', 'c1')] },
  ] });
  const [nav] = classes(app, 'chips');
  assert.deepEqual(nav.children.map((a) => [a.attrs.href, a.text]), [['#g0', 'Een'], ['#g1', 'Twee']]);
  assert.deepEqual(classes(app, 'panel').map((p) => p.attrs.id), ['g0', 'g1']);
  assert.equal(classes(app, 'fact').length, 1);
});

test('flashcards need more than one word, and the tip is shown with its label', () => {
  const one = build({ file: 'greetings_learning.html', groups: [{ title: 'T', en: 'T', words: [word('a', 'b')] }] });
  assert.equal(classes(one, 'flash').length, 0);
  const two = build({ file: 'greetings_learning.html', tip: 'Say it aloud', groups: [{ title: 'T', en: 'T', words: [word('a', 'b'), word('c', 'd')] }] });
  assert.equal(classes(two, 'flash').length, 1);
  const [tip] = classes(two, 'tip');
  assert.deepEqual(tip.children.map((c) => (typeof c === 'string' ? c : c.text)), ['Tip: ', 'Say it aloud']);
});

test('notes follow the tip, each with its label, and several lines stay separate', () => {
  const app = build({
    file: 'greetings_learning.html',
    tip: 'First',
    notes: [{ label: 'Voorbeelden', text: ['1 + 1 = 2', '2 + 2 = 4'] }, { label: 'Let op', text: 'Single line' }],
    groups: [{ title: 'T', en: 'T', words: [word('a', 'b'), word('c', 'd')] }],
  });
  const shown = classes(app, 'tip').map((p) => p.children.map((c) => (typeof c === 'string' ? c : c.text)));
  assert.deepEqual(shown, [['Tip: ', 'First'], ['Voorbeelden: ', '1 + 1 = 2', '2 + 2 = 4'], ['Let op: ', 'Single line']]);
  assert.deepEqual(classes(app, 'tip-line').map((n) => n.text), ['1 + 1 = 2', '2 + 2 = 4']);
});

test('a note about a missing Dutch voice is part of every lesson page, hidden by CSS until it applies', () => {
  const app = build({ file: 'greetings_learning.html', groups: [{ title: 'T', en: 'T', words: [word('a', 'b'), word('c', 'd')] }] });
  const [note] = classes(app, 'voice-note');
  assert.equal(note.attrs.role, 'note');
  assert.match(note.text, /Nederlandse stem/);
});

test('the Flashcards link follows the lesson flag, not the page content', () => {
  const page = { file: 'greetings_learning.html', groups: [{ title: 'T', en: 'T', words: [word('a', 'b'), word('c', 'd')] }] };
  const linkTexts = (flash) => walk(build(page, flash)).filter((n) => n.tag === 'a').map((a) => a.text);
  assert.ok(linkTexts(true).includes('Flashcards'));
  assert.ok(!linkTexts(false).includes('Flashcards'));
});

test('a reference page keeps the written content of its shell and gains the header around it', () => {
  const content = { tag: 'div', attrs: { id: 'content' }, children: ['written text'], text: '' };
  const app = build({ file: 'dutch_grammar.html', content: true, groups: [] }, undefined, (document) => { document.ids.content = content; });
  assert.ok(app.children.includes(content), 'the content element is part of the page');
  assert.ok(app.children.every((c) => c !== null && typeof c === 'object'));
  assert.equal(classes(app, 'lesson-head').length, 1);
  assert.equal(classes(app, 'chips').length, 0);
  assert.equal(classes(app, 'split').length, 0);
  assert.equal(classes(app, 'flash').length, 0);
  assert.equal(app.children.indexOf(content), app.children.length - 1 - 0, 'the content comes after the header');
});

test('a page whose data is broken or unknown shows a message with a way back instead of staying blank', () => {
  const broken = [
    [undefined, 'no data'],
    [{ file: 'nope.html', groups: [] }, 'unknown lesson'],
    [{ file: 'greetings_learning.html', groups: [{ title: 'T', en: 'T', words: [{ nl: 'a', en: 'b', tags: 'land' }] }], reveal: true, practice: { unit: 'Woorden' } }, 'a tag list that is not a list'],
  ];
  for (const [page, why] of broken) {
    const document = fakeDocument();
    const sandbox = { document, localStorage: storage, console: { error() {} } };
    sandbox.window = sandbox;
    sandbox.NL_PAGE = page;
    vm.runInNewContext(read('nl-core.js'), sandbox);
    vm.runInNewContext(read('nl-practice.js'), sandbox);
    vm.runInNewContext(read('nl-page.js'), sandbox);
    const app = document.getElementById('app');
    assert.equal(classes(app, 'empty').length, 1, why);
    assert.equal(classes(app, 'empty')[0].attrs.role, 'alert', why);
    assert.ok(walk(app).some((n) => n.tag === 'a' && n.attrs.href === 'DUTCH_Learning.html'), why);
  }
});
