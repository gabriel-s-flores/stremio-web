// Stands in for src/core/createTransport.ts in the layout page: that module starts the core worker
// when it is imported, and the page has no core.
const noop = () => Promise.resolve();

module.exports = {
    __esModule: true,
    default: () => ({ init: noop, getState: noop, dispatch: noop, analytics: noop, encodeStream: noop, decodeStream: noop }),
};
