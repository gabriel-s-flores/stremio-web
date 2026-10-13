// webOS TV 4.x build only (resolved instead of MetaPreview.js by webos/webpack/app.js, F8.6).
// The upstream component as is, except for the details page's preview of the poster that was opened
// (webos/lib/meta-preview): until the real meta arrives, no library and watched toggles. They would act
// on the preview and show "not in the library" and "not watched" whatever the real state is.
// F8.7: the logo only once it is loaded (webos/lib/image-ready), and the name meanwhile (the upstream shows
// the name when there is no logo): on the TV the title stayed blank while the logo came through the tlsproxy.
// No JSX: see Stream.webos.js.

const React = require('react');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamMetaPreview = require('./MetaPreview.js');
const { isOptimistic } = require('../../../webos/lib/meta-preview');
const { useImageReady } = require('../../../webos/lib/image-ready');
const tlsProxy = require('../../../webos/tlsproxy/page').default;

const MetaPreview = React.forwardRef((props, ref) => {
    // The same URL the Image will ask for (Image.webos.tsx), re-read when the proxy changes.
    React.useSyncExternalStore(tlsProxy.subscribe, tlsProxy.getVersion, tlsProxy.getVersion);
    const logoReady = useImageReady(props.logo, tlsProxy.proxify);
    return React.createElement(UpstreamMetaPreview, Object.assign({}, props, { ref },
        logoReady ? null : { logo: null },
        isOptimistic(props.links) ? { toggleInLibrary: null, toggleWatched: null } : null));
});

MetaPreview.displayName = 'MetaPreview';
MetaPreview.Placeholder = UpstreamMetaPreview.Placeholder;
MetaPreview.propTypes = UpstreamMetaPreview.propTypes;

module.exports = MetaPreview;
