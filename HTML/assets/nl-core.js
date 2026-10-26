/* Shared behaviour for the home page and the lesson pages: lesson list, saved progress, speech, word rows, flashcards. */
(function () {
  'use strict';

  const NL = (window.NL = {});

  // Tracks are neutral on purpose: the site names no learners.
  NL.LEARNERS = {
    t1: { name: 'Track 1', initial: '1', avatar: 'a1' },
    t2: { name: 'Track 2', initial: '2', avatar: 'a2' },
  };
  NL.CATEGORIES = ['Alles', 'Basis', 'Woordenschat', 'Grammatica', 'Oefenen', 'Spellen'];

  // The single lesson list. A lesson gets flash: true when its page has flashcards.
  NL.LESSONS = [
    { file: 'bouw_learning.html', nl: 'Bouw', en: 'Letters & words', cat: 'Woordenschat', learner: 't1', flash: false },
    { file: 'bouw_games.html', nl: 'Bouwspellen', en: 'Word games', cat: 'Spellen', learner: 't1', flash: false },
    { file: 'dutch_stories.html', nl: 'Verhalen', en: 'Stories', cat: 'Spellen', learner: 't1', flash: false },
    { file: 'house_learning.html', nl: 'Het huis', en: 'House & household', cat: 'Woordenschat', learner: 't1', flash: false },
    { file: 'days_months_weather_learning.html', nl: 'Dagen & maanden', en: 'Days, months & seasons', cat: 'Basis', learner: 't1', flash: false },
    { file: 'body_parts_learning.html', nl: 'Het lichaam', en: 'Body parts', cat: 'Woordenschat', learner: 't1', flash: false },
    { file: 'outdoor_learning.html', nl: 'Buiten', en: 'Outdoor', cat: 'Woordenschat', learner: 't1', flash: false },
    { file: 'shapes_learning.html', nl: 'Vormen', en: 'Shapes', cat: 'Basis', learner: 't1', flash: false },
    { file: 'stationery_learning.html', nl: 'Kantoorartikelen', en: 'Stationery', cat: 'Woordenschat', learner: 't1', flash: true },
    { file: 'family_tree_learning.html', nl: 'De familie', en: 'Family tree', cat: 'Woordenschat', learner: 't1', flash: false },
    { file: 'animals_learning.html', nl: 'Dieren', en: 'Animals', cat: 'Woordenschat', learner: 't1', flash: false },
    { file: 'numbers_learning.html', nl: 'Getallen', en: 'Numbers & symbols', cat: 'Basis', learner: 't1', flash: false },
    { file: 'time_learning.html', nl: 'De tijd', en: 'Time', cat: 'Basis', learner: 't1', flash: false },
    { file: 'greetings_learning.html', nl: 'Begroetingen', en: 'Greetings', cat: 'Basis', learner: 't1', flash: true },
    { file: 'seasons_months_learning.html', nl: 'Seizoenen', en: 'Seasons & months', cat: 'Basis', learner: 't1', flash: false },
    { file: 'food_learning.html', nl: 'Eten', en: 'Food', cat: 'Woordenschat', learner: 't1', flash: false },
    { file: 'common_dutch_words.html', nl: 'Veelgebruikte woorden', en: 'Common words', cat: 'Woordenschat', learner: 't2', flash: false },
    { file: 'common_dutch_words_game.html', nl: 'Woordenspel', en: 'Common words game', cat: 'Spellen', learner: 't2', flash: false },
    { file: 'dutch_pronunciation_guide.html', nl: 'Uitspraak', en: 'Pronunciation', cat: 'Grammatica', learner: 't2', flash: false },
    { file: 'verb_adjective_preposition.html', nl: 'Werkwoord & bijvoeglijk', en: 'Verbs & adjectives', cat: 'Grammatica', learner: 't2', flash: false },
    { file: 'noun_sentences.html', nl: 'Zinnen met zelfst. nw.', en: 'Noun sentences', cat: 'Oefenen', learner: 't2', flash: false },
    { file: 'verb_sentences.html', nl: 'Zinnen met werkwoorden', en: 'Verb sentences', cat: 'Oefenen', learner: 't2', flash: false },
    { file: 'dutch_grammar.html', nl: 'Grammatica', en: 'Dutch grammar', cat: 'Grammatica', learner: 't2', flash: false },
  ];
  NL.lessonsOf = (learner) => NL.LESSONS.filter((l) => l.learner === learner);

  // Storage can be blocked (private windows, site data off); the page then keeps its state in memory.
  const memory = {};
  const store = {
    get(key) {
      try {
        const value = localStorage.getItem(key);
        if (value !== null) return value;
      } catch (e) {
        // Blocked: fall through to memory.
      }
      return Object.hasOwn(memory, key) ? memory[key] : null;
    },
    set(key, value) {
      memory[key] = value;
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // Blocked: the value lives in memory until the page closes.
      }
    },
  };
  const readJson = (key) => {
    try {
      return JSON.parse(store.get(key));
    } catch (e) {
      return null;
    }
  };

  // Finished lessons: a JSON array of file names, the same shape the old home page wrote.
  const DONE_KEY = 'dutchLearning.done';
  const rawDone = () => {
    const v = readJson(DONE_KEY);
    if (Array.isArray(v)) return v.filter((f) => typeof f === 'string');
    if (v && typeof v === 'object') return Object.keys(v).filter((f) => v[f] === true);
    return [];
  };
  NL.done = () => {
    const known = new Set(NL.LESSONS.map((l) => l.file));
    return new Set(rawDone().filter((f) => known.has(f)));
  };
  NL.isDone = (file) => NL.done().has(file);
  NL.setDone = (file, value) => {
    // Names this page does not know stay in the list, so a page added later keeps its tick.
    const list = rawDone().filter((f) => f !== file);
    if (value) list.push(file);
    store.set(DONE_KEY, JSON.stringify(list));
    if (value) NL.bumpStreak();
  };

  // Streak in local calendar days.
  const STREAK_KEY = 'dutchLearning.streak';
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (offset, now) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const readStreak = () => {
    const v = readJson(STREAK_KEY);
    const ok = v && /^\d{4}-\d{2}-\d{2}$/.test(v.last) && Number.isSafeInteger(v.count) && v.count >= 0 && v.count <= 3660;
    return ok ? { last: v.last, count: v.count } : { last: null, count: 0 };
  };
  NL.bumpStreak = (now = new Date()) => {
    const s = readStreak();
    const today = dayKey(0, now);
    if (s.last === today) return;
    store.set(STREAK_KEY, JSON.stringify({ last: today, count: s.last === dayKey(-1, now) ? Math.min(s.count + 1, 3660) : 1 }));
  };
  NL.streak = (now = new Date()) => {
    const s = readStreak();
    return s.last === dayKey(0, now) || s.last === dayKey(-1, now) ? s.count : 0;
  };

  const LEARNER_KEY = 'dutchLearning.learner';
  NL.learner = () => {
    const id = store.get(LEARNER_KEY);
    return Object.hasOwn(NL.LEARNERS, id) ? id : 't1';
  };
  NL.setLearner = (id) => { if (Object.hasOwn(NL.LEARNERS, id)) store.set(LEARNER_KEY, id); };

  // The Dutch text that is read aloud: an explicit say, else the first of "a / b".
  NL.spoken = (word) => (word.say !== undefined ? word.say : String(word.nl).split(' / ')[0]);

  const shuffle = (list, random) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // The card and up to three wrong answers, each with a different English meaning, in random order.
  NL.pickOptions = (words, card, random = Math.random) => {
    const norm = (s) => String(s).trim().toLowerCase();
    const seen = new Set([norm(card.en)]);
    const wrong = [];
    for (const w of shuffle(words, random)) {
      if (w === card || seen.has(norm(w.en)) || norm(w.nl) === norm(card.nl)) continue;
      seen.add(norm(w.en));
      wrong.push(w);
      if (wrong.length === 3) break;
    }
    return shuffle([card, ...wrong], random);
  };
  NL.shuffle = (list) => shuffle(list, Math.random);

  if (typeof document === 'undefined') return;

  // Builds elements with textContent and attributes only, so data can never become markup.
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
    return node;
  };
  NL.el = el;

  const root = document.documentElement;

  // Theme: the head script has already applied the saved one; a click is the only thing that saves.
  NL.setTheme = (theme, save = true) => {
    const t = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', t);
    if (save) store.set('theme', t);
    document.querySelectorAll('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t)));
  };
  NL.setTheme(store.get('theme'), false);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-btn]');
    if (b) NL.setTheme(b.dataset.themeBtn);
  });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => root.classList.add('nl-ready'));

  // Speech: a Dutch voice stored on this device is preferred over an online one.
  let voice = null;
  let current = null;
  const pickVoice = () => {
    const all = speechSynthesis.getVoices().map((v) => ({ v, lang: v.lang.replace('_', '-').toLowerCase() }));
    const dutch = all.filter((x) => x.lang.startsWith('nl'));
    const best = dutch.find((x) => x.lang === 'nl-nl' && x.v.localService) || dutch.find((x) => x.v.localService) || dutch.find((x) => x.lang === 'nl-nl') || dutch[0];
    voice = best ? best.v : null;
    root.classList.toggle('no-nl-voice', all.length > 0 && !voice);
  };
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  // Resolves when the utterance ends, so a caller can chain several.
  NL.speak = (text, btn, opts = {}) => new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    if (!voice) pickVoice();
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    document.querySelectorAll('.speaking').forEach((b) => b.classList.remove('speaking'));
    const lang = opts.lang || 'nl-NL';
    const u = new SpeechSynthesisUtterance(String(text));
    current = u; // keeps a reference so the browser cannot drop it before it ends
    u.lang = lang;
    u.rate = opts.rate || 0.85;
    if (opts.pitch) u.pitch = opts.pitch;
    if (voice && lang.toLowerCase().startsWith('nl')) u.voice = voice;
    if (btn) btn.classList.add('speaking');
    const finish = () => { if (btn && current === u) btn.classList.remove('speaking'); resolve(); };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-say]');
    if (b) NL.speak(b.dataset.say, b, { lang: b.dataset.lang, pitch: Number(b.dataset.pitch) || 0 });
  });

  // Ctrl/Cmd+K focuses the search box where a page has one.
  document.addEventListener('keydown', (e) => {
    const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'k') {
      const box = document.querySelector('[data-search]');
      if (box) { e.preventDefault(); box.focus(); }
    }
  });

  const playButton = (word) => el('button', { class: 'play', type: 'button', 'data-say': NL.spoken(word), 'aria-label': `Luister: ${word.nl}`, text: '▶' });

  // The picture search is a click-only link; the term is encoded and anything shaped like a URL is refused.
  const PHOTO_BASE = 'https://www.google.com/search?tbm=isch&q=';
  NL.photoUrl = (term) => (typeof term === 'string' && term.trim() && term.length <= 100 && !term.includes('://') ? PHOTO_BASE + encodeURIComponent(term.trim()) : null);

  const photoLink = (w) => {
    const href = NL.photoUrl(w.photo);
    return href ? el('a', { class: 'photo', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Foto van ${w.nl} (nieuw tabblad)`, text: 'Foto' }) : null;
  };

  // An emoji gets a large cell of its own; a plain numeral or sign is set in the display font.
  const symbolCell = (w) => (w.sym ? el('span', { class: /\p{Extended_Pictographic}/u.test(w.sym) ? 'word-sym' : 'word-sym word-sym-text', 'aria-hidden': 'true', text: w.sym }) : null);

  // Word rows: a play button, an optional symbol, the Dutch word with its respelling, and the English meaning with its respelling and photo link.
  NL.renderWords = (host, words) => {
    host.replaceChildren(...words.map((w) => el('div', { class: 'word' },
      playButton(w),
      symbolCell(w),
      el('span', { class: 'word-nl', lang: 'nl' }, w.nl, w.pron ? el('span', { class: 'word-pron', lang: 'en', text: w.pron }) : null),
      el('span', { class: 'word-en', lang: 'en' }, w.en, w.enPron ? el('span', { class: 'word-pron', text: w.enPron }) : null, photoLink(w)))));
  };

  // Flashcards: Dutch word, four English answers. opts.count sets the deck size; opts.onFinish gets (score, total).
  NL.flashcards = (host, words, opts = {}) => {
    const deck = NL.shuffle(words).slice(0, opts.count || Math.min(12, words.length));
    let index = 0;
    let score = 0;

    const render = (moveFocus) => {
      if (index >= deck.length) {
        const again = el('button', { class: 'btn btn-accent', type: 'button', text: 'Opnieuw' });
        again.addEventListener('click', () => NL.flashcards(host, words, opts));
        host.replaceChildren(
          el('div', { class: 'panel-label' }, el('span', { text: 'Flashcards' }), el('span', { text: 'Klaar' })),
          el('div', { class: 'flash-word', text: `${score} / ${deck.length}` }),
          el('div', { class: 'btn-row' }, again));
        if (moveFocus) again.focus({ preventScroll: true });
        if (opts.onFinish) opts.onFinish(score, deck.length);
        return;
      }
      const card = deck[index];
      const options = NL.pickOptions(words, card);
      const fill = el('span', { class: 'track-fill' });
      fill.style.width = `${(index / deck.length) * 100}%`;
      const scoreText = el('span', { text: `Score ${score}` });
      const next = el('button', { class: 'btn btn-accent', type: 'button', text: 'Volgende →', hidden: true });
      const buttons = options.map((o) => el('button', { class: 'answer', type: 'button', lang: 'en', text: o.en }));
      buttons.forEach((b, k) => b.addEventListener('click', () => {
        const right = options[k] === card;
        buttons.forEach((x, j) => {
          x.disabled = true;
          if (options[j] === card) x.classList.add('correct');
          else if (x === b) x.classList.add('wrong');
        });
        if (right) score += 1;
        scoreText.textContent = `Score ${score}`;
        next.hidden = false;
        next.setAttribute('aria-label', `${right ? 'Goed.' : `Fout. Juist: ${card.en}.`} Volgende`);
        next.focus();
      }));
      next.addEventListener('click', () => { index += 1; render(true); });
      host.replaceChildren(
        el('div', { class: 'panel-label' }, el('span', { text: 'Flashcard' }), el('span', { text: `${index + 1} / ${deck.length}` })),
        el('span', { class: 'track', 'aria-hidden': 'true' }, fill),
        el('div', { class: 'flash-word' }, el('span', { lang: 'nl', text: card.nl }), playButton(card)),
        el('div', { class: 'answers' }, buttons),
        el('div', { class: 'flash-foot' }, scoreText, next));
      if (moveFocus) buttons[0].focus({ preventScroll: true });
    };
    render(false);
  };
})();
