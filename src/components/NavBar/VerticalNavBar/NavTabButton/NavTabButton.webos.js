// webOS TV 4.x build only (resolved instead of NavTabButton.js by webos/webpack/app.js, F4.1b).
// The upstream button with tabIndex 0: upstream keeps the side navigation bar out of the keyboard
// focus (tabIndex -1), so the remote arrows could never reach it. LEFT from the first column of a
// screen goes to it (spatial-navigation-polyfill) and RIGHT comes back to the item it was left from
// (webos/lib/navigation/sideBar.js). The upstream render runs as is, only the tab index changes.

const React = require('react');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamNavTabButton = require('./NavTabButton.js');

const NavTabButton = (props) => React.cloneElement(UpstreamNavTabButton(props), { tabIndex: 0 });

NavTabButton.propTypes = UpstreamNavTabButton.propTypes;

module.exports = NavTabButton;
