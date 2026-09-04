/**
 * A pass that runs while only part of the diff has rendered must not report a
 * verdict. GitHub fills the file tree with the navigation but appends the diff
 * pane progressively, so the first pass can legitimately see one file, classify
 * it correctly as source, and have nothing left to retry — which is how a diff
 * full of tests reports "Nothing to hide in this diff" and stays that way.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');
const FILES = [
    'README.md',
    'server/lib/rates.js',
    'test/api/spec/rates.js',
    'client/app/rates.component.spec.ts',
    'server/lib/pricing.js'
];
const NOISE = new Set(['test/api/spec/rates.js', 'client/app/rates.component.spec.ts']);

const container = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Prc-module__toolbar--k2"><button>&#9662;</button><span>${p}</span><span>+8</span><span>-2</span></div>
  <div class="DiffLine-module__line--q">+ code()</div>
</div>`;

const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}">
  <span>${p}</span></li>`;

// GitHub's own count is present from the start, as is the whole tree; only the
// diff pane is a prefix.
const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/7/files">Files changed <span>${FILES.length}</span></a></nav>
  <div id="toolbar"><span>+40</span><span>&minus;10</span></div>
  <ul role="tree">${FILES.map(treeRow).join('')}</ul>
  <div id="files">${container(FILES[0])}</div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/7/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);

    console.log('=== a pass over a prefix of the diff reports no verdict ===');
    const pill = doc.getElementById('ghtf-pill');
    const api = window.__ghTestFileFilter;
    ok(doc.querySelectorAll('[class^="Diff-module__diffTargetable"]').length === 1,
        'only the first file has rendered');
    ok(api.report().expectedFiles === 5, `GitHub's count is read as 5 (got ${api.report().expectedFiles})`);
    ok(!/Nothing to hide in this diff/.test(pill.textContent),
        `pill does not claim there is nothing to hide (got: ${pill.textContent.trim()})`);
    ok(/Waiting for the diff/.test(pill.textContent),
        `pill says it is still waiting (got: ${pill.textContent.trim()})`);
    ok(doc.querySelector(`[id="${anchor(FILES[0])}"]`).getAttribute('data-ghtf') === 'source',
        'the file that did render is still classified');

    console.log('\n=== the rest of the diff arriving settles it ===');
    const host = doc.getElementById('files');
    host.insertAdjacentHTML('beforeend', FILES.slice(1).map(container).join(''));
    await sleep(1400);

    const hidden = [...doc.querySelectorAll('[data-ghtf="hidden"]')];
    ok(hidden.length === 2, `both test files hidden once the diff completed (got ${hidden.length})`);
    ok(hidden.every(c => NOISE.has(c.__ghtfPath)), 'the hidden files are the two test files');
    ok(/2 files hidden/.test(pill.textContent),
        `pill reports the real count (got: ${pill.textContent.trim()})`);
    ok(api.report().expectedFiles === 5 && doc.querySelectorAll('[class^="Diff-module__diffTargetable"]').length === 5,
        'expected and rendered counts agree once complete');

    console.log('\n=== a complete diff with no tests still says so ===');
    const clean = new JSDOM(`<!doctype html><html><body>
      <nav><a href="/acme/repo/pull/8/files">Files changed <span>1</span></a></nav>
      <ul role="tree">${treeRow('README.md')}</ul>
      <div id="files">${container('README.md')}</div>
    </body></html>`, { url: 'https://github.com/acme/repo/pull/8/changes', runScripts: 'outside-only' });
    if (clean.window.document.readyState !== 'complete') {
        await new Promise(r => clean.window.addEventListener('load', r, { once: true }));
    }
    clean.window.eval(src);
    ok(/Nothing to hide in this diff/.test(clean.window.document.getElementById('ghtf-pill').textContent),
        'a genuinely test-free diff is still reported as such');

    console.log('\n' + (failures === 0 ? 'ALL PARTIAL-LOAD ASSERTIONS PASS' : failures + ' PARTIAL-LOAD FAILURES'));
    process.exit(failures ? 1 : 0);
})();
