// Route layer of the Back dispatcher as a React hook (owner: F3.2). Used by BackNavigation.js;
// no JSX, so the jsdom tests run it inside a real router (webos/tests/back/history.test.js).
//
// Registers createRouteBackHandler (webos/back/routes.js) at the ROUTE priority, and records every
// location the router goes through with its history.state.idx (createHistoryStack), so that Back
// can go through the history instead of pushing screens again (F3.2b).

const React = require('react');
const { useLocation, useNavigate, useNavigationType } = require('react-router');
const { default: getBackFallback } = require('../../src/router/getBackFallback');
const { PRIORITY } = require('./dispatcher');
const backDispatcher = require('./backDispatcher');
const { findPageBackButton } = require('./overlays');
const { createHistoryStack, createRouteBackHandler } = require('./routes');

const getHistoryIndex = () => (window.history.state ? window.history.state.idx : undefined);

// openExitDialog(): called on the Board (and /intro) instead of navigating.
const useRouteBack = ({ openExitDialog }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const navigationType = useNavigationType();
    const historyStack = React.useMemo(createHistoryStack, []);
    const locationRef = React.useRef(location);
    const navigateRef = React.useRef(navigate);
    const openExitDialogRef = React.useRef(openExitDialog);
    locationRef.current = location;
    navigateRef.current = navigate;
    openExitDialogRef.current = openExitDialog;

    React.useEffect(() => {
        historyStack.record(getHistoryIndex(), location, navigationType);
    }, [location]);

    React.useEffect(() => {
        return backDispatcher.register(createRouteBackHandler({
            getLocation: () => locationRef.current,
            getHistoryIndex,
            getEntry: historyStack.get,
            getFallbackPath: getBackFallback,
            findPageBackButton: () => findPageBackButton(document),
            navigate: (to, options) => navigateRef.current(to, options),
            openExitDialog: () => openExitDialogRef.current(),
        }), { priority: PRIORITY.ROUTE, name: 'route' });
    }, []);
};

module.exports = useRouteBack;
