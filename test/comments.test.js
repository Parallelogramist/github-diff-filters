/**
 * A test file carrying review feedback must stay open. A one-line stub is easy
 * to scroll past, and threads often load after the diff, so a file that gains
 * one while collapsed has to be released.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

const file = (p, id, thread) => `<div data-file-path="${p}"><div class="file js-file" id="diff-${id}">
  <div class="file-header" data-path="${p}"><div class="file-info"><a title="${p}">${p}</a>
    <span aria-label="4 additions &amp; 1 deletion"></span></div></div>
  <table><tbody>
    <tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ it('works')</td></tr>
    ${thread ? '<tr class="js-comment-container"><td colspan="2">Reviewer: this assertion is inverted</td></tr>' : ''}
  </tbody></table></div></div>`;

const html = `<!doctype html><html><body>
  <span class="diffstat" id="diffstat"><span class="color-fg-success">+100</span><span class="color-fg-danger">−20</span></span>
  <ul role="tree">
    <li role="treeitem" data-tree-entry-type="file" id="file-tree-item-diff-${'a'.repeat(64)}"><a>src/reviewed.spec.ts</a></li>
    <li role="treeitem" data-tree-entry-type="file" id="file-tree-item-diff-${'b'.repeat(64)}"><a>src/quiet.spec.ts</a></li>
  </ul>
  <div id="files">
    ${file('src/reviewed.spec.ts', 'a'.repeat(64), true)}
    ${file('src/quiet.spec.ts', 'b'.repeat(64), false)}
    ${file('src/later.spec.ts', 'c'.repeat(64), false)}
  </div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/3/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const doc = dom.window.document;
    dom.window.eval(src);
    const api = dom.window.__ghTestFileFilter;
    const box = id => doc.getElementById('diff-' + id.repeat(64));

    console.log('\n-- a thread keeps the file open --');
    ok(box('a').getAttribute('data-ghtf') === 'commented', 'reviewed spec marked commented');
    ok(box('a').style.display !== 'none', 'reviewed spec still visible');
    ok(!box('a').previousElementSibling || !box('a').previousElementSibling.classList.contains('ghtf-stub'),
        'reviewed spec got no stub');
    ok(box('b').getAttribute('data-ghtf') === 'hidden', 'the quiet spec is still hidden');

    console.log('\n-- its tree row stays too --');
    const row = doc.getElementById('file-tree-item-diff-' + 'a'.repeat(64));
    ok(row.getAttribute('data-ghtf-tree') !== 'hidden', 'reviewed spec keeps its tree row');
    ok(doc.getElementById('file-tree-item-diff-' + 'b'.repeat(64)).getAttribute('data-ghtf-tree') === 'hidden',
        'the quiet spec loses its tree row');

    console.log('\n-- a thread arriving later releases a collapsed file --');
    ok(box('c').getAttribute('data-ghtf') === 'hidden', 'later.spec.ts starts hidden');
    const late = doc.createElement('tr');
    late.className = 'js-comment-container';
    late.innerHTML = '<td>Reviewer: needs a case for the empty list</td>';
    box('c').querySelector('tbody').appendChild(late);
    api.apply();
    ok(box('c').getAttribute('data-ghtf') === 'commented', 'later.spec.ts released once the thread appears');
    ok(box('c').style.display !== 'none', 'and is visible again');
    ok(!doc.querySelector('.ghtf-stub[data-for="later"]'), 'its stub is gone');

    console.log('\n-- the pill says what it left open --');
    const pill = doc.getElementById('ghtf-pill');
    ok(/2 with comments/.test(pill.textContent),
        'pill reports both files kept open (got: ' + pill.textContent + ')');

    console.log('\n-- and debug() names the state --');
    const rows = api.debug();
    ok(rows.filter(r => r.state === 'commented').length === 2, 'two rows marked commented');

    console.log('\n' + (failures === 0 ? 'ALL COMMENT-GUARD ASSERTIONS PASS' : failures + ' COMMENT-GUARD FAILURES'));
    process.exit(failures ? 1 : 0);
})();
