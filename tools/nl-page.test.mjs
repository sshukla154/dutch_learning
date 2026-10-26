import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeDocument, walk } from './fake-dom.mjs';

const read = (name) => readFileSync(new URL(`../HTML/assets/${name}`, import.meta.url), 'utf8');
const storage = { getItem: () => null, setItem() {} };

// Runs the shared script and the page builder against a fake page and returns the #app element.
function build(page, flash) {
  const document = fakeDocument();
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
  assert.ok(app.children.every((c) => typeof c === 'object'), 'every child is an element');
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

test('the Flashcards link follows the lesson flag, not the page content', () => {
  const page = { file: 'greetings_learning.html', groups: [{ title: 'T', en: 'T', words: [word('a', 'b'), word('c', 'd')] }] };
  const linkTexts = (flash) => walk(build(page, flash)).filter((n) => n.tag === 'a').map((a) => a.text);
  assert.ok(linkTexts(true).includes('Flashcards'));
  assert.ok(!linkTexts(false).includes('Flashcards'));
});
