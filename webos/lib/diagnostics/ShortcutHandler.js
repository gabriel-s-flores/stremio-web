// The remote shortcut of the diagnostics screen (shortcut.js), mounted inside the Router next to
// BackNavigation (src/App/index.webos.js, F3.6). It opens the screen with the router's navigate(), so
// the history entry has history.state.idx and the Back key of F3.2 returns to the route the user was on
// (setting location.hash would leave an entry without idx, and Back would fall to the Board).
// Renders nothing; one window listener for the life of the app.

const React = require('react');
const { useNavigate } = require('react-router');
const { installDiagnosticsShortcut, DIAGNOSTICS_PATH } = require('./shortcut');

const ShortcutHandler = () => {
    const navigate = useNavigate();
    const navigateRef = React.useRef(navigate);
    navigateRef.current = navigate;

    React.useEffect(() => installDiagnosticsShortcut(window, {
        open: () => {
            if (!window.location.hash.startsWith('#' + DIAGNOSTICS_PATH)) navigateRef.current(DIAGNOSTICS_PATH);
        },
    }), []);

    return null;
};

module.exports = ShortcutHandler;
