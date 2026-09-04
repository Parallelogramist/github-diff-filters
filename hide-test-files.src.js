/**
 * GitHub PR diff: hide test files.
 *
 * Standalone bookmarklet. Independent of hide-comment-diffs — separate storage
 * key, DOM markers and pill, so both can run on the same page.
 *
 * Re-running the bookmarklet toggles hiding on and off.
 */
(() => {
    'use strict';

    if (window.__ghTestFileFilter) {
        window.__ghTestFileFilter.enabled = !window.__ghTestFileFilter.enabled;
        return;
    }

    const ENABLED_KEY = 'gh-hide-test-files:enabled';
    const CUSTOM_RULES_KEY = 'gh-hide-test-files:customRules';
    const ONLY_CHANGED_KEY = 'gh-hide-test-files:onlyChanged';
    const CATEGORIES_KEY = 'gh-hide-test-files:categories';
    const SEEN_KEY = 'gh-hide-test-files:seen';
    const SEEN_INDEX_KEY = 'gh-hide-test-files:seenIndex';
    const SEEN_LIMIT = 20;
    const PAUSED_KEY = 'gh-hide-test-files:paused';
    const SETTING_PREFIX = 'gh-hide-test-files:';
    const WRITTEN_AT = '@at';
    const SYNC_PULL = 'ghdf:sync-pull';
    const SYNC_PUSH = 'ghdf:sync-push';
    const SYNC_DATA = 'ghdf:sync-data';
    const STATE_ATTR = 'data-ghtf';
    const HIDDEN_CLASS = 'ghtf-hidden-file';
    const STUB_CLASS = 'ghtf-stub';
    const PILL_ID = 'ghtf-pill';
    const POPOVER_ID = 'ghtf-popover';
    const CATEGORY_LABELS = {
        test: 'Test files',
        snapshot: 'Snapshots',
        lockfile: 'Lockfiles',
        generated: 'Generated code',
        vendored: 'Vendored code',
        data: 'Seeded data',
        rename: 'Renames with no changes',
        mode: 'Mode-only changes',
        binary: 'Binary files',
        viewed: 'Files you marked viewed'
    };
    const DEBOUNCE_MS = 300;
    const MAX_WAIT_MS = 1000;
    /** On everything this script and its siblings put in the page; the observer skips it. */
    const UI_CLASS = 'ghdf-ui';
    /** Fired after the pill changes, for whatever docks it. */
    const STATE_EVENT = 'ghdf:state';
    const COMMENT_FILTER_PILL_ID = 'ghccf-pill';
    const DOCK_ID = 'ghdf-dock';
    const HIDDEN_STATES = /^(hidden|unchanged)$/;

    const FILE_SELECTOR = ['.js-file', '[class^="Diff-module__diffTargetable"]'].join(',');
    const ADDITION_SELECTOR = ['.blob-code-addition', 'td[data-code-marker="+"]'].join(',');
    const DELETION_SELECTOR = ['.blob-code-deletion', 'td[data-code-marker="-"]'].join(',');
    const PATH_ATTRS = ['data-path', 'data-file-path', 'data-tagsearch-path'];
    const HEADER_SELECTOR = [
        '.file-info', '.file-header',
        '[class*="DiffHeader"]', '[class*="diffHeader"]',
        '[class*="FileHeader"]', '[class*="fileHeader"]'
    ].join(',');
    const DIFFSTAT_LEAF = /^[+\-\u2212\u2013]?\d[\d,]*$/;
    // The review view states a file's counts in words, which is the only place
    // it states them unambiguously: the visible diffstat splits the sign and the
    // number into separate text nodes.
    const LINES_CHANGED = /(\d[\d,]*)\s+additions?\s*(?:&|and|&amp;)\s*(\d[\d,]*)\s+deletions?/i;
    const COMMENTS_HIDDEN = /(\d[\d,]*)\s+comments?\s+hidden/i;
    const TREE_STATE_ATTR = 'data-ghtf-tree';
    const TREE_ITEM_SELECTOR = '[role="treeitem"]';
    const TREE_GROUP_SELECTOR = '[role="group"],[role="treeitem"]';
    const VISIBLE_STAT_CLASS = 'ghtf-visible-stat';
    const ADDED_TOTAL = /^\+[\d,]+$/;
    const DELETED_TOTAL = /^[-\u2212\u2013][\d,]+$/;
    const COMBINED_TOTAL = /^\+[\d,]+\s*[-\u2212\u2013][\d,]+$/;
    const DIFF_BODY_SELECTOR = 'tr,[role="row"],[class*="iffLine"],[class*="diff-line"],.blob-code,.blob-num,table';
    const REVIEW_COMMENT_SELECTOR = [
        '.review-comment', '.js-comment-container', '.js-inline-comments-container .js-comment',
        '[class*="ReviewThread"]', '[class*="reviewThread"]',
        '[data-testid*="comment-thread"]', '[data-testid*="review-thread"]'
    ].join(',');
    const ANCHOR_ID = /(diff-[0-9a-f]{16,})$/i;
    const HUNK_SELECTOR = '.blob-code-hunk,[class*="Hunk"],[class*="hunk"]';
    const STYLE_ID = 'ghtf-style';
    const STUB_ID_PREFIX = 'ghtf-stub-';
    const RESOLVE_ATTEMPT_LIMIT = 40;
    const FILE_COUNT_LABEL = /files?\s+changed/i;
    const RESOLVE_RETRY_MS = 350;
    const CONTROL_LEAF = /^(viewed|expand|collapse|copy|comment|comments|hidden|load|diff|show|hide|unchanged|binary|\u2026|\u22ef)$/i;

    /**
     * A file is a test file by path shape: a directory segment that only ever
     * holds tests, or a filename in one of the per-ecosystem test conventions.
     * Content is never inspected — the header renders long before the diff body,
     * so a path rule can hide a file without waiting for it to load.
     */
    const BUILT_IN_RULES = [
        ['test dir', /(^|\/)(tests?|specs?|__tests__|__mocks__|testdata|test_data|e2e|cypress|playwright)\//i, 'test'],
        ['js/ts spec', /[.\-_](spec|test|cy)\.[cm]?[jt]sx?$/i, 'test'],
        ['py test', /(^|\/)(test_[^/]+|[^/]+_test|conftest)\.py$/i, 'test'],
        ['go test', /_test\.go$/i, 'test'],
        ['rb spec', /_(spec|test)\.rb$/i, 'test'],
        ['jvm test', /(Test|Tests|TestCase|Spec|Specs|IT)\.(java|kt|kts|scala|groovy)$/, 'test'],
        ['dotnet test', /(Test|Tests|Spec|Specs)\.(cs|fs|vb)$/, 'test'],
        ['php test', /Test\.php$/, 'test'],
        ['cucumber', /\.feature$/i, 'test'],
        ['test config', /(^|\/)(jest|vitest|karma|jasmine|playwright|cypress|codecept|protractor|wdio|nyc)\.[^/]*(conf|config|setup)\.[cm]?[jt]s$/i, 'test'],
        ['snapshot', /(\.snap$|(^|\/)__snapshots__\/)/i, 'snapshot'],
        ['lockfile', /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|Pipfile\.lock|go\.sum)$/i, 'lockfile'],
        ['generated', /(\.(pb|g|generated)\.[a-z]+$|_pb2?\.(py|js|ts|go)$|(^|\/)generated\/|\.min\.(js|css)$|\.designer\.cs$)/i, 'generated'],
        ['vendored', /(^|\/)(vendor|vendored|third_party|thirdparty|node_modules|Pods)\//i, 'vendored'],
        ['seeded data', /(^|\/)(seeds?|goldens?|baselines?|captured|fixtures|__fixtures__)\//i, 'data']
    ];

    const CATEGORIES = ['test', 'snapshot', 'lockfile', 'generated', 'vendored', 'data',
        'rename', 'mode', 'binary', 'viewed'];
    const VIEWED_LABEL = /^\s*viewed\s*$/i;
    const VIEWED_RULE = { name: 'viewed on GitHub', category: 'viewed' };

    /**
     * Files with nothing to read, recognised by what the header says rather than
     * by their path: a rename that moved no lines, a permission change, and a
     * binary GitHub will not render. Each still costs a scroll.
     */
    const CONTENT_RULES = [
        ['renamed, unchanged', /renamed\s+(?:with\s+)?(?:without|no)\s+changes/i, 'rename'],
        ['mode change only', /file\s+mode\s+changed/i, 'mode'],
        ['binary', /binary\s+files?\s+(?:not\s+shown|differ)/i, 'binary']
    ];

    /**
     * Set by the extension's bootstrap before it runs this filter; a bookmarklet
     * click leaves it unset. Auto-installed, the filter outlives the diff screen
     * that started it, so the "no diff here" nudge would fire on every page.
     */
    const AUTO_INSTALLED = window.__ghDiffFilterAuto === true;

    /**
     * Preferences resolve per repository, falling back to a global default, so
     * a repo whose tests you always read keeps them open without changing the
     * setting everywhere.
     */
    /**
     * Which preferences travel between machines.
     *
     * Not the per-pull-request snapshots: they are the largest thing stored, one
     * per pull request, and describe what this reader has already looked at
     * rather than how they want the filter to behave. Chrome's synced storage
     * is a few kilobytes per item, so sending them would push the real
     * preferences out of it. A peek is session-scoped on purpose.
     */
    function syncable(key) {
        return key.indexOf(SETTING_PREFIX) === 0
            && key.indexOf(SEEN_KEY) !== 0
            && key.indexOf(PAUSED_KEY) !== 0
            && key.indexOf(WRITTEN_AT) === -1;
    }

    /** Write a preference here, and offer it to the reader's other browsers. */
    function writeSetting(key, value) {
        const at = Date.now();
        try {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
            localStorage.setItem(key + WRITTEN_AT, String(at));
        } catch (error) {
            // Private browsing; the in-memory value still governs this page.
        }
        if (!syncable(key)) return;
        document.dispatchEvent(new CustomEvent(SYNC_PUSH, { detail: { key, value, at } }));
    }

    function writtenAt(key) {
        const at = Number(localStorage.getItem(key + WRITTEN_AT));
        return Number.isFinite(at) ? at : 0;
    }

    /**
     * Take a synced preference only when it is newer than what this browser
     * wrote, so a tab that has been open for a week does not undo a change made
     * on another machine this morning, or the reverse.
     */
    function acceptSynced(settings) {
        let changed = false;
        for (const key of Object.keys(settings || {})) {
            const record = settings[key];
            if (!syncable(key) || !record || typeof record.at !== 'number') continue;
            if (record.at <= writtenAt(key)) continue;
            try {
                if (record.value === null || record.value === undefined) localStorage.removeItem(key);
                else localStorage.setItem(key, record.value);
                localStorage.setItem(key + WRITTEN_AT, String(record.at));
                changed = true;
            } catch (error) {
                // Private browsing; nothing to adopt into.
            }
        }
        if (!changed) return;
        enabled = readEnabled();
        onlyChanged = readOnlyChanged();
        categories = readCategories();
        rules = BUILT_IN_RULES.concat(loadCustomRules());
        reset();
        apply();
    }

    function repoScope() {
        const parts = location.pathname.match(/^\/([^/]+)\/([^/]+)/);
        return parts ? `${parts[1]}/${parts[2]}` : '';
    }

    function repoEnabledKey() {
        const scope = repoScope();
        return scope ? `${ENABLED_KEY}:${scope}` : ENABLED_KEY;
    }

    function readEnabled() {
        const forRepo = localStorage.getItem(repoEnabledKey());
        if (forRepo !== null) return forRepo !== 'false';
        return localStorage.getItem(ENABLED_KEY) !== 'false';
    }

    function onlyChangedKey() {
        const scope = repoScope();
        return scope ? `${ONLY_CHANGED_KEY}:${scope}` : ONLY_CHANGED_KEY;
    }

    function readOnlyChanged() {
        return localStorage.getItem(onlyChangedKey()) === 'true';
    }

    function pausedKey() {
        return `${PAUSED_KEY}:${pullRequestScope() || repoScope()}`;
    }

    /**
     * A peek at what is hidden, for this pull request in this tab only.
     *
     * The pill's chip reads "Show", which is a request to look at the hidden
     * files — not to change what the repository does from now on. It used to
     * write the repository's stored preference, so one look switched the filter
     * off for every later visit with nothing on screen saying why.
     */
    function readPaused() {
        try {
            return sessionStorage.getItem(pausedKey()) === 'true';
        } catch (error) {
            return false;
        }
    }

    let activeScope = repoScope();
    let enabled = readEnabled();
    let paused = readPaused();

    /** Whether files are being hidden right now, preference and peek together. */
    function hiding() {
        return enabled && !paused;
    }
    let onlyChanged = readOnlyChanged();

    /**
     * What each file looked like on the previous visit to this pull request,
     * read once and held for the whole visit. Comparing against a snapshot that
     * was rewritten mid-visit would report everything as unchanged.
     */
    function categoriesKey() {
        const scope = repoScope();
        return scope ? `${CATEGORIES_KEY}:${scope}` : CATEGORIES_KEY;
    }

    /** Every category hides by default; a repository can switch any of them off. */
    function readCategories() {
        let stored = {};
        try {
            stored = JSON.parse(localStorage.getItem(categoriesKey()) || '{}');
        } catch (error) {
            stored = {};
        }
        const resolved = {};
        for (const name of CATEGORIES) resolved[name] = stored[name] !== false;
        return resolved;
    }

    let categories = readCategories();

    let visitBaseline;
    let baselineFor;
    let lastWritten;

    function pullRequestScope() {
        const pr = location.pathname.match(/\/pull\/(\d+)/);
        return pr ? `${repoScope()}#${pr[1]}` : '';
    }

    function seenKeyFor(scope) {
        return `${SEEN_KEY}:${scope}`;
    }

    function readBaseline() {
        const scope = pullRequestScope();
        if (baselineFor === scope) return visitBaseline;
        baselineFor = scope;
        lastWritten = null;
        try {
            visitBaseline = scope ? JSON.parse(localStorage.getItem(seenKeyFor(scope)) || '{}') : {};
        } catch (error) {
            visitBaseline = {};
        }
        return visitBaseline;
    }

    /** Keeps the newest pull requests only, so this never grows without bound. */
    function rememberSnapshot(snapshot) {
        const scope = pullRequestScope();
        if (!scope) return;
        const serialised = JSON.stringify(snapshot);
        if (serialised === lastWritten) return;
        lastWritten = serialised;
        localStorage.setItem(seenKeyFor(scope), serialised);
        let index;
        try {
            index = JSON.parse(localStorage.getItem(SEEN_INDEX_KEY) || '[]');
        } catch (error) {
            index = [];
        }
        index = [scope].concat(index.filter(entry => entry !== scope));
        for (const stale of index.slice(SEEN_LIMIT)) localStorage.removeItem(seenKeyFor(stale));
        localStorage.setItem(SEEN_INDEX_KEY, JSON.stringify(index.slice(0, SEEN_LIMIT)));
    }

    /**
     * Counts plus hunk headers: enough to tell a rewritten file from a resent
     * one. An unrendered file has no readable counts, and every one of those
     * would fingerprint alike, so it gets no fingerprint at all rather than one
     * that makes a changed file look untouched.
     */
    function fingerprint(container) {
        const counts = fileCounts(container);
        if (!counts.known) return '';
        const hunks = Array.from(container.querySelectorAll(HUNK_SELECTOR))
            .map(el => (el.textContent || '').trim())
            .join('|');
        return `${counts.added}/${counts.deleted}/${counts.changed}|${hunks}`;
    }
    let pill;
    let pillKey = '';
    let lastSummary = null;
    let statHost;
    let totalsAttempts = 0;
    const TOTALS_ATTEMPT_LIMIT = 15;
    let resolveTimer;
    let resolveAttempts = 0;
    let resolveScope;
    let treePathByAnchor = new Map();
    let treeStatByAnchor = new Map();
    let lastSignature = '';
    /**
     * Counts memoised for the duration of one pass, which asks for a file's
     * counts several times over — for its fingerprint, its stub and the header
     * figure. Not held across passes: the numbers can change through an
     * attribute nothing cheap can watch, and a stale count would collapse a
     * file that did move as unchanged.
     */
    const countCache = new WeakMap();
    let countEpoch = 0;

    /** Verdicts by `diff-<sha>`, which outlive the elements they were reached on. */
    const verdicts = new Map();
    /**
     * Files shown by hand, keyed the same way. GitHub may replace the element a
     * reveal was performed on, and re-deciding it would hide the file again
     * under the reader.
     */
    const revealed = new Set();

    // ---------------------------------------------------------------- rules

    function loadCustomRules() {
        try {
            const raw = JSON.parse(localStorage.getItem(CUSTOM_RULES_KEY) || '[]');
            return raw.map(source => ['custom', new RegExp(source, 'i')]);
        } catch (err) {
            console.warn('[test-file-filter] ignoring unparseable custom rules', err);
            return [];
        }
    }

    let rules = BUILT_IN_RULES.concat(loadCustomRules());

    /** @returns {{name: string, category: string}|null} the rule that claims this path. */
    /**
     * A verdict from the file header, for files whose path says nothing. Read
     * only once the header has text, so an empty header defers rather than
     * declaring the file ordinary.
     */
    function matchContent(container) {
        const text = headerLeaves(container, 40).join(' ');
        if (!text) return null;
        for (const [name, re, category] of CONTENT_RULES) {
            if (!re.test(text)) continue;
            if (!categories[category]) continue;
            return { name, category };
        }
        return null;
    }

    /** The Viewed box, honoured only while that category is switched on. */
    function isViewedNow(container) {
        return categories.viewed === true && isViewed(container);
    }

    function matchRule(path) {
        for (const [name, re, category] of rules) {
            if (!re.test(path)) continue;
            const group = category || 'custom';
            if (group !== 'custom' && !categories[group]) continue;
            return { name, category: group };
        }
        return null;
    }

    // ------------------------------------------------------------ file info

    function fileContainers() {
        // Outermost matches only. Asking each candidate whether it sits inside
        // another one is linear in the number of files; comparing every pair is
        // not, and a large pull request pays that on every pass.
        return Array.from(document.querySelectorAll(FILE_SELECTOR))
            .filter(el => !(el.parentElement && el.parentElement.closest(FILE_SELECTOR)));
    }

    /** Renames render as "old → new"; the new path is the one to classify. */
    function normalizePath(raw) {
        return (raw || '').split('→').pop().trim();
    }

    /**
     * Whether the reader has ticked GitHub's own "Viewed" box for this file.
     *
     * Preferred over any local record of having seen it: GitHub keeps this per
     * reviewer on the server, so it is already correct on another machine and
     * survives a force-push the way a content fingerprint cannot.
     */
    function isViewed(container) {
        const scope = headerOf(container) || container;
        for (const box of scope.querySelectorAll('input[type="checkbox"]')) {
            const label = box.getAttribute('aria-label') || labelTextFor(box) || '';
            if (VIEWED_LABEL.test(label)) return box.checked === true;
        }
        return false;
    }

    function labelTextFor(box) {
        const wrapper = box.closest('label');
        if (wrapper) return (wrapper.textContent || '').trim();
        const byId = box.id && document.querySelector(`label[for="${box.id}"]`);
        return byId ? (byId.textContent || '').trim() : '';
    }

    /** Whether a file carries review feedback, which must never be collapsed away. */
    function hasReviewComments(container) {
        return !!container.querySelector(REVIEW_COMMENT_SELECTOR);
    }

    /** A path carries no whitespace and has either a directory separator or an extension. */
    function looksLikePath(value) {
        return value.length > 1 && value.length < 400 && !/\s/.test(value)
            && (value.includes('/') || /\.[A-Za-z0-9]+$/.test(value));
    }

    /** Headers render the diffstat next to the path, and adjacent spans concatenate. */
    function trimGluedStat(value) {
        const stripped = value.replace(/(?:[+\-\u2212\u2013]\d[\d,]*)+$/, '');
        return /\.[A-Za-z0-9]+$/.test(stripped) ? stripped : value;
    }

    function pathFromAttributes(container) {
        for (const attr of PATH_ATTRS) {
            const own = container.getAttribute(attr);
            if (own) return normalizePath(own);
            const nested = container.querySelector(`[${attr}]`);
            const value = nested && nested.getAttribute(attr);
            if (value) return normalizePath(value);
        }
        return '';
    }

    function headerOf(container) {
        return container.querySelector(HEADER_SELECTOR) || container.firstElementChild;
    }

    /**
     * Only a path-shaped label counts — headers also carry "Copy", "Viewed" and
     * the like. Scoped to the header because a diff line can contain a link
     * whose title is some other file's path.
     */
    function pathFromLabels(container) {
        const scope = headerOf(container) || container;
        for (const el of scope.querySelectorAll('a[title],a[aria-label]')) {
            const candidate = normalizePath(el.getAttribute('title') || el.getAttribute('aria-label') || '');
            if (looksLikePath(candidate)) return candidate;
        }
        return '';
    }

    /**
     * Last resort for markup that carries the path only as text. Text nodes are
     * read as separate leaves rather than via textContent, because the header
     * splits a path across a directory span and a filename span and glues the
     * diffstat onto the end.
     */
    function pathFromText(container) {
        const header = headerOf(container);
        if (!header) return '';
        const leaves = [];
        const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && leaves.length < 12; node = walker.nextNode()) {
            const text = node.nodeValue.trim();
            if (text) leaves.push(text);
        }
        let joined = '';
        for (const leaf of leaves) {
            if (DIFFSTAT_LEAF.test(leaf) || CONTROL_LEAF.test(leaf) || /\s/.test(leaf)) break;
            // Chevrons and status glyphs precede the path; a path fragment can
            // only start with a character a filename starts with.
            if (!joined && !/^[\w.@~]/.test(leaf)) continue;
            joined += leaf;
        }
        const assembled = trimGluedStat(normalizePath(joined));
        if (looksLikePath(assembled)) return assembled;
        // A leading label would have corrupted the assembly; fall back to the
        // first leaf that stands on its own as a path.
        for (const leaf of leaves) {
            const candidate = trimGluedStat(normalizePath(leaf));
            if (looksLikePath(candidate)) return candidate;
        }
        return '';
    }

    /**
     * How many files this diff has, according to GitHub rather than to what has
     * rendered. The tree lists every file and the "Files changed" tab carries
     * the number, both of which arrive before the diff pane finishes, so a pass
     * can tell a complete diff from a prefix of one — and a verdict over a
     * prefix is what makes an incomplete pass look like a diff with no tests.
     */
    function expectedFileCount() {
        let expected = treePathByAnchor.size;
        for (const link of document.querySelectorAll('a[href*="/files"],a[href*="/changes"]')) {
            const text = link.textContent || '';
            if (!FILE_COUNT_LABEL.test(text)) continue;
            for (const digits of text.match(/\d[\d,]*/g) || []) {
                expected = Math.max(expected, parseCount(digits));
            }
            break;
        }
        return expected;
    }

    function pathFromTree(container) {
        const anchor = anchorOf(container, true);
        return (anchor && treePathByAnchor.get(anchor)) || '';
    }

    /**
     * A path plus how it was obtained. An attribute or a tree row is a key and
     * is final; reading the header is a guess, because a header still rendering
     * yields a shorter path that matches no rule — a verdict that would
     * otherwise stand for the rest of the visit.
     */
    function resolvePath(container) {
        const keyed = pathFromAttributes(container) || pathFromTree(container);
        if (keyed) return { path: keyed, trust: 'exact' };
        const read = pathFromLabels(container) || pathFromText(container);
        return { path: read, trust: read ? 'guessed' : 'none' };
    }

    function filePath(container) {
        return resolvePath(container).path;
    }

    function parseCount(text) {
        return Number(String(text == null ? '' : text).replace(/[^\d]/g, '')) || 0;
    }

    /**
     * A container's leading text, stopping where the diff body starts. Headers
     * come first in document order, and their class names differ between the two
     * GitHub diff views, so position is a steadier guide than a selector.
     */
    function headerLeaves(container, limit) {
        const out = [];
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && out.length < limit; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (parent && parent.closest(DIFF_BODY_SELECTOR)) break;
            const text = node.nodeValue.trim();
            if (text) out.push(text);
        }
        return out;
    }

    /** The file header's combined changed-lines figure, present even when the diff is collapsed. */
    function changedTotal(container) {
        const stat = (headerOf(container) || container).querySelector('.diffstat')
            || container.querySelector('.diffstat');
        const lead = stat && (stat.textContent || '').trim().split(/\s+/)[0];
        return lead && /^\d[\d,]*$/.test(lead) ? parseCount(lead) : null;
    }

    /**
     * `signed` says whether the +/- split is trustworthy. Counting rendered rows
     * looks like a signed answer but silently under-reports a file GitHub left
     * collapsed, so those counts only count when they foot to the header's
     * changed-lines total.
     *
     * @returns {{added: number, deleted: number, changed: number, signed: boolean, known: boolean}}
     */
    function fileCounts(container) {
        const cached = countCache.get(container);
        if (cached && cached.epoch === countEpoch) return cached.counts;
        const counts = readCounts(container);
        countCache.set(container, { epoch: countEpoch, counts });
        return counts;
    }

    function readCounts(container) {
        const stated = statedCounts(container);
        if (stated) return stated;

        const labelled = container.querySelector('[aria-label*="addition" i]');
        const fromLabel = labelled && (labelled.getAttribute('aria-label') || '').match(/\d[\d,]*/g);
        if (fromLabel && fromLabel.length >= 2) {
            const added = parseCount(fromLabel[0]);
            const deleted = parseCount(fromLabel[1]);
            return { added, deleted, changed: added + deleted, signed: true, known: true };
        }

        const keyed = anchorOf(container, true);
        const fromTree = keyed && treeStatByAnchor.get(keyed);
        if (fromTree) return fromTree;

        const leaves = headerLeaves(container, 40).filter(text => DIFFSTAT_LEAF.test(text));
        const plus = leaves.find(text => text.startsWith('+'));
        const minus = leaves.find(text => /^[-\u2212\u2013]/.test(text));
        if (plus && minus) {
            const added = parseCount(plus);
            const deleted = parseCount(minus);
            return { added, deleted, changed: added + deleted, signed: true, known: true };
        }

        const added = container.querySelectorAll(ADDITION_SELECTOR).length;
        const deleted = container.querySelectorAll(DELETION_SELECTOR).length;
        const total = changedTotal(container);
        if (total !== null) {
            return { added, deleted, changed: total, signed: added + deleted === total, known: true };
        }
        return { added, deleted, changed: added + deleted, signed: true, known: added > 0 || deleted > 0 };
    }

    /**
     * "N additions & M deletions", wherever the header says it — as text, as an
     * aria-label, or in a screen-reader-only node. It is authoritative and
     * present before the diff body renders.
     */
    function statedCounts(container) {
        const header = headerOf(container) || container;
        const sources = headerLeaves(container, 40);
        for (const el of header.querySelectorAll('[aria-label],[title]')) {
            sources.push(el.getAttribute('aria-label') || '', el.getAttribute('title') || '');
        }
        for (const text of sources) {
            const hit = text && text.match(LINES_CHANGED);
            if (!hit) continue;
            const added = parseCount(hit[1]);
            const deleted = parseCount(hit[2]);
            return { added, deleted, changed: added + deleted, signed: true, known: true };
        }
        return null;
    }

    /** Comment-only lines the sibling filter collapsed inside this file. */
    function commentLinesHidden(container) {
        for (const text of headerLeaves(container, 40)) {
            const hit = text.match(COMMENTS_HIDDEN);
            if (hit) return parseCount(hit[1]);
        }
        return 0;
    }

    function formatStat(counts) {
        if (!counts.known) return '';
        return counts.signed
            ? `+${counts.added.toLocaleString()} \u2212${counts.deleted.toLocaleString()}`
            : `${counts.changed.toLocaleString()} lines`;
    }

    // -------------------------------------------------------- hide / restore

    function styleElement() {
        let el = document.getElementById(STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            el.className = UI_CLASS;
            (document.head || document.documentElement).appendChild(el);
        }
        return el;
    }

    /**
     * Hide through a stylesheet rather than by writing on the element.
     *
     * The review view re-renders the diff pane and replaces container elements,
     * discarding anything written on them: files silently came back into view
     * while their stubs stayed behind. A rule keyed on the `diff-<sha>` anchor
     * keeps matching whatever element GitHub puts there, and the file's tree
     * row is covered the same way. Two rules, because one selector a browser
     * does not understand voids the whole rule it sits in, and the diff pane
     * must stay hidden even where `:has()` is unknown.
     */
    function syncHiding() {
        const panes = [];
        const rows = [];
        for (const [anchor, verdict] of verdicts) {
            if (!HIDDEN_STATES.test(verdict.state)) continue;
            panes.push(`#${anchor}`);
            rows.push(`#file-tree-item-${anchor}`, treeRowSelector(anchor));
        }
        const sheet = styleElement();
        const text = panes.length === 0 ? ''
            : `${panes.join(',')}{display:none!important}\n${rows.join(',')}{display:none!important}`;
        if (sheet.textContent !== text) sheet.textContent = text;
    }

    /**
     * The review view's tree row carries the file path as its id and the anchor
     * only in the link inside its own label. A directory row has no link of its
     * own, and the child combinator keeps the rule off the rows above a file.
     */
    function treeRowSelector(anchor) {
        return `${TREE_ITEM_SELECTOR}:has(> :not([role="group"]) a[href$="#${anchor}"])`;
    }

    /** Drop stubs whose file is no longer hidden, or whose container is gone. */
    function pruneStubs() {
        for (const stub of document.querySelectorAll('.' + STUB_CLASS)) {
            // Only keyed stubs can be judged here; an unkeyed one belongs to a
            // container with no stable id and is owned by revealFile.
            if (stub.id.indexOf(STUB_ID_PREFIX) !== 0) continue;
            const anchor = stub.id.slice(STUB_ID_PREFIX.length);
            const verdict = verdicts.get(anchor);
            if (!verdict || !HIDDEN_STATES.test(verdict.state) || !document.getElementById(anchor)) {
                stub.remove();
            }
        }
    }

    function makeStub(container, path, ruleName) {
        const stub = document.createElement('div');
        stub.className = `${STUB_CLASS} ${UI_CLASS}`;
        stub.title = `matched by rule: ${ruleName} — click to show this file`;
        stub.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;'
            + 'font:11px/1.9 var(--fontStack-monospace,ui-monospace,monospace);'
            + 'color:var(--fgColor-muted,#8b949e);padding:1px 10px;margin:2px 0;'
            + 'background:var(--bgColor-muted,#161b22);'
            + 'border:1px solid var(--borderColor-muted,#30363d);border-radius:6px;';

        const label = icon(ruleName === 'unchanged since your last visit' ? 'pause' : 'filter');
        const name = document.createElement('span');
        name.textContent = path;
        name.style.cssText = 'color:var(--fgColor-default,#e6edf3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const stat = document.createElement('span');
        stat.textContent = formatStat(fileCounts(container));
        const hint = document.createElement('span');
        hint.textContent = 'click to show';
        hint.style.marginLeft = 'auto';
        stub.append(label, name, stat, hint);

        stub.addEventListener('click', () => {
            revealFile(container);
            refreshChrome();
        });
        return stub;
    }

    function hideFile(container, path, ruleName, state) {
        const anchor = anchorOf(container, true);
        if (anchor) {
            verdicts.set(anchor, { path, ruleName, state: state || 'hidden' });
            syncHiding();
        }
        markHidden(container, path, ruleName, state || 'hidden');
    }

    /**
     * The element-level half of hiding: the stub and the marker. Re-runnable,
     * because GitHub may replace the container at any point and the stylesheet
     * will already be hiding whatever replaced it.
     */
    function markHidden(container, path, ruleName, state) {
        const anchor = anchorOf(container, true);
        const existing = anchor && document.getElementById(STUB_ID_PREFIX + anchor);
        if (!existing) {
            const stub = makeStub(container, path, ruleName);
            if (anchor) stub.id = STUB_ID_PREFIX + anchor;
            container.__ghtfStub = stub;
            container.parentNode.insertBefore(stub, container);
        }
        container.classList.add(HIDDEN_CLASS);
        // The stylesheet covers a container GitHub may replace, but it needs the
        // `diff-<sha>` id to key on; without one, the element itself is the only
        // handle this file has.
        if (!anchor) container.style.display = 'none';
        container.setAttribute(STATE_ATTR, state);
    }

    /**
     * Unhide one file because the reader asked, and remember that they did: the
     * element may be replaced, and re-deciding it would hide the file again
     * under them.
     */
    function revealFile(container) {
        const anchor = anchorOf(container, true);
        if (anchor) revealed.add(anchor);
        unhide(container);
    }

    /** Undo the hiding, with no memory of why — the teardown half of it. */
    function unhide(container) {
        const anchor = anchorOf(container, true);
        if (anchor) {
            verdicts.delete(anchor);
            syncHiding();
        }
        const stub = container.__ghtfStub
            || (anchor && document.getElementById(STUB_ID_PREFIX + anchor))
            || (container.previousElementSibling && container.previousElementSibling.classList.contains(STUB_CLASS)
                ? container.previousElementSibling
                : null);
        if (stub) stub.remove();
        container.__ghtfStub = null;
        container.classList.remove(HIDDEN_CLASS);
        container.style.removeProperty('display');
        container.setAttribute(STATE_ATTR, 'shown');
    }

    function clearFile(container) {
        unhide(container);
        container.removeAttribute(STATE_ATTR);
        container.__ghtfTrust = null;
    }

    // ------------------------------------------------------------------ pill

    const ICONS = {
        filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
        pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
        sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>'
            + '<line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>'
            + '<line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>'
            + '<line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>'
            + '<line x1="17" y1="16" x2="23" y2="16"/>',
        alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
            + '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
    };

    /** A stroke icon in the text colour around it. */
    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'ghdf-icon');
        svg.style.flex = 'none';
        svg.innerHTML = ICONS[name];
        return svg;
    }

    function toast(message) {
        const el = document.createElement('div');
        el.className = UI_CLASS;
        el.textContent = message;
        el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:320px;'
            + 'font:12px/1.4 -apple-system,system-ui,sans-serif;background:rgba(20,22,26,.96);color:#e6edf3;'
            + 'border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:9px 13px;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,.4);';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    /**
     * One pill shape shared with the comment filter's, so the two read as one
     * control: state on the left, the action it performs in a chip on the right.
     * Written only when what it says changes: the observer sees each rewrite
     * like any other mutation, and a pass that rewrites its own pill schedules
     * the next pass, for as long as the page is open.
     */
    function renderPill(containers, incomplete) {
        if (!pill) {
            pill = document.createElement('div');
            pill.id = PILL_ID;
            pill.className = UI_CLASS;
            pill.style.cssText = 'position:fixed;right:16px;z-index:2147483000;'
                + 'display:flex;align-items:center;gap:9px;'
                + 'font:500 12px/1 var(--fontStack-sansSerif,-apple-system,system-ui,sans-serif);'
                + 'background:var(--bgColor-default,#0d1117);color:var(--fgColor-muted,#8b949e);'
                + 'border:1px solid var(--borderColor-default,#30363d);border-radius:999px;'
                + 'padding:9px 10px 9px 14px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4);'
                + 'user-select:none;max-width:340px;white-space:nowrap;';
            pill.addEventListener('click', () => {
                // Off for the repository is a stored decision, and only an
                // explicit action reverses it. Otherwise a click is a peek.
                if (!enabled) api.enabled = true;
                else api.peek(!paused);
            });
        }
        // A navigation can replace body, and the pill with it.
        if (!pill.isConnected) {
            document.body.appendChild(pill);
            pillKey = '';
        }
        // The extension may dock both pills in one container and own the
        // layout; only place ourselves when standing alone.
        if (!pill.closest('#' + DOCK_ID)) {
            const neighbour = document.getElementById(COMMENT_FILTER_PILL_ID);
            const bottom = neighbour ? `${neighbour.offsetHeight + 24}px` : '16px';
            if (pill.style.bottom !== bottom) pill.style.bottom = bottom;
        }

        // Every figure is read back off the states the pass just wrote, so the
        // pill has one source for them and no argument list a second caller can
        // supply incompletely. By state, not by stub: an unchanged file wears a
        // stub too and is not a test file.
        const inState = name => containers.filter(c => c.getAttribute(STATE_ATTR) === name);
        const hidden = inState('hidden').length;
        // Every file a rule claimed, hidden or shown again by hand.
        const matched = hidden + inState('shown').length;
        const unidentified = inState('pending').length;
        const badges = {
            unidentified,
            commented: inState('commented').length,
            unchanged: inState('unchanged').length
        };
        const files = n => `${n} file${n === 1 ? '' : 's'}`;
        let state;
        let action;
        if (!enabled) {
            // Named, because "nothing to hide" and "switched off for this
            // repository" look identical on screen and are not the same thing.
            state = 'Hiding off for this repo';
            action = 'Turn on';
        } else if (paused) {
            state = matched > 0 ? `${files(matched)} shown` : 'Hidden files shown';
            action = 'Hide';
        } else if (hidden > 0) {
            state = `${files(hidden)} hidden`;
            action = 'Show';
        } else if (matched > 0) {
            state = `${files(matched)} shown`;
            action = 'Hide';
        } else if (incomplete) {
            // Saying "nothing to hide" here would be a verdict on a diff that is
            // still arriving, and it is the one wrong answer users act on.
            state = 'Waiting for the diff to load';
            action = '';
        } else {
            state = 'Nothing to hide in this diff';
            action = '';
        }
        const plural = n => (n === 1 ? '' : 's');
        const summary = {
            hidden, matched, files: containers.length, unidentified,
            commented: badges.commented, unchanged: badges.unchanged,
            enabled, paused, hiding: hiding(), incomplete: !!incomplete
        };
        const key = JSON.stringify([summary, state, action]);
        if (key === pillKey) return;
        pillKey = key;
        lastSummary = summary;

        if (containers.length === 0) {
            pill.style.display = 'none';
            if (!AUTO_INSTALLED) toast('No diff found on this page — open a PR’s "Files changed" tab.');
        } else {
            pill.style.display = 'flex';
            pill.style.opacity = hiding() ? '1' : '0.85';
            setPillContent(pill, 'filter', state, action, badges);
            if (unidentified > 0) {
                pill.title = `${unidentified} file${plural(unidentified)} whose path this script could not read`
                    + ' — run __ghTestFileFilter.report() in the console';
                pill.style.borderColor = 'var(--borderColor-attention-emphasis,#d29922)';
            } else {
                pill.title = '';
                pill.style.borderColor = 'var(--borderColor-default,#30363d)';
            }
        }
        document.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: summary }));
    }

    let popoverOpen = false;

    /** How many files each category is currently hiding. */
    function categoryCounts(containers) {
        const counts = new Map();
        for (const container of containers) {
            if (container.getAttribute(STATE_ATTR) !== 'hidden') continue;
            const category = container.__ghtfCategory || 'test';
            counts.set(category, (counts.get(category) || 0) + 1);
        }
        return counts;
    }

    /**
     * The categories, as controls rather than as console calls.
     *
     * Everything this filter can do was reachable only from the console, which
     * meant anyone who installed it got the defaults and nothing else.
     */
    function renderPopover(containers) {
        let popover = document.getElementById(POPOVER_ID);
        if (!popoverOpen) {
            if (popover) popover.remove();
            return;
        }
        if (!popover) {
            popover = document.createElement('div');
            popover.id = POPOVER_ID;
            popover.className = UI_CLASS;
            popover.style.cssText = 'position:fixed;right:16px;z-index:2147483001;min-width:250px;'
                + 'font:12px/1.5 var(--fontStack-sansSerif,-apple-system,system-ui,sans-serif);'
                + 'background:var(--overlay-bgColor,var(--bgColor-default,#161b22));'
                + 'color:var(--fgColor-default,#e6edf3);'
                + 'border:1px solid var(--borderColor-default,#30363d);border-radius:8px;'
                + 'box-shadow:0 8px 24px rgba(0,0,0,.5);padding:6px;';
            document.body.appendChild(popover);
        }
        // Above whatever holds the pill: the dock, when the extension collapsed
        // the pill into it, since a collapsed pill has no box of its own.
        const above = (pill && pill.closest('#' + DOCK_ID)) || pill;
        const box = above && above.getBoundingClientRect ? above.getBoundingClientRect() : null;
        popover.style.bottom = box && box.height
            ? `${Math.max(16, window.innerHeight - box.top + 8)}px`
            : '72px';

        popover.replaceChildren();
        popover.append(popoverRow(`Hide files in ${repoScope() || 'this repository'}`, enabled,
            checked => { api.enabled = checked; }, null, true));
        const counts = categoryCounts(containers);
        for (const name of CATEGORIES) {
            popover.append(popoverRow(CATEGORY_LABELS[name] || name, categories[name] !== false,
                checked => { api.setCategory(name, checked); }, counts.get(name) || 0, false));
        }
        const help = window.__ghDiffFilterShortcuts;
        if (Array.isArray(help) && help.length > 0) popover.append(shortcutList(help));
    }

    /**
     * The keyboard shortcuts, published by the extension's controls script. They
     * were documented only in a title attribute, which nobody reads.
     */
    function shortcutList(help) {
        const list = document.createElement('div');
        list.className = 'ghtf-popover-shortcuts';
        list.style.cssText = 'margin-top:4px;padding:8px 8px 4px;'
            + 'border-top:1px solid var(--borderColor-muted,#30363d);'
            + 'color:var(--fgColor-muted,#8b949e);';
        for (const { key, label } of help) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;align-items:baseline;';
            const kbd = document.createElement('kbd');
            kbd.textContent = key;
            kbd.style.cssText = 'min-width:14px;text-align:center;padding:0 4px;border-radius:3px;'
                + 'border:1px solid var(--borderColor-default,#30363d);'
                + 'font:11px/1.6 var(--fontStack-monospace,ui-monospace,monospace);'
                + 'color:var(--fgColor-default,#e6edf3);';
            const what = document.createElement('span');
            what.textContent = label;
            row.append(kbd, what);
            list.append(row);
        }
        return list;
    }

    function popoverRow(text, checked, onChange, count, emphasise) {
        const row = document.createElement('label');
        row.className = 'ghtf-popover-row';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;'
            + 'cursor:pointer;white-space:nowrap;'
            + (emphasise ? 'font-weight:600;border-bottom:1px solid var(--borderColor-muted,#30363d);'
                + 'margin-bottom:4px;padding-bottom:8px;' : '');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = checked;
        box.style.margin = '0';
        box.addEventListener('change', () => onChange(box.checked));
        const label = document.createElement('span');
        label.textContent = text;
        label.style.flex = '1';
        row.append(box, label);
        if (count !== null) {
            const tally = document.createElement('span');
            tally.className = 'ghtf-popover-count';
            tally.style.color = 'var(--fgColor-muted,#8b949e)';
            tally.textContent = count > 0 ? String(count) : '';
            row.append(tally);
        }
        return row;
    }

    /** The pill's parts, in the order the comment filter's pill uses too. */
    function setPillContent(host, iconName, state, action, badges) {
        const { unidentified = 0, commented = 0, unchanged = 0 } = badges || {};
        host.replaceChildren();
        const label = document.createElement('span');
        label.className = 'ghdf-pill-label';
        label.style.cssText = 'display:inline-flex;align-items:center;gap:7px;color:var(--fgColor-default,#e6edf3);';
        label.append(icon(iconName), document.createTextNode(state));
        host.append(label);
        if (unidentified > 0) {
            const warn = document.createElement('span');
            warn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;color:var(--fgColor-attention,#d29922);';
            warn.append(icon('alert'), document.createTextNode(`${unidentified} unread`));
            host.append(warn);
        }
        if (unchanged > 0) {
            const held = document.createElement('span');
            held.textContent = `· ${unchanged} unchanged`;
            held.title = 'Identical to your last visit to this pull request';
            host.append(held);
        }
        if (commented > 0) {
            const kept = document.createElement('span');
            kept.textContent = `· ${commented} with comments`;
            kept.title = 'Left open because a review thread would otherwise be collapsed out of sight';
            host.append(kept);
        }
        if (action) {
            const chip = document.createElement('span');
            chip.className = 'ghdf-pill-action';
            chip.textContent = action;
            chip.style.cssText = 'padding:3px 9px;font-weight:600;'
                + 'color:var(--fgColor-default,#e6edf3);';
            host.append(chip);
        }
        // The extension's own control carries the settings button; a pill a
        // bookmarklet put here is the only control there is, so it carries one.
        if (host.id !== PILL_ID || AUTO_INSTALLED) return;
        const gear = document.createElement('span');
        gear.className = 'ghtf-pill-settings';
        gear.append(icon('sliders'));
        gear.title = 'Choose what to hide';
        gear.style.cssText = 'display:inline-flex;padding:3px 6px;color:var(--fgColor-muted,#8b949e);';
        gear.addEventListener('click', event => {
            event.stopPropagation();
            setSettingsOpen(!popoverOpen);
        });
        host.append(gear);
    }

    /** Open or close the category popover, and say so, for the control that shows its state. */
    function setSettingsOpen(open) {
        if (popoverOpen === open) return;
        popoverOpen = open;
        renderPopover(fileContainers());
        document.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: lastSummary }));
    }

    // ------------------------------------------------------------- file tree

    /** The `diff-<sha>` anchor both a diff container and its tree row are keyed by. */
    function anchorOf(el, allowDescendantLink) {
        const fromId = el.id && el.id.match(ANCHOR_ID);
        if (fromId) return fromId[1].toLowerCase();
        if (!allowDescendantLink) return '';
        const link = el.querySelector('a[href*="#diff-"]');
        const inHref = link && (link.getAttribute('href') || '').match(/#(diff-[0-9a-f]{16,})/i);
        return inHref ? inHref[1].toLowerCase() : '';
    }

    function isDirectoryRow(row) {
        const declared = row.getAttribute('data-tree-entry-type');
        if (declared) return declared === 'directory';
        return !!row.querySelector(TREE_GROUP_SELECTOR);
    }

    /** A row's own text, ignoring the text of any nested rows. */
    function ownLeaves(row) {
        const out = [];
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                for (let el = node.parentElement; el && el !== row; el = el.parentElement) {
                    if (el.matches && el.matches(TREE_GROUP_SELECTOR)) return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.nodeValue.trim();
            if (text) out.push(text);
        }
        return out;
    }

    function rowLabel(row) {
        for (const text of ownLeaves(row)) {
            if (!DIFFSTAT_LEAF.test(text) && !CONTROL_LEAF.test(text)) return text.split(/\s+/)[0];
        }
        return '';
    }

    /** A tree rooted at the repository would prefix every rebuilt path with its name. */
    function stripRepoPrefix(path) {
        const repo = repoScope().split('/')[1];
        return repo && path.startsWith(repo + '/') ? path.slice(repo.length + 1) : path;
    }

    /**
     * A row's path without asking the diff pane, which may know nothing yet.
     * Shape is the only check available here, so a rebuilt path is accepted on
     * its own terms rather than confirmed against what the diff pane found.
     */
    function treeRowOwnPath(row) {
        for (const attr of PATH_ATTRS) {
            const value = row.getAttribute(attr);
            if (value) return normalizePath(value);
        }
        const payload = row.getAttribute('data-hydro-click-payload');
        const inPayload = payload && payload.match(/"path":"([^"]+)"/);
        if (inPayload) return normalizePath(inPayload[1]);
        // The review view's rows are keyed by the path itself.
        const label = rowLabel(row);
        if (label && looksLikePath(row.id) && row.id.endsWith(label)) return row.id;
        const rebuilt = stripRepoPrefix(pathFromAncestors(row));
        return looksLikePath(rebuilt) ? rebuilt : '';
    }

    /**
     * A row's own diffstat. Only a clean signed pair counts; anything else is
     * left to the diff pane rather than guessed at.
     */
    function treeRowStat(row) {
        const leaves = ownLeaves(row).filter(text => DIFFSTAT_LEAF.test(text));
        const plus = leaves.filter(text => text.startsWith('+'));
        const minus = leaves.filter(text => /^[-\u2212\u2013]/.test(text));
        if (plus.length !== 1 || minus.length !== 1) return null;
        const added = parseCount(plus[0]);
        const deleted = parseCount(minus[0]);
        return { added, deleted, changed: added + deleted, signed: true, known: true };
    }

    /**
     * The file tree, read on its own terms.
     *
     * Every tree row carries the same `diff-<sha>` anchor as the diff container
     * for the same file, which makes the row an exact key for the container.
     * The tree is filled in with the page navigation rather than with the diff
     * bodies, so it is the one place a complete path and diffstat exist before a
     * file's own header has rendered.
     */
    function readTree() {
        treePathByAnchor = new Map();
        treeStatByAnchor = new Map();
        for (const row of document.querySelectorAll(TREE_ITEM_SELECTOR)) {
            if (isDirectoryRow(row)) continue;
            const anchor = anchorOf(row, true);
            if (!anchor) continue;
            const path = treeRowOwnPath(row);
            if (path) treePathByAnchor.set(anchor, path);
            const stat = treeRowStat(row);
            if (stat) treeStatByAnchor.set(anchor, stat);
        }
    }

    /**
     * Trees that show only leaf names need the ancestor rows to rebuild a path;
     * a row whose own label is already a path needs none of them. Both shapes
     * occur, and prepending into the second duplicates the directory rather
     * than completing the path.
     */
    function pathFromAncestors(row) {
        let path = rowLabel(row);
        if (path.includes('/')) return path;
        for (let el = row.parentElement; el; el = el.parentElement) {
            if (!el.matches || !el.matches(TREE_ITEM_SELECTOR)) continue;
            const parent = rowLabel(el);
            if (!parent || path === parent || path.startsWith(parent + '/')) continue;
            path = path ? parent + '/' + path : parent;
        }
        return path.replace(/\/{2,}/g, '/');
    }

    function treeRowPath(row, index) {
        const own = treeRowOwnPath(row);
        if (own) return own;
        const anchor = anchorOf(row, false);
        if (anchor && index.pathByAnchor.has(anchor)) return index.pathByAnchor.get(anchor);
        const label = rowLabel(row);
        if (index.knownPaths.has(label)) return label;
        const rebuilt = pathFromAncestors(row);
        return index.knownPaths.has(rebuilt) ? rebuilt : '';
    }

    /** What the diff pane already decided, keyed every way a tree row can be matched. */
    function buildIndex(containers) {
        const pathByAnchor = new Map();
        const knownPaths = new Set();
        const hiddenPaths = new Set();
        const byBasename = new Map();
        for (const container of containers) {
            const path = container.__ghtfPath;
            if (!path) continue;
            knownPaths.add(path);
            const anchor = anchorOf(container, true);
            if (anchor) pathByAnchor.set(anchor, path);
            const state = container.getAttribute(STATE_ATTR);
            const verdict = state === 'hidden' || state === 'unchanged' ? 'hidden' : 'source';
            if (verdict === 'hidden') hiddenPaths.add(path);
            const base = path.split('/').pop();
            const seen = byBasename.get(base);
            byBasename.set(base, seen && seen !== verdict ? 'mixed' : verdict);
        }
        return { pathByAnchor, knownPaths, hiddenPaths, byBasename };
    }

    function setTreeRowHidden(row, hide) {
        if (hide) {
            if (row.getAttribute(TREE_STATE_ATTR) === 'hidden') return;
            row.__ghtfTreeDisplay = row.style.display;
            row.style.display = 'none';
            row.setAttribute(TREE_STATE_ATTR, 'hidden');
        } else if (row.hasAttribute(TREE_STATE_ATTR)) {
            row.style.display = row.__ghtfTreeDisplay || '';
            row.removeAttribute(TREE_STATE_ATTR);
        }
    }

    /**
     * Mirror the diff pane's verdicts into the file tree, so a hidden file does
     * not still occupy a navigation row. A directory goes only when every file
     * under it went.
     */
    function applyTree(containers) {
        const rows = Array.from(document.querySelectorAll(TREE_ITEM_SELECTOR));
        if (rows.length === 0) return 0;
        const index = buildIndex(containers);
        let hiddenRows = 0;
        const directories = [];
        for (const row of rows) {
            if (isDirectoryRow(row)) {
                directories.push(row);
                continue;
            }
            const path = treeRowPath(row, index);
            const hide = path
                ? index.hiddenPaths.has(path)
                : index.byBasename.get(rowLabel(row).split('/').pop()) === 'hidden';
            setTreeRowHidden(row, hide);
            if (hide) hiddenRows++;
        }
        for (const directory of directories) {
            const files = Array.from(directory.querySelectorAll(TREE_ITEM_SELECTOR)).filter(row => !isDirectoryRow(row));
            const allHidden = files.length > 0 && files.every(row => row.getAttribute(TREE_STATE_ATTR) === 'hidden');
            setTreeRowHidden(directory, allHidden);
        }
        return hiddenRows;
    }

    function clearTree() {
        for (const row of document.querySelectorAll(`[${TREE_STATE_ATTR}]`)) setTreeRowHidden(row, false);
    }

    // ------------------------------------------- visible change-count summary

    /**
     * Where the PR's own +/- totals are rendered. The classic view gives them an
     * id; the newer review view does not, so they are found by shape instead:
     * a leaf reading "+N" with a "-M" leaf beside it, or both in one leaf.
     *
     * Document order decides, because the PR total is rendered above the file
     * list while a per-file header carries the same shape.
     */
    function diffstatHost() {
        if (statHost && statHost.isConnected) return statHost;
        statHost = document.getElementById('diffstat');
        if (statHost) return statHost;
        for (const el of document.querySelectorAll('span,div,strong,em,p,h1,h2,h3')) {
            if (el.children.length > 0 || el.closest(FILE_SELECTOR)) continue;
            const text = (el.textContent || '').trim();
            if (COMBINED_TOTAL.test(text)) {
                statHost = el.parentElement || el;
                return statHost;
            }
            if (!ADDED_TOTAL.test(text)) continue;
            const parent = el.parentElement;
            if (!parent) continue;
            for (const sibling of parent.children) {
                if (sibling !== el && DELETED_TOTAL.test((sibling.textContent || '').trim())) {
                    statHost = parent;
                    return statHost;
                }
            }
        }
        return null;
    }

    /** GitHub's own figures in the host — never the one this script added to it. */
    function hostFigures(host) {
        const theirs = el => !el.closest('.' + VISIBLE_STAT_CLASS);
        const added = Array.from(host.querySelectorAll('.color-fg-success,[class*="fgColor-success"]')).find(theirs);
        const deleted = Array.from(host.querySelectorAll('.color-fg-danger,[class*="fgColor-danger"]')).find(theirs);
        return added && deleted ? { added, deleted } : null;
    }

    function hostOwnText(host) {
        return Array.from(host.childNodes)
            .filter(node => !(node.nodeType === 1 && node.classList && node.classList.contains(VISIBLE_STAT_CLASS)))
            .map(node => node.textContent)
            .join(' ');
    }

    /** The PR's own totals, read past our injected span. */
    function hostTotals(host) {
        const figures = hostFigures(host);
        if (figures) {
            return { added: parseCount(figures.added.textContent), deleted: parseCount(figures.deleted.textContent) };
        }
        const text = hostOwnText(host);
        const plus = text.match(/\+\s*([\d,]+)/);
        const minus = text.match(/[-\u2212\u2013]\s*([\d,]+)/);
        return plus && minus ? { added: parseCount(plus[1]), deleted: parseCount(minus[1]) } : null;
    }

    /**
     * How GitHub types its own figures in this host, so ours are typed the same.
     * The two views use different class names and a different minus sign; a
     * copy of what is in the host follows either.
     */
    function hostFigureStyle(host) {
        const figures = hostFigures(host);
        const minusIn = text => ((text || '').match(/[-\u2212\u2013](?=\s*\d)/) || [])[0];
        if (!figures) return { copied: false, minus: minusIn(hostOwnText(host)) || '\u2212' };
        return {
            copied: true,
            success: String(figures.added.className),
            danger: String(figures.deleted.className),
            minus: minusIn(figures.deleted.textContent) || '\u2212'
        };
    }

    function renderVisibleTotals(containers) {
        const hiddenFiles = containers.filter(c => HIDDEN_STATES.test(c.getAttribute(STATE_ATTR)));
        const host = diffstatHost();
        if (!host) {
            // The toolbar holding the totals can render after the diff. Nothing
            // else may mutate afterwards, so waiting on the observer alone loses
            // the figure until the next toggle.
            if (hiddenFiles.length > 0 && totalsAttempts < TOTALS_ATTEMPT_LIMIT) {
                totalsAttempts++;
                setTimeout(refreshChrome, 400);
            }
            return null;
        }
        totalsAttempts = 0;
        const existing = host.querySelector('.' + VISIBLE_STAT_CLASS);
        if (!hiding() || hiddenFiles.length === 0) {
            if (existing) existing.remove();
            return null;
        }

        let hiddenAdded = 0;
        let hiddenDeleted = 0;
        let hiddenChanged = 0;
        let hiddenSigned = true;
        for (const container of hiddenFiles) {
            const counts = fileCounts(container);
            hiddenAdded += counts.added;
            hiddenDeleted += counts.deleted;
            hiddenChanged += counts.changed;
            if (!counts.signed) hiddenSigned = false;
        }

        // Subtracting from the PR's own totals keeps the figure footing to the
        // one beside it. Where the hidden files' +/- split is not trustworthy,
        // report changed lines rather than invent a split.
        const totals = hostTotals(host);
        let visible;
        if (totals && hiddenSigned) {
            visible = {
                added: Math.max(0, totals.added - hiddenAdded),
                deleted: Math.max(0, totals.deleted - hiddenDeleted),
                signed: true
            };
        } else if (totals) {
            visible = { changed: Math.max(0, totals.added + totals.deleted - hiddenChanged), signed: false };
        } else {
            visible = { added: 0, deleted: 0, changed: 0, signed: true };
            for (const container of containers) {
                if (HIDDEN_STATES.test(container.getAttribute(STATE_ATTR))) continue;
                const counts = fileCounts(container);
                visible.added += counts.added;
                visible.deleted += counts.deleted;
                visible.changed += counts.changed;
                if (!counts.signed) visible.signed = false;
            }
        }

        // Comment-only lines the sibling filter collapsed inside files that are
        // still on screen. They carry no sign, so they reduce the total rather
        // than either side of the split.
        let commentLines = 0;
        for (const container of containers) {
            if (HIDDEN_STATES.test(container.getAttribute(STATE_ATTR))) continue;
            commentLines += commentLinesHidden(container);
        }

        const style = hostFigureStyle(host);
        const badge = existing || document.createElement('span');
        if (!existing) {
            badge.className = `${VISIBLE_STAT_CLASS} ${UI_CLASS}`;
            // Spaced like the host's own row; the type is the host's, copied.
            badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px;white-space:nowrap;';
            host.appendChild(badge);
        }
        badge.replaceChildren();
        badge.title = describeExclusions(hiddenFiles.length, hiddenSigned, hiddenAdded, hiddenDeleted,
            hiddenChanged, commentLines);
        const dot = figure('\u00b7', 'muted', style);
        dot.setAttribute('aria-hidden', 'true');
        badge.append(dot, figure('after filter', 'muted', style));
        if (visible.signed) {
            badge.append(figure(`+${visible.added.toLocaleString()}`, 'success', style),
                figure(`${style.minus}${visible.deleted.toLocaleString()}`, 'danger', style));
        } else {
            badge.append(figure(`${visible.changed.toLocaleString()} lines`, 'default', style));
        }
        if (commentLines > 0) {
            badge.append(figure(`${style.minus}${commentLines.toLocaleString()} comment`, 'muted', style));
        }
        return visible;
    }

    const FALLBACK_COLORS = { success: '#3fb950', danger: '#f85149', muted: '#8b949e', default: '#e6edf3' };

    /**
     * One figure in the header row, wearing the classes GitHub put on its own
     * figure of that tone; without one to copy, GitHub's colour tokens.
     */
    function figure(text, tone, style) {
        const el = document.createElement('span');
        if (style.copied) {
            el.className = tone === 'danger' ? style.danger
                : style.success.replace(/fgColor-success/g, `fgColor-${tone}`)
                    .replace(/color-fg-success/g, `color-fg-${tone}`);
        } else {
            el.className = `color-fg-${tone}`;
            el.style.color = `var(--fgColor-${tone},${FALLBACK_COLORS[tone]})`;
        }
        el.textContent = text;
        return el;
    }

    function describeExclusions(files, signed, added, deleted, changed, commentLines) {
        const parts = [];
        if (files > 0) {
            parts.push(`${files} hidden file${files === 1 ? '' : 's'}`
                + ` (${signed ? `+${added.toLocaleString()} \u2212${deleted.toLocaleString()}`
                    : `${changed.toLocaleString()} changed lines`})`);
        }
        if (commentLines > 0) {
            parts.push(`${commentLines.toLocaleString()} comment-only line${commentLines === 1 ? '' : 's'}`);
        }
        return parts.length === 0 ? '' : 'Excluding ' + parts.join(' and ');
    }

    // ----------------------------------------------------------------- apply

    function apply() {
        // Turbo carries this instance across repositories; the preference has to
        // follow the repository on screen.
        if (activeScope !== repoScope()) {
            activeScope = repoScope();
            enabled = readEnabled();
            paused = readPaused();
            onlyChanged = readOnlyChanged();
            categories = readCategories();
            statHost = null;
        }
        if (resolveScope !== pullRequestScope()) {
            resolveScope = pullRequestScope();
            resolveAttempts = 0;
        }
        countEpoch++;
        const containers = fileContainers();
        // Nothing has moved since the last pass and nothing is waiting to be
        // classified, so re-deriving every verdict would buy nothing. Checked
        // before the tree is read, which is itself most of a pass.
        const signature = quickSignature(containers);
        if (signature === lastSignature) return;
        readTree();
        // A pass over part of the diff must keep looking rather than conclude.
        let unresolved = Math.max(0, expectedFileCount() - containers.length);
        const incomplete = unresolved > 0;
        const baseline = readBaseline();
        const snapshot = {};
        for (const container of containers) {
            let state = container.getAttribute(STATE_ATTR);
            if (!hiding()) {
                if (state) clearFile(container);
                continue;
            }
            // Feedback outranks tidiness: a collapsed stub is easy to scroll
            // past, and a review thread on a test file still has to be read.
            if (state === 'hidden' && hasReviewComments(container)) {
                revealFile(container);
                container.setAttribute(STATE_ATTR, 'commented');
                continue;
            }
            // GitHub replaced the element this file was decided on; the
            // stylesheet is still hiding it, so restore the marker and stub
            // rather than deciding it again from scratch.
            if (!state) {
                const anchor = anchorOf(container, true);
                if (anchor && revealed.has(anchor)) {
                    container.setAttribute(STATE_ATTR, 'shown');
                    continue;
                }
                const known = anchor && verdicts.get(anchor);
                if (known && HIDDEN_STATES.test(known.state)) {
                    container.__ghtfPath = known.path;
                    container.__ghtfTrust = 'exact';
                    markHidden(container, known.path, known.ruleName, known.state);
                    continue;
                }
            }
            // Viewed is the reader's own switch and they flip it while working,
            // so a file hidden for that reason is re-checked rather than settled.
            if (state === 'hidden' && container.__ghtfCategory === 'viewed' && !isViewedNow(container)) {
                clearFile(container);
                state = '';
            }
            if (state === 'commented') {
                if (hasReviewComments(container)) continue;
                // The thread is gone. Reclassifying beats leaving a file open
                // for feedback that is no longer on it.
                container.removeAttribute(STATE_ATTR);
                state = '';
            }
            if (state === 'unchanged') {
                const mark = fingerprint(container);
                if (container.__ghtfPath && mark) snapshot[container.__ghtfPath] = mark;
                continue;
            }
            // The reader can tick Viewed long after a file was decided, so an
            // ordinary verdict is not final while that category is on.
            if (state === 'source' && isViewedNow(container)) {
                clearFile(container);
                state = '';
            }
            // 'source' stands only when the path behind it was keyed rather than
            // read off a header that may still have been rendering.
            if (state === 'source' && container.__ghtfTrust === 'exact') continue;
            if (state && state !== 'source' && state !== 'pending') continue;
            const resolved = resolvePath(container);
            // A file whose path cannot be read yet is marked and retried, so
            // markup this script cannot read shows up in the pill instead of
            // looking like a diff with no test files in it.
            if (!resolved.path) {
                container.setAttribute(STATE_ATTR, 'pending');
                unresolved++;
                continue;
            }
            if (resolved.trust !== 'exact') unresolved++;
            const path = resolved.path;
            container.__ghtfPath = path;
            container.__ghtfTrust = resolved.trust;
            const rule = matchRule(path) || matchContent(container)
                || (isViewedNow(container) ? VIEWED_RULE : null);
            const mark = fingerprint(container);
            if (mark) snapshot[path] = mark;
            if (!rule) {
                if (onlyChanged && mark && baseline[path] === mark) {
                    if (hasReviewComments(container)) {
                        container.setAttribute(STATE_ATTR, 'commented');
                        continue;
                    }
                    hideFile(container, path, 'unchanged since your last visit', 'unchanged');
                    continue;
                }
                container.setAttribute(STATE_ATTR, 'source');
                continue;
            }
            if (hasReviewComments(container)) {
                container.setAttribute(STATE_ATTR, 'commented');
                continue;
            }
            container.__ghtfCategory = rule.category;
            hideFile(container, path, rule.name, 'hidden');
        }
        if (Object.keys(snapshot).length > 0) rememberSnapshot(Object.assign({}, baseline, snapshot));
        pruneStubs();
        applyTree(containers);
        renderVisibleTotals(containers);
        renderPill(containers, incomplete);
        renderPopover(containers);
        diagnose(containers);
        lastSignature = unresolved > 0 ? '' : quickSignature(containers);
        scheduleResolve(unresolved);
    }

    /**
     * Everything a pass would react to, cheap enough to compute on every one:
     * how many files there are, how many are still undecided, how big the tree
     * is, and the preferences in force. An unresolved file leaves the signature
     * blank so the next pass always runs.
     */
    function quickSignature(containers) {
        let undecided = 0;
        for (const container of containers) {
            if (!container.getAttribute(STATE_ATTR)) undecided++;
        }
        return [containers.length, undecided, document.querySelectorAll(TREE_ITEM_SELECTOR).length,
            // Live signals a pass reacts to and would otherwise skip: the reader
            // ticking Viewed, and a review thread arriving after the diff did.
            document.querySelectorAll('input[type="checkbox"]:checked').length,
            document.querySelectorAll(REVIEW_COMMENT_SELECTOR).length,
            // What this script put in the page and GitHub may have re-rendered
            // away: the header figure, the stubs, the pill.
            document.querySelector('.' + VISIBLE_STAT_CLASS) !== null,
            document.querySelectorAll('.' + STUB_CLASS).length,
            pill !== undefined && pill.isConnected,
            verdicts.size, revealed.size, enabled, paused, onlyChanged, popoverOpen,
            // Turbo carries one instance across pull requests, and a new one is
            // a different diff even when it happens to be the same shape.
            pullRequestScope()].join('|');
    }

    /**
     * GitHub renders a file's container before the header that names it, so a
     * pass can legitimately find nothing to classify. The observer usually
     * delivers the rest, but the review view finishes rendering work this
     * script never sees a mutation for, which would leave those files
     * unclassified for the remainder of the visit.
     */
    function scheduleResolve(unresolved) {
        clearTimeout(resolveTimer);
        if (unresolved === 0) {
            resolveAttempts = 0;
            return;
        }
        if (resolveAttempts >= RESOLVE_ATTEMPT_LIMIT) return;
        resolveAttempts++;
        resolveTimer = setTimeout(apply, RESOLVE_RETRY_MS);
    }

    /**
     * The tree lists this diff's files independently of the diff pane, so it can
     * report files the rules match while nothing is hidden. That is the one
     * failure the pill cannot show, because every container is reporting a
     * verdict it reached from a path this script may have misread.
     */
    function diagnose(containers) {
        if (!hiding() || treePathByAnchor.size === 0) return;
        const claimed = new Set(containers.map(c => c.__ghtfPath).filter(Boolean));
        const missed = Array.from(treePathByAnchor.values())
            .filter(path => matchRule(path) && !claimed.has(path));
        if (missed.length === 0) return;
        console.warn(`[test-file-filter] the file tree lists ${missed.length} file(s) matching a rule`
            + ' that no diff container claimed — run __ghTestFileFilter.report()', missed.slice(0, 5));
    }

    /** Re-sync the tree, the header summary and the pill after a manual reveal. */
    function refreshChrome() {
        countEpoch++;
        const containers = fileContainers();
        readTree();
        applyTree(containers);
        renderVisibleTotals(containers);
        renderPill(containers, expectedFileCount() > containers.length);
    }

    function reset() {
        verdicts.clear();
        syncHiding();
        for (const stub of document.querySelectorAll('.' + STUB_CLASS)) stub.remove();
        for (const container of fileContainers()) clearFile(container);
        revealed.clear();
        clearTree();
        statHost = null;
        totalsAttempts = 0;
        resolveAttempts = 0;
        lastSignature = '';
        clearTimeout(resolveTimer);
        const badge = document.querySelector('.' + VISIBLE_STAT_CLASS);
        if (badge) badge.remove();
    }

    // ------------------------------------------------------------- lifecycle

    let scheduled;
    let waitingSince = 0;

    /**
     * Trailing debounce with a ceiling. A plain trailing debounce never fires
     * while mutations keep arriving faster than its delay, and the review view
     * renders a large diff in bursts for seconds; a pass has to land inside
     * that window, or every file it appends stays unclassified until it stops.
     */
    function schedule() {
        const now = Date.now();
        if (!waitingSince) waitingSince = now;
        clearTimeout(scheduled);
        const remaining = waitingSince + MAX_WAIT_MS - now;
        scheduled = setTimeout(runPass, Math.max(0, Math.min(DEBOUNCE_MS, remaining)));
    }

    function runPass() {
        waitingSince = 0;
        apply();
    }

    /**
     * Whether a batch of mutations touched anything that is not this
     * extension's own UI. A pass writes pills, stubs and badges, and the
     * observer sees those writes like any other; reacting to them schedules a
     * pass whose writes schedule another, for as long as the page is open.
     */
    function foreign(records) {
        for (const record of records) {
            if (ownNode(record.target)) continue;
            for (const node of record.addedNodes) if (!ownNode(node)) return true;
            for (const node of record.removedNodes) if (!ownNode(node)) return true;
        }
        return false;
    }

    function ownNode(node) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        return !!(el && el.closest(`.${UI_CLASS}`));
    }

    function onMutations(records) {
        if (foreign(records)) schedule();
    }

    function install() {
        apply();
        // The bridge answers only if the extension installed it; a bookmarklet
        // stays local, which is the behaviour it had before.
        document.addEventListener(SYNC_DATA, event => {
            acceptSynced(event.detail && event.detail.settings);
        });
        document.dispatchEvent(new CustomEvent(SYNC_PULL));
        document.addEventListener('click', event => {
            if (!popoverOpen) return;
            const inside = event.target && event.target.closest
                && event.target.closest(`#${POPOVER_ID},#${PILL_ID},#${DOCK_ID}`);
            if (inside) return;
            setSettingsOpen(false);
        }, true);
        // documentElement, not body: GitHub replaces body on a navigation, and
        // an observer holding the old one goes quiet for the rest of the visit,
        // which leaves every file GitHub appends afterwards unclassified.
        new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
        for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) {
            window.addEventListener(event, schedule);
        }
    }

    const api = {
        apply,
        reset,
        get enabled() {
            return enabled;
        },
        set enabled(value) {
            enabled = Boolean(value);
            writeSetting(repoEnabledKey(), String(enabled));
            // An explicit decision ends any peek that was in force.
            paused = false;
            try {
                sessionStorage.removeItem(pausedKey());
            } catch (error) {
                // Private browsing; the in-memory flag is enough.
            }
            reset();
            apply();
        },
        /** Whether hiding is in force right now, preference and peek together. */
        get hiding() {
            return hiding();
        },
        get paused() {
            return paused;
        },
        /** What the pill is reporting, as numbers: the last pass's counts and the preferences in force. */
        summary() {
            return lastSummary ? Object.assign({}, lastSummary) : null;
        },
        /** Whether the category popover is open. */
        get settingsOpen() {
            return popoverOpen;
        },
        /** Open or close the category popover; with no argument, the other one. */
        toggleSettings(value) {
            setSettingsOpen(value === undefined ? !popoverOpen : Boolean(value));
            return popoverOpen;
        },
        /**
         * Show the hidden files for this pull request without changing what the
         * repository does next time.
         */
        peek(value) {
            paused = value === undefined ? !paused : Boolean(value);
            try {
                sessionStorage.setItem(pausedKey(), String(paused));
            } catch (error) {
                // Private browsing; the peek lasts as long as the page does.
            }
            reset();
            apply();
            return paused;
        },
        /** The setting for repositories with no preference of their own. */
        get defaultEnabled() {
            return localStorage.getItem(ENABLED_KEY) !== 'false';
        },
        set defaultEnabled(value) {
            writeSetting(ENABLED_KEY, String(Boolean(value)));
            enabled = readEnabled();
            reset();
            apply();
        },
        get repo() {
            return repoScope();
        },
        /** Collapse files identical to the previous visit to this pull request. */
        get onlyChanged() {
            return onlyChanged;
        },
        get categories() {
            return Object.assign({}, categories);
        },
        /** Switch one category of noise off for this repository. */
        setCategory(name, value) {
            if (!CATEGORIES.includes(name)) throw new Error(`unknown category: ${name}`);
            const stored = readCategories();
            stored[name] = Boolean(value);
            writeSetting(categoriesKey(), JSON.stringify(stored));
            categories = readCategories();
            reset();
            apply();
            return api.categories;
        },
        set onlyChanged(value) {
            onlyChanged = Boolean(value);
            writeSetting(onlyChangedKey(), String(onlyChanged));
            reset();
            apply();
        },
        /** Hand this repository back to the global default. */
        clearRepoPreference() {
            writeSetting(repoEnabledKey(), null);
            enabled = readEnabled();
            reset();
            apply();
            return { repo: repoScope(), enabled };
        },
        get rules() {
            return rules.map(([name, re]) => ({ name, pattern: String(re) }));
        },
        /** Persist an extra path pattern (string or RegExp) for repos with odd test layouts. */
        addRule(pattern) {
            const source = pattern instanceof RegExp ? pattern.source : String(pattern);
            const stored = JSON.parse(localStorage.getItem(CUSTOM_RULES_KEY) || '[]');
            if (!stored.includes(source)) stored.push(source);
            writeSetting(CUSTOM_RULES_KEY, JSON.stringify(stored));
            rules = BUILT_IN_RULES.concat(loadCustomRules());
            reset();
            apply();
            return api.rules;
        },
        clearCustomRules() {
            writeSetting(CUSTOM_RULES_KEY, null);
            rules = BUILT_IN_RULES.slice();
            reset();
            apply();
            return api.rules;
        },
        /** Reveal every file whose path contains `needle`, without disabling the filter. */
        show(needle) {
            let shown = 0;
            for (const container of fileContainers()) {
                if (container.getAttribute(STATE_ATTR) !== 'hidden') continue;
                if (needle && !filePath(container).includes(needle)) continue;
                revealFile(container);
                shown++;
            }
            refreshChrome();
            return shown;
        },
        debug() {
            readTree();
            const rows = fileContainers().map(container => {
                const resolved = resolvePath(container);
                // The same resolution apply() uses, so the table cannot disagree
                // with the verdicts on screen.
                const rule = (resolved.path ? matchRule(resolved.path) : null)
                    || matchContent(container)
                    || (isViewedNow(container) ? VIEWED_RULE : null);
                return {
                    path: resolved.path,
                    from: resolved.trust,
                    rule: rule ? rule.name : (resolved.path ? null : '(no path yet)'),
                    category: rule ? rule.category : null,
                    state: container.getAttribute(STATE_ATTR) || '(unprocessed)',
                    stat: formatStat(fileCounts(container))
                };
            });
            const host = diffstatHost();
            console.table(rows);
            console.log('[test-file-filter] totals host:',
                host ? (host.id || host.className || host.tagName) : 'NOT FOUND',
                host ? `"${(host.textContent || '').trim().slice(0, 60)}"` : '');
            if (rows.length === 0) {
                console.warn('[test-file-filter] no diff file containers matched. Selector in use: ' + FILE_SELECTOR);
            } else if (rows.every(row => row.path === '')) {
                console.warn('[test-file-filter] file containers found but no paths extracted. Attrs tried: ' + PATH_ATTRS.join(', '));
            }
            return rows;
        },
        /** Compact dump of what the two unreliable probes actually saw. */
        report() {
            readTree();
            const containers = fileContainers();
            const hidden = containers.find(c => c.getAttribute(STATE_ATTR) === 'hidden');
            const stuck = containers.find(c => c.getAttribute(STATE_ATTR) === 'pending')
                || hidden || containers[0];
            const host = diffstatHost();
            const describe = el => el && {
                tag: el.tagName,
                id: el.id || null,
                cls: String(el.className || '').slice(0, 90),
                text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90)
            };
            const states = {};
            for (const container of containers) {
                const state = container.getAttribute(STATE_ATTR) || '(unprocessed)';
                states[state] = (states[state] || 0) + 1;
            }
            const treePaths = Array.from(treePathByAnchor.values());
            const out = {
                url: location.pathname,
                containers: containers.length,
                states,
                resolveAttempts,
                // The tree's own reading, which does not depend on any file
                // header having rendered.
                treeRows: treePaths.length,
                treeMatching: treePaths.filter(path => matchRule(path)).length,
                treeStats: treeStatByAnchor.size,
                treeSample: treePaths.slice(0, 3),
                joinedFromTree: containers.filter(c => pathFromTree(c)).length,
                expectedFiles: expectedFileCount(),
                verdicts: verdicts.size,
                revealed: revealed.size,
                orphanStubs: Array.from(document.querySelectorAll('.' + STUB_CLASS))
                    .filter(stub => !document.getElementById(stub.id.slice(STUB_ID_PREFIX.length))).length,
                // The paths actually produced, which is the only way to tell a
                // rule that does not match from a path that was misread.
                resolvedPaths: containers.slice(0, 80).map(c => [
                    c.getAttribute(STATE_ATTR) || '?',
                    resolvePath(c).trust,
                    c.__ghtfPath || resolvePath(c).path
                ].join(' ')),
                totalsHost: describe(host),
                hostTotals: host ? hostTotals(host) : null,
                sampleAnchor: stuck ? anchorOf(stuck, true) : null,
                samplePath: stuck ? stuck.__ghtfPath || filePath(stuck) : null,
                sampleTrust: stuck ? resolvePath(stuck).trust : null,
                sampleHeaderLeaves: stuck ? headerLeaves(stuck, 24) : null,
                sampleCounts: stuck ? fileCounts(stuck) : null,
                sampleHeaderHtml: stuck
                    ? ((headerOf(stuck) || stuck).outerHTML || '').replace(/\s+/g, ' ').slice(0, 700)
                    : null,
                treeRowHtml: (document.querySelector(`${TREE_ITEM_SELECTOR}[data-tree-entry-type="file"]`)
                    || document.querySelector(TREE_ITEM_SELECTOR) || { outerHTML: '' })
                    .outerHTML.replace(/\s+/g, ' ').slice(0, 500)
            };
            console.log('%c[test-file-filter] paste everything below', 'font-weight:bold;color:#d29922');
            console.log(JSON.stringify(out, null, 1));
            return out;
        },
        selectors: { FILE_SELECTOR, PATH_ATTRS }
    };
    window.__ghTestFileFilter = api;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();
