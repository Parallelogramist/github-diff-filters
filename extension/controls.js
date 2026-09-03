/**
 * Docks both filters' pills into one control and adds keyboard shortcuts.
 *
 * The two pills are created by separate scripts and each placed itself in the
 * corner, which only worked while there were exactly two of them. Docking gives
 * one owner for the layout.
 */
(() => {
    'use strict';

    if (window.__ghDiffFilterControls) return;
    window.__ghDiffFilterControls = true;

    const DOCK_ID = 'ghdf-dock';
    const PILL_IDS = ['ghtf-pill', 'ghccf-pill'];
    const DIFF_PATH = /\/pull\/\d+\/(files|changes|commits\/[0-9a-f]{7,})/;
    const CONTAINER_SELECTOR = '.js-file,[class^="Diff-module__diffTargetable"]';
    const TYPING_SELECTOR = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';

    const SHORTCUTS = 'Shortcuts: t hide/show test files · c hide/show comment lines'
        + ' · j/k next and previous visible file';

    let dock;

    function ensureDock() {
        const pills = PILL_IDS.map(id => document.getElementById(id)).filter(Boolean);
        if (pills.length === 0) return;
        if (!dock || !dock.isConnected) {
            dock = document.createElement('div');
            dock.id = DOCK_ID;
            dock.title = SHORTCUTS;
            dock.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;'
                + 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;';
            document.body.appendChild(dock);
        }
        for (const id of PILL_IDS) {
            const pill = document.getElementById(id);
            if (!pill) continue;
            if (pill.parentElement !== dock) dock.appendChild(pill);
            // The pills each placed themselves before there was a dock.
            pill.style.position = 'static';
            pill.style.right = 'auto';
            pill.style.bottom = 'auto';
        }
    }

    function onDiffScreen() {
        return DIFF_PATH.test(location.pathname);
    }

    /** Files still on screen, in document order, skipping what a filter collapsed. */
    function visibleFiles() {
        return Array.from(document.querySelectorAll(CONTAINER_SELECTOR))
            .filter(el => el.style.display !== 'none' && !el.classList.contains('ghtf-hidden-file'));
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
        if (filter) filter.enabled = !filter.enabled;
    }

    function onKeyDown(event) {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.defaultPrevented || !onDiffScreen()) return;
        const target = event.target;
        if (target && target.closest && target.closest(TYPING_SELECTOR)) return;
        switch (event.key) {
            case 't': toggle('__ghTestFileFilter'); break;
            case 'c': toggle('__ghCommentFilter'); break;
            case 'j': step(1); break;
            case 'k': step(-1); break;
            default: return;
        }
        event.preventDefault();
    }

    document.addEventListener('keydown', onKeyDown, true);
    new MutationObserver(ensureDock).observe(document.body, { childList: true });
    ensureDock();
})();
