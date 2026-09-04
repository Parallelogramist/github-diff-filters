/**
 * Invariants, checked after every kind of operation rather than at one moment.
 *
 * The bugs this extension has actually had were all consistency failures rather
 * than wrong verdicts: a stub left behind by a container GitHub replaced, a
 * pill reporting a count nothing on the page agreed with, a file marked shown
 * while still hidden. Each of those is an invariant, so each is checked here.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');

const FILES = [
    'test/api/spec/one.js', 'test/api/spec/two.js', 'yarn.lock',
    'server/lib/rates.js', 'client/app/x.component.spec.ts', 'docs/readme.md'
];
const file = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x"><span>${p}</span>
    <span class="sr-only">Lines changed: 8 additions &amp; 2 deletions</span>
    <label><input type="checkbox"> Viewed</label></div>
  <div class="DiffLine-module__line--q">+ code()</div></div>`;
const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}"><span>${p}</span></li>`;
const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/1/files">Files changed <span>${FILES.length}</span></a></nav>
  <div id="toolbar"><span>+48</span><span>&minus;12</span></div>
  <ul role="tree">${FILES.map(treeRow).join('')}</ul>
  <div id="files">${FILES.map(file).join('')}</div>
</body></html>`;

const STATES = ['hidden', 'unchanged', 'commented', 'source', 'shown', 'pending'];

/** Every invariant, as one check that names whichever one broke. */
function violations(doc, api) {
    const out = [];
    const containers = [...doc.querySelectorAll('.js-file,[class^="Diff-module__diffTargetable"]')];
    const sheet = doc.getElementById('ghtf-style');
    const rules = sheet ? (sheet.textContent.match(/#diff-[0-9a-f]+/g) || []) : [];
    const hidden = containers.filter(c => c.getAttribute('data-ghtf') === 'hidden');
    const stubs = [...doc.querySelectorAll('.ghtf-stub')];

    for (const container of containers) {
        const state = container.getAttribute('data-ghtf');
        if (state && !STATES.includes(state)) out.push(`unknown state ${state}`);
        if (state === 'shown' && container.classList.contains('ghtf-hidden-file')) {
            out.push('a shown file still carries the hidden class');
        }
        if (state === 'shown' && rules.includes('#' + container.id)) {
            out.push('a shown file is still hidden by the stylesheet');
        }
        if (state === 'hidden' && !rules.includes('#' + container.id)
            && container.style.display !== 'none') {
            out.push('a hidden file is not actually hidden');
        }
    }
    for (const container of hidden) {
        const owned = stubs.filter(s => s.id === 'ghtf-stub-' + container.id);
        if (owned.length !== 1) out.push(`hidden file has ${owned.length} stubs`);
    }
    for (const stub of stubs) {
        const id = stub.id.replace('ghtf-stub-', '');
        if (id && !doc.getElementById(id)) out.push('a stub outlived its container');
    }
    if (new Set(stubs.map(s => s.id)).size !== stubs.length) out.push('duplicate stub ids');

    const pill = doc.getElementById('ghtf-pill');
    const stated = pill && (pill.textContent.match(/^\D*(\d[\d,]*) (?:test )?files? hidden/) || [])[1];
    if (stated && Number(stated.replace(/,/g, '')) !== hidden.length) {
        out.push(`pill says ${stated} hidden, the page has ${hidden.length}`);
    }
    const report = api.report();
    if (report.orphanStubs !== 0) out.push(`${report.orphanStubs} orphan stubs reported`);
    return out;
}

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/1/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;
    const check = label => {
        const broken = violations(doc, api);
        ok(broken.length === 0, `${label}: ${broken.length === 0 ? 'consistent' : broken.join('; ')}`);
    };

    check('after the first pass');

    api.peek(true);
    check('while peeking');
    api.peek(false);
    check('after the peek ends');

    api.show('yarn.lock');
    check('after showing one file by hand');

    // GitHub replaces the containers of both a hidden and a revealed file.
    for (const p of ['test/api/spec/one.js', 'yarn.lock']) {
        const old = doc.getElementById(anchor(p));
        const fresh = doc.createElement('div');
        fresh.className = 'Diff-module__diffTargetable--z9';
        fresh.id = anchor(p);
        fresh.innerHTML = '<div class="Diff-module__diffHeaderWrapper__x"><span>' + p + '</span>'
            + '<span class="sr-only">Lines changed: 8 additions &amp; 2 deletions</span></div>';
        old.replaceWith(fresh);
    }
    await sleep(1200);
    check('after GitHub replaced two containers');

    api.setCategory('lockfile', false);
    check('after switching a category off');
    api.setCategory('lockfile', true);
    check('after switching it back on');

    const box = doc.querySelector('input[type="checkbox"]');
    if (box) {
        box.checked = true;
        api.apply();
        check('after a file was marked viewed');
        box.checked = false;
        api.apply();
        check('after it was unmarked');
    }

    api.enabled = false;
    check('while switched off for the repository');
    api.enabled = true;
    check('after switching it back on');

    api.onlyChanged = true;
    api.apply();
    check('with unchanged-since-last-visit on');
    api.onlyChanged = false;

    dom.reconfigure({ url: 'https://github.com/acme/other/pull/5/changes' });
    api.apply();
    check('after Turbo carried the instance to another repository');

    api.reset();
    const leftovers = doc.querySelectorAll('.ghtf-stub').length
        + doc.querySelectorAll('[data-ghtf]').length
        + ((doc.getElementById('ghtf-style') || {}).textContent || '').length;
    ok(leftovers === 0, `reset leaves nothing behind (got ${leftovers})`);

    console.log('\n' + (failures === 0 ? 'ALL INVARIANT ASSERTIONS PASS' : failures + ' INVARIANT FAILURES'));
    process.exit(failures ? 1 : 0);
})();
