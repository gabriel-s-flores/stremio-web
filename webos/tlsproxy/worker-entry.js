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
