import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeDocument, walk } from './fake-dom.mjs';

// NL_CORE_PATH lets a planted-mistake copy be tested; without it the real script is used.
const source = readFileSync(process.env.NL_CORE_PATH ?? new URL('../HTML/assets/nl-core.js', import.meta.url), 'utf8');

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (Object.hasOwn(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const blockedStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

function load(storage, extra = {}) {
  const sandbox = { window: {}, localStorage: storage, ...extra };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.NL;
}

test('the lesson list matches the files and the two tracks', () => {
  const NL = load(memoryStorage());
  assert.equal(NL.LESSONS.length, 23);
  assert.equal(NL.lessonsOf('t1').length, 16);
  assert.equal(NL.lessonsOf('t2').length, 7);
  for (const l of NL.LESSONS) assert.match(l.file, /^[a-z0-9_]+\.html$/);
  assert.equal(new Set(NL.LESSONS.map((l) => l.file)).size, 23);
  assert.ok(NL.LESSONS.some((l) => l.file === 'stationery_learning.html'));
  assert.ok(NL.LESSONS.some((l) => l.file === 'verb_adjective_preposition.html'));
  assert.deepEqual(Object.keys(NL.LEARNERS), ['t1', 't2']);
});

test('progress and the streak keep working when storage is blocked', () => {
  const NL = load(blockedStorage);
  NL.setDone('greetings_learning.html', true);
  assert.equal(NL.isDone('greetings_learning.html'), true);
  NL.setDone('greetings_learning.html', false);
  assert.equal(NL.isDone('greetings_learning.html'), false);
  assert.equal(NL.learner(), 't1');
});

test('old ticks (an array of file names) are read and written back as an array', () => {
  const storage = memoryStorage({ 'dutchLearning.done': JSON.stringify(['shapes_learning.html', 'future_page.html']) });
  const NL = load(storage);
  assert.deepEqual([...NL.done()], ['shapes_learning.html']);
  NL.setDone('food_learning.html', true);
  const saved = JSON.parse(storage.data['dutchLearning.done']);
  assert.ok(Array.isArray(saved));
  assert.deepEqual(saved.sort(), ['food_learning.html', 'future_page.html', 'shapes_learning.html']);
});

test('corrupt or hostile stored progress ticks nothing and does not throw', () => {
  for (const raw of ['{', 'null', '"x"', '123', '{"__proto__":true,"constructor":true,"shapes_learning.html":true}', '[1,{"a":1},null]']) {
    const NL = load(memoryStorage({ 'dutchLearning.done': raw }));
    const done = [...NL.done()];
    assert.ok(done.every((f) => f === 'shapes_learning.html'), `${raw} gave ${done}`);
  }
  const NL = load(memoryStorage({ 'dutchLearning.done': '["shapes_learning.html", "x"]' }));
  assert.equal(NL.isDone('shapes_learning.html'), true);
  assert.equal(NL.isDone('constructor'), false);
});

test('the streak counts local calendar days and ignores bad stored values', () => {
  const storage = memoryStorage();
  const NL = load(storage);
  const day = (d, h = 12, m = 0) => new Date(2026, 0, d, h, m);
  NL.bumpStreak(day(1, 0, 30));
  assert.equal(NL.streak(day(1, 23, 0)), 1);
  NL.bumpStreak(day(1, 9));
  assert.equal(NL.streak(day(1, 10)), 1, 'a second lesson on the same day does not count again');
  NL.bumpStreak(day(2, 0, 10));
  assert.equal(NL.streak(day(2, 12)), 2);
  assert.equal(NL.streak(day(3, 12)), 2, 'still alive the day after');
  assert.equal(NL.streak(day(4, 12)), 0, 'a missed day ends it');
  NL.bumpStreak(day(5, 8));
  assert.equal(NL.streak(day(5, 9)), 1);
  for (const raw of ['{"last":"<img onerror=x>","count":"y"}', '{"last":"2026-01-05","count":-4}', '{"last":"2026-01-05","count":99999}', '[]', 'x']) {
    const bad = load(memoryStorage({ 'dutchLearning.streak': raw }));
    assert.equal(bad.streak(day(5, 9)), 0, raw);
  }
});

test('only a known track is accepted', () => {
  for (const raw of ['constructor', '__proto__', 'x', '', 'T1']) assert.equal(load(memoryStorage({ 'dutchLearning.learner': raw })).learner(), 't1', raw);
  const storage = memoryStorage({ 'dutchLearning.learner': 't2' });
  const NL = load(storage);
  assert.equal(NL.learner(), 't2');
  NL.setLearner('nope');
  assert.equal(storage.data['dutchLearning.learner'], 't2');
});

test('flashcard answers never repeat an English meaning', () => {
  const NL = load(memoryStorage());
  const words = [
    { nl: 'De', en: 'This' }, { nl: 'Dit', en: 'This' }, { nl: 'Deze', en: 'this' },
    { nl: 'Hond', en: 'Dog' }, { nl: 'Kat', en: 'Cat' }, { nl: 'Huis', en: 'House' }, { nl: 'Boom', en: 'Tree' },
  ];
  for (let i = 0; i < 200; i++) {
    const options = NL.pickOptions(words, words[0]);
    assert.ok(options.includes(words[0]));
    assert.equal(options.length, 4);
    assert.equal(new Set(options.map((o) => o.en.toLowerCase())).size, options.length);
  }
  const two = [{ nl: 'Ja', en: 'Yes' }, { nl: 'Nee', en: 'No' }];
  assert.equal(NL.pickOptions(two, two[0]).length, 2);
  assert.equal(NL.pickOptions([two[0]], two[0]).length, 1);
});

test('the spoken text is the explicit say or the first of "a / b"', () => {
  const NL = load(memoryStorage());
  assert.equal(NL.spoken({ nl: 'Dag / Tot ziens' }), 'Dag');
  assert.equal(NL.spoken({ nl: 'Dag / Tot ziens', say: 'Tot ziens' }), 'Tot ziens');
  assert.equal(NL.spoken({ nl: 'Goedemorgen' }), 'Goedemorgen');
  assert.equal(NL.spoken({ nl: 'x', say: '' }), '');
});

test('hostile strings stay text and attributes, never markup', () => {
  const NL = load(memoryStorage(), { document: fakeDocument() });
  const host = fakeDocument().createElement('div');
  const hostile = '"><img src=x onerror=alert(1)>';
  NL.renderWords(host, [{ nl: hostile, en: '<b>bold</b> & more', pron: '<i>x</i>', say: 'a"b' }]);
  const tags = new Set(walk(host).map((n) => n.tag));
  assert.deepEqual([...tags].sort(), ['button', 'div', 'span']);
  const play = walk(host).find((n) => n.attrs.class === 'play');
  assert.equal(play.attrs['data-say'], 'a"b');
  assert.equal(play.attrs['aria-label'], `Luister: ${hostile}`);
  assert.ok(walk(host).some((n) => n.children.includes(hostile)));
  assert.ok(walk(host).some((n) => n.children.includes('<b>bold</b> & more')));
});

test('the photo link encodes the term and refuses anything shaped like a URL', () => {
  const NL = load(memoryStorage(), { document: fakeDocument() });
  assert.equal(NL.photoUrl('good morning greeting'), 'https://www.google.com/search?tbm=isch&q=good%20morning%20greeting');
  assert.equal(NL.photoUrl('a&b=c#d'), 'https://www.google.com/search?tbm=isch&q=a%26b%3Dc%23d');
  for (const bad of ['https://evil.example/x', 'x://y', '', '   ', undefined, 5, 'x'.repeat(101)]) assert.equal(NL.photoUrl(bad), null, String(bad));
});

test('a word row shows the English respelling and a safe photo link, and no link without a term', () => {
  const NL = load(memoryStorage(), { document: fakeDocument() });
  const host = fakeDocument().createElement('div');
  NL.renderWords(host, [
    { nl: 'Hallo', en: 'Hello', pron: 'HAH-loh', enPron: 'heh-LOH', photo: 'hello greeting' },
    { nl: 'Hoi', en: 'Hi' },
  ]);
  const all = walk(host);
  const links = all.filter((n) => n.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attrs.href, 'https://www.google.com/search?tbm=isch&q=hello%20greeting');
  assert.equal(links[0].attrs.rel, 'noopener noreferrer');
  assert.equal(links[0].attrs.target, '_blank');
  assert.ok(all.some((n) => n.attrs.class === 'word-pron' && n.text === 'heh-LOH'));
  assert.ok(all.some((n) => n.attrs.class === 'word-pron' && n.text === 'HAH-loh'));
});

test('the script never writes markup from data', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
});
