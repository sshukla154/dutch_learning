/* Builds a lesson page from window.NL_PAGE (see HTML/data/): header, section chips, word rows, flashcards. */
(function () {
  'use strict';

  const el = NL.el;
  const page = window.NL_PAGE;
  const lesson = NL.LESSONS.find((l) => l.file === page.file);
  const app = document.getElementById('app');
  const groups = page.groups;
  const allWords = groups.flatMap((g) => g.words);

  function topbar() {
    const button = (id, label) => el('button', { type: 'button', 'data-theme-btn': id, 'aria-pressed': 'false', text: label });
    return el('header', { class: 'topbar' },
      el('a', { class: 'brand', href: 'DUTCH_Learning.html' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: 'nl' }), 'Leren'),
      el('div', { class: 'theme-switch', role: 'group', 'aria-label': 'Thema' }, button('light', 'Licht'), button('dark', 'Donker')));
  }

  function header() {
    const done = el('button', { class: 'btn btn-accent', type: 'button' });
    const sync = () => {
      const on = NL.isDone(page.file);
      done.textContent = on ? '✓ Klaar' : 'Markeer als klaar';
      done.className = `btn ${on ? 'btn-solid' : 'btn-accent'}`;
      done.setAttribute('aria-pressed', String(on));
    };
    done.addEventListener('click', () => { NL.setDone(page.file, !NL.isDone(page.file)); sync(); });
    sync();
    const node = el('section', { class: 'lesson-head' },
      el('a', { class: 'back', href: 'DUTCH_Learning.html', text: '← Alle lessen' }),
      el('h1', { lang: 'nl', text: lesson.nl }),
      el('p', { lang: 'en', text: `${page.subtitle || lesson.en} · ${lesson.cat}` }),
      el('div', { class: 'btn-row' }, done, lesson.flash ? el('a', { class: 'btn btn-surface', href: '#flashcards', text: 'Flashcards' }) : null));
    return { node, sync };
  }

  function groupPanel(group, index) {
    const list = el('div', { class: 'words' });
    NL.renderWords(list, group.words);
    return el('div', { class: 'panel', id: `g${index}` },
      el('div', { class: 'panel-label' }, el('span', { text: `${group.title} · ${group.en}` }), el('span', { text: String(group.words.length) })),
      list,
      group.fact ? el('p', { class: 'fact', lang: 'en' }, el('strong', { text: 'Weetje: ' }), group.fact) : null);
  }

  // A tip and any further notes sit under the lesson; a note's text is one line or an array of lines.
  const notes = [...(page.tip ? [{ label: 'Tip', text: page.tip }] : []), ...(page.notes || [])];

  function build() {
    // A practice page hides the answers instead of showing word rows and flashcards.
    const practice = page.reveal === true;
    const flash = el('div', { class: 'flash', id: 'flashcards', role: 'region', 'aria-label': 'Flashcards' });
    const practiceHost = el('div', { class: 'groups' });
    const head = header();
    const parts = [
      topbar(),
      head.node,
      el('p', { class: 'voice-note', role: 'note', text: 'Er is geen Nederlandse stem op dit apparaat gevonden: het geluid kan ontbreken.' }),
      groups.length > 1 ? el('nav', { class: 'chips', 'aria-label': 'Secties' }, groups.map((g, i) => el('a', { class: 'chip', href: `#g${i}`, text: g.title }))) : null,
      practice ? practiceHost : el('section', { class: 'split' }, el('div', { class: 'groups' }, groups.map(groupPanel)), allWords.length > 1 ? flash : null),
      ...notes.map(NL.note),
    ];
    // replaceChildren turns a null into the text "null", unlike el().
    app.replaceChildren(...parts.filter(Boolean));
    // The theme buttons were just created, so the saved theme has to be marked on them again.
    NL.setTheme(document.documentElement.getAttribute('data-theme'), false);
    if (practice) {
      NL.practice(practiceHost, groups, page.practice);
    } else if (allWords.length > 1) {
      NL.flashcards(flash, allWords, { count: 12, onFinish: (score, total) => { if (score / total >= 0.8) { NL.setDone(page.file, true); head.sync(); } } });
    }
  }

  build();
})();
