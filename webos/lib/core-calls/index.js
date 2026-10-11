// Fewer getState calls to the core worker (F7.2).
//
// Every useModelState asks the core for its model on each NewState event, and several components
// watch the same model: at boot, 6+ subscribers of "ctx" ask for it at the same instant, and the
// worker serializes the same state again for each one. On the C8 profile the core (wasm2js) answers
// those one by one, and the board request with the first catalog items waits behind them (F7.2
// boot timeline: 47 getState('ctx') before the Board settles, in bursts of 9 or 10).
//
// coalesceGetState(transport): getState(model) asked while an identical request is still on its way
// to the worker, and no other call (dispatch, init, ...) went out after that request, gets the same
// answer. The worker answers in order, so that answer is one the separate request could have had
// too (the state as of a moment after the call was made). A later NewState event still makes the
// subscribers ask again: the request is done by then (its answer comes before the event), so they
// get a new one. Any other call ends the sharing, so a getState made after a dispatch always sees it.
// The answer object is shared by the callers, which only read it (they map it into React state).

const coalesceGetState = (transport) => {
    const pending = new Map();
    let generation = 0;

    const getState = (model) => {
        const shared = pending.get(model);
        if (shared && shared.generation === generation) return shared.promise;
        const entry = { generation, promise: transport.getState(model) };
        pending.set(model, entry);
        const done = () => {
            if (pending.get(model) === entry) pending.delete(model);
        };
        entry.promise.then(done, done);
        return entry.promise;
    };

    const wrapped = { ...transport, getState };
    Object.keys(transport).forEach((name) => {
        if (name === 'getState' || typeof transport[name] !== 'function') return;
        wrapped[name] = (...args) => {
            generation += 1;
            return transport[name](...args);
        };
    });
    return wrapped;
};

module.exports = { coalesceGetState };
