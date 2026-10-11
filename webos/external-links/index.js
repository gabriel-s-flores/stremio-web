// External links on webOS TV 4.x (owner: F3.4). Behaviour and limits: webos/external-links/README.md.
//
//   <ExternalLinks />   inside the App (src/App/index.webos.js): the QR code dialog
//
// Requiring this module installs the interception (window.open and the clicks on links) at once, as
// webos/back does for the Back key, so a link opened before React mounts is not lost.

const React = require('react');
const { classify, createStore, install } = require('./links');
const ExternalLinkDialog = require('./ExternalLinkDialog');

const store = createStore();

if (typeof window !== 'undefined') {
    install(window, store);
}

const ExternalLinks = () => {
    const [state, setState] = React.useState(store.getState());
    React.useEffect(() => {
        setState(store.getState());
        return store.subscribe(setState);
    }, []);
    return React.createElement(ExternalLinkDialog, { url: state.url, onClose: store.close });
};

module.exports = {
    ExternalLinks,
    externalLinks: store,
    classify,
};
