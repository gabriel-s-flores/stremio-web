// React hook of the Back dispatcher (owner: F3.2). API: webos/back/README.md.
//
//   useBackHandler(() => { closeMyModal(); return true; }, { enabled: open, name: 'my-modal' });
//
// While enabled, the handler runs on each Back press before the upstream overlay bridge and the
// route layer. Return true to consume the press; anything else passes it on to the next handler.
// The latest handler is always the one called, so it does not need to be memoized.

const { useEffect, useRef } = require('react');
const { PRIORITY } = require('./dispatcher');
const backDispatcher = require('./backDispatcher');

const useBackHandler = (handler, { enabled = true, priority = PRIORITY.HANDLER, name = 'handler' } = {}) => {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        return backDispatcher.register((context) => handlerRef.current(context), { priority, name });
    }, [enabled, priority, name]);
};

module.exports = useBackHandler;
