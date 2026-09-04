/**
 * One control in the corner for both filters, and the keyboard shortcuts.
 *
 * Collapsed, it reads `files:lines` beside an icon that shows the filters are
 * in force; on hover or focus it expands to the two pills, which say what was
 * hidden and let the reader show it. The pills are the filters' own elements,
 * created by separate scripts, so their behaviour is theirs; this owns only
 * where they sit.
 */
(() => {
    'use strict';

    if (window.__ghDiffFilterControls) return;

    const DOCK_ID = 'ghdf-dock';
    const PILL_IDS = ['ghtf-pill', 'ghccf-pill'];
    const DIFF_PATH = /\/pull\/\d+\/(files|changes|commits\/[0-9a-f]{7,})/;
    const CONTAINER_SELECTOR = '.js-file,[class^="Diff-module__diffTargetable"]';
    const TYPING_SELECTOR = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
    const KEYS_KEY = 'gh-diff-filters:keys';
    const ENABLED_KEY = 'gh-diff-filters:shortcuts';
    /** On everything the filters and this script put in the page; their observers skip it. */
    const UI_CLASS = 'ghdf-ui';
    /** Fired by a filter after its pill changes. */
    const STATE_EVENT = 'ghdf:state';
    const STYLE_ID = 'ghdf-dock-style';
    const PINNED_CLASS = 'ghdf-pinned';
    const FUNNEL = '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>';
    const DOCK_CSS = `
#${DOCK_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
#${DOCK_ID} .ghdf-panel{display:none;flex-direction:column;align-items:flex-end;gap:6px;}
#${DOCK_ID}:hover .ghdf-panel,#${DOCK_ID}:focus-within .ghdf-panel,#${DOCK_ID}.${PINNED_CLASS} .ghdf-panel{display:flex;}
#${DOCK_ID} .ghdf-indicator{position:relative;display:inline-flex;align-items:center;gap:8px;margin:0;padding:6px 10px 6px 12px;border-radius:999px;border:1px solid var(--borderColor-default,#30363d);background:var(--bgColor-default,#0d1117);color:var(--fgColor-default,#e6edf3);font:600 12px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,monospace);box-shadow:0 6px 20px rgba(0,0,0,.4);user-select:none;}
#${DOCK_ID} .ghdf-indicator button{all:unset;display:inline-flex;align-items:center;font:inherit;color:inherit;line-height:1;cursor:pointer;}
#${DOCK_ID} .ghdf-indicator button:focus-visible{outline:2px solid var(--focus-outlineColor,#1f6feb);outline-offset:3px;border-radius:2px;}
#${DOCK_ID} .ghdf-settings{padding:3px;margin:-3px;border-radius:50%;color:var(--fgColor-muted,#8b949e);}
#${DOCK_ID} .ghdf-settings svg{display:block;}
#${DOCK_ID} .ghdf-settings:hover,#${DOCK_ID} .ghdf-settings[aria-expanded="true"]{color:var(--fgColor-default,#e6edf3);}
#${DOCK_ID} .ghdf-indicator.ghdf-active .ghdf-settings{color:var(--fgColor-success,#3fb950);}
#${DOCK_ID} .ghdf-progress{position:absolute;left:12px;right:10px;bottom:3px;height:2px;border-radius:999px;background:var(--borderColor-muted,#30363d);overflow:hidden;opacity:0;transition:opacity .3s ease;pointer-events:none;}
#${DOCK_ID} .ghdf-progress.ghdf-progress-on{opacity:1;}
#${DOCK_ID} .ghdf-progress span{display:block;height:100%;width:0;border-radius:999px;background:var(--fgColor-accent,#388bfd);transition:width .18s ease;}
#${DOCK_ID} .ghdf-progress.ghdf-progress-sweep span{width:35%;transition:none;animation:ghdf-sweep 1.1s ease-in-out infinite;}
@keyframes ghdf-sweep{0%{transform:translateX(-110%);}100%{transform:translateX(300%);}}
@media (prefers-reduced-motion:reduce){#${DOCK_ID} .ghdf-progress.ghdf-progress-sweep span{animation:none;width:100%;opacity:.5;}}
`;

    const DEFAULT_KEYS = { tests: 't', comments: 'c', next: 'j', previous: 'k' };
    const ACTION_LABELS = {
        tests: 'hide or show the filtered files',
        comments: 'hide or show comment-only lines',
        next: 'next visible file',
        previous: 'previous visible file'
    };

    function stored(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function readKeys() {
        let overrides = {};
        try {
            overrides = JSON.parse(stored(KEYS_KEY, '{}')) || {};
        } catch (error) {
            overrides = {};
        }
        const keys = Object.assign({}, DEFAULT_KEYS);
        for (const action of Object.keys(DEFAULT_KEYS)) {
            const key = overrides[action];
            if (typeof key === 'string' && key.length === 1) keys[action] = key;
        }
        return keys;
    }

    /**
     * Whether the reader has turned single-character shortcuts off.
     *
     * GitHub offers that as an accessibility setting and marks the document when
     * it is in force. The marker is matched by shape rather than by name, so the
     * setting keeps being honoured when GitHub renames the attribute — the cost
     * of guessing wrong here is shadowing a key someone relies on.
     */
    function characterKeysDisabled() {
        for (const el of [document.documentElement, document.body]) {
            if (!el || !el.attributes) continue;
            for (const attr of el.attributes) {
                if (!/(single.?character|character.?key).*(shortcut|key)|shortcut.*character/i.test(attr.name)) continue;
                const value = String(attr.value).toLowerCase();
                if (value !== 'false' && value !== '0' && value !== 'enabled') return true;
            }
        }
        return false;
    }

    let keys = readKeys();

    function shortcutsEnabled() {
        return stored(ENABLED_KEY, 'true') !== 'false' && !characterKeysDisabled();
    }

    /** Read by the test filter's popover, so the keys are visible somewhere. */
    function publishHelp() {
        window.__ghDiffFilterShortcuts = shortcutsEnabled()
            ? Object.keys(DEFAULT_KEYS).map(action => ({ key: keys[action], label: ACTION_LABELS[action] }))
            : [];
    }

    let dock;
    let panel;
    let indicator;
    let shorthand;
    let settings;
    let progress;
    let progressFill;
    let doneTimer;
    let activityTimer;
    let busy = false;
    /** How long after the last pass the filters are taken to be finished. */
    const SETTLE_MS = 700;
    let indicatorKey = '';

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.className = UI_CLASS;
        style.textContent = DOCK_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function funnel() {
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
        svg.innerHTML = FUNNEL;
        return svg;
    }

    function ensureDock() {
        const pills = PILL_IDS.map(id => document.getElementById(id)).filter(Boolean);
        if (pills.length === 0) return;
        ensureStyle();
        if (!dock || !dock.isConnected) {
            dock = document.createElement('div');
            dock.id = DOCK_ID;
            dock.className = UI_CLASS;
            panel = document.createElement('div');
            panel.className = 'ghdf-panel';
            indicator = document.createElement('div');
            indicator.className = 'ghdf-indicator';
            shorthand = document.createElement('button');
            shorthand.type = 'button';
            shorthand.className = 'ghdf-shorthand';
            shorthand.setAttribute('aria-expanded', 'false');
            // Hover is not available to everyone; a click keeps the pills open.
            shorthand.addEventListener('click', () => {
                const pinned = dock.classList.toggle(PINNED_CLASS);
                shorthand.setAttribute('aria-expanded', String(pinned));
            });
            settings = document.createElement('button');
            settings.type = 'button';
            settings.className = 'ghdf-settings';
            settings.setAttribute('aria-label', 'Choose what to hide');
            settings.setAttribute('aria-haspopup', 'dialog');
            settings.setAttribute('aria-expanded', 'false');
            settings.append(funnel());
            settings.addEventListener('click', () => {
                const filter = window.__ghTestFileFilter;
                if (filter && typeof filter.toggleSettings === 'function') filter.toggleSettings();
            });
            progress = document.createElement('div');
            progress.className = 'ghdf-progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-label', 'Filtering the diff');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            progressFill = document.createElement('span');
            progress.append(progressFill);
            indicator.append(shorthand, settings, progress);
            dock.append(panel, indicator);
            document.body.appendChild(dock);
        }
        for (const pill of pills) {
            if (pill.parentElement !== panel) panel.appendChild(pill);
            // The pills each placed themselves before there was a dock.
            if (pill.style.position !== 'static') {
                pill.style.position = 'static';
                pill.style.right = 'auto';
                pill.style.bottom = 'auto';
            }
        }
        renderIndicator();
    }

    function summaryOf(name) {
        const filter = window[name];
        return filter && typeof filter.summary === 'function' ? filter.summary() : null;
    }

    /** `files:lines` — what the test-file filter hid and what the comment filter hid. */
    /**
     * Note that the filters are working. They announce every pass, and GitHub
     * renders a large diff in bursts, so passes keep arriving for as long as
     * the diff does — a quiet spell is the end of it. This is the only signal
     * available on the review view, which lists every file's container up front
     * and fills the bodies in afterwards: by the time the slow part starts,
     * every file has "arrived" and a percentage has nothing left to count.
     */
    function noteActivity() {
        busy = true;
        clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
            busy = false;
            indicatorKey = '';
            renderIndicator();
        }, SETTLE_MS);
    }

    function renderIndicator() {
        const tests = summaryOf('__ghTestFileFilter');
        const comments = summaryOf('__ghCommentFilter');
        const files = tests ? tests.hidden : 0;
        const lines = comments ? comments.hiddenLines : 0;
        const active = Boolean((tests && tests.hiding) || (comments && comments.hiding));
        const filter = window.__ghTestFileFilter;
        const settingsOpen = Boolean(filter && filter.settingsOpen);
        const arrived = tests ? tests.files : 0;
        const expected = tests ? Math.max(tests.expected || 0, arrived) : 0;
        const loading = busy || Boolean(tests && tests.incomplete && expected > 0);
        const key = `${files}:${lines}:${active}:${settingsOpen}:${!!filter}:${arrived}/${expected}:${loading}`;
        if (key === indicatorKey) return;
        indicatorKey = key;
        shorthand.textContent = `${files}:${lines}`;
        indicator.classList.toggle('ghdf-active', active);
        const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
        shorthand.setAttribute('aria-label', `Diff filters${active ? '' : ', off'}: ${count(files, 'file')}`
            + ` and ${count(lines, 'comment line')} hidden. Details on hover or focus.`);
        // The categories belong to the test-file filter; without it there is nothing to open.
        settings.hidden = !filter;
        settings.setAttribute('aria-expanded', String(settingsOpen));
        renderProgress(loading, arrived, expected);
    }

    /**
     * A bar while the diff is still arriving. GitHub renders a large one in
     * bursts over several seconds, and a count that has stopped moving looks
     * exactly like a count that is finished — this says which. It fills to the
     * end before going away, so finishing is something the reader sees rather
     * than something they infer from the bar's absence.
     */
    function renderProgress(loading, arrived, expected) {
        if (!progress) return;
        clearTimeout(doneTimer);
        // Count against a total only where the page gives one that is still
        // ahead of what has arrived; otherwise say "working" and mean it.
        const counted = expected > arrived;
        if (loading) {
            const percent = counted ? Math.min(100, Math.round((arrived / expected) * 100)) : 0;
            progress.classList.add('ghdf-progress-on');
            progress.classList.toggle('ghdf-progress-sweep', !counted);
            if (counted) {
                progress.setAttribute('aria-valuenow', String(percent));
                // A sliver reads as "started"; nothing reads as broken.
                progressFill.style.width = `${Math.max(4, percent)}%`;
            } else {
                progress.removeAttribute('aria-valuenow');
                progressFill.style.width = '';
            }
            return;
        }
        if (!progress.classList.contains('ghdf-progress-on')) return;
        progress.classList.remove('ghdf-progress-sweep');
        progress.setAttribute('aria-valuenow', '100');
        progressFill.style.width = '100%';
        doneTimer = setTimeout(() => progress.classList.remove('ghdf-progress-on'), 900);
    }

    function onDiffScreen() {
        return DIFF_PATH.test(location.pathname);
    }

    /** Files still on screen, in document order, skipping what a filter collapsed. */
    function visibleFiles() {
        return Array.from(document.querySelectorAll(CONTAINER_SELECTOR))
            .filter(el => !el.classList.contains('ghtf-hidden-file')
                && getComputedStyle(el).display !== 'none');
    }

    let cursor = -1;
    function step(delta) {
        const files = visibleFiles();
        if (files.length === 0) return;
        cursor = Math.max(0, Math.min(files.length - 1, cursor === -1 ? 0 : cursor + delta));
        const target = files[cursor];
        if (target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function toggle(name) {
        const filter = window[name];
        if (!filter) return;
        // A peek where the filter offers one: showing the files is not the same
        // as changing what this repository does from now on.
        if (typeof filter.peek === 'function') filter.peek();
        else filter.enabled = !filter.enabled;
    }

    const ACTIONS = {
        tests: () => toggle('__ghTestFileFilter'),
        comments: () => toggle('__ghCommentFilter'),
        next: () => step(1),
        previous: () => step(-1)
    };

    function onKeyDown(event) {
        if (!shortcutsEnabled()) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.defaultPrevented || !onDiffScreen()) return;
        const target = event.target;
        if (target && target.closest && target.closest(TYPING_SELECTOR)) return;
        for (const action of Object.keys(ACTIONS)) {
            if (event.key !== keys[action]) continue;
            ACTIONS[action]();
            event.preventDefault();
            return;
        }
    }

    document.addEventListener('keydown', onKeyDown, true);
    // A filter announces each change to its pill, including a pill it had to
    // put back after a navigation replaced body.
    document.addEventListener(STATE_EVENT, () => {
        noteActivity();
        ensureDock();
    });
    ensureDock();
    publishHelp();

    window.__ghDiffFilterControls = {
        get keys() {
            return Object.assign({}, keys);
        },
        /** Rebind one action to a single character; pass null to restore the default. */
        setKey(action, key) {
            if (!Object.prototype.hasOwnProperty.call(DEFAULT_KEYS, action)) {
                throw new Error(`unknown action: ${action}`);
            }
            if (key !== null && (typeof key !== 'string' || key.length !== 1)) {
                throw new Error('a shortcut is a single character');
            }
            let overrides = {};
            try {
                overrides = JSON.parse(stored(KEYS_KEY, '{}')) || {};
            } catch (error) {
                overrides = {};
            }
            if (key === null) delete overrides[action];
            else overrides[action] = key;
            try {
                localStorage.setItem(KEYS_KEY, JSON.stringify(overrides));
            } catch (error) {
                // Private browsing; the change lasts as long as the page does.
            }
            keys = readKeys();
            if (key !== null) keys[action] = key;
            publishHelp();
            return this.keys;
        },
        get enabled() {
            return shortcutsEnabled();
        },
        set enabled(value) {
            try {
                localStorage.setItem(ENABLED_KEY, String(Boolean(value)));
            } catch (error) {
                // Private browsing.
            }
            publishHelp();
        },
        /** Why the shortcuts are off, when they are. */
        get characterKeysDisabledByGitHub() {
            return characterKeysDisabled();
        },
        help() {
            // Recomputed, because GitHub's setting can change without us acting.
            publishHelp();
            return window.__ghDiffFilterShortcuts;
        }
    };
})();
