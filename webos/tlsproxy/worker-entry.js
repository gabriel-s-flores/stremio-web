// Prefixed to the core `worker` entry by webos/webpack/tlsproxy.js, before the vendored worker.js.
import '../lib/redact/install';
import { install } from './worker';
import { install as installCatalogTrim } from '../lib/catalog-trim';

install(self);
// F7.2: catalogs reach the core without the episode lists it throws away (outside the proxy wrapper).
installCatalogTrim(self);
