// webOS TV 4.x build only (resolved instead of MetaDetails.js by webos/webpack/app.js, F4.1c).
// The upstream page as is, with the remote control navigation of webos/lib/navigation/metadetails.js:
// initial focus, focus restored on the way back, the moves between the info column and the list,
// scrolling that keeps the neighbours in view, the summary reachable. The controller works on the
// DOM of this route (the parent of a hidden marker rendered after the page) and is told the page
// path, how it was reached and whether the route is the top one. No JSX: see Stream.webos.js.

const React = require('react');
const { useLocation, useNavigationType } = require('react-router');
const { useRouteActive } = require('stremio/common/useRouteFocused');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamMetaDetails = require('./MetaDetails.js');
const { createMetaDetailsNavigation } = require('../../../webos/lib/navigation/metadetails');

const MetaDetails = (props) => {
    const location = useLocation();
    const navigationType = useNavigationType();
    const routeActive = useRouteActive();
    const markerRef = React.useRef(null);
    const navigationRef = React.useRef(null);

    React.useEffect(() => {
        const navigation = createMetaDetailsNavigation({ root: markerRef.current.parentNode, window });
        navigationRef.current = navigation;
        return () => {
            navigationRef.current = null;
            navigation.destroy();
        };
    }, []);

    React.useEffect(() => {
        navigationRef.current.setLocation(location.pathname, navigationType);
    }, [location.pathname, navigationType]);

    React.useEffect(() => {
        navigationRef.current.setRouteActive(routeActive);
    }, [routeActive]);

    return [
        React.createElement(UpstreamMetaDetails, Object.assign({ key: 'page' }, props)),
        React.createElement('span', { key: 'navigation', ref: markerRef, hidden: true }),
    ];
};

module.exports = MetaDetails;
