// React side of the screen focus (./core/screenFocus.js): wraps a route component in its
// index.webos.js (Board, Discover, Search, Library, Calendar, Addons, Settings). No JSX: the root
// jest config does not transform it, and webos/tests/navigation/withScreenNavigation.test.js renders
// this with react-dom.

const React = require('react');
const { UNSAFE_LocationContext: LocationContext } = require('react-router');
const { useRouteActive } = require('stremio/common/useRouteFocused');
const { createScreenFocus } = require('./core/screenFocus');

// The location of the route (src/router/Routes.tsx gives every view its own); null outside a router.
const useRouteLocation = () => {
    const context = React.useContext(LocationContext);
    return context ? context.location : null;
};

// Wraps a route component. The marker element is rendered next to the screen, inside the route
// content (src/router/Route), which is the container of the screen's focus.
const withScreenNavigation = (Component, screen) => {
    const ScreenWithNavigation = (props) => {
        const markerRef = React.useRef(null);
        const focusRef = React.useRef(null);
        const active = useRouteActive();
        const wasActiveRef = React.useRef(active);
        const activeRef = React.useRef(active);
        activeRef.current = active;
        const location = useRouteLocation();
        const locationKey = location ? `${location.pathname}?${location.search}` : null;
        const locationKeyRef = React.useRef(locationKey);

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

        // Same screen, another location (a filter, a sort): the list under the focus is replaced.
        React.useEffect(() => {
            const previous = locationKeyRef.current;
            locationKeyRef.current = locationKey;
            if (focusRef.current && activeRef.current && previous !== locationKey) focusRef.current.onLocationChange();
        }, [locationKey]);

        return React.createElement(
            React.Fragment,
            null,
            React.createElement(Component, props),
            React.createElement('span', { ref: markerRef, hidden: true }),
        );
    };
    ScreenWithNavigation.displayName = `WithScreenNavigation(${Component.displayName || Component.name || 'Screen'})`;
    return ScreenWithNavigation;
};

module.exports = withScreenNavigation;
