// Mounts the webOS lifecycle (webos/lifecycle/controller.js) inside the router: the deep link of a
// launch or relaunch becomes a navigation. Renders nothing; the work happens on the events.

const React = require('react');
const { createPath, useLocation, useNavigate } = require('react-router');
const createLifecycle = require('./controller');

const LifecycleHandler = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const locationPathRef = React.useRef(null);
    const navigateRef = React.useRef(navigate);
    locationPathRef.current = createPath(location);
    navigateRef.current = navigate;

    React.useEffect(() => {
        const lifecycle = createLifecycle({
            window,
            onDeepLink: (path) => {
                if (path !== locationPathRef.current) {
                    navigateRef.current(path);
                }
            },
        });
        lifecycle.start();
        return lifecycle.stop;
    }, []);

    return null;
};

module.exports = LifecycleHandler;
