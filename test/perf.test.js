/**
 * A pass costs a walk over every container, and GitHub mutates the page
 * constantly while appending files, so the debounce fires repeatedly on a diff
 * that has already settled. The measurement is the deliverable here: an idle
 * pass must cost a small fraction of the first one, or the extension is paying
 * for the whole diff every few hundred milliseconds.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');

const COUNT = 300;
const PATHS = Array.from({ length: COUNT }, (_, i) =>
    i % 3 === 0 ? `test/api/spec/case${i}.js` : `server/lib/mod${i}.js`);

const file = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x"><span>${p}</span>
    <span class="sr-only">Lines changed: 12 additions &amp; 3 deletions</span></div>
  ${Array.from({ length: 15 }, (_, n) => `<div class="DiffLine-module__line--q">+ line ${n}</div>`).join('')}
</div>`;
const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}"><span>${p}</span></li>`;

const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/2/files">Files changed <span>${COUNT}</span></a></nav>
  <div id="toolbar"><span>+3600</span><span>&minus;900</span></div>
  <ul role="tree">${PATHS.map(treeRow).join('')}</ul>
  <div id="files">${PATHS.map(file).join('')}</div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/2/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const api0 = Date.now();
    window.eval(src);
    const firstPass = Date.now() - api0;
    const api = window.__ghTestFileFilter;

    console.log(`  ${COUNT} files, first pass ${firstPass}ms`);
    ok(window.document.querySelectorAll('[data-ghtf="hidden"]').length === 100,
        `all 100 test files hidden (got ${window.document.querySelectorAll('[data-ghtf="hidden"]').length})`);

    const idle0 = Date.now();
    const PASSES = 20;
    for (let i = 0; i < PASSES; i++) api.apply();
    const idle = Date.now() - idle0;
    console.log(`  ${PASSES} idle passes ${idle}ms (${(idle / PASSES).toFixed(1)}ms each)`);

    ok(idle < firstPass, `${PASSES} idle passes cost less than the first pass (${idle}ms vs ${firstPass}ms)`);
    ok(idle / PASSES < firstPass / 4,
        `an idle pass is a fraction of a real one (${(idle / PASSES).toFixed(1)}ms vs ${firstPass}ms)`);

    console.log('\n-- a real change is still picked up --');
    const fresh = window.document.createElement('div');
    fresh.className = 'Diff-module__diffTargetable--z9';
    fresh.id = anchor('test/api/spec/late.js');
    fresh.innerHTML = '<div class="Diff-module__diffHeaderWrapper__x"><span>test/api/spec/late.js</span>'
        + '<span class="sr-only">Lines changed: 1 additions &amp; 0 deletions</span></div>';
    window.document.getElementById('files').appendChild(fresh);
    const treeHost = window.document.querySelector('[role="tree"]');
    treeHost.insertAdjacentHTML('beforeend', treeRow('test/api/spec/late.js'));
    api.apply();
    ok(fresh.getAttribute('data-ghtf') === 'hidden',
        `a file appended after the diff settled is still classified (got ${fresh.getAttribute('data-ghtf')})`);

    console.log('\n' + (failures === 0 ? 'ALL PERF ASSERTIONS PASS' : failures + ' PERF FAILURES'));
    process.exit(failures ? 1 : 0);
})();
