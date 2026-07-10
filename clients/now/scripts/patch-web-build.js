/**
 * Expo's web export doesn't inject a manifest link or register a service
 * worker on its own (confirmed: the exported index.html has neither) --
 * this patches the built index.html so the PWA is actually installable and
 * push notifications actually work, without hand-editing a generated file.
 */
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const inject = `
  <link rel="manifest" href="./manifest.json">
  <link rel="apple-touch-icon" href="./icon-192.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="DESIRED">
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function (e) {
          console.error('[sw] registration failed', e);
        });
      });
    }
  </script>
`;

html = html.replace('</head>', `${inject}</head>`);

// Expo's raw export sets <title> from app.json's expo.name ("DESIRED") --
// short on purpose there, since it's also the native home-screen icon
// caption (long names get truncated under an icon). The browser tab has
// more room, so it gets the fuller tagline instead, same split reasoning
// manifest.json's name/short_name pair already uses.
html = html.replace(/<title>.*<\/title>/, '<title>DESIRED: Identity to Reality</title>');

fs.writeFileSync(indexPath, html);
console.log('[patch-web-build] injected manifest link + service worker registration + full title');
