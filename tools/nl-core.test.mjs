import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument, walk } from './fake-dom.mjs';
import { coreSource, loadCore as load, memoryStorage, blockedStorage } from './load-core.mjs';

// A stand-in for Date that only has the local calendar getters the streak reads, so no test depends on the machine's time zone.
const at = (year, month, day) => ({ getFullYear: () => year, getMonth: () => month - 1, getDate: () => day });

test('the lesson list is complete and well formed', () => {
  const NL = load(memoryStorage());
  assert.equal(NL.LESSONS.length, 23);
  assert.equal(NL.lessonsOf('t1').length, 16);
  assert.equal(NL.lessonsOf('t2').length, 7);
  assert.equal(new Set(NL.LESSONS.map((l) => l.file)).size, 23);
  assert.deepEqual(Object.keys(NL.LEARNERS), ['t1', 't2']);
  for (const l of NL.LESSONS) {
    assert.match(l.file, /^[a-z0-9_]+\.html$/);
    assert.ok(NL.CATEGORIES.slice(1).includes(l.cat), `${l.file} has the unknown category ${l.cat}`);
    assert.ok(Object.hasOwn(NL.LEARNERS, l.learner), `${l.file} has the unknown track ${l.learner}`);
    assert.ok(typeof l.nl === 'string' && l.nl.trim() && typeof l.en === 'string' && l.en.trim(), `${l.file} needs both titles`);
    assert.equal(typeof l.flash, 'boolean');
  }
  assert.ok(NL.LESSONS.some((l) => l.file === 'stationery_learning.html'));
  assert.ok(NL.LESSONS.some((l) => l.file === 'verb_adjective_preposition.html'));
});

test('progress and the streak keep working when storage is blocked', () => {
  const NL = load(blockedStorage);
  NL.setDone('greetings_learning.html', true);
  assert.equal(NL.isDone('greetings_learning.html'), true);
  assert.equal(NL.streak(), 1);
  NL.setDone('greetings_learning.html', false);
  assert.equal(NL.isDone('greetings_learning.html'), false);
  assert.equal(NL.learner(), 't1');
  NL.setLearner('t2');
  assert.equal(NL.learner(), 't2');
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

test('corrupt or hostile stored progress ticks only what is really known', () => {
  const expected = [
    ['{', []],
    ['null', []],
    ['"x"', []],
    ['123', []],
    ['[1,{"a":1},null]', []],
    ['["shapes_learning.html","x"]', ['shapes_learning.html']],
    ['{"__proto__":true,"constructor":true,"shapes_learning.html":true,"food_learning.html":false}', ['shapes_learning.html']],
  ];
  for (const [raw, done] of expected) assert.deepEqual([...load(memoryStorage({ 'dutchLearning.done': raw })).done()], done, raw);
  const NL = load(memoryStorage({ 'dutchLearning.done': '["shapes_learning.html","x"]' }));
  assert.equal(NL.isDone('shapes_learning.html'), true);
  assert.equal(NL.isDone('constructor'), false);
});

test('a lesson done on one day starts a streak that grows on consecutive local days', () => {
  const NL = load(memoryStorage());
  NL.bumpStreak(at(2026, 1, 1));
  assert.equal(NL.streak(at(2026, 1, 1)), 1);
  NL.bumpStreak(at(2026, 1, 1));
  assert.equal(NL.streak(at(2026, 1, 1)), 1, 'a second lesson on the same day does not count again');
  NL.bumpStreak(at(2026, 1, 2));
  assert.equal(NL.streak(at(2026, 1, 2)), 2);
  assert.equal(NL.streak(at(2026, 1, 3)), 2, 'still alive the day after');
  assert.equal(NL.streak(at(2026, 1, 4)), 0, 'a missed day ends it');
  NL.bumpStreak(at(2026, 1, 5));
  assert.equal(NL.streak(at(2026, 1, 5)), 1, 'and the next lesson starts again from one');
});

test('the streak crosses month ends, a leap day, a year end and both daylight-saving changes', () => {
  const runs = [
    [[2025, 12, 31], [2026, 1, 1]],
    [[2026, 2, 28], [2026, 3, 1]],
    [[2028, 2, 28], [2028, 2, 29], [2028, 3, 1]],
    [[2026, 3, 28], [2026, 3, 29], [2026, 3, 30]],
    [[2026, 10, 24], [2026, 10, 25], [2026, 10, 26]],
  ];
  for (const run of runs) {
    const NL = load(memoryStorage());
    for (const [y, m, d] of run) NL.bumpStreak(at(y, m, d));
    const [y, m, d] = run[run.length - 1];
    assert.equal(NL.streak(at(y, m, d)), run.length, run.map((r) => r.join('-')).join(' > '));
  }
});

test('a streak value that is not a valid date and count is ignored', () => {
  const bad = [
    '{"last":"<img onerror=x>","count":3}',
    '{"last":"2026-1-5","count":3}',
    '{"last":"2026-01-05","count":-4}',
    '{"last":"2026-01-05","count":99999}',
    '{"last":"2026-01-05","count":"3"}',
    '{"last":"2026-01-05","count":1.5}',
    '[]',
    'x',
  ];
  for (const raw of bad) assert.equal(load(memoryStorage({ 'dutchLearning.streak': raw })).streak(at(2026, 1, 5)), 0, raw);
  assert.equal(load(memoryStorage({ 'dutchLearning.streak': '{"last":"2026-01-05","count":3}' })).streak(at(2026, 1, 5)), 3);
});

test('only a known track is accepted and a choice is remembered', () => {
  for (const raw of ['constructor', '__proto__', 'x', '', 'T1']) assert.equal(load(memoryStorage({ 'dutchLearning.learner': raw })).learner(), 't1', raw);
  const storage = memoryStorage({ 'dutchLearning.learner': 't2' });
  const NL = load(storage);
  assert.equal(NL.learner(), 't2');
  NL.setLearner('nope');
  assert.equal(storage.data['dutchLearning.learner'], 't2');
  NL.setLearner('t1');
  assert.equal(storage.data['dutchLearning.learner'], 't1');
  assert.equal(NL.learner(), 't1');
});

test('the theme is dark or light, saved only when asked, and a stored value is checked', () => {
  const document = fakeDocument();
  const storage = memoryStorage();
  const NL = load(storage, { document });
  const theme = () => document.documentElement.getAttribute('data-theme');
  assert.equal(theme(), 'light');
  NL.setTheme('dark');
  assert.equal(theme(), 'dark');
  assert.equal(storage.data.theme, 'dark');
  NL.setTheme('light', false);
  assert.equal(theme(), 'light');
  assert.equal(storage.data.theme, 'dark', 'applying a theme without saving leaves the saved one alone');
  NL.setTheme('Dark');
  assert.equal(theme(), 'light', 'only the exact word dark gives dark');
  assert.equal(storage.data.theme, 'light');

  const saved = memoryStorage({ theme: 'dark' });
  const doc2 = fakeDocument();
  load(saved, { document: doc2 });
  assert.equal(doc2.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(saved.data.theme, 'dark', 'loading a page never rewrites the saved theme');
  for (const raw of ['evil', '"dark"', '']) {
    const doc3 = fakeDocument();
    load(memoryStorage({ theme: raw }), { document: doc3 });
    assert.equal(doc3.documentElement.getAttribute('data-theme'), 'light', raw);
  }
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

test('the answer to a Dutch word never offers another entry with the same Dutch word', () => {
  const NL = load(memoryStorage());
  const words = [
    { nl: 'Nicht', en: 'Niece' }, { nl: 'Nicht', en: 'Cousin (female)' },
    { nl: 'Oom', en: 'Uncle' }, { nl: 'Tante', en: 'Aunt' }, { nl: 'Opa', en: 'Grandfather' },
  ];
  for (let i = 0; i < 100; i++) assert.ok(!NL.pickOptions(words, words[0]).some((o) => o.en === 'Cousin (female)'));
});

test('the shuffle can move the first element', () => {
  const NL = load(memoryStorage());
  const list = [1, 2, 3, 4, 5, 6];
  assert.ok(Array.from({ length: 200 }, () => NL.shuffle(list)[0]).some((first) => first !== 1));
  assert.deepEqual([...NL.shuffle(list)].sort(), list);
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6], 'the input list is left alone');
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

test('a word row marks its language and keeps both respellings', () => {
  const NL = load(memoryStorage(), { document: fakeDocument() });
  const host = fakeDocument().createElement('div');
  NL.renderWords(host, [{ nl: 'Hallo', en: 'Hello', pron: 'HAH-loh', enPron: 'heh-LOH' }]);
  const all = walk(host);
  const dutch = all.find((n) => n.attrs.class === 'word-nl');
  const english = all.find((n) => n.attrs.class === 'word-en');
  assert.equal(dutch.attrs.lang, 'nl');
  assert.equal(english.attrs.lang, 'en');
  assert.ok(all.some((n) => n.attrs.class === 'word-pron' && n.text === 'HAH-loh'));
  assert.ok(all.some((n) => n.attrs.class === 'word-pron' && n.text === 'heh-LOH'));
  assert.equal(all.find((n) => n.attrs.class === 'play').attrs.type, 'button');
});

test('the photo link encodes the term and refuses anything shaped like a URL', () => {
  const NL = load(memoryStorage(), { document: fakeDocument() });
  assert.equal(NL.photoUrl('good morning greeting'), 'https://www.google.com/search?tbm=isch&q=good%20morning%20greeting');
  assert.equal(NL.photoUrl('a&b=c#d'), 'https://www.google.com/search?tbm=isch&q=a%26b%3Dc%23d');
  for (const bad of ['https://evil.example/x', 'x://y', '', '   ', undefined, 5, 'x'.repeat(101)]) assert.equal(NL.photoUrl(bad), null, String(bad));
});

test('a word row shows a safe photo link, and no link without a term', () => {
  const NL = load(memoryStorage(), { document: fakeDocument() });
  const host = fakeDocument().createElement('div');
  NL.renderWords(host, [{ nl: 'Hallo', en: 'Hello', photo: 'hello greeting' }, { nl: 'Hoi', en: 'Hi' }]);
  const links = walk(host).filter((n) => n.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attrs.href, 'https://www.google.com/search?tbm=isch&q=hello%20greeting');
  assert.equal(links[0].attrs.rel, 'noopener noreferrer');
  assert.equal(links[0].attrs.target, '_blank');
});

test('a symbol is shown as text, large for an emoji and in the display font for a numeral or sign', () => {
  const NL = load(memoryStorage(), { document: fakeDocument() });
  const host = fakeDocument().createElement('div');
  NL.renderWords(host, [{ nl: 'Potlood', en: 'Pencil', sym: '✏️' }, { nl: 'Plus', en: 'Plus', sym: '+' }, { nl: 'Hoi', en: 'Hi' }]);
  const cells = walk(host).filter((n) => String(n.attrs.class).startsWith('word-sym'));
  assert.deepEqual(cells.map((n) => [n.attrs.class, n.text, n.attrs['aria-hidden']]), [['word-sym', '✏️', 'true'], ['word-sym word-sym-text', '+', 'true']]);
});

test('the script never writes markup or loads code from data', () => {
  assert.doesNotMatch(coreSource, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|\beval\s*\(|new Function|srcdoc/);
});
