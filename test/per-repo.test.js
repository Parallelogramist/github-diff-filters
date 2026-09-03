/**
 * A preference set on one repository must not follow you to the next one, and a
 * repository with no preference of its own follows the global default.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const KEY = 'gh-hide-test-files:enabled';

const html = `<!doctype html><html><body><div id="files">
  <div data-file-path="src/app.spec.ts"><div class="file js-file" id="diff-${'a'.repeat(64)}">
    <div class="file-header" data-path="src/app.spec.ts"><div class="file-info">
      <a title="src/app.spec.ts">src/app.spec.ts</a></div></div>
    <table><tbody><tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ x</td></tr></tbody></table>
  </div></div>
</div></body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/one/pull/1/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;
    const store = window.localStorage;

    console.log('\n-- a repo with no preference follows the global default --');
    ok(api.repo === 'acme/one', 'repo scope read from the path (got: ' + api.repo + ')');
    ok(api.enabled === true, 'hiding on by default');
    ok(doc.querySelectorAll('.ghtf-stub').length === 1, 'the spec file is hidden');

    console.log('\n-- toggling writes the repo, not the global default --');
    api.enabled = false;
    ok(store.getItem(KEY + ':acme/one') === 'false', 'repo preference stored');
    ok(store.getItem(KEY) === null, 'global default untouched (got: ' + store.getItem(KEY) + ')');
    ok(api.defaultEnabled === true, 'global default still on');
    ok(doc.querySelectorAll('.ghtf-stub').length === 0, 'nothing hidden in this repo');

    console.log('\n-- another repo is unaffected --');
    dom.reconfigure({ url: 'https://github.com/acme/two/pull/5/files' });
    api.apply();
    ok(api.repo === 'acme/two', 'scope followed the navigation');
    ok(api.enabled === true, 'second repo still hides, using the global default');
    ok(doc.querySelectorAll('.ghtf-stub').length === 1, 'and its spec file is hidden');

    console.log('\n-- the global default can be moved on its own --');
    api.defaultEnabled = false;
    ok(store.getItem(KEY) === 'false', 'global default stored');
    ok(api.enabled === false, 'this repo follows it');
    dom.reconfigure({ url: 'https://github.com/acme/one/pull/1/files' });
    api.apply();
    ok(api.enabled === false, 'the repo with its own "false" agrees');

    console.log('\n-- and a repo can be handed back to the default --');
    api.defaultEnabled = true;
    const cleared = api.clearRepoPreference();
    ok(store.getItem(KEY + ':acme/one') === null, 'repo preference removed');
    ok(cleared.enabled === true, 'it now follows the default again (got: ' + JSON.stringify(cleared) + ')');

    console.log('\n' + (failures === 0 ? 'ALL PER-REPO ASSERTIONS PASS' : failures + ' PER-REPO FAILURES'));
    process.exit(failures ? 1 : 0);
})();
