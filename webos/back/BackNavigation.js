// Route layer and quit dialog of the Back dispatcher (owner: F3.2). Rendered next to the App,
// inside the router (src/App/index.webos.js).
//
// When no keyboard, handler or overlay took the press: the episode streams list goes back to the
// episode list, other routes go back as in webos/back/routes.js (createRouteBackHandler, with the
// guard against a second navigation from the same location, useRouteBack.js), and the Board asks
// to quit.

const React = require('react');
const useBackHandler = require('./useBackHandler');
const useRouteBack = require('./useRouteBack');
const { exitApp } = require('./platform');
const ExitDialog = require('./ExitDialog');

const BackNavigation = () => {
    const [exitOpen, setExitOpen] = React.useState(false);
    const focusBeforeExitRef = React.useRef(null);

    useRouteBack({
        openExitDialog: () => {
            focusBeforeExitRef.current = document.activeElement;
            setExitOpen(true);
        },
    });

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
