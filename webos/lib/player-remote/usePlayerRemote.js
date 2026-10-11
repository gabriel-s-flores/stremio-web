// Hook of the Player remote (F5.7), used by src/routes/Player/ControlBar/ControlBar.webos.js: installs
// webos/lib/player-remote/controller.js while the control bar is mounted and registers its Back
// handler in webos/back. `props` are the control bar props the Player passes; `barRef` is the bar.
// window.__webosPlayerRemote.status tells the last key it handled (emulator tests).

const React = require('react');
const { backDispatcher, useBackHandler } = require('../../back');
const { OVERLAYS } = require('../../back/overlays');
const { createPlayerRemote } = require('./controller');

// Overlays that own the arrows while open: every one in the Back bridge's catalogue except the next
// video popup, which comes up by itself and does not hold the focus (F4.3).
const isOverlayOpen = () => OVERLAYS.some((overlay) => overlay.name !== 'next-video-popup' && !!overlay.find(document));

// The element focused last in the page. When the Player opens, the route below goes display: none
// and loses its focus (the stream played): the remote gives the focus back to it on the way out.
let lastFocused = null;
document.addEventListener('focusin', (event) => {
    lastFocused = event.target;
}, true);

// Stop leaves the Player like Back does, without the "hide the bar first" step of this controller.
const stop = () => backDispatcher.dispatch({ source: 'stop' });

const usePlayerRemote = (props, barRef) => {
    const propsRef = React.useRef(props);
    propsRef.current = props;
    const remoteRef = React.useRef(null);

    React.useEffect(() => {
        const remote = createPlayerRemote({
            window,
            getBar: () => barRef.current,
            getProps: () => ({
                paused: propsRef.current.paused,
                nextVideo: propsRef.current.nextVideo,
                onPlayRequested: propsRef.current.onPlayRequested,
                onPauseRequested: propsRef.current.onPauseRequested,
                onNextVideoRequested: propsRef.current.onNextVideoRequested,
                // The Player gives the bar its mouse leave handler as onTouchEnd: it hides the bar.
                onHideRequested: propsRef.current.onTouchEnd,
            }),
            isOverlayOpen,
            stop,
            getLastFocused: () => lastFocused,
        });
        remoteRef.current = remote;
        remote.prepare();
        window.__webosPlayerRemote = remote;
        const uninstall = remote.install();
        return () => {
            uninstall();
            // What the last Player did on the way out (focus given back: diagnostics, tests).
            window.__webosPlayerRemoteLast = remote.status;
            remoteRef.current = null;
            if (window.__webosPlayerRemote === remote) delete window.__webosPlayerRemote;
        };
    }, [barRef]);

    useBackHandler((context) => remoteRef.current !== null && remoteRef.current.onBack(context), { name: 'player-controls' });
};

module.exports = usePlayerRemote;
