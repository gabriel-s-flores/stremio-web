// Mounts the navigation of webos/lib/navigation/f4.1b.js inside the router (src/App/index.webos.js):
// the key and focus listeners for the life of the app, and the screen focus on every location change.
// Renders nothing. window.__webosNavigationF41b.status tells the last focus it moved (tests).

const React = require('react');
const { useLocation } = require('react-router');
const { createNavigation } = require('./f4.1b');

const F41bNavigation = () => {
    const location = useLocation();
    const navigationRef = React.useRef(null);

    React.useEffect(() => {
        const navigation = createNavigation({ window });
        navigationRef.current = navigation;
        window.__webosNavigationF41b = navigation;
        const uninstall = navigation.install();
        return () => {
            uninstall();
            navigationRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        if (navigationRef.current !== null) navigationRef.current.focusScreen();
    }, [location.pathname, location.search]);

    return null;
};

module.exports = F41bNavigation;
