import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument, byClass } from './fake-dom.mjs';
import { loadCore, memoryStorage } from './load-core.mjs';

const WORDS = [
  { nl: 'Hond', en: 'Dog' }, { nl: 'Kat', en: 'Cat' }, { nl: 'Huis', en: 'House' },
  { nl: 'Boom', en: 'Tree' }, { nl: 'Brood', en: 'Bread' }, { nl: 'Melk', en: 'Milk' },
];

function start(words, opts) {
  const document = fakeDocument();
  const NL = loadCore(memoryStorage(), { document });
  const host = document.createElement('div');
  NL.flashcards(host, words, opts);
  return { document, host, NL };
}
const cardWord = (host) => byClass(host, 'flash-word')[0].children[0].text;
const answers = (host) => byClass(host, 'answer');
const nextButton = (host) => byClass(host, 'flash-foot')[0].children[1];
const rightAnswer = (host) => answers(host).find((a) => a.text === WORDS.find((w) => w.nl === cardWord(host)).en);
const wrongAnswer = (host) => answers(host).find((a) => a.text !== WORDS.find((w) => w.nl === cardWord(host)).en);

// Plays a whole deck, choosing with `pick` on every card.
function play(host, pick) {
  const seen = [];
  while (byClass(host, 'answer').length) {
    seen.push(cardWord(host));
    pick(host).click();
    nextButton(host).click();
  }
  return seen;
}

test('the deck has the requested size and every card is different', () => {
  const { host } = start(WORDS, { count: 4 });
  const seen = play(host, rightAnswer);
  assert.equal(seen.length, 4);
  assert.equal(new Set(seen).size, 4);
});

test('right answers count, and onFinish gets the score and the deck size', () => {
  const finished = [];
  const { host } = start(WORDS, { count: 4, onFinish: (score, total) => finished.push([score, total]) });
  play(host, rightAnswer);
  assert.deepEqual(finished, [[4, 4]]);
  assert.equal(byClass(host, 'flash-word')[0].text, '4 / 4');
});

test('wrong answers score nothing', () => {
  const finished = [];
  const { host } = start(WORDS, { count: 3, onFinish: (score, total) => finished.push([score, total]) });
  play(host, wrongAnswer);
  assert.deepEqual(finished, [[0, 3]]);
});

test('after an answer all choices are locked and the right and wrong ones are marked', () => {
  const { host } = start(WORDS, { count: 3 });
  const wrong = wrongAnswer(host);
  wrong.click();
  assert.ok(answers(host).every((a) => a.disabled === true));
  assert.ok(rightAnswer(host).classList.contains('correct'));
  assert.ok(wrong.classList.contains('wrong'));
  assert.equal(nextButton(host).hidden, false);
  assert.match(nextButton(host).attrs['aria-label'], /^Fout\. Juist: /);
});

test('a right answer is announced as right on the next button', () => {
  const { host } = start(WORDS, { count: 3 });
  rightAnswer(host).click();
  assert.match(nextButton(host).attrs['aria-label'], /^Goed\./);
});

test('focus follows the deck: next button, then the first answer, then Opnieuw, then the first answer of the new deck', () => {
  const { document, host } = start(WORDS, { count: 2 });
  assert.equal(document.activeElement, null, 'nothing steals focus when the page loads');
  rightAnswer(host).click();
  assert.equal(document.activeElement, nextButton(host));
  nextButton(host).click();
  assert.equal(document.activeElement, answers(host)[0]);
  rightAnswer(host).click();
  nextButton(host).click();
  const again = byClass(host, 'btn-row')[0].children[0];
  assert.equal(document.activeElement, again);
  again.click();
  assert.equal(document.activeElement, answers(host)[0]);
});

test('the choices are a labelled group that names the Dutch word', () => {
  const { host } = start(WORDS, { count: 2 });
  const [group] = byClass(host, 'answers');
  assert.equal(group.attrs.role, 'group');
  assert.equal(group.attrs['aria-label'], `Betekenis van ${cardWord(host)}`);
});

test('the restart button says the score aloud', () => {
  const { host } = start(WORDS, { count: 2 });
  play(host, rightAnswer);
  const again = byClass(host, 'btn-row')[0].children[0];
  assert.equal(again.attrs['aria-label'], 'Opnieuw. Score 2 van 2');
});

test('fewer than two words give no quiz and never call onFinish', () => {
  for (const words of [[], [WORDS[0]]]) {
    let called = false;
    const { host } = start(words, { onFinish: () => { called = true; } });
    assert.equal(host.hidden, true);
    assert.equal(called, false);
  }
});
