const React = require('react');
const { useLocation, useNavigate } = require('react-router');
const { usePlatform, useBackHandler, BACK_HANDLER_PRIORITIES } = require('stremio/common');
const { getBackNavigationAction } = require('stremio/common/Shortcuts/backNavigation');

// This must render beneath ShortcutsProvider so both handlers register with its
// central Back dispatcher.
const BackNavigation = () => {
    const { webos } = usePlatform();
    const navigate = useNavigate();
    const location = useLocation();

    const closeRouteOriginOnBack = React.useCallback(() => {
        const action = getBackNavigationAction(location, window.history.state);
        if (action.type !== 'route-origin') return false;

        navigate(action.target, { replace: true });
        return true;
    }, [location, navigate]);
    useBackHandler(
        closeRouteOriginOnBack,
        BACK_HANDLER_PRIORITIES.ROUTE_MODAL,
        !!location.state?.from
    );

    const handleAppBack = React.useCallback(() => {
        const action = getBackNavigationAction(location, window.history.state);
        if (action.type === 'history') {
            navigate(-1);
        } else if (action.type === 'platform') {
            webos.platformBack();
        }

        // Consume even when a direct non-root launch has no internal entry.
        return true;
    }, [location, navigate, webos.platformBack]);
    useBackHandler(handleAppBack, BACK_HANDLER_PRIORITIES.FALLBACK);

    return null;
};

module.exports = BackNavigation;
