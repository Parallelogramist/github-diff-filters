/**
 * Per-file counts in the newer review view, where a file carries no
 * aria-label diffstat, no .diffstat element, and a diff body that is not a
 * table of .blob-code cells. The signed pair lives in the header as plain
 * text, and nothing else in the container reveals it.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

// Header class deliberately unlike anything the header selector lists, so the
// counts have to be found without knowing where the header is.
const file = (p, added, deleted) => `<div class="Diff-module__diffTargetable--z9">
  <div class="Prc-module__toolbar--k2">
    <button>▾</button><span>+${added}</span><span>-${deleted}</span>
    <span class="blocks"></span><span>${p}</span><span>Viewed</span>
  </div>
  <div class="DiffLine-module__line--q">+ code()</div>
  <div class="DiffLine-module__line--q">- gone()</div>
</div>`;

const html = `<!doctype html><html><body>
  <div id="toolbar"><span>+5,826</span><span>-179</span></div>
  <div id="files">
    ${file('client/app/widgets/gauge/gauge.component.spec.ts', 9, 3)}
    ${file('test/api/spec/checkoutFlow.js', 40, 12)}
    ${file('server/lib/pricing/rateTable.ts', 100, 20)}
  </div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/9/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const doc = dom.window.document;
    dom.window.eval(src);
    const api = dom.window.__ghTestFileFilter;

    console.log('\n-- per-file counts come from the header text --');
    const rows = api.debug();
    const spec = rows.find(r => r.path.endsWith('gauge.component.spec.ts'));
    ok(!!spec, 'the spec file was classified');
    ok(spec && spec.stat === '+9 −3', 'its stat reads +9 −3 rather than nothing (got: ' + (spec && spec.stat) + ')');
    const suite = rows.find(r => r.path.startsWith('test/'));
    ok(suite && suite.stat === '+40 −12', 'the test-dir file reads +40 −12 (got: ' + (suite && suite.stat) + ')');

    console.log('\n-- so the header figure is the total less the hidden files --');
    const badge = doc.querySelector('.ghtf-visible-stat');
    ok(!!badge, 'badge rendered');
    // Hidden: +9−3 and +40−12 = +49 −15. 5,826−49 = 5,777. 179−15 = 164.
    ok(badge && /\+5,777/.test(badge.textContent),
        'additions read 5,777, not the untouched total (got: ' + (badge && badge.textContent) + ')');
    ok(badge && /164/.test(badge.textContent),
        'deletions read 164 (got: ' + (badge && badge.textContent) + ')');
    ok(badge && !/5,826/.test(badge.textContent),
        'the figure differs from the PR total, which is the bug this pins');

    console.log('\n-- report() carries what a future miss needs --');
    const report = api.report();
    ok(report && report.totalsHost, 'report names the totals host');
    ok(report && Array.isArray(report.sampleHeaderLeaves) && report.sampleHeaderLeaves.length > 0,
        'report lists the header text leaves it saw');
    ok(report && report.sampleCounts && report.sampleCounts.added === 9,
        'report shows the counts it read for a hidden file');

    console.log('\n' + (failures === 0 ? 'ALL CHANGES-COUNT ASSERTIONS PASS' : failures + ' CHANGES-COUNT FAILURES'));
    process.exit(failures ? 1 : 0);
})();
