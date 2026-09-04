/**
 * Two things the review view does that the diff pane does not: it recognises
 * files with nothing to read only from their header text, and it replaces
 * container elements as it re-renders. A verdict written on an element is lost
 * with it — measured live, 24 of 65 containers were replaced, leaving their
 * files visible again and their stubs behind as orphans.
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

const file = (p, note) => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x"><button>Collapse file</button><span>${p}</span>
    <span class="sr-only">Lines changed: 4 additions &amp; 1 deletions</span>${note ? `<span>${note}</span>` : ''}</div>
  <div class="DiffLine-module__line--q">+ code()</div>
</div>`;
const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}"><span>${p}</span></li>`;

const CASES = [
    { p: 'server/lib/moved.js', note: 'File renamed without changes', category: 'rename' },
    { p: 'scripts/deploy.sh', note: 'File mode changed', category: 'mode' },
    { p: 'assets/logo.png', note: 'Binary file not shown', category: 'binary' },
    { p: 'test/api/spec/rates.js', note: '', category: 'test' },
    { p: 'server/lib/rates.js', note: '', category: null }
];

const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/5/files">Files changed <span>${CASES.length}</span></a></nav>
  <div id="toolbar"><span>+20</span><span>&minus;5</span></div>
  <ul role="tree">${CASES.map(c => treeRow(c.p)).join('')}</ul>
  <div id="files">${CASES.map(c => file(c.p, c.note)).join('')}</div>
</body></html>`;

const stateOf = (doc, p) => (doc.getElementById(anchor(p)) || {}).getAttribute
    ? doc.getElementById(anchor(p)).getAttribute('data-ghtf') : '(missing)';
const sheetHides = (doc, p) => (doc.getElementById('ghtf-style') || {}).textContent
    ? doc.getElementById('ghtf-style').textContent.includes('#' + anchor(p)) : false;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/5/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;

    console.log('=== files with nothing to read are recognised from the header ===');
    for (const c of CASES.filter(x => x.category)) {
        ok(stateOf(doc, c.p) === 'hidden', `${c.p} hidden (${c.category}) - got ${stateOf(doc, c.p)}`);
    }
    ok(stateOf(doc, 'server/lib/rates.js') === 'source', 'an ordinary source file is kept');
    const rows = api.debug();
    const catOf = p => (rows.find(r => r.path === p) || {}).category;
    ok(catOf('server/lib/moved.js') === 'rename', `rename category attributed (got ${catOf('server/lib/moved.js')})`);
    ok(catOf('scripts/deploy.sh') === 'mode', `mode category attributed (got ${catOf('scripts/deploy.sh')})`);
    ok(catOf('assets/logo.png') === 'binary', `binary category attributed (got ${catOf('assets/logo.png')})`);

    console.log('\n-- one category can be switched off alone --');
    api.setCategory('binary', false);
    ok(stateOf(doc, 'assets/logo.png') === 'source', 'the binary file is kept once its category is off');
    ok(stateOf(doc, 'server/lib/moved.js') === 'hidden', 'the rename stays hidden');
    api.setCategory('binary', true);

    console.log('\n=== hiding survives GitHub replacing the container ===');
    const testPath = 'test/api/spec/rates.js';
    ok(sheetHides(doc, testPath), 'the file is hidden by a rule keyed on its id, not on the element');
    const before = doc.getElementById(anchor(testPath));
    const fresh = doc.createElement('div');
    fresh.className = 'Diff-module__diffTargetable--z9';
    fresh.id = anchor(testPath);
    fresh.innerHTML = '<div class="DiffLine-module__line--q">+ code()</div>';
    before.replaceWith(fresh);
    await sleep(1200);

    ok(doc.getElementById(anchor(testPath)) === fresh, 'the container really was replaced');
    ok(sheetHides(doc, testPath), 'the stylesheet still hides the replacement');
    ok(stateOf(doc, testPath) === 'hidden', `the replacement is marked hidden again (got ${stateOf(doc, testPath)})`);
    const stubs = [...doc.querySelectorAll('.ghtf-stub')];
    ok(stubs.length === new Set(stubs.map(s => s.id)).size, 'no duplicate stubs after the replacement');
    ok(stubs.every(s => !s.id || doc.getElementById(s.id.replace('ghtf-stub-', ''))),
        'no stub left orphaned by the replacement');

    console.log('\n=== a manual reveal survives it too ===');
    api.show(testPath);
    ok(stateOf(doc, testPath) === 'shown', 'the file is shown after asking for it');
    const shown = doc.getElementById(anchor(testPath));
    const fresh2 = doc.createElement('div');
    fresh2.className = 'Diff-module__diffTargetable--z9';
    fresh2.id = anchor(testPath);
    fresh2.innerHTML = '<div class="DiffLine-module__line--q">+ code()</div>';
    shown.replaceWith(fresh2);
    await sleep(1200);
    ok(stateOf(doc, testPath) === 'shown',
        `it stays shown rather than being hidden under the reader (got ${stateOf(doc, testPath)})`);
    ok(!sheetHides(doc, testPath), 'and no rule hides it');

    console.log('\n' + (failures === 0 ? 'ALL RESILIENCE ASSERTIONS PASS' : failures + ' RESILIENCE FAILURES'));
    process.exit(failures ? 1 : 0);
})();
