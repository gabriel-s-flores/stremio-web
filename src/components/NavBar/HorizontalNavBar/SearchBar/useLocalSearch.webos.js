// webOS TV 4.x build only (resolved instead of useLocalSearch.js by webos/webpack/app.js).
//
// No local search suggestions on webOS 4. The upstream hook makes the core fetch and index Cinemeta's
// feed.json (~570 KB) whenever a search bar mounts: on the Board at boot and again on every route.
// With the core in wasm2js that load holds the core's only thread for ~3 s in the default emulator and
// ~13 s in the C8 profile (before the Board catalogs are even requested), and it adds ~270 MB to the
// app process for a moment. In the emulator (1 GB, like the C8) the app was killed when it happened
// after some browsing. Searching still works: the query goes to the search route and the addons.

const ITEMS = [];

const search = () => {
    // Nothing to search locally: suggestions come only from the search history.
};

const useLocalSearch = () => ({
    items: ITEMS,
    search,
});

module.exports = useLocalSearch;
