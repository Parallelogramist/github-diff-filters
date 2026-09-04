/**
 * GitHub keeps the "Viewed" tick per reviewer on the server, so it is already
 * right on another machine and survives a force-push in a way a local content
 * fingerprint cannot. It is also a switch the reader flips while working, so a
 * file hidden for that reason has to be re-checked rather than settled.
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

const file = (p, viewed, comment) => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x">
    <span>${p}</span><span class="sr-only">Lines changed: 4 additions &amp; 1 deletions</span>
    <label><input type="checkbox" id="v-${anchor(p)}"${viewed ? ' checked' : ''}> Viewed</label>
  </div>
  <div class="DiffLine-module__line--q">+ code()</div>
  ${comment ? '<div class="ReviewThread-module__thread--a">looks wrong</div>' : ''}
</div>`;
const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}"><span>${p}</span></li>`;

const FILES = [
    { p: 'server/lib/done.js', viewed: true },
    { p: 'server/lib/todo.js', viewed: false },
    { p: 'test/api/spec/rates.js', viewed: false },
    { p: 'server/lib/reviewed.js', viewed: true, comment: true }
];

const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/6/files">Files changed <span>${FILES.length}</span></a></nav>
  <div id="toolbar"><span>+16</span><span>&minus;4</span></div>
  <ul role="tree">${FILES.map(f => treeRow(f.p)).join('')}</ul>
  <div id="files">${FILES.map(f => file(f.p, f.viewed, f.comment)).join('')}</div>
</body></html>`;

const stateOf = (doc, p) => doc.getElementById(anchor(p)).getAttribute('data-ghtf');

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/6/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;

    console.log('=== a file you already ticked is collapsed ===');
    ok(stateOf(doc, 'server/lib/done.js') === 'hidden', `the viewed file is hidden (got ${stateOf(doc, 'server/lib/done.js')})`);
    ok(stateOf(doc, 'server/lib/todo.js') === 'source', 'an unticked file is left alone');
    ok(stateOf(doc, 'test/api/spec/rates.js') === 'hidden', 'a test file is still hidden on its path');
    const row = api.debug().find(r => r.path === 'server/lib/done.js');
    ok(row.category === 'viewed' && row.rule === 'viewed on GitHub',
        `attributed to the viewed category (got ${row.rule} / ${row.category})`);

    console.log('\n-- feedback still outranks it --');
    ok(stateOf(doc, 'server/lib/reviewed.js') === 'commented',
        `a viewed file carrying a thread stays open (got ${stateOf(doc, 'server/lib/reviewed.js')})`);

    console.log('\n-- unticking it brings the file back --');
    const box = doc.getElementById('v-' + anchor('server/lib/done.js'));
    box.checked = false;
    doc.getElementById('files').appendChild(doc.createElement('span'));
    await sleep(1200);
    ok(stateOf(doc, 'server/lib/done.js') === 'source',
        `the file returns once unticked (got ${stateOf(doc, 'server/lib/done.js')})`);

    console.log('\n-- the category can be switched off on its own --');
    box.checked = true;
    api.apply();
    ok(stateOf(doc, 'server/lib/done.js') === 'hidden', 're-ticking hides it again');
    api.setCategory('viewed', false);
    ok(stateOf(doc, 'server/lib/done.js') === 'source', 'switching the category off keeps viewed files open');
    ok(stateOf(doc, 'test/api/spec/rates.js') === 'hidden', 'and leaves the test rule alone');

    console.log('\n' + (failures === 0 ? 'ALL VIEWED ASSERTIONS PASS' : failures + ' VIEWED FAILURES'));
    process.exit(failures ? 1 : 0);
})();
