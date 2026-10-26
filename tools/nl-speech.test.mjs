import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument } from './fake-dom.mjs';
import { loadCore, memoryStorage } from './load-core.mjs';

const voice = (lang, localService, name = `${lang}-${localService ? 'local' : 'online'}`) => ({ lang, localService, name });

// A speech engine that records what is spoken and lets the test end or fail an utterance.
function fakeEngine(voices = []) {
  const engine = {
    voices, spoken: [], cancelled: 0, speaking: false, pending: false, listeners: {},
    getVoices() { return this.voices; },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    speak(u) { this.spoken.push(u); },
    cancel() { this.cancelled += 1; },
  };
  return engine;
}

function setup(engine) {
  const document = fakeDocument();
  const timers = [];
  const extra = { document, setTimeout: (fn) => timers.push(fn), SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } };
  if (engine) { extra.speechSynthesis = engine; extra.window = { speechSynthesis: engine }; }
  const NL = loadCore(memoryStorage(), extra);
  return { NL, document, timers, root: document.documentElement };
}
const chosen = (voices) => {
  const engine = fakeEngine(voices);
  const { NL } = setup(engine);
  NL.speak('Hallo');
  return engine.spoken[0].voice;
};

test('a Dutch voice on this device wins, then any Dutch voice there, then online ones', () => {
  const nlLocal = voice('nl-NL', true);
  const beLocal = voice('nl-BE', true);
  const nlOnline = voice('nl-NL', false);
  const beOnline = voice('nl-BE', false);
  assert.equal(chosen([beOnline, nlOnline, beLocal, nlLocal]), nlLocal);
  assert.equal(chosen([beOnline, nlOnline, beLocal]), beLocal);
  assert.equal(chosen([beOnline, nlOnline]), nlOnline);
  assert.equal(chosen([beOnline, voice('en-US', true)]), beOnline);
  assert.equal(chosen([voice('nl_NL', true)]).lang, 'nl_NL', 'an underscore in the language tag still counts');
  assert.equal(chosen([voice('en-US', true)]), undefined, 'without a Dutch voice the engine default is used');
});

test('an English utterance never gets the Dutch voice', () => {
  const engine = fakeEngine([voice('nl-NL', true)]);
  const { NL } = setup(engine);
  NL.speak('Hello', null, { lang: 'en-US' });
  assert.equal(engine.spoken[0].voice, undefined);
  assert.equal(engine.spoken[0].lang, 'en-US');
});

test('speak resolves true when the utterance ends and false when it fails', async () => {
  const engine = fakeEngine([voice('nl-NL', true)]);
  const { NL } = setup(engine);
  const ended = NL.speak('Een');
  engine.spoken[0].onend();
  assert.equal(await ended, true);
  const failed = NL.speak('Twee');
  engine.spoken[1].onerror();
  assert.equal(await failed, false);
});

test('speak resolves false at once for empty text and without a speech engine', async () => {
  const engine = fakeEngine([voice('nl-NL', true)]);
  assert.equal(await setup(engine).NL.speak('   '), false);
  assert.equal(engine.spoken.length, 0);
  assert.equal(await setup(null).NL.speak('Hallo'), false);
});

test('a new utterance cuts off the one still speaking', () => {
  const engine = fakeEngine([voice('nl-NL', true)]);
  const { NL } = setup(engine);
  NL.speak('Een');
  engine.speaking = true;
  NL.speak('Twee');
  assert.equal(engine.cancelled, 1);
  assert.equal(engine.spoken.length, 2);
});

test('the play button is marked while speaking and cleared when it ends', () => {
  const engine = fakeEngine([voice('nl-NL', true)]);
  const { NL, document } = setup(engine);
  const button = document.createElement('button');
  NL.speak('Hallo', button);
  assert.ok(button.classList.contains('speaking'));
  engine.spoken[0].onend();
  assert.ok(!button.classList.contains('speaking'));
});

test('the page says so when there is no Dutch voice, whichever way that comes about', () => {
  assert.ok(setup(null).root.classList.contains('no-nl-voice'), 'no speech engine at all');

  const noDutch = setup(fakeEngine([voice('en-US', true)]));
  assert.ok(noDutch.root.classList.contains('no-nl-voice'), 'voices exist but none is Dutch');

  const withDutch = setup(fakeEngine([voice('nl-NL', true)]));
  assert.ok(!withDutch.root.classList.contains('no-nl-voice'));

  const lateEngine = fakeEngine([]);
  const late = setup(lateEngine);
  assert.ok(!late.root.classList.contains('no-nl-voice'), 'an empty list is not judged before the page has settled');
  late.timers.forEach((fn) => fn());
  assert.ok(late.root.classList.contains('no-nl-voice'), 'still empty after the wait');

  const arriving = fakeEngine([]);
  const loaded = setup(arriving);
  arriving.voices = [voice('nl-NL', true)];
  arriving.listeners.voiceschanged.forEach((fn) => fn());
  loaded.timers.forEach((fn) => fn());
  assert.ok(!loaded.root.classList.contains('no-nl-voice'), 'a voice that arrives later clears the notice');
});
