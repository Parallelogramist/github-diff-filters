/**
 * Everything this filter can do was reachable only from the console, so anyone
 * who installed it got the defaults and nothing else. The popover is the way in.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');

const file = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x"><span>${p}</span>
    <span class="sr-only">Lines changed: 4 additions &amp; 1 deletions</span></div>
  <div class="DiffLine-module__line--q">+ code()</div></div>`;
const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}"><span>${p}</span></li>`;

const FILES = [
    'test/api/spec/one.js',
    'test/api/spec/two.js',
    'yarn.lock',
    'server/lib/rates.js'
];
const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/9/files">Files changed <span>${FILES.length}</span></a></nav>
  <div id="toolbar"><span>+16</span><span>&minus;4</span></div>
  <ul role="tree">${FILES.map(treeRow).join('')}</ul>
  <div id="files">${FILES.map(file).join('')}</div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/9/changes',
        runScripts: 'outside-only', pretendToBeVisual: true });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;
    const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const rowFor = text => [...doc.querySelectorAll('.ghtf-popover-row')]
        .find(r => r.textContent.includes(text));

    console.log('=== the pill offers a way in ===');
    const gear = doc.querySelector('.ghtf-pill-settings');
    ok(!!gear, 'the pill carries a settings control');
    ok(!doc.getElementById('ghtf-popover'), 'the popover starts closed');

    click(gear);
    const popover = doc.getElementById('ghtf-popover');
    ok(!!popover, 'clicking it opens the popover');

    console.log('\n=== it lists every category with what it is hiding ===');
    ok(!!rowFor('Test files'), 'test files are listed');
    ok(!!rowFor('Lockfiles'), 'lockfiles are listed');
    ok(!!rowFor('Files you marked viewed'), 'the viewed category is listed');
    ok(rowFor('Test files').querySelector('.ghtf-popover-count').textContent === '2',
        `the test count is shown (got ${rowFor('Test files').querySelector('.ghtf-popover-count').textContent})`);
    ok(rowFor('Lockfiles').querySelector('.ghtf-popover-count').textContent === '1', 'the lockfile count is shown');
    ok(!!rowFor('acme/repo'), 'the repository row names the repo it applies to');

    console.log('\n=== a checkbox is the same action as the console call ===');
    const lockBox = rowFor('Lockfiles').querySelector('input');
    ok(lockBox.checked === true, 'lockfiles start hidden');
    lockBox.checked = false;
    lockBox.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(doc.getElementById(anchor('yarn.lock')).getAttribute('data-ghtf') === 'source',
        'unchecking it brings the lockfile back');
    ok(doc.getElementById(anchor('test/api/spec/one.js')).getAttribute('data-ghtf') === 'hidden',
        'and leaves the other categories alone');
    ok(api.categories.lockfile === false, 'the choice is persisted like any other');
    ok(!!doc.getElementById('ghtf-popover'), 'the popover stays open across the change');

    console.log('\n=== the repository row is the stored preference ===');
    const repoBox = rowFor('acme/repo').querySelector('input');
    repoBox.checked = false;
    repoBox.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(api.enabled === false, 'unchecking it switches hiding off for the repo');
    ok(/Hiding off for this repo/.test(doc.getElementById('ghtf-pill').textContent),
        'and the pill says so rather than implying an empty diff');

    console.log('\n=== clicking away closes it ===');
    click(doc.getElementById('toolbar'));
    ok(!doc.getElementById('ghtf-popover'), 'a click outside closes the popover');

    console.log('\n' + (failures === 0 ? 'ALL POPOVER ASSERTIONS PASS' : failures + ' POPOVER FAILURES'));
    process.exit(failures ? 1 : 0);
})();
