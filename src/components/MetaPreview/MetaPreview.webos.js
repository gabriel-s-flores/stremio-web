// webOS TV 4.x build only (resolved instead of MetaPreview.js by webos/webpack/app.js, F8.6).
// The upstream component as is, except for the details page's preview of the poster that was opened
// (webos/lib/meta-preview): until the real meta arrives, no library and watched toggles. They would act
// on the preview and show "not in the library" and "not watched" whatever the real state is.
// No JSX: see Stream.webos.js.

const React = require('react');
// The explicit extension resolves to the upstream component, not to this file.
const UpstreamMetaPreview = require('./MetaPreview.js');
const { isOptimistic } = require('../../../webos/lib/meta-preview');

const MetaPreview = React.forwardRef((props, ref) => React.createElement(UpstreamMetaPreview, Object.assign({}, props, { ref },
    isOptimistic(props.links) ? { toggleInLibrary: null, toggleWatched: null } : null)));

MetaPreview.displayName = 'MetaPreview';
MetaPreview.Placeholder = UpstreamMetaPreview.Placeholder;
MetaPreview.propTypes = UpstreamMetaPreview.propTypes;

module.exports = MetaPreview;
