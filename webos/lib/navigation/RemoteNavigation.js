// The remote navigation of the whole app (README.md), mounted once next to BackNavigation
// (src/App/index.webos.js). Renders nothing: it installs, for the life of the app, the parts that are
// not one screen's: the focus of the overlays (modals.js), the context menu triggers
// (contextMenu.js), the side navigation bar (sideBar.js) and the interface zoom. The screens bring
// their own focus with them (withScreenNavigation.js, MetaDetails.webos.js). All of it listens
// through one input hub (core/input.js); nothing runs at boot.

const React = require('react');
const { createModalFocus } = require('./modals');
const { installContextMenuTrigger } = require('./contextMenu');
const { installSideBar } = require('./sideBar');
const { getInputHub } = require('./core/input');
const { visibleRoute } = require('./core/routes');
const { screenFocusOf, status } = require('./core/screenFocus');

const RemoteNavigation = () => {
    React.useEffect(() => {
        const modalFocus = createModalFocus(window);
        modalFocus.start();
        const removeContextMenuTrigger = installContextMenuTrigger(window);
        const removeSideBar = installSideBar(window);

        // The interface zoom (Settings) changes the layout under the focused element: once laid out,
        // its list scrolls to it again.
        let resizeTimer = null;
        const onResize = () => {
            if (resizeTimer !== null) return;
            resizeTimer = window.setTimeout(() => {
                resizeTimer = null;
                const screen = screenFocusOf(visibleRoute(document));
                if (screen !== null) screen.realign();
            }, 0);
        };
        window.addEventListener('resize', onResize);

        // For the tests on the emulator and the diagnostics screen.
        const diagnostics = {
            status,
            hub: getInputHub(window),
            screen: () => screenFocusOf(visibleRoute(document)),
        };
        window.__webosModalFocus = modalFocus;
        window.__webosNavigation = diagnostics;
        // The name the F4.1b tests on the emulator wait for.
        window.__webosNavigationF41b = diagnostics;
        return () => {
            modalFocus.stop();
            removeContextMenuTrigger();
            removeSideBar();
            window.clearTimeout(resizeTimer);
            window.removeEventListener('resize', onResize);
            delete window.__webosModalFocus;
            delete window.__webosNavigation;
            delete window.__webosNavigationF41b;
        };
    }, []);

    return null;
};

module.exports = RemoteNavigation;
