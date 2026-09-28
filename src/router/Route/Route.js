// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const { ModalsContainerProvider } = require('../ModalsContainerContext');
const { RouteFocusedProvider } = require('stremio/common/useRouteFocused');
const useInitialFocus = require('stremio/common/useInitialFocus');

const Route = ({ component, focused, routePath }) => {
    const routeElementRef = React.useRef(null);
    const lastFocusedElementRef = React.useRef(null);
    const rememberElement = React.useCallback((element) => {
        if (!process.env.WEBOS) return;
        if (
            typeof HTMLElement !== 'undefined' &&
            element instanceof HTMLElement &&
            routeElementRef.current &&
            routeElementRef.current.contains(element)
        ) {
            lastFocusedElementRef.current = {
                element,
                href: typeof element.href === 'string' ? element.href : null,
            };
        }
    }, []);
    const onFocusCapture = React.useCallback((event) => {
        if (event.target !== event.currentTarget) rememberElement(event.target);
    }, [rememberElement]);
    const onClickCapture = React.useCallback((event) => {
        if (typeof Element === 'undefined' || !(event.target instanceof Element)) return;
        const element = event.target.closest('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) rememberElement(element);
    }, [rememberElement]);

    useInitialFocus(routeElementRef, lastFocusedElementRef, routePath, focused);

    return (
        <div className={'route-container'}>
            <RouteFocusedProvider value={focused}>
                <ModalsContainerProvider>
                    <div ref={routeElementRef} className={'route-content'} onFocusCapture={onFocusCapture} onClickCapture={onClickCapture}>
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
    routePath: PropTypes.string,
};

module.exports = Route;
