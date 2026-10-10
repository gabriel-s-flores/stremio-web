// webOS TV 4.x build only (resolved instead of useLocalSearch.js by webos/webpack/app.js).
//
// The upstream hook loads the local search records (Cinemeta's feed.json, ~570 KB, indexed by the
// core) whenever a search bar mounts: on the Board at boot and again on every route. With the core in
// wasm2js on webOS 4 that takes the core's only thread for ~3 s in the default emulator and ~13 s in
// the C8 profile, before it even requests the Board catalogs. Here the records are loaded once per
// session, on the first non-empty query. The core keeps them across search bars (it has no Unload for
// LocalSearch), so later queries search right away.

const React = require('react');
const { useCore } = require('stremio/core');
const useModelState = require('stremio/common/useModelState');

const LOAD_ACTION = {
    action: 'Load',
    args: {
        model: 'LocalSearch',
    }
};

let loadRequested = false;

const useLocalSearch = () => {
    const core = useCore();

    const [action, setAction] = React.useState(null);
    const lastQuery = React.useRef('');

    const { items } = useModelState({ model: 'local_search', action });

    const dispatchSearch = React.useCallback((query) => {
        core.transport.dispatch({
            action: 'Search',
            args: {
                action: 'Search',
                args: {
                    searchQuery: query,
                    maxResults: 5
                }
            },
        });
    }, []);

    const search = React.useCallback((query) => {
        lastQuery.current = query;
        if (query && !loadRequested) {
            loadRequested = true;
            setAction(LOAD_ACTION);
        }
        dispatchSearch(query);
    }, []);

    // The records arrive after the query that asked for them: search again on the two state changes
    // of the load (Loading, then Ready or an error), so the suggestions show up without another key.
    React.useEffect(() => {
        if (action === null) {
            return;
        }
        let changes = 0;
        const onState = (models) => {
            if (models.indexOf('local_search') === -1) {
                return;
            }
            dispatchSearch(lastQuery.current);
            if (++changes === 2) {
                core.off('state', onState);
            }
        };
        core.on('state', onState);
        return () => core.off('state', onState);
    }, [action]);

    return {
        items,
        search,
    };
};

module.exports = useLocalSearch;
