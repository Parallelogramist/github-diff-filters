/**
 * Finding the PR's own +/- totals when they carry no id, which is how GitHub's
 * newer review view renders them. The trap is that a per-file header shows the
 * same "+N -M" shape, so the PR total has to win — it is rendered first.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

// A toolbar with the totals split across two leaves and no id anywhere, then a
// file whose own header repeats the shape. The second file's container class
// deliberately does not match the file selector, so document order is what
// keeps the per-file numbers from being picked.
const file = (p, added, deleted, cls) => `<div class="${cls}" data-file-path="${p}">
  <div class="file-header" data-path="${p}"><div class="file-info"><a title="${p}">${p}</a></div>
    <span>+${added}</span><span>-${deleted}</span></div>
  <table><tbody><tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ x</td></tr></tbody></table>
</div>`;

const html = `<!doctype html><html><body>
  <div id="toolbar"><span>+5,826</span><span>-179</span><span class="blocks"></span></div>
  <div id="files">
    ${file('src/app.spec.ts', 9, 3, 'file js-file')}
    ${file('src/app.ts', 40, 12, 'file js-file')}
    ${file('src/other.spec.ts', 7, 1, 'SomeFutureDiff-module__thing')}
  </div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/9/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const doc = dom.window.document;
    dom.window.eval(src);

    const badge = doc.querySelector('.ghtf-visible-stat');
    ok(!!badge, 'badge rendered with no #diffstat present');
    ok(badge && badge.parentElement.id === 'toolbar',
        'badge landed on the PR toolbar (got: ' + (badge && badge.parentElement.id) + ')');
    ok(badge && !badge.closest('.js-file'), 'badge is not inside a file header');
    // 5,826 total less the 9 added in the one hidden matching file, likewise 179 less 3.
    ok(badge && /\+5,817/.test(badge.textContent) && /176/.test(badge.textContent),
        'totals are the PR figures less the hidden file (got: ' + (badge && badge.textContent) + ')');

    console.log('\n-- the action chip carries no background --');
    const chip = doc.querySelector('.ghdf-pill-action');
    ok(!!chip, 'action chip rendered');
    ok(chip && !/background/.test(chip.getAttribute('style') || ''), 'chip declares no background');
    ok(chip && /padding:\s*3px 9px/.test(chip.getAttribute('style') || ''),
        'chip keeps its padding, so the label stays put');

    console.log('\n' + (failures === 0 ? 'ALL TOTALS-HOST ASSERTIONS PASS' : failures + ' TOTALS-HOST FAILURES'));
    process.exit(failures ? 1 : 0);
})();
