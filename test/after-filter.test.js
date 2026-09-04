/**
 * The header figure has to account for everything the extension removed, and
 * the review view states a file's counts only in words: its visible diffstat
 * splits the sign and the number into separate text nodes, so "+130" is never
 * one leaf. The sibling comment filter reports its own per-file total the same
 * way, inside the file header.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');

// Sign and number in separate leaves, plus the stated pair, exactly as GitHub
// renders it; `commentsHidden` mimics the other filter's per-file label.
const file = (p, added, deleted, commentsHidden) => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x">
    <button>Collapse file</button><span>${p}</span>
    <span>+</span><span>${added}</span><span>-</span><span>${deleted}</span>
    <span class="sr-only">Lines changed: ${added} additions &amp; ${deleted} deletions</span>
    <span>Viewed</span>${commentsHidden ? `<span>${commentsHidden} comment hidden</span>` : ''}
  </div>
  <div class="DiffLine-module__line--q">+ code()</div>
</div>`;

const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}"><span>${p}</span></li>`;

const FILES = [
    { p: 'test/api/spec/one.js', add: 130, del: 0, comments: 0 },
    { p: 'client/app/x.component.spec.ts', add: 20, del: 5, comments: 0 },
    { p: 'server/lib/rates.js', add: 300, del: 40, comments: 22 },
    { p: 'server/lib/pricing.js', add: 50, del: 5, comments: 8 }
];
// Totals as GitHub would state them for the whole pull request.
const TOTAL_ADD = FILES.reduce((n, f) => n + f.add, 0);
const TOTAL_DEL = FILES.reduce((n, f) => n + f.del, 0);
// Hidden: the two test files (+150 −5). Visible: +350 −45, less 30 comment lines.
const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/3/files">Files changed <span>${FILES.length}</span></a></nav>
  <div id="toolbar"><span>+${TOTAL_ADD}</span><span>&minus;${TOTAL_DEL}</span></div>
  <ul role="tree">${FILES.map(f => treeRow(f.p)).join('')}</ul>
  <div id="files">${FILES.map(f => file(f.p, f.add, f.del, f.comments)).join('')}</div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/3/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const doc = dom.window.document;
    dom.window.eval(src);

    console.log('=== per-file counts come from the stated pair ===');
    const rows = dom.window.__ghTestFileFilter.debug();
    const byPath = p => rows.find(r => r.path === p);
    ok(byPath('test/api/spec/one.js').stat === '+130 −0',
        `a split diffstat is still read (got: ${byPath('test/api/spec/one.js').stat})`);
    ok(rows.every(r => r.stat && r.stat.length), 'every file has readable counts');

    console.log('\n=== the figure accounts for hidden files and comment lines ===');
    const badge = doc.querySelector('.ghtf-visible-stat');
    ok(!!badge, 'the badge rendered');
    ok(/after filter/.test(badge.textContent), `labelled "after filter" (got: ${badge.textContent})`);
    ok(/\+350/.test(badge.textContent), `additions exclude the hidden files (got: ${badge.textContent})`);
    ok(/−45/.test(badge.textContent), `deletions exclude the hidden files (got: ${badge.textContent})`);
    ok(/−30 comment/.test(badge.textContent),
        `the 30 comment-only lines are reported (got: ${badge.textContent})`);
    ok(/2 hidden files \(\+150 −5\)/.test(badge.title) && /30 comment-only lines/.test(badge.title),
        `the tooltip accounts for both (got: ${badge.title})`);

    console.log('\n=== it reads as part of GitHub’s own diffstat ===');
    const numbers = [...badge.querySelectorAll('span')].filter(el => /[+−]\d/.test(el.textContent));
    ok(numbers.some(el => el.className === 'color-fg-success'), 'additions use GitHub’s success class');
    ok(numbers.some(el => el.className === 'color-fg-danger'), 'deletions use GitHub’s danger class');
    ok(!/font-size/.test(badge.getAttribute('style') || ''),
        'the badge sets no font of its own, so it inherits the host’s');
    ok(badge.parentElement.id === 'toolbar', 'it lives inside GitHub’s own totals element');

    console.log('\n=== comment lines inside a hidden file are not double counted ===');
    // server/lib/rates.js is visible, so its 22 count; a hidden file's would not.
    ok(!/−52 comment/.test(badge.textContent), 'only visible files contribute comment lines');

    console.log('\n' + (failures === 0 ? 'ALL AFTER-FILTER ASSERTIONS PASS' : failures + ' AFTER-FILTER FAILURES'));
    process.exit(failures ? 1 : 0);
})();
