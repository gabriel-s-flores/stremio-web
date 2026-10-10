// webOS TV 4.x build only (resolved instead of ControlBar.js by webos/webpack/app.js, F5.1).
// The upstream control bar without the playback speed button (the C8 plays without sound at rates
// other than 1x; useVideo.webos.js already turns the speed off). The upstream render runs as is and
// only the button that opens the speed menu is dropped from its output, so the rest of the bar
// follows upstream changes.

const React = require('react');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamControlBar = require('./ControlBar.js');
const { removeElements } = require('../../../../webos/lib/player');

const ControlBar = React.forwardRef((props, ref) => {
    const element = UpstreamControlBar.render(props, ref);
    const onToggleSpeedMenu = props.onToggleSpeedMenu;
    return typeof onToggleSpeedMenu === 'function' ?
        removeElements(React, element, (node) => node.props.onClick === onToggleSpeedMenu)
        :
        element;
});

ControlBar.displayName = 'ControlBar';
ControlBar.propTypes = UpstreamControlBar.propTypes;

module.exports = ControlBar;
