/**
 * A file GitHub leaves collapsed renders few or no diff rows while its header
 * still shows the real changed-lines total. Counting rows would silently
 * under-report it, so both the stub and the header summary must fall back to
 * changed lines instead of publishing a wrong +/- split.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

// src/app.ts is fully rendered; test/big.test.ts reports 60 changed lines in its
// header but has rendered only one row so far.
const html = `<!doctype html><html><body>
  <span class="diffstat" id="diffstat">
    <span class="color-fg-success">+100</span><span class="color-fg-danger">−20</span>
  </span>
  <div id="files">
    <div class="file js-file" id="diff-${'a'.repeat(64)}">
      <div class="file-header" data-path="src/app.ts"><div class="file-info">
        <a title="src/app.ts">src/app.ts</a></div>
        <span class="diffstat" aria-hidden="true">60 <span class="diffstat-block-added"></span></span>
      </div>
      <table><tbody>
        ${'<tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ x</td></tr>'.repeat(50)}
        ${'<tr><td class="blob-num">1</td><td class="blob-code blob-code-deletion">- x</td></tr>'.repeat(10)}
      </tbody></table>
    </div>
    <div class="file js-file" id="diff-${'b'.repeat(64)}">
      <div class="file-header" data-path="test/big.test.ts"><div class="file-info">
        <a title="test/big.test.ts">test/big.test.ts</a></div>
        <span class="diffstat" aria-hidden="true">60 <span class="diffstat-block-added"></span></span>
      </div>
      <table><tbody><tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ x</td></tr></tbody></table>
    </div>
  </div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/1/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const doc = dom.window.document;
    dom.window.eval(src);

    const stub = doc.querySelector('.ghtf-stub');
    const badge = doc.querySelector('.ghtf-visible-stat');

    console.log('\n-- a collapsed file reports changed lines, not a wrong split --');
    ok(!!stub, 'the collapsed test file is still hidden');
    ok(/60 lines/.test(stub.textContent), 'stub shows "60 lines" rather than "+1 −0" (got: ' + stub.textContent + ')');
    ok(!/\+1/.test(stub.textContent), 'stub does not publish the under-counted row total');

    console.log('\n-- the header summary matches those units --');
    ok(/60 lines/.test(badge.textContent), 'badge shows 120 total − 60 hidden = 60 lines (got: ' + badge.textContent + ')');
    ok(/60 changed lines/.test(badge.title), 'tooltip states what was excluded (got: ' + badge.title + ')');

    console.log('\n-- a fully rendered file still gets an exact signed split --');
    const rendered = doc.getElementById('diff-' + 'a'.repeat(64));
    ok(rendered.getAttribute('data-ghtf') === 'source', 'src/app.ts kept as source');
    const rows = dom.window.__ghTestFileFilter.debug();
    const appRow = rows.find(r => r.path === 'src/app.ts');
    ok(appRow.stat === '+50 −10', 'its 50 additions and 10 deletions foot to the header total (got: ' + appRow.stat + ')');

    console.log('\n' + (failures === 0 ? 'ALL COLLAPSED-FILE ASSERTIONS PASS' : failures + ' COLLAPSED FAILURES'));
    process.exit(failures ? 1 : 0);
})();
