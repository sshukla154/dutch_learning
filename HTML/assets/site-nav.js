(function () {
    var HOME_HREF = 'DUTCH_Learning.html';
    var BAR_HEIGHT = 44;
    var BAR_Z_INDEX = 9000; // below full-screen effects, which use a higher z-index

    // Nothing to attach to, or already loaded (a second load would stack two bars).
    if (!document.body || document.querySelector('.site-nav')) {
        return;
    }

    var style = document.createElement('style');
    style.textContent = [
        'html { padding-top: ' + BAR_HEIGHT + 'px; scroll-padding-top: ' + (BAR_HEIGHT + 8) + 'px; }',
        'body { min-height: calc(100vh - ' + BAR_HEIGHT + 'px); }',
        '.site-nav { position: fixed; top: 0; left: 0; right: 0; height: ' + BAR_HEIGHT + 'px;',
        '  z-index: ' + BAR_Z_INDEX + '; box-sizing: border-box; display: flex; align-items: center;',
        '  justify-content: space-between; padding: 0 16px; background: #004e89; color: #fff;',
        '  font: 600 15px/1 system-ui, -apple-system, "Segoe UI", sans-serif; }',
        '.site-nav a { color: #fff; text-decoration: none; padding: 8px 12px; border-radius: 8px;',
        '  background: rgba(255, 255, 255, 0.15); }',
        '.site-nav a:hover, .site-nav a:focus-visible { background: rgba(255, 255, 255, 0.3); }',
        '@media print { .site-nav { display: none; } html { padding-top: 0; } }'
    ].join('\n');

    var bar = document.createElement('div');
    bar.className = 'site-nav';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Site');

    var home = document.createElement('a');
    home.href = HOME_HREF;
    home.textContent = '\u{1F4DA} All lessons';

    var title = document.createElement('span');
    title.textContent = '\u{1F1F3}\u{1F1F1} Dutch Learning';

    bar.appendChild(home);
    bar.appendChild(title);
    document.head.appendChild(style);
    document.body.insertBefore(bar, document.body.firstChild);
})();
