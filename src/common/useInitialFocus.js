const React = require('react');

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const getInitialFocusKey = (routePath) => {
    if (typeof routePath !== 'string') return null;
    if (routePath === '/') return 'board';
    if (routePath === '/search') return 'search';
    if (routePath.startsWith('/metadetails/') || routePath.startsWith('/detail/')) return 'meta-details';
    if (routePath.startsWith('/player/')) return 'player';
    return null;
};

const isUsableFocusTarget = (target, routeElement) => {
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement) || !routeElement.contains(target)) return false;
    if (target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true') return false;
    if (target.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (target.tabIndex < 0) return false;

    const style = window.getComputedStyle(target);
    return style.display !== 'none' && style.visibility !== 'hidden' && target.getClientRects().length > 0;
};

const findFocusable = (container, routeElement) => {
    const candidates = container.querySelectorAll(FOCUSABLE_SELECTOR);
    for (let index = 0; index < candidates.length; index += 1) {
        if (isUsableFocusTarget(candidates[index], routeElement)) return candidates[index];
    }
    return null;
};

const findInitialTarget = (routeElement, routePath) => {
    const focusKey = getInitialFocusKey(routePath);
    if (focusKey !== null) {
        const markedTarget = routeElement.querySelector(`[data-webos-initial-focus="${focusKey}"]`);
        if (markedTarget === null) return null;
        if (isUsableFocusTarget(markedTarget, routeElement)) return markedTarget;
        return findFocusable(markedTarget, routeElement);
    }

    const content = routeElement.querySelector('[data-webos-focus-content]') || routeElement;
    return findFocusable(content, routeElement);
};

const getSavedTarget = (savedFocus, routeElement) => {
    if (savedFocus === null || typeof savedFocus !== 'object') return null;

    const savedElement = savedFocus.element;
    if (typeof savedFocus.href !== 'string') {
        return isUsableFocusTarget(savedElement, routeElement) ? savedElement : null;
    }
    if (isUsableFocusTarget(savedElement, routeElement) && savedElement.href === savedFocus.href) return savedElement;

    const links = routeElement.querySelectorAll('a[href]');
    for (let index = 0; index < links.length; index += 1) {
        if (links[index].href === savedFocus.href && isUsableFocusTarget(links[index], routeElement)) return links[index];
    }
    return null;
};

const useInitialFocus = (routeElementRef, lastFocusedElementRef, routePath, focused) => {
    React.useLayoutEffect(() => {
        if (!process.env.WEBOS || !focused || typeof window === 'undefined') return undefined;

        const routeElement = routeElementRef.current;
        if (routeElement === null) return undefined;

        let completed = false;
        let observer = null;

        const cleanup = () => {
            if (observer !== null) observer.disconnect();
            routeElement.removeEventListener('focusin', onFocusIn, true);
            routeElement.removeEventListener('mousedown', onRouteInteraction, true);
            routeElement.removeEventListener('click', onRouteInteraction, true);
            routeElement.removeEventListener('wheel', onRouteInteraction, true);
        };

        const finish = () => {
            completed = true;
            cleanup();
        };

        const onFocusIn = (event) => {
            if (!completed && event.target !== routeElement && routeElement.contains(event.target)) finish();
        };
        const onRouteInteraction = (event) => {
            if (!completed && event.target !== routeElement && routeElement.contains(event.target)) finish();
        };

        const focus = (target) => {
            if (!isUsableFocusTarget(target, routeElement)) return false;
            finish();
            target.focus();
            return true;
        };

        if (focus(getSavedTarget(lastFocusedElementRef.current, routeElement))) return cleanup;

        const currentFocus = getSavedTarget({ element: document.activeElement }, routeElement);
        if (focus(currentFocus)) {
            lastFocusedElementRef.current = { element: currentFocus, href: currentFocus.href || null };
            return cleanup;
        }

        const tryInitialFocus = () => {
            if (completed) return;
            focus(findInitialTarget(routeElement, routePath));
        };

        tryInitialFocus();
        if (completed) return cleanup;

        routeElement.addEventListener('focusin', onFocusIn, true);
        routeElement.addEventListener('mousedown', onRouteInteraction, true);
        routeElement.addEventListener('click', onRouteInteraction, true);
        routeElement.addEventListener('wheel', onRouteInteraction, true);
        if (typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(tryInitialFocus);
            observer.observe(routeElement, {
                attributes: true,
                attributeFilter: ['aria-disabled', 'class', 'data-webos-initial-focus', 'disabled', 'hidden', 'tabindex'],
                childList: true,
                subtree: true,
            });
        }

        return cleanup;
    }, [focused, lastFocusedElementRef, routeElementRef, routePath]);
};

module.exports = useInitialFocus;
