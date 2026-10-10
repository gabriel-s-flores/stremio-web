// src/components/NavBar/HorizontalNavBar/SearchBar/useLocalSearch.webos.js: no local search on webOS 4
// (the core's feed.json load costs seconds of the core and ~270 MB of the app process).
const fs = require('fs');
const path = require('path');

const SEARCH_BAR = path.resolve(__dirname, '..', '..', 'src', 'components', 'NavBar', 'HorizontalNavBar', 'SearchBar');

describe('useLocalSearch.webos', () => {
    const useLocalSearch = require(path.join(SEARCH_BAR, 'useLocalSearch.webos.js'));

    test('has no suggestions and never talks to the core', () => {
        const { items, search } = useLocalSearch();
        expect(items).toEqual([]);
        expect(search('matrix')).toBeUndefined();
        const source = fs.readFileSync(path.join(SEARCH_BAR, 'useLocalSearch.webos.js'), 'utf8');
        expect(source).not.toMatch(/require\(/);
    });

    test('returns the same references on every render (SearchBar memoizes on search)', () => {
        const first = useLocalSearch();
        const second = useLocalSearch();
        expect(second.search).toBe(first.search);
        expect(second.items).toBe(first.items);
    });

    // SearchBar.js uses the hook as { items, search }; if upstream changes that, the override must follow.
    test('the upstream hook still has the same shape and loads on mount', () => {
        const upstream = fs.readFileSync(path.join(SEARCH_BAR, 'useLocalSearch.js'), 'utf8');
        expect(upstream).toMatch(/action: 'Load',\s*args: \{\s*model: 'LocalSearch',?\s*\}/);
        expect(upstream).toMatch(/return \{\s*items,\s*search,\s*\};/);
        const searchBar = fs.readFileSync(path.join(SEARCH_BAR, 'SearchBar.js'), 'utf8');
        expect(searchBar).toContain('const { search } = localSearch;');
        expect(searchBar).toContain('localSearch?.items?.length');
    });
});
