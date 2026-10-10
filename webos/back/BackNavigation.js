// Route layer and quit dialog of the Back dispatcher (owner: F3.2). Rendered next to the App,
// inside the router (src/App/index.webos.js).
//
// When no keyboard, handler or overlay took the press: the episode streams list goes back to the
// episode list, other routes go back as in webos/back/routes.js, and the Board asks to quit.
// One press moves one step: until the location changes after a navigation, further presses are
// consumed without navigating again (a history pop is asynchronous, and a second navigate(-1)
// computed from the old location would skip a screen or leave the app's history). The guard
// expires after PENDING_MS, so a navigation that never happens does not leave Back stuck.

const React = require('react');
const { useLocation, useNavigate } = require('react-router');
const { default: getBackFallback } = require('../../src/router/getBackFallback');
const { PRIORITY } = require('./dispatcher');
const backDispatcher = require('./backDispatcher');
const useBackHandler = require('./useBackHandler');
const { findPageBackButton } = require('./overlays');
const { resolveRouteBack } = require('./routes');
const { exitApp } = require('./platform');
const ExitDialog = require('./ExitDialog');

const PENDING_MS = 1000;

const BackNavigation = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [exitOpen, setExitOpen] = React.useState(false);
    const locationRef = React.useRef(location);
    const pendingRef = React.useRef({ key: null, time: 0 });
    const focusBeforeExitRef = React.useRef(null);
    locationRef.current = location;

    React.useEffect(() => {
        return backDispatcher.register((context) => {
            const current = locationRef.current;
            const pending = pendingRef.current;
            if (pending.key === current.key && Date.now() - pending.time < PENDING_MS) {
                context.detail = 'pending';
                return true;
            }

            const pageBackButton = findPageBackButton(document);
            if (pageBackButton !== null) {
                context.detail = 'page';
                pendingRef.current = { key: current.key, time: Date.now() };
                pageBackButton.click();
                return true;
            }

            const action = resolveRouteBack({
                pathname: current.pathname,
                state: current.state,
                historyIndex: window.history.state ? window.history.state.idx : undefined,
                fallbackPath: getBackFallback(current),
            });
            if (action.type === 'exit') {
                context.detail = 'exit-dialog';
                focusBeforeExitRef.current = document.activeElement;
                setExitOpen(true);
                return true;
            }

            context.detail = `navigate:${action.to}`;
            pendingRef.current = { key: current.key, time: Date.now() };
            if (action.to === -1) {
                navigate(-1);
            } else {
                navigate(action.to, { replace: action.replace });
            }
            return true;
        }, { priority: PRIORITY.ROUTE, name: 'route' });
    }, [navigate]);

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
