/**
 * Path extraction against GitHub's newer diff markup (the /changes view), where
 * a file container carries no data-path and the header renders the path as text
 * split across a directory span and a filename span.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

/** Header with the path split across spans, then a diffstat, then a control label. */
function newUiFile(parts, stat = '+309', extraHeader = '') {
    return `<div class="Diff-module__diffTargetable--aB3" data-file-anchor="diff-abc">
      <div class="DiffHeader-module__container--x1">
        <button class="DiffHeader-module__chevron--y">▾</button>
        ${parts.map(p => `<span>${p}</span>`).join('')}
        <span>${stat}</span><span>Viewed</span>${extraHeader}
      </div>
      <div class="DiffLine-module__line--z">+ code</div>
    </div>`;
}

const html = `<!doctype html><html><body><div id="files">
  ${newUiFile(['client/app/widgets/gauge/', 'gauge-status.component.spec.ts'])}
  ${newUiFile(['server/lib/pricing/', 'rateTable.ts'], '+12')}
  ${newUiFile(['test/api/spec/checkout/testWorker.js'], '+40')}
  ${newUiFile(['pkg/server/', 'handler_test.go'], '+7', '<a title="Copy">copy</a>')}
  ${newUiFile(['old/legacy.spec.ts', '→', 'client/new/renamed.spec.ts'], '+3')}
  <div class="Diff-module__diffTargetable--aB3">
    <div class="DiffHeader-module__container--x1"><span>Viewed</span><span>+3</span></div>
  </div>
</div></body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/1/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;

    const rows = api.debug();
    const byPath = p => rows.find(r => r.path === p);

    console.log('\n-- path read from header text with no data-path present --');
    ok(!!byPath('client/app/widgets/gauge/gauge-status.component.spec.ts'),
        'directory span + filename span assemble into the full path');
    ok(byPath('client/app/widgets/gauge/gauge-status.component.spec.ts')?.state === 'hidden',
        'that .spec.ts file is hidden');
    ok(byPath('server/lib/pricing/rateTable.ts')?.state === 'source',
        'new-UI source file classified as source, not hidden');
    ok(byPath('test/api/spec/checkout/testWorker.js')?.state === 'hidden',
        'single-leaf path under test/ is hidden');

    console.log('\n-- the diffstat must not glue onto the path --');
    ok(rows.every(r => !/[+−]\d/.test(r.path)), 'no extracted path carries a diffstat suffix');

    console.log('\n-- a non-path label must not be mistaken for the path --');
    ok(byPath('pkg/server/handler_test.go')?.state === 'hidden',
        'header text wins over a title="Copy" label');

    console.log('\n-- rename keeps the new path --');
    ok(byPath('client/new/renamed.spec.ts')?.state === 'hidden', 'renamed file classified on its new path');

    console.log('\n-- an unreadable container is surfaced, not silently skipped --');
    const unreadable = [...doc.querySelectorAll('[class^="Diff-module__diffTargetable"]')]
        .find(el => !el.hasAttribute('data-ghtf'));
    ok(!!unreadable, 'container with no resolvable path stays unmarked so a later pass retries');
    const pill = doc.getElementById('ghtf-pill');
    ok(/⚠ 1 unread/.test(pill.textContent), 'pill reports the unreadable file (got: ' + pill.textContent + ')');
    ok(/debug\(\)/.test(pill.title), 'pill tooltip points at debug()');

    console.log('\n-- totals --');
    const hidden = doc.querySelectorAll('.ghtf-stub').length;
    ok(hidden === 4, '4 of the 5 readable files hidden (got ' + hidden + ')');

    console.log('\n' + (failures === 0 ? 'ALL NEW-UI ASSERTIONS PASS' : failures + ' NEW-UI FAILURES'));
    process.exit(failures ? 1 : 0);
})();
