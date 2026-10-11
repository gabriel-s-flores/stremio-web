// webOS TV 4.x build only (resolved instead of NavMenu.js by webos/webpack/app.js, F4.1b).
// The upstream profile menu with its button focusable (upstream renders it with tabIndex -1, out of
// reach of the remote arrows): OK opens and closes the menu, Back closes it (overlay bridge of
// webos/back). Only the tab index of the label changes.

const React = require('react');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamNavMenu = require('./NavMenu.js');

const NavMenu = ({ renderLabel, ...props }) => {
    const renderFocusableLabel = React.useCallback((labelProps) => (
        React.cloneElement(renderLabel(labelProps), { tabIndex: 0 })
    ), [renderLabel]);
    return React.createElement(UpstreamNavMenu, { ...props, renderLabel: renderFocusableLabel });
};

NavMenu.propTypes = UpstreamNavMenu.propTypes;

module.exports = NavMenu;
