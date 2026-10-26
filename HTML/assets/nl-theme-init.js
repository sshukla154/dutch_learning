(function () {
  // Runs in <head> so the saved theme is set before the first paint and the page never flashes light.
  var theme = 'light';
  try {
    if (localStorage.getItem('theme') === 'dark') {
      theme = 'dark';
    }
  } catch (e) {
    // Storage is blocked; the light theme stays.
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
