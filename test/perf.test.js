/**
 * What a pass costs, in the currency a pass is built from.
 *
 * GitHub renders a large diff in bursts for seconds and mutates the page while
 * it does, so passes run throughout. The cost that matters is therefore not the
 * first pass but every one after it, and the thing to hold down is how much of
 * the document a pass reads: selector calls and tree walks, counted here rather
 * than timed, because wall-clock in jsdom measures the harness.
 *
 * The property under test: a pass reads the file that changed, not the diff.
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

const COUNT = 300;
const PATHS = Array.from({ length: COUNT }, (_, i) =>
    i % 3 === 0 ? `test/api/spec/case${i}.js` : `server/lib/mod${i}.js`);

const rows = n => Array.from({ length: n }, (_, i) =>
    `<tr><td class="blob-num">${i}</td><td class="blob-code blob-code-addition">+ line ${i}</td></tr>`).join('');
const file = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x"><span>${p}</span>
    <span class="sr-only">Lines changed: 12 additions &amp; 3 deletions</span></div>
  <table>${rows(20)}</table>
</div>`;
const treeRow = p => `<li role="treeitem" data-tree-entry-type="file" id="${p}">`
    + `<span class="item-text"><a href="#${anchor(p)}">${p.split('/').pop()}</a></span>`
    + '<span>+12</span><span>&minus;3</span></li>';

const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/2/files">Files changed <span>${COUNT}</span></a></nav>
  <div id="toolbar"><span>+3600</span><span>&minus;900</span></div>
  <ul role="tree">${PATHS.map(treeRow).join('')}</ul>
  <div id="files">${PATHS.map(file).join('')}</div>
</body></html>`;

/**
 * Selector calls and tree walks, counted on the prototypes so every one the
 * script makes is seen, whichever element it is made against.
 */
function countSelectorWork(window) {
    const tally = { ops: 0, walks: 0 };
    const patch = (proto, name, field) => {
        const original = proto[name];
        if (typeof original !== 'function') return;
        proto[name] = function (...args) {
            tally[field]++;
            return original.apply(this, args);
        };
    };
    for (const name of ['querySelector', 'querySelectorAll']) {
        patch(window.Document.prototype, name, 'ops');
        patch(window.Element.prototype, name, 'ops');
    }
    for (const name of ['closest', 'matches']) patch(window.Element.prototype, name, 'ops');
    patch(window.Document.prototype, 'createTreeWalker', 'walks');
    return tally;
}

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/2/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const tally = countSelectorWork(window);

    window.eval(src);
    const first = { ops: tally.ops, walks: tally.walks };
    const api = window.__ghTestFileFilter;
    console.log(`  ${COUNT} files, first pass ${first.ops} selector calls, ${first.walks} walks`);

    const hidden = () => window.document.querySelectorAll('[data-ghtf="hidden"]').length;
    ok(hidden() === 100, `all 100 test files hidden (got ${hidden()})`);

    // A pass asked for by hand re-decides the diff, so it is the upper bound on
    // what any pass costs once the diff has settled.
    tally.ops = 0;
    tally.walks = 0;
    api.apply();
    const forced = { ops: tally.ops, walks: tally.walks };
    console.log(`  forced pass on a settled diff ${forced.ops} selector calls, ${forced.walks} walks`);
    ok(forced.ops < first.ops / 2,
        `a settled diff is not re-read to re-decide it (${forced.ops} vs ${first.ops} calls)`);

    // The production path: GitHub appends one file, the observer reports where
    // it landed, and the pass that follows reads that file rather than the diff.
    console.log('\n-- one more file arrives --');
    const late = 'test/api/spec/late.js';
    tally.ops = 0;
    tally.walks = 0;
    const fresh = window.document.createElement('div');
    fresh.className = 'Diff-module__diffTargetable--z9';
    fresh.id = anchor(late);
    fresh.innerHTML = '<div class="Diff-module__diffHeaderWrapper__x"><span>' + late + '</span>'
        + '<span class="sr-only">Lines changed: 1 additions &amp; 0 deletions</span></div>';
    window.document.getElementById('files').appendChild(fresh);
    window.document.querySelector('[role="tree"]').insertAdjacentHTML('beforeend', treeRow(late));
    await sleep(500);
    const incremental = { ops: tally.ops, walks: tally.walks };
    console.log(`  incremental pass ${incremental.ops} selector calls, ${incremental.walks} walks`);

    ok(fresh.getAttribute('data-ghtf') === 'hidden',
        `a file appended after the diff settled is classified by the observer alone `
        + `(got ${fresh.getAttribute('data-ghtf')})`);
    ok(incremental.ops < first.ops / 3,
        `the pass reads the file that arrived, not the diff (${incremental.ops} vs ${first.ops} calls)`);
    ok(incremental.walks <= COUNT / 2,
        `and walks a fraction of the headers (${incremental.walks} walks over ${COUNT} files)`);

    // A pass whose work another already did has nothing to read. Reaching this
    // needs a reveal by hand to land between a mutation and the pass it booked.
    console.log('\n-- a pass whose work is already done --');
    window.document.getElementById('files').appendChild(window.document.createElement('div'));
    await sleep(10);
    api.apply();
    // Let the observer see the pass's own writes and discard them, so what is
    // counted below is the superseded pass and nothing else.
    await sleep(10);
    tally.ops = 0;
    tally.walks = 0;
    await sleep(500);
    console.log(`  superseded pass ${tally.ops} selector calls, ${tally.walks} walks`);
    ok(tally.ops === 0, `a pass with nothing to react to reads nothing (${tally.ops} calls)`);

    console.log('\n' + (failures === 0 ? 'ALL PERF ASSERTIONS PASS' : failures + ' PERF FAILURES'));
    process.exit(failures ? 1 : 0);
})();
