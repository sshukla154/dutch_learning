// Words for common_dutch_words.html, rendered by assets/nl-page.js and assets/nl-practice.js. The words come from common_words.js.
window.NL_PAGE = {
  file: 'common_dutch_words.html',
  reveal: true,
  practice: { unit: 'Woorden', search: true, together: true },
  groups: [
    {
      title: 'Makkelijk', en: 'Easy words (beginner level)',
      notes: [
        { label: 'Learning tip', text: "These are the most common Dutch words you'll use daily. Master these first!" },
        {
          label: 'Pronunciation guide',
          text: [
            'Easy phonetic spelling! Pronunciations are written how they sound in English:',
            '"ah" = like "father" | "oo" = like "food" | "ay" = like "day"',
            '"uh" = like "about" | "oh" = like "go" | "ew" = like "few"',
            'Guttural G = throat-clearing sound (like Scottish "loch") - the trickiest Dutch sound!',
          ],
        },
        { label: 'Tip', text: 'Always press the play button to hear the authentic pronunciation!' },
      ],
      words: window.NL_COMMON_WORDS.easy,
    },
    {
      title: 'Gemiddeld', en: 'Medium words (intermediate level)',
      notes: [{ label: 'Learning tip', text: 'Medium-level words for everyday conversations. Practice these after mastering the easy words!' }],
      words: window.NL_COMMON_WORDS.medium,
    },
    {
      title: 'Moeilijk', en: 'Hard words (advanced level)',
      notes: [{ label: 'Learning tip', text: 'Advanced vocabulary for fluent conversations. These are connector words, abstract concepts, and complex expressions. Master Easy and Medium first!' }],
      words: window.NL_COMMON_WORDS.hard,
    },
  ],
};
