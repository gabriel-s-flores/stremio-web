// React side of webos/lib/navigation/f4.1a.js (owner: F4.1a): wraps the Board, Discover and Search
// route components (their index.webos.js). Kept apart so the DOM logic is unit tested without JSX.

const React = require('react');
const { useRouteActive } = require('stremio/common/useRouteFocused');
const { createScreenFocus } = require('./f4.1a');

// Wraps a route component. The marker element is rendered next to the screen, inside the route
// content (src/router/Route), which is the container of the screen's focus.
const withScreenNavigation = (Component, screen) => {
    const ScreenWithNavigation = (props) => {
        const markerRef = React.useRef(null);
        const focusRef = React.useRef(null);
        const active = useRouteActive();
        const wasActiveRef = React.useRef(active);

        React.useEffect(() => {
            const focus = createScreenFocus(markerRef.current.parentElement, screen);
            focusRef.current = focus;
            focus.ensureFocus();
            return () => {
                focusRef.current = null;
                focus.destroy();
            };
        }, []);

        // Effects run children first: this one comes after the screen's own (the search field).
        React.useEffect(() => {
            const wasActive = wasActiveRef.current;
            wasActiveRef.current = active;
            if (!focusRef.current || active === wasActive) return;
            if (active) focusRef.current.restore();
            else focusRef.current.leave();
        }, [active]);

        return (
            <React.Fragment>
                <Component {...props} />
                <span ref={markerRef} hidden={true} />
            </React.Fragment>
        );
    };
    ScreenWithNavigation.displayName = `WithScreenNavigation(${Component.displayName || Component.name || 'Screen'})`;
    return ScreenWithNavigation;
};

module.exports = withScreenNavigation;
