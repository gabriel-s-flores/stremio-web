// webOS TV 4.x build only (resolved instead of ControlBar.js by webos/webpack/app.js, F5.1).
// The upstream control bar without the playback speed button (the C8 plays without sound at rates
// other than 1x; useVideo.webos.js already turns the speed off). The upstream render runs as is and
// only the button that opens the speed menu is dropped from its output, so the rest of the bar
// follows upstream changes. The bar gets the native rate as `playbackSpeed`: the Player state says
// null (no speed control), but the seek bar divides the remaining time by it.
// The remote (F5.7, webos/lib/player-remote): the buttons the upstream bar keeps out of the tab
// order (tabIndex -1) become focusable, and the bar installs the Player's remote keys and Back.

const React = require('react');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamControlBar = require('./ControlBar.js');
const { NATIVE_PLAYBACK_SPEED, removeElements } = require('../../../../webos/lib/player');
const { makeFocusable } = require('../../../../webos/lib/player-remote');
const usePlayerRemote = require('../../../../webos/lib/player-remote/usePlayerRemote');

const ControlBar = React.forwardRef((props, ref) => {
    const barRef = React.useRef(null);
    const setRef = React.useCallback((element) => {
        barRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
    }, [ref]);
    usePlayerRemote(props, barRef);
    const element = UpstreamControlBar.render({ ...props, playbackSpeed: NATIVE_PLAYBACK_SPEED }, setRef);
    const onToggleSpeedMenu = props.onToggleSpeedMenu;
    const withoutSpeed = typeof onToggleSpeedMenu === 'function' ?
        removeElements(React, element, (node) => node.props.onClick === onToggleSpeedMenu)
        :
        element;
    return makeFocusable(React, withoutSpeed);
});

ControlBar.displayName = 'ControlBar';
ControlBar.propTypes = UpstreamControlBar.propTypes;

module.exports = ControlBar;
