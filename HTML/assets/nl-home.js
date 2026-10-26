/* Home page: continue card, the two tracks, category filter, search and the lesson grid. */
(function () {
  'use strict';

  const el = NL.el;
  const hero = document.getElementById('hero');
  const chipHost = document.getElementById('chips');
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const search = document.querySelector('[data-search]');
  let category = 'Alles';

  function continueCard() {
    const id = NL.learner();
    const mine = NL.lessonsOf(id);
    const next = mine.find((l) => !NL.isDone(l.file)) || mine[0];
    const buttons = [el('a', { class: 'btn btn-solid', href: next.file, text: 'Start les' })];
    if (next.flash) buttons.push(el('a', { class: 'btn btn-outline', href: `${next.file}#flashcards`, text: 'Flashcards' }));
    return el('div', { class: 'continue' },
      el('div', { class: 'eyebrow', text: `Doorgaan · ${NL.LEARNERS[id].name}` }),
      el('div', {}, el('h2', { lang: 'nl', text: next.nl }), el('div', { class: 'continue-sub', lang: 'en', text: `${next.en} · ${next.cat}` })),
      el('div', { class: 'btn-row' }, buttons));
  }

  function learnerCard(id) {
    const who = NL.LEARNERS[id];
    const mine = NL.lessonsOf(id);
    const done = mine.filter((l) => NL.isDone(l.file)).length;
    const percent = mine.length ? Math.round((done / mine.length) * 100) : 0;
    const active = id === NL.learner();
    const streak = active ? NL.streak() : 0;
    const fill = el('span', { class: `track-fill ${who.avatar}` });
    fill.style.width = `${percent}%`;
    return el('button', { class: 'learner', type: 'button', 'data-learner': id, 'aria-pressed': String(active) },
      el('span', { class: 'learner-head' },
        el('span', { class: 'learner-id' }, el('span', { class: `avatar ${who.avatar}`, 'aria-hidden': 'true', text: who.initial }), who.name),
        el('span', { class: 'learner-state', text: active ? 'actief' : 'kies' })),
      el('span', { class: 'pct' }, String(percent), el('small', { text: '%' })),
      el('span', { class: 'track', 'aria-hidden': 'true' }, fill),
      el('span', { class: 'learner-meta', text: `${done} van ${mine.length} lessen${streak ? ` · ${streak} ${streak === 1 ? 'dag' : 'dagen'} op rij` : ''}` }));
  }

  function chips() {
    const pool = NL.lessonsOf(NL.learner());
    // A category with no lesson on this track gets no chip.
    return NL.CATEGORIES.map((c) => ({ c, n: c === 'Alles' ? pool.length : pool.filter((l) => l.cat === c).length }))
      .filter(({ n }) => n > 0)
      .map(({ c, n }) => el('button', { class: 'chip', type: 'button', 'data-cat': c, 'aria-pressed': String(c === category) }, c, el('span', { class: 'n', text: String(n) })));
  }

  function tile(lesson) {
    const done = NL.isDone(lesson.file);
    const number = NL.lessonsOf(lesson.learner).indexOf(lesson) + 1;
    return el('div', { class: `tile${done ? ' done' : ''}` },
      el('button', { class: 'tile-icon', type: 'button', 'data-toggle': lesson.file, 'aria-pressed': String(done), 'aria-label': `Klaar: ${lesson.nl}`, text: done ? '✓' : String(number) }),
      el('a', { class: 'tile-text', href: lesson.file },
        el('span', { class: 'tile-nl', lang: 'nl', text: lesson.nl }),
        el('span', { class: 'tile-en', lang: 'en', text: lesson.en })));
  }

  // A search looks through both tracks and every category; otherwise the active track and category apply.
  function visibleLessons() {
    const term = search.value.trim().toLowerCase();
    if (term) return NL.LESSONS.filter((l) => `${l.nl} ${l.en} ${l.cat}`.toLowerCase().includes(term));
    return NL.lessonsOf(NL.learner()).filter((l) => category === 'Alles' || l.cat === category);
  }

  function render(refocus) {
    hero.replaceChildren(continueCard(), ...Object.keys(NL.LEARNERS).map(learnerCard));
    chipHost.replaceChildren(...chips());
    const list = visibleLessons();
    grid.replaceChildren(...list.map(tile));
    empty.hidden = list.length > 0;
    // Every re-render replaces the buttons, so focus goes back to the one that was used.
    if (refocus) {
      const target = document.querySelector(refocus);
      if (target) target.focus();
    }
  }

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const file = toggle.dataset.toggle;
      NL.setDone(file, !NL.isDone(file));
      render(`[data-toggle="${CSS.escape(file)}"]`);
      return;
    }
    const learner = e.target.closest('[data-learner]');
    if (learner) {
      NL.setLearner(learner.dataset.learner);
      category = 'Alles';
      render(`[data-learner="${CSS.escape(learner.dataset.learner)}"]`);
      return;
    }
    const chip = e.target.closest('[data-cat]');
    if (chip) {
      category = chip.dataset.cat;
      render(`[data-cat="${CSS.escape(category)}"]`);
    }
  });
  search.addEventListener('input', () => render());
  render();
})();
