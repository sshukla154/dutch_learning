# dutch_learning

My notes and interactive pages for learning Dutch.

Open the lessons online: https://sshukla154.github.io/dutch_learning/

## Layout

- `HTML/` has the lesson pages. `DUTCH_Learning.html` is the home page and links to every lesson.
- A page in the new design is a small shell plus a data file in `HTML/data/` with its words. `assets/nl-page.js` builds the page from that file, using `assets/nl-core.js` (lesson list, progress, speech, flashcards), `assets/nl-practice.js` for pages that hide the answers until asked, and the styles in `assets/nl-tokens.css` and `assets/nl-theme.css`. The lesson list lives in `nl-core.js`.
- The four game and story pages (`dutch_stories`, `bouw_learning`, `bouw_games`, `common_dutch_words_game`) keep their own styles and script. They use the shared fonts, colours and theme (`nl-tokens.css`, `nl-topbar.css`, `nl-theme-init.js`) and the same top bar. Grammar and pronunciation keep their written content in the page and use `nl-reference.css` and `nl-tabs.js`.
- `Inburgering/` has my plain-text study notes.
- `HTML/assets/fonts/` has the page fonts, served from this site so no page asks a third party for them. They are under the SIL Open Font License 1.1; see the `OFL-*.txt` files and `SOURCES.txt` there.

## Run it locally

Open `HTML/DUTCH_Learning.html` in a browser, or serve the folder so every page loads over http:

```bash
cd HTML
python -m http.server --bind 127.0.0.1
```

Then open http://127.0.0.1:8000/DUTCH_Learning.html.

Lesson ticks are stored in the browser for the address you opened, so ticks made from a file do not appear on `127.0.0.1`.

## Checks

`tools/check-site.mjs` checks links, requests on page load, page structure, fonts and private words. It needs a plain-text file with one private word per line, kept outside the repo:

```bash
NL_PRIVATE_TERMS_FILE=/path/to/words.txt node tools/check-site.mjs
node tools/check-site.mjs --self-test
node --test
```

Add `--history` to also check the commits not yet pushed.
