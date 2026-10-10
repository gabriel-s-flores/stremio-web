// webOS TV 4.x build only (F3.6): the transport that src/core/createTransport.webos.js (the localStorage
// mirror, F3.5) wraps instead of createTransport.ts. Same as createTransport.ts plus two boot marks for the
// diagnostics screen (core init start and core ready, just timestamps) and getCoreLoaderStatus: the status
// of the core loader that runs in the worker (webos/core/loader.js), read on demand. A separate file name,
// not createTransport.webos.ts, because the .webos.ts extension would win over the .webos.js of F3.5.
// webos/tests/no-server/no-server.test.js fails when it drifts from the upstream file.

import Bridge from '@stremio/stremio-core-web/bridge';
import { mark } from '../../webos/lib/diagnostics/registry';

const worker = new Worker(`${process.env.COMMIT_HASH}/scripts/worker.js`);
const bridge = new Bridge(window, worker);

const createTransport = (): CoreTransport & { getCoreLoaderStatus: () => Promise<object> } => {
    const init = (args: object): Promise<void> => {
        mark('coreInitStart');
        return bridge.call(['init'], [args]).then(() => {
            mark('coreReady');
        });
    };

    const getState = (model: string): Promise<object> => {
        return bridge.call(['getState'], [model]);
    };

    const dispatch = (action: DispatchAction, model?: string): Promise<void> => {
        return bridge.call(['dispatch'], [action, model, location.hash]);
    };

    const encodeStream = (stream: Stream): Promise<string> => {
        return bridge.call(['encodeStream'], [stream]);
    };

    const decodeStream = (stream: string): Promise<Stream> => {
        return bridge.call(['decodeStream'], [stream]);
    };

    const analytics = (event: object): Promise<void> => {
        return bridge.call(['analytics'], [event, location.hash]);
    };

    const getCoreLoaderStatus = (): Promise<object> => {
        return bridge.call(['getCoreLoaderStatus'], []);
    };

    return {
        getCoreLoaderStatus,
        init,
        getState,
        dispatch,
        encodeStream,
        decodeStream,
        analytics,
    };
};

export default createTransport;
