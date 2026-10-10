// webOS TV 4.x build only (resolved instead of createTransport.ts by webos/webpack/app.js, F3.6).
// Same as createTransport.ts plus two boot marks for the diagnostics screen (core init start and
// core ready, just timestamps) and getCoreLoaderStatus: the status of the core loader that runs in
// the worker (webos/core/loader.js), read on demand. webos/tests/no-server/no-server.test.js
// fails when the two drift apart.

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
