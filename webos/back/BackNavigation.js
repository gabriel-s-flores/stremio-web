// Route layer and quit dialog of the Back dispatcher (owner: F3.2). Rendered next to the App,
// inside the router (src/App/index.webos.js).
//
// When no keyboard, handler or overlay took the press: the episode streams list goes back to the
// episode list, other routes go back as in webos/back/routes.js (createRouteBackHandler, with the
// guard against a second navigation from the same location), and the Board asks to quit.

const React = require('react');
const { useLocation, useNavigate } = require('react-router');
const { default: getBackFallback } = require('../../src/router/getBackFallback');
const { PRIORITY } = require('./dispatcher');
const backDispatcher = require('./backDispatcher');
const useBackHandler = require('./useBackHandler');
const { findPageBackButton } = require('./overlays');
const { createRouteBackHandler } = require('./routes');
const { exitApp } = require('./platform');
const ExitDialog = require('./ExitDialog');

const BackNavigation = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [exitOpen, setExitOpen] = React.useState(false);
    const locationRef = React.useRef(location);
    const navigateRef = React.useRef(navigate);
    const focusBeforeExitRef = React.useRef(null);
    locationRef.current = location;
    navigateRef.current = navigate;

    React.useEffect(() => {
        return backDispatcher.register(createRouteBackHandler({
            getLocation: () => locationRef.current,
            getHistoryIndex: () => (window.history.state ? window.history.state.idx : undefined),
            getFallbackPath: getBackFallback,
            findPageBackButton: () => findPageBackButton(document),
            navigate: (to, options) => navigateRef.current(to, options),
            openExitDialog: () => {
                focusBeforeExitRef.current = document.activeElement;
                setExitOpen(true);
            },
        }), { priority: PRIORITY.ROUTE, name: 'route' });
    }, []);

    const closeExitDialog = React.useCallback(() => {
        setExitOpen(false);
        const previous = focusBeforeExitRef.current;
        focusBeforeExitRef.current = null;
        if (previous && previous !== document.body && document.body.contains(previous)) {
            previous.focus();
        }
    }, []);

    const confirmExit = React.useCallback(() => exitApp(window), []);

    useBackHandler((context) => {
        context.detail = 'exit-dialog-cancel';
        closeExitDialog();
        return true;
    }, { enabled: exitOpen, name: 'exit-dialog' });

    return exitOpen ? <ExitDialog onCancel={closeExitDialog} onConfirm={confirmExit} /> : null;
};

module.exports = BackNavigation;
