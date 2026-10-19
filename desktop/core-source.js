'use strict';
// ===== Desktop app: the compute code, taken from the page itself ===========================
// The built page carries the physics core and the worker driver as text blocks (the browser turns
// them into its Web Worker). The desktop compute processes run exactly that text, so a rebuilt page
// is all the app needs to pick up changes, and the two versions cannot drift apart.

const fs = require('fs');

function computeSource(pagePath) {
  const html = fs.readFileSync(pagePath, 'utf8');
  const block = id => {
    const m = html.match(new RegExp('<script type="text/plain" id="' + id + '">([\\s\\S]*?)</script>'));
    if (!m) throw new Error('The "' + id + '" block was not found in ' + pagePath + '; rebuild the page with node tools/build.mjs.');
    return m[1];
  };
  // the same concatenation as the page's Blob worker: core, a newline, driver
  return block('core') + '\n' + block('worker-driver');
}

module.exports = { computeSource };
