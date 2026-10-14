// Prefixed to the core `worker` entry by webos/webpack/tlsproxy.js, before the vendored worker.js.
import '../lib/redact/install';
import { install } from './worker';
import { install as installCatalogTrim } from '../lib/catalog-trim';
import { install as installMetaFirst } from '../lib/meta-first';

install(self);
// F7.2: catalogs reach the core without the episode lists it throws away (outside the proxy wrapper).
// F8.7: and catalogs and metas with only the keys the core reads.
installCatalogTrim(self);
// F8.7: the meta of a title reaches the core before its streams (outermost: it sees the trimmed answers).
installMetaFirst(self);
// F8.7: the core's warm-up (webos/core/warm-up.patch), for the page through the Bridge (webos/lib/boot-pulls
// calls it once per launch, when the app is idle). The glue is the module the vendored worker.js requires in
// its init (webpack keeps one instance), required here only when called; 0 while the core is not ready.
self.webosWarmUp = () => {
    // eslint-disable-next-line global-require
    const glue = require('../vendor/stremio-core-web/stremio_core_web.js');
    return typeof glue.webos_warm_up === 'function' ? glue.webos_warm_up() : 0;
};
