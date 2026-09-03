/**
 * Noise categories beyond tests, each switchable on its own and per repository.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

const PATHS = [
    'package-lock.json', 'vendor/lib/helper.js', 'src/api/schema.pb.go',
    'src/__snapshots__/Button.snap', 'seeds/pricing.json', 'src/app.spec.ts', 'src/app.ts'
];
const file = (p, i) => `<div data-file-path="${p}"><div class="file js-file" id="diff-${String(i).repeat(64).slice(0, 64)}">
  <div class="file-header" data-path="${p}"><div class="file-info"><a title="${p}">${p}</a>
    <span aria-label="5 additions &amp; 1 deletion"></span></div></div>
  <table><tbody><tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ x</td></tr></tbody></table>
</div></div>`;

const html = `<!doctype html><html><body>
  <span class="diffstat" id="diffstat"><span class="color-fg-success">+70</span><span class="color-fg-danger">−14</span></span>
  <div id="files">${PATHS.map(file).join('')}</div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/4/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;
    const stateOf = p => {
        const rows = api.debug();
        const row = rows.find(r => r.path === p);
        return row && row.state;
    };
    const categoryOf = p => {
        const row = api.debug().find(r => r.path === p);
        return row && row.category;
    };

    console.log('\n-- every category hides by default --');
    ok(api.categories.lockfile === true && api.categories.vendored === true, 'categories default on');
    for (const p of PATHS.slice(0, 6)) ok(stateOf(p) === 'hidden', p + ' hidden');
    ok(stateOf('src/app.ts') === 'source', 'src/app.ts left open');

    console.log('\n-- each file names the category that claimed it --');
    ok(categoryOf('package-lock.json') === 'lockfile', 'lockfile category');
    ok(categoryOf('vendor/lib/helper.js') === 'vendored', 'vendored category');
    ok(categoryOf('src/api/schema.pb.go') === 'generated', 'generated category');
    ok(categoryOf('src/__snapshots__/Button.snap') === 'snapshot', 'snapshot category');
    ok(categoryOf('seeds/pricing.json') === 'data', 'data category');
    ok(categoryOf('src/app.spec.ts') === 'test', 'test category');

    console.log('\n-- the pill stops calling them test files --');
    const pill = doc.getElementById('ghtf-pill').textContent;
    ok(/6 files hidden/.test(pill), 'reads "6 files hidden" (got: ' + pill + ')');

    console.log('\n-- a category can be switched off for this repository --');
    api.setCategory('lockfile', false);
    ok(stateOf('package-lock.json') === 'source', 'the lockfile is open again');
    ok(stateOf('vendor/lib/helper.js') === 'hidden', 'the vendored path is still hidden');
    ok(api.categories.lockfile === false, 'the getter agrees');
    const stored = JSON.parse(window.localStorage.getItem('gh-hide-test-files:categories:acme/repo'));
    ok(stored.lockfile === false, 'stored against the repository (got: ' + JSON.stringify(stored) + ')');

    console.log('\n-- an unknown category is refused --');
    let threw = false;
    try { api.setCategory('nonsense', false); } catch (error) { threw = true; }
    ok(threw, 'setCategory rejects a name it does not know');

    console.log('\n-- turning tests off leaves the rest hiding --');
    api.setCategory('test', false);
    ok(stateOf('src/app.spec.ts') === 'source', 'the spec file is open');
    ok(stateOf('seeds/pricing.json') === 'hidden', 'seeded data still hidden');

    console.log('\n' + (failures === 0 ? 'ALL CATEGORY ASSERTIONS PASS' : failures + ' CATEGORY FAILURES'));
    process.exit(failures ? 1 : 0);
})();
