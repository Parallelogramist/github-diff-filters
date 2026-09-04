/**
 * Collapsing files identical to the previous visit. A return visit is modelled
 * by navigating to another pull request and back, which is what makes the
 * filter re-read the stored snapshot instead of the one it just wrote.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

const file = (p, sha, added, deleted) => `<div data-file-path="${p}"><div class="file js-file" id="diff-${sha}">
  <div class="file-header" data-path="${p}"><div class="file-info"><a title="${p}">${p}</a>
    <span aria-label="${added} additions &amp; ${deleted} deletions"></span></div></div>
  <table><tbody><tr><td class="blob-code blob-code-hunk">@@ -1,4 +1,6 @@</td></tr></tbody></table>
</div></div>`;

const page = () => `<span class="diffstat" id="diffstat"><span class="color-fg-success">+60</span><span class="color-fg-danger">−9</span></span>
  <div id="files">
    ${file('src/steady.ts', 'a'.repeat(64), 10, 2)}
    ${file('src/moved.ts', 'b'.repeat(64), 20, 3)}
  </div>`;

(async () => {
    const dom = new JSDOM(`<!doctype html><html><body>${page()}</body></html>`,
        { url: 'https://github.com/acme/repo/pull/1/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;
    const box = c => doc.getElementById('diff-' + c.repeat(64));

    console.log('\n-- first visit records, hides nothing --');
    api.onlyChanged = true;
    ok(api.onlyChanged === true, 'mode on');
    ok(box('a').getAttribute('data-ghtf') === 'source', 'steady.ts left open on a first visit');
    const stored = JSON.parse(window.localStorage.getItem('gh-hide-test-files:seen:acme/repo#1') || '{}');
    ok(!!stored['src/steady.ts'], 'a fingerprint was stored (got: ' + JSON.stringify(stored) + ')');

    console.log('\n-- return visit collapses what did not move --');
    // Away and back, so the snapshot just written becomes the previous visit.
    dom.reconfigure({ url: 'https://github.com/acme/repo/pull/2/files' });
    api.apply();
    dom.reconfigure({ url: 'https://github.com/acme/repo/pull/1/files' });
    // moved.ts comes back with different counts; steady.ts is untouched.
    box('b').querySelector('[aria-label]').setAttribute('aria-label', '40 additions & 8 deletions');
    api.reset();
    api.apply();
    ok(box('a').getAttribute('data-ghtf') === 'unchanged',
        'steady.ts collapsed as unchanged (got: ' + box('a').getAttribute('data-ghtf') + ')');
    ok(box('b').getAttribute('data-ghtf') === 'source', 'moved.ts stays open, its counts changed');
    const stub = box('a').previousElementSibling;
    ok(stub && /unchanged since your last visit/.test(stub.title),
        'its stub says why (got: ' + (stub && stub.title) + ')');
    const pillText = doc.getElementById('ghtf-pill').textContent;
    ok(/1 unchanged/.test(pillText), 'pill reports it (got: ' + pillText + ')');
    ok(!/[0-9]+ files? hidden/.test(pillText), 'and does not count it among the hidden files (got: ' + pillText + ')');

    console.log('\n-- the header figure counts it as hidden --');
    const badge = doc.querySelector('.ghtf-visible-stat');
    ok(badge && /after filter/.test(badge.textContent),
        'badge is labelled after filter (got: ' + (badge && badge.textContent) + ')');
    ok(badge && /\+50/.test(badge.textContent),
        'badge excludes the unchanged file from the figure (got: ' + (badge && badge.textContent) + ')');
    ok(badge && /\+50/.test(badge.textContent),
        '60 total less the 10 in the collapsed file (got: ' + (badge && badge.textContent) + ')');

    console.log('\n-- the preference is per repo and the store is capped --');
    ok(window.localStorage.getItem('gh-hide-test-files:onlyChanged:acme/repo') === 'true',
        'mode stored against the repository');
    const index = JSON.parse(window.localStorage.getItem('gh-hide-test-files:seenIndex') || '[]');
    ok(index.length <= 20 && index[0] === 'acme/repo#1',
        'newest pull request first, capped (got: ' + JSON.stringify(index) + ')');

    console.log('\n-- and it can be turned back off --');
    api.onlyChanged = false;
    ok(box('a').getAttribute('data-ghtf') === 'source', 'steady.ts open again');

    console.log('\n' + (failures === 0 ? 'ALL UNCHANGED ASSERTIONS PASS' : failures + ' UNCHANGED FAILURES'));
    process.exit(failures ? 1 : 0);
})();
