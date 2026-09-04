/**
 * File-tree mirroring and the visible change-count summary, against the markup
 * the classic PR view actually renders: tree rows are
 * `li[role=treeitem][data-tree-entry-type]` keyed `file-tree-item-diff-<sha>`,
 * and the diff container for the same file is `#diff-<sha>`.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

const sha = n => String(n).repeat(64).slice(0, 64);
const FILES = [
    { p: 'src/app.ts', add: 50, del: 10, sha: sha(1) },
    { p: 'src/app.spec.ts', add: 30, del: 5, sha: sha(2) },
    { p: 'test/e2e/one.test.ts', add: 10, del: 0, sha: sha(3) },
    { p: 'test/e2e/two.test.ts', add: 10, del: 5, sha: sha(4) }
];

const diffFile = f => `<div data-file-path="${f.p}"><div class="file js-file" id="diff-${f.sha}" data-tagsearch-path="${f.p}">
  <div class="file-header" data-path="${f.p}"><div class="file-info">
    <a title="${f.p}" href="#diff-${f.sha}">${f.p}</a>
    <span aria-label="${f.add} additions &amp; ${f.del} deletions"></span></div></div>
  <table><tbody><tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ x</td></tr></tbody></table>
</div></div>`;

// The last row deliberately carries no id, exercising the label fallback.
const treeFile = (f, withId = true) =>
    `<li role="treeitem" data-tree-entry-type="file"${withId ? ` id="file-tree-item-diff-${f.sha}"` : ''}>
       <a href="#diff-${f.sha}">${f.p}</a></li>`;

const html = `<!doctype html><html><body>
  <span class="diffstat" id="diffstat">
    <span class="color-fg-success">+100</span><span class="color-fg-danger">−20</span>
  </span>
  <ul role="tree">
    <li role="treeitem" data-tree-entry-type="directory" id="tree-src"><span>src</span>
      <ul role="group">${treeFile(FILES[0])}${treeFile(FILES[1])}</ul></li>
    <li role="treeitem" data-tree-entry-type="directory" id="tree-test"><span>test</span>
      <ul role="group">
        <li role="treeitem" data-tree-entry-type="directory" id="tree-e2e"><span>e2e</span>
          <ul role="group">${treeFile(FILES[2])}${treeFile(FILES[3], false)}</ul></li>
      </ul></li>
  </ul>
  <div id="files">${FILES.map(diffFile).join('')}</div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/1/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;

    const treeRow = f => doc.getElementById('file-tree-item-diff-' + f.sha);
    const hiddenRow = el => el.getAttribute('data-ghtf-tree') === 'hidden' && el.style.display === 'none';
    const noIdRow = [...doc.querySelectorAll('[role="treeitem"][data-tree-entry-type="file"]')]
        .find(el => !el.id);

    console.log('\n-- tree rows mirror the diff verdicts --');
    ok(hiddenRow(treeRow(FILES[1])), 'src/app.spec.ts tree row hidden (joined by diff-<sha> id)');
    ok(hiddenRow(treeRow(FILES[2])), 'test/e2e/one.test.ts tree row hidden');
    ok(hiddenRow(noIdRow), 'row with no id hidden via its label (got display=' + noIdRow.style.display + ')');
    ok(!hiddenRow(treeRow(FILES[0])), 'src/app.ts source row left visible');

    console.log('\n-- directories go only when every file under them goes --');
    ok(hiddenRow(doc.getElementById('tree-e2e')), 'test/e2e directory hidden (all files are tests)');
    ok(hiddenRow(doc.getElementById('tree-test')), 'test directory hidden (all descendants are tests)');
    ok(!hiddenRow(doc.getElementById('tree-src')), 'src directory kept (holds a source file)');

    console.log('\n-- visible change counts beside the PR totals --');
    const badge = doc.querySelector('.ghtf-visible-stat');
    ok(!!badge, 'badge injected into #diffstat');
    ok(badge && badge.parentElement.id === 'diffstat', 'badge sits with the full counts');
    // Hidden: +30−5, +10−0, +10−5 = +50 −10. Totals +100 −20 leaves +50 −10.
    ok(/\+50/.test(badge.textContent) && /−10/.test(badge.textContent),
        'badge reports +50 −10 (got: ' + badge.textContent + ')');
    ok(/3 hidden files \(\+50 −10\)/.test(badge.title),
        'badge tooltip accounts for what was excluded (got: ' + badge.title + ')');
    ok(/after filter/.test(badge.textContent),
        'badge is labelled after filter (got: ' + badge.textContent + ')');

    console.log('\n-- revealing one file updates tree and counts --');
    doc.querySelectorAll('.ghtf-stub')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(!hiddenRow(treeRow(FILES[1])), 'revealed file gets its tree row back');
    ok(!hiddenRow(doc.getElementById('tree-src')), 'src directory still visible');
    const after = doc.querySelector('.ghtf-visible-stat');
    ok(/\+80/.test(after.textContent) && /−15/.test(after.textContent),
        'counts move to +80 −15 once a +30 −5 file is shown (got: ' + after.textContent + ')');

    console.log('\n-- toggling off restores the tree and drops the badge --');
    api.enabled = false;
    ok(doc.querySelectorAll('[data-ghtf-tree]').length === 0, 'no tree row left marked');
    ok([...doc.querySelectorAll('[role="treeitem"]')].every(el => el.style.display !== 'none'), 'every tree row visible');
    ok(!doc.querySelector('.ghtf-visible-stat'), 'badge removed');

    console.log('\n-- toggling back on re-hides both --');
    api.enabled = true;
    ok(hiddenRow(treeRow(FILES[2])), 'tree row hidden again');
    ok(/\+50/.test(doc.querySelector('.ghtf-visible-stat').textContent), 'badge back to +50');

    console.log('\n' + (failures === 0 ? 'ALL TREE ASSERTIONS PASS' : failures + ' TREE FAILURES'));
    process.exit(failures ? 1 : 0);
})();
