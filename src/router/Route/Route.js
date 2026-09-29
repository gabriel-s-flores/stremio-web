// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const { ModalsContainerProvider } = require('../ModalsContainerContext');
const { RouteFocusedProvider } = require('stremio/common/useRouteFocused');

const useInitialFocus = process.env.WEBOS ? require('stremio/common/TV/useInitialFocus') : () => undefined;

const Route = ({ component, focused, locationKey, pathname }) => {
    const rootRef = React.useRef(null);
    useInitialFocus(rootRef, focused, locationKey, pathname);
    return (
        <div ref={rootRef} className={'route-container'} data-tv-route-active={process.env.WEBOS ? String(focused) : undefined}>
            <RouteFocusedProvider value={focused}>
                <ModalsContainerProvider>
                    <div className={'route-content'}>
                        {component}
                    </div>
                </ModalsContainerProvider>
            </RouteFocusedProvider>
        </div>
    );
};

Route.propTypes = {
    component: PropTypes.node,
    focused: PropTypes.bool,
    locationKey: PropTypes.string,
    pathname: PropTypes.string,
};

module.exports = Route;
