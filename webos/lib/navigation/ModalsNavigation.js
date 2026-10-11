// Mounted next to BackNavigation (src/App/index.webos.js, F4.3). Renders nothing: it installs, for
// the life of the app, the focus of the overlays (modals.js) and the context menu triggers
// (contextMenu.js). Both only listen; they add no work to the boot.

const React = require('react');
const { createModalFocus } = require('./modals');
const { installContextMenuTrigger } = require('./contextMenu');

const ModalsNavigation = () => {
    React.useEffect(() => {
        const modalFocus = createModalFocus(window);
        modalFocus.start();
        // For the tests on the emulator and the diagnostics screen: window.__webosModalFocus.current.
        window.__webosModalFocus = modalFocus;
        const removeContextMenuTrigger = installContextMenuTrigger(window);
        return () => {
            modalFocus.stop();
            delete window.__webosModalFocus;
            removeContextMenuTrigger();
        };
    }, []);

    return null;
};

module.exports = ModalsNavigation;
