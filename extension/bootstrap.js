/**
 * Runs the queued diff filters once a GitHub pull-request diff is actually on
 * screen.
 *
 * The content script is matched against all of github.com rather than the diff
 * URLs alone because GitHub navigates with Turbo: moving from a PR list to its
 * diff replaces the body without a document load, so a narrower match would
 * never inject. The filters stay dormant until this decides the page qualifies.
 */
(() => {
    'use strict';

    if (window.__ghDiffFilterBootstrap) return;
    window.__ghDiffFilterBootstrap = true;

    // Read by the filters to tell an automatic install from a bookmarklet click.
    window.__ghDiffFilterAuto = true;

    const DIFF_PATH = /\/pull\/\d+\/(files|changes|commits\/[0-9a-f]{7,})/;
    const CONTAINER_SELECTOR = '.js-file,[class^="Diff-module__diffTargetable"]';
    const SETTLE_MS = 200;

    let installed = false;
    let settleTimer;

    function onDiffScreen() {
        return DIFF_PATH.test(location.pathname);
    }

    function install() {
        if (installed || !onDiffScreen() || !document.querySelector(CONTAINER_SELECTOR)) return;
        installed = true;
        observer.disconnect();
        for (const filter of window.__ghDiffFilterQueue || []) {
            try {
                filter();
            } catch (error) {
                console.warn('[gh-diff-filters] a filter failed to start', error);
            }
        }
    }

    function schedule() {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(install, SETTLE_MS);
    }

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) {
        window.addEventListener(event, schedule);
    }
    install();

    /**
     * Both filters nudge you when they find no diff, which is the right call for
     * a bookmarklet you just clicked and pure noise once they are always on: the
     * filters outlive the diff screen and re-run on every later page. The test
     * filter honours __ghDiffFilterAuto, but hide-comment-diffs is a third-party
     * minified artifact, so its nudge is cleared here instead of at the source.
     */
    const STRAY_NOTICE = 'No diff found on this page';
    new MutationObserver(records => {
        for (const record of records) {
            if (record.target !== document.body) continue;
            for (const node of record.addedNodes) {
                if (node.nodeType === 1 && !node.id && !node.className
                    && (node.textContent || '').startsWith(STRAY_NOTICE)) {
                    node.remove();
                }
            }
        }
    }).observe(document.body, { childList: true });
})();
