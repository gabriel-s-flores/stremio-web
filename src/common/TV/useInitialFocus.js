const React = require('react');
const { isFocusable, initialTarget } = require('./focus');
const { revealTarget } = require('../installTVSpatialNavigation');

// Route layers retain their DOM while a details/player layer covers them.
const useInitialFocus = (rootRef, active, locationKey, pathname) => {
    const remembered = React.useRef(new Map());
    React.useEffect(() => {
        if (!process.env.WEBOS || !active || !rootRef.current) return;
        const root = rootRef.current;
        let pending = true;
        let frame;
        let observer;
        let timer;
        const stop = () => {
            pending = false;
            if (observer) observer.disconnect();
            clearTimeout(timer);
            cancelAnimationFrame(frame);
        };
        const remember = (event) => {
            if (!root.contains(event.target) || event.target.closest('[data-focus-lock-disabled="false"],[role="menu"]')) return;
            remembered.current.delete(locationKey);
            remembered.current.set(locationKey, event.target);
            if (remembered.current.size > 20) remembered.current.delete(remembered.current.keys().next().value);
            stop();
        };
        const attempt = (fallback = false) => {
            if (!pending) return;
            const current = document.activeElement;
            // Respect native autofocus, user navigation, and any open overlay.
            if (current && (current.closest('[data-focus-lock-disabled="false"]') || (root.contains(current) && isFocusable(current)))) {
                stop();
                return;
            }
            const previous = remembered.current.get(locationKey);
            const target = root.contains(previous) && isFocusable(previous) ? previous : initialTarget(root, pathname, fallback);
            if (target) {
                target.focus();
                revealTarget(target);
                if (document.activeElement === target) stop();
            }
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => attempt());
        };
        root.addEventListener('focusin', remember);
        observer = new MutationObserver(schedule);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'tabindex'] });
        timer = setTimeout(() => attempt(true), 1200);
        schedule();
        return () => {
            stop();
            root.removeEventListener('focusin', remember);
        };
    }, [active, locationKey, pathname, rootRef]);
};

module.exports = useInitialFocus;
