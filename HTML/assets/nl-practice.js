/* Practice pages: words or sentences whose Dutch and pronunciation stay hidden until the learner asks for them. */
(function () {
  'use strict';

  const NL = window.NL;
  const el = NL.el;

  // A list longer than PAGE_FROM shows PAGE_STEP rows at a time.
  const PAGE_FROM = 60;
  const PAGE_STEP = 50;

  const KINDS = {
    nl: { show: 'Toon Nederlands', hide: 'Verberg Nederlands' },
    pron: { show: 'Toon uitspraak', hide: 'Verberg uitspraak' },
    both: { show: 'Toon antwoord', hide: 'Verberg antwoord' },
  };

  // opts: unit (what the rows are called), search, together (one button reveals Dutch and pronunciation),
  // tagLabels (names for each tag), unique ({ index, label }: a count of distinct tags).
  function panel(group, index, opts) {
    const words = group.words;
    const together = opts.together === true;
    const labels = opts.tagLabels || [];
    const shown = words.map(() => ({ nl: false, pron: false }));
    const rows = [];
    const firstLimit = words.length > PAGE_FROM ? PAGE_STEP : words.length;
    let limit = firstLimit;
    let term = '';

    const count = el('strong', { text: '0' });
    const percent = el('strong', { text: '0%' });
    const fill = el('span', { class: 'track-fill' });
    fill.style.width = '0%';
    const empty = el('p', { class: 'empty', role: 'status', text: 'Geen resultaten gevonden. Probeer een ander woord.' });
    empty.hidden = true;
    const more = el('button', { class: 'btn btn-surface', type: 'button', text: 'Toon meer' });
    more.hidden = true;

    // Progress is the share of answers shown; a row counts as revealed once all its answers are.
    const answers = words.reduce((n, w) => n + (w.pron ? 2 : 1), 0);
    const update = () => {
      const reveals = shown.reduce((n, s) => n + (s.nl ? 1 : 0) + (s.pron ? 1 : 0), 0);
      const share = answers ? Math.round((reveals / answers) * 100) : 0;
      count.textContent = String(shown.filter((s, i) => s.nl && (s.pron || !words[i].pron)).length);
      percent.textContent = `${share}%`;
      fill.style.width = `${share}%`;
    };

    const refresh = () => {
      let matched = 0;
      rows.forEach((row) => {
        const hit = term === '' || row.haystack.includes(term);
        if (hit) matched += 1;
        row.node.hidden = !(hit && matched <= limit);
      });
      empty.hidden = matched > 0;
      more.hidden = matched <= limit;
      more.textContent = `Toon meer (nog ${matched - limit})`;
    };

    const set = (i, kind, on) => {
      if (kind === 'pron' && !words[i].pron) return;
      shown[i][kind] = on;
      rows[i].parts[kind].text.hidden = !on;
    };
    const setButton = (i, kind, on) => {
      const button = rows[i].buttons[kind];
      if (!button) return;
      const wording = kind === 'nl' && together ? KINDS.both : KINDS[kind];
      button.textContent = on ? wording.hide : wording.show;
      button.setAttribute('aria-expanded', String(on));
    };
    const toggle = (i, kind) => {
      const on = !shown[i][kind];
      if (kind === 'nl' && together) { set(i, 'nl', on); set(i, 'pron', on); setButton(i, 'nl', on); } else { set(i, kind, on); setButton(i, kind, on); }
      update();
    };
    const setAll = (kinds, on) => {
      words.forEach((w, i) => kinds.forEach((kind) => {
        if (kind === 'pron' && !w.pron) return;
        set(i, kind, on);
        setButton(i, kind, on);
      }));
      update();
    };

    words.forEach((w, i) => {
      const texts = { nl: el('p', { class: 'practice-nl', lang: 'nl', text: w.nl }), pron: w.pron ? el('p', { class: 'practice-pron', lang: 'en', text: w.pron }) : null };
      Object.values(texts).forEach((t) => { if (t) t.hidden = true; });
      const button = (kind) => {
        const b = el('button', { class: 'btn btn-surface reveal', type: 'button', 'aria-expanded': 'false', text: (kind === 'nl' && together ? KINDS.both : KINDS[kind]).show });
        b.addEventListener('click', () => toggle(i, kind));
        return b;
      };
      const buttons = { nl: button('nl'), pron: !together && w.pron ? button('pron') : null };
      const tags = (w.tags || []).map((t, k) => el('span', { class: 'tag', text: labels[k] ? `${labels[k]}: ${t}` : t }));
      const node = el('li', { class: 'practice-row' },
        NL.playButton(w),
        el('div', { class: 'practice-body' },
          el('p', { class: 'practice-en', lang: 'en', text: w.en }),
          el('div', { class: 'practice-answer' }, buttons.nl, texts.nl),
          texts.pron ? el('div', { class: 'practice-answer' }, buttons.pron, texts.pron) : null,
          tags.length ? el('div', { class: 'word-meta' }, tags) : null));
      rows.push({ node, parts: { nl: { text: texts.nl }, pron: { text: texts.pron || { hidden: true } } }, buttons, haystack: [w.en, w.nl, w.pron, ...(w.tags || [])].join(' ').toLowerCase() });
    });

    const control = (label, kinds, on) => {
      const b = el('button', { class: 'btn btn-surface', type: 'button', text: label });
      b.addEventListener('click', () => setAll(kinds, on));
      return b;
    };
    const controls = together
      ? [control('Toon alles', ['nl', 'pron'], true), control('Verberg alles', ['nl', 'pron'], false)]
      : [control('Toon alles', ['nl', 'pron'], true), control('Verberg alles', ['nl', 'pron'], false),
        control(KINDS.nl.show, ['nl'], true), control(KINDS.nl.hide, ['nl'], false),
        control(KINDS.pron.show, ['pron'], true), control(KINDS.pron.hide, ['pron'], false)];

    more.addEventListener('click', () => { limit += PAGE_STEP; refresh(); });
    let search = null;
    if (opts.search === true) {
      search = el('input', { type: 'search', class: 'practice-search', 'aria-label': `Zoek in ${group.title}`, placeholder: 'Zoek', autocomplete: 'off' });
      search.addEventListener('input', () => { term = String(search.value).trim().toLowerCase(); limit = firstLimit; refresh(); });
    }

    const unique = opts.unique ? new Set(words.map((w) => (w.tags || [])[opts.unique.index])).size : null;
    const node = el('div', { class: 'panel practice', id: `g${index}` },
      el('div', { class: 'panel-label' }, el('span', { text: `${group.title} · ${group.en}` }), el('span', { text: String(words.length) })),
      (group.notes || []).map(NL.note),
      el('div', { class: 'practice-stats' },
        el('span', {}, `${opts.unit || 'Zinnen'}: `, el('strong', { text: String(words.length) })),
        el('span', {}, 'Onthuld: ', count),
        el('span', {}, 'Voortgang: ', percent),
        unique === null ? null : el('span', {}, `${opts.unique.label}: `, el('strong', { text: String(unique) }))),
      el('span', { class: 'track', 'aria-hidden': 'true' }, fill),
      el('div', { class: 'btn-row' }, controls),
      search,
      empty,
      el('ol', { class: 'practice-list' }, rows.map((r) => r.node)),
      more);
    refresh();
    update();
    return node;
  }

  // groups: [{ title, en, notes?, words: [{ nl, en, pron?, tags? }] }]
  NL.practice = (host, groups, opts = {}) => {
    host.replaceChildren(...groups.map((g, i) => panel(g, i, opts)));
  };
})();
