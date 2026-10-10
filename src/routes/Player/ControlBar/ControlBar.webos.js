// webOS TV 4.x build only (resolved instead of ControlBar.js by webos/webpack/app.js, F5.1).
// The upstream control bar without the playback speed button (the C8 plays without sound at rates
// other than 1x; useVideo.webos.js already turns the speed off). The upstream render runs as is and
// only the button that opens the speed menu is dropped from its output, so the rest of the bar
// follows upstream changes. The bar gets the native rate as `playbackSpeed`: the Player state says
// null (no speed control), but the seek bar divides the remaining time by it.

const React = require('react');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamControlBar = require('./ControlBar.js');
const { NATIVE_PLAYBACK_SPEED, removeElements } = require('../../../../webos/lib/player');

const ControlBar = React.forwardRef((props, ref) => {
    const element = UpstreamControlBar.render({ ...props, playbackSpeed: NATIVE_PLAYBACK_SPEED }, ref);
    const onToggleSpeedMenu = props.onToggleSpeedMenu;
    return typeof onToggleSpeedMenu === 'function' ?
        removeElements(React, element, (node) => node.props.onClick === onToggleSpeedMenu)
        :
        element;
});

ControlBar.displayName = 'ControlBar';
ControlBar.propTypes = UpstreamControlBar.propTypes;

module.exports = ControlBar;
