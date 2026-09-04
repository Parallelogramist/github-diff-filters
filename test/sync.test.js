/**
 * The filters run in the page's own world, which has no chrome.storage, so
 * every preference lived in localStorage: right on one machine and invisible on
 * the next. bridge.js runs in the isolated world and relays over DOM events,
 * the only channel the two share. Each setting carries when it was written and
 * the newer write wins, because a preference is one value and the alternative
 * is asking someone to resolve a conflict about whether lockfiles are hidden.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', 'extension');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');
const bridge = fs.readFileSync(path.join(EXT, 'bridge.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');

const PREFIX = 'gh-hide-test-files:';
const FILES = ['yarn.lock', 'test/api/spec/one.js', 'server/lib/rates.js'];
const file = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x"><span>${p}</span>
    <span class="sr-only">Lines changed: 4 additions &amp; 1 deletions</span></div></div>`;
const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}"><span>${p}</span></li>`;
const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/4/files">Files changed <span>3</span></a></nav>
  <div id="toolbar"><span>+12</span><span>&minus;3</span></div>
  <ul role="tree">${FILES.map(treeRow).join('')}</ul>
  <div id="files">${FILES.map(file).join('')}</div>
</body></html>`;

/** Enough of chrome.storage.sync to exercise the real bridge. */
function fakeChrome(initial) {
    const store = { settings: initial };
    const listeners = [];
    return {
        store,
        api: {
            storage: {
                sync: {
                    get(key, then) {
                        then({ [key]: store[key] });
                    },
                    set(patch, then) {
                        const before = store.settings;
                        Object.assign(store, patch);
                        for (const fn of listeners) {
                            fn({ settings: { oldValue: before, newValue: store.settings } }, 'sync');
                        }
                        if (then) then();
                    }
                },
                onChanged: { addListener(fn) { listeners.push(fn); } }
            },
            runtime: {}
        }
    };
}

const stateOf = (doc, p) => doc.getElementById(anchor(p)).getAttribute('data-ghtf');

(async () => {
    const now = Date.now();
    // Another machine turned lockfiles off a minute ago.
    const chromeMock = fakeChrome({
        // Per repository, the same way the filter stores it.
        [`${PREFIX}categories:acme/repo`]: { value: '{"lockfile":false}', at: now - 60000 }
    });

    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/4/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.chrome = chromeMock.api;
    window.eval(bridge);
    window.eval(src);
    const api = window.__ghTestFileFilter;

    console.log('=== a preference set on another machine arrives here ===');
    ok(api.categories.lockfile === false, 'the synced category is adopted');
    ok(stateOf(doc, 'yarn.lock') === 'source', 'and takes effect on the diff');
    ok(stateOf(doc, 'test/api/spec/one.js') === 'hidden', 'without disturbing the others');

    console.log('\n=== a change here is offered to the other machines ===');
    api.setCategory('vendored', false);
    const pushed = chromeMock.store.settings[`${PREFIX}categories:acme/repo`];
    ok(!!pushed && /"vendored":false/.test(pushed.value), 'the write reached synced storage');
    ok(pushed.at >= now, 'stamped with when it was written');

    console.log('\n=== an older write does not undo a newer one ===');
    const stale = { [`${PREFIX}categories:acme/repo`]: { value: '{"lockfile":true}', at: now - 600000 } };
    doc.dispatchEvent(new window.CustomEvent('ghdf:sync-data', { detail: { settings: stale } }));
    ok(api.categories.lockfile === false, 'a stale tab catching up is ignored');

    console.log('\n=== a newer write does apply ===');
    const fresh = { [`${PREFIX}enabled:acme/repo`]: { value: 'false', at: Date.now() + 1000 } };
    doc.dispatchEvent(new window.CustomEvent('ghdf:sync-data', { detail: { settings: fresh } }));
    ok(api.enabled === false, 'a newer preference is adopted');
    ok(/Hiding off for this repo/.test(doc.getElementById('ghtf-pill').textContent),
        'and the pill reflects it');

    console.log('\n=== what must never be synced ===');
    const keys = Object.keys(chromeMock.store.settings);
    ok(keys.every(key => !key.includes(':seen')),
        `no per-pull-request snapshot is pushed (got ${JSON.stringify(keys)})`);
    ok(keys.every(key => !key.includes(':paused')), 'a peek stays on this machine');
    ok(keys.every(key => !key.includes('@at')), 'the local write stamps are not themselves settings');

    console.log('\n=== without the bridge, nothing breaks ===');
    const alone = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/4/changes', runScripts: 'outside-only' });
    if (alone.window.document.readyState !== 'complete') {
        await new Promise(r => alone.window.addEventListener('load', r, { once: true }));
    }
    alone.window.eval(src);
    ok(alone.window.__ghTestFileFilter.categories.lockfile !== false,
        'a bookmarklet with no bridge keeps its own local settings');
    ok(alone.window.document.getElementById(anchor('yarn.lock')).getAttribute('data-ghtf') === 'hidden',
        'and still filters');

    console.log('\n' + (failures === 0 ? 'ALL SYNC ASSERTIONS PASS' : failures + ' SYNC FAILURES'));
    process.exit(failures ? 1 : 0);
})();
