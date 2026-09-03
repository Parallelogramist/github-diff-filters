const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SRC = path.join(__dirname, '..', 'hide-test-files.src.js');
const src = fs.readFileSync(process.argv[2] || SRC, 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// jsdom reports readyState 'loading' right after construction, so the script's
// DOMContentLoaded deferral kicks in; wait for load before asserting.
async function makeDom(html) {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/1/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    return dom;
}

function oldUiFile(path, adds, dels) {
    return `<div class="file js-file" id="f-${path.replace(/\W/g, '')}">
      <div class="file-header" data-path="${path}">
        <div class="file-info"><a title="${path}" href="#">${path}</a>
        <span aria-label="${adds} additions &amp; ${dels} deletions"></span></div>
      </div>
      <table><tbody>
        <tr><td class="blob-num blob-num-addition">1</td><td class="blob-code blob-code-addition">+ code</td></tr>
        <tr><td class="blob-num blob-num-deletion">2</td><td class="blob-code blob-code-deletion">- code</td></tr>
      </tbody></table></div>`;
}
function newUiFile(path) {
    return `<div class="Diff-module__diffTargetable--x9" data-file-anchor="diff-abc">
      <div class="Diff-module__diffHeader--a1"><a href="#">${path}</a></div>
      <div class="Diff-module__diffLine--q">+ code</div></div>`;
}

const html = `<!doctype html><html><body><div id="files">
  ${oldUiFile('server/lib/pricing/rateTable.js', 12, 3)}
  ${oldUiFile('test/api/spec/checkoutFlow.js', 40, 0)}
  ${oldUiFile('client/app/widgets/gauge/gauge.component.spec.ts', 8, 2)}
  ${newUiFile('client/app/widgets/gauge/gauge.component.ts')}
  ${newUiFile('pkg/server/handler_test.go')}
</div></body></html>`;

(async () => {
    const dom = await makeDom(html);
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;

    console.log('\n-- initial pass (5 files: 3 test, 2 source) --');
    const state = p => {
        for (const el of doc.querySelectorAll('.js-file,[class^="Diff-module__diffTargetable"]')) {
            const a = el.querySelector('a');
            if (a && a.textContent.trim() === p) return el;
        }
        return null;
    };
    const spec = state('client/app/widgets/gauge/gauge.component.spec.ts');
    const jasmineSpec = state('test/api/spec/checkoutFlow.js');
    const goTest = state('pkg/server/handler_test.go');
    const source = state('server/lib/pricing/rateTable.js');
    const newUiSource = state('client/app/widgets/gauge/gauge.component.ts');

    ok(spec.getAttribute('data-ghtf') === 'hidden', 'old-UI .spec.ts marked hidden');
    ok(spec.style.display === 'none', 'old-UI .spec.ts display:none');
    ok(jasmineSpec.getAttribute('data-ghtf') === 'hidden', 'old-UI test/ dir file marked hidden');
    ok(goTest.getAttribute('data-ghtf') === 'hidden', 'NEW-UI _test.go marked hidden (path from header link)');
    ok(source.getAttribute('data-ghtf') === 'source', 'old-UI source file marked source');
    ok(source.style.display !== 'none', 'old-UI source file still visible');
    ok(newUiSource.getAttribute('data-ghtf') === 'source', 'NEW-UI source file marked source');
    ok(doc.querySelectorAll('.ghtf-stub').length === 3, 'three stubs inserted (got ' + doc.querySelectorAll('.ghtf-stub').length + ')');
    ok(spec.previousElementSibling.classList.contains('ghtf-stub'), 'stub sits immediately before its file');

    const stub = spec.previousElementSibling;
    ok(stub.textContent.includes('client/app/widgets/gauge/gauge.component.spec.ts'), 'stub shows the path');
    ok(stub.textContent.includes('+8 −2'), 'stub shows the diffstat from aria-label (got: ' + JSON.stringify(stub.textContent.replace(/\s+/g, ' ')) + ')');
    ok(/rule: js\/ts spec/.test(stub.title), 'stub title names the matching rule');

    console.log('\n-- pill --');
    const pill = doc.getElementById('ghtf-pill');
    ok(!!pill, 'pill rendered');
    ok(/3 test files hidden/.test(pill.textContent), 'pill counts 3 hidden (got: ' + pill.textContent + ')');
    ok(pill.style.bottom === '16px', 'pill at bottom:16px with no comment-filter pill');

    console.log('\n-- pill stacks above the comment-filter pill --');
    const other = doc.createElement('div');
    other.id = 'ghccf-pill';
    doc.body.appendChild(other);
    api.apply();
    // Measured from the neighbour rather than a fixed offset, so the two never
    // overlap when one of them wraps to a second line.
    ok(pill.style.bottom === `${other.offsetHeight + 24}px`,
        'pill sits clear of #ghccf-pill, measured from its height (got ' + pill.style.bottom + ')');
    ok(pill.style.bottom !== '16px', 'and no longer sits at the base position');
    other.remove();

    console.log('\n-- click a stub to reveal one file --');
    stub.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(spec.getAttribute('data-ghtf') === 'shown', 'clicked file marked shown');
    ok(spec.style.display === '', 'clicked file visible again');
    ok(!doc.body.contains(stub), 'stub removed');
    ok(/2 test files hidden/.test(doc.getElementById('ghtf-pill').textContent), 'pill recounts to 2 (got: ' + doc.getElementById('ghtf-pill').textContent + ')');

    console.log('\n-- a reprocess must not re-hide a manually revealed file --');
    api.apply();
    ok(spec.getAttribute('data-ghtf') === 'shown', 'revealed file stays shown across an apply()');
    ok(doc.querySelectorAll('.ghtf-stub').length === 2, 'still 2 stubs, no duplicates');

    console.log('\n-- lazy-loaded file gets hidden by the observer --');
    const holder = doc.createElement('div');
    holder.innerHTML = oldUiFile('spec/models/user_spec.rb', 5, 1);
    doc.getElementById('files').appendChild(holder.firstElementChild);
    await sleep(450);
    const lazy = state('spec/models/user_spec.rb');
    ok(lazy.getAttribute('data-ghtf') === 'hidden', 'lazily appended test file hidden by MutationObserver');
    ok(doc.querySelectorAll('.ghtf-stub').length === 3, 'stub count back to 3');

    console.log('\n-- a mutation arriving mid-write is deferred, not dropped --');
    api.apply();                                       // suppressObserver is true for this task
    const holder3 = doc.createElement('div');
    holder3.innerHTML = oldUiFile('api/test_views.py', 3, 0);
    doc.getElementById('files').appendChild(holder3.firstElementChild);
    await sleep(900);
    ok(state('api/test_views.py').getAttribute('data-ghtf') === 'hidden', 'file appended during suppression still gets hidden');

    console.log('\n-- toggle off --');
    api.enabled = false;
    ok(doc.querySelectorAll('.ghtf-stub').length === 0, 'all stubs removed when disabled');
    ok(!goTest.hasAttribute('data-ghtf'), 'state attribute cleared when disabled');
    ok(goTest.style.display === '', 'test file visible when disabled');
    ok(/Test files shown/.test(doc.getElementById('ghtf-pill').textContent), 'pill offers to re-hide');
    // The pill writes the repository on screen, not the global default.
    ok(window.localStorage.getItem('gh-hide-test-files:enabled:acme/repo') === 'false',
        'disabled state persisted against this repository');

    console.log('\n-- toggle back on --');
    api.enabled = true;
    ok(doc.querySelectorAll('.ghtf-stub').length === 5, 'all 5 test files hidden again (got ' + doc.querySelectorAll('.ghtf-stub').length + ')');
    ok(window.localStorage.getItem('gh-hide-test-files:enabled:acme/repo') === 'true',
        'enabled state persisted against this repository');

    console.log('\n-- api.show(needle) --');
    ok(api.show('handler_test.go') === 1, 'show() revealed exactly the matching file');
    ok(goTest.getAttribute('data-ghtf') === 'shown', 'targeted file shown');
    ok(doc.querySelectorAll('.ghtf-stub').length === 4, 'other files stay hidden');

    console.log('\n-- api.addRule persists a custom pattern --');
    api.addRule('/legacy-checks/');
    const holder2 = doc.createElement('div');
    holder2.innerHTML = oldUiFile('server/legacy-checks/validate.js', 2, 2);
    doc.getElementById('files').appendChild(holder2.firstElementChild);
    api.apply();
    const custom = state('server/legacy-checks/validate.js');
    ok(custom.getAttribute('data-ghtf') === 'hidden', 'custom rule hides the matching file');
    ok(api.rules.some(r => r.name === 'custom'), 'custom rule listed in api.rules');
    ok(JSON.parse(window.localStorage.getItem('gh-hide-test-files:customRules')).includes('/legacy-checks/'), 'custom rule persisted');
    api.clearCustomRules();
    ok(!api.rules.some(r => r.name === 'custom'), 'clearCustomRules drops it');
    ok(state('server/legacy-checks/validate.js').getAttribute('data-ghtf') === 'source', 'file reclassified as source after clearing');

    console.log('\n-- debug() --');
    const rows = api.debug();
    ok(Array.isArray(rows) && rows.length >= 7, 'debug() returns a row per file (' + rows.length + ')');
    ok(rows.some(r => r.rule === 'go test'), 'debug() names the matching rule');

    console.log('\n-- no-diff page --');
    const empty = await makeDom('<!doctype html><html><body></body></html>');
    empty.window.eval(src);
    const emptyPill = empty.window.document.getElementById('ghtf-pill');
    ok(emptyPill.style.display === 'none', 'pill hidden with no diff on page');
    ok(/No diff found/.test(empty.window.document.body.textContent), 'toast explains there is no diff');

    console.log('\n-- second invocation toggles instead of reinstalling --');
    const before = api;
    window.eval(src);
    ok(window.__ghTestFileFilter === before, 're-running the bookmarklet keeps one instance');
    ok(api.enabled === false, 'second invocation flipped enabled to false');
    window.eval(src);
    ok(api.enabled === true, 'third invocation flipped it back');

    console.log('\n' + (failures === 0 ? 'ALL DOM ASSERTIONS PASS' : failures + ' DOM FAILURES'));
    process.exit(failures ? 1 : 0);
})();
