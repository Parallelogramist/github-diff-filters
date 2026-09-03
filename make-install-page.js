/**
 * Generate install.html from every *.bookmarklet.txt in this directory.
 *
 * A bookmarklet cannot be dragged out of a terminal, so the install path is an
 * HTML page with the javascript: URLs as draggable links.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const TITLES = {
    'hide-test-files': ['🧪 Hide test files', 'Collapses every test file in a PR diff to a one-line stub. Click a stub to open that file; click the pill to toggle all.'],
    'hide-comment-diffs': ['🙈 Hide comment diffs', 'Hides diff lines whose only change is a comment or whitespace.']
};

const cards = fs.readdirSync(HERE)
    .filter(f => f.endsWith('.bookmarklet.txt'))
    .sort()
    .map(file => {
        const name = file.replace('.bookmarklet.txt', '');
        const url = fs.readFileSync(path.join(HERE, file), 'utf8').trim();
        const [title, blurb] = TITLES[name] || [name, ''];
        const kb = (url.length / 1024).toFixed(1);
        return `    <li class="card">
      <a class="btn" href="${url}">${title}</a>
      <p>${blurb}</p>
      <code>${name} · ${kb} KB</code>
    </li>`;
    })
    .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>GitHub diff bookmarklets</title>
<style>
    :root { color-scheme: light dark; }
    body { font: 15px/1.6 -apple-system, system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; }
    h1 { font-size: 1.4rem; margin-bottom: .25rem; }
    .lede { opacity: .7; margin-top: 0; }
    ol.steps { padding-left: 1.2rem; }
    ul { list-style: none; padding: 0; display: grid; gap: 1rem; margin: 2rem 0; }
    .card { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 10px; padding: 1rem 1.25rem; }
    .card p { margin: .6rem 0 .4rem; opacity: .8; }
    .btn { display: inline-block; font-weight: 600; text-decoration: none; padding: .45rem .9rem; border-radius: 8px;
           border: 1px solid color-mix(in srgb, currentColor 30%, transparent); cursor: grab; }
    .btn:active { cursor: grabbing; }
    code { font-size: .8rem; opacity: .6; }
    .note { border-left: 3px solid color-mix(in srgb, currentColor 30%, transparent); padding-left: .9rem; opacity: .85; }
</style>
</head>
<body>
<h1>GitHub diff bookmarklets</h1>
<p class="lede">Drag a button to your bookmarks bar, then click it on a pull request's <strong>Files changed</strong> tab.</p>
<p class="note">Want these to apply <strong>automatically</strong> on every PR diff? Load the extension instead:
open <code>chrome://extensions/</code>, turn on <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>
and pick the <code>extension</code> folder next to this file. The bookmarklets below keep working as manual toggles.</p>
<ol class="steps">
    <li>Show the bookmarks bar (<kbd>⌘⇧B</kbd>).</li>
    <li>Drag a button below onto it.</li>
    <li>Open a PR's Files changed tab and click the bookmark. Click it again to toggle.</li>
</ol>
<ul>
${cards}
</ul>
<p><code>gh-diff-filters</code></p>
</body>
</html>
`;

fs.writeFileSync(path.join(HERE, 'install.html'), html);
console.log('install.html written with ' + (cards.match(/class="card"/g) || []).length + ' bookmarklet(s)');
