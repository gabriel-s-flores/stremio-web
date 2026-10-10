// src/components/NavBar/HorizontalNavBar/SearchBar/useLocalSearch.webos.js: the local search records
// are loaded on the first non-empty query instead of when a search bar mounts. The hook runs on a
// minimal stand-in for React's hooks (one component, effects run after each render).
const fs = require('fs');
const path = require('path');

const SEARCH_BAR = path.resolve(__dirname, '..', '..', 'src', 'components', 'NavBar', 'HorizontalNavBar', 'SearchBar');

const mockHooks = { states: [], refs: [], effects: [], index: 0 };
jest.mock('react', () => ({
    useState: (initial) => {
        const i = mockHooks.index++;
        if (!(i in mockHooks.states)) mockHooks.states[i] = initial;
        return [mockHooks.states[i], (value) => { mockHooks.states[i] = value; mockHooks.dirty = true; }];
    },
    useRef: (initial) => {
        const i = mockHooks.index++;
        if (!(i in mockHooks.refs)) mockHooks.refs[i] = { current: initial };
        return mockHooks.refs[i];
    },
    useCallback: (fn, deps) => {
        const i = mockHooks.index++;
        const previous = mockHooks.refs[i];
        if (!previous || deps.some((dep, k) => dep !== previous.deps[k])) mockHooks.refs[i] = { current: fn, deps };
        return mockHooks.refs[i].current;
    },
    useEffect: (fn, deps) => {
        const i = mockHooks.index++;
        const previous = mockHooks.effects[i];
        if (!previous || deps.some((dep, k) => dep !== previous.deps[k])) {
            if (previous && previous.cleanup) previous.cleanup();
            mockHooks.effects[i] = { deps, pending: fn };
        }
    },
}));

const mockCore = { dispatched: [], listeners: new Set() };
mockCore.transport = { dispatch: (action) => mockCore.dispatched.push(action) };
mockCore.on = (event, fn) => mockCore.listeners.add(fn);
mockCore.off = (event, fn) => mockCore.listeners.delete(fn);
mockCore.emit = (models) => [...mockCore.listeners].forEach((fn) => fn(models));
jest.mock('stremio/core', () => ({ useCore: () => mockCore }), { virtual: true });

const mockModelState = [];
jest.mock('stremio/common/useModelState', () => ({ action, model }) => {
    mockModelState.push({ model, action });
    return { items: [] };
}, { virtual: true });

const render = (hook) => {
    let result;
    do {
        mockHooks.dirty = false;
        mockHooks.index = 0;
        result = hook();
        mockHooks.effects.forEach((effect) => {
            if (effect && effect.pending) {
                effect.cleanup = effect.pending();
                effect.pending = null;
            }
        });
    } while (mockHooks.dirty);
    return result;
};

const searches = () => mockCore.dispatched.filter((a) => a.action === 'Search').map((a) => a.args.args.searchQuery);

describe('useLocalSearch.webos', () => {
    let useLocalSearch;

    beforeEach(() => {
        jest.isolateModules(() => {
            useLocalSearch = require(path.join(SEARCH_BAR, 'useLocalSearch.webos.js'));
        });
        Object.assign(mockHooks, { states: [], refs: [], effects: [], index: 0 });
        mockCore.dispatched.length = 0;
        mockCore.listeners.clear();
        mockModelState.length = 0;
    });

    test('does not load the records when the search bar mounts', () => {
        const { search } = render(useLocalSearch);
        search('');
        render(useLocalSearch);
        expect(mockModelState.every(({ model, action }) => model === 'local_search' && action === null)).toBe(true);
        expect(searches()).toEqual(['']);
    });

    test('loads the records on the first non-empty query, once', () => {
        const { search } = render(useLocalSearch);
        search('m');
        render(useLocalSearch);
        expect(mockModelState[mockModelState.length - 1].action).toEqual({ action: 'Load', args: { model: 'LocalSearch' } });
        search('ma');
        render(useLocalSearch);
        expect(searches()).toEqual(['m', 'ma']);
        const loads = new Set(mockModelState.map(({ action }) => action).filter(Boolean));
        expect(loads.size).toBe(1);
    });

    test('searches the last query again on the two state changes of the load', () => {
        const { search } = render(useLocalSearch);
        search('mat');
        render(useLocalSearch);
        search('matr');
        mockCore.emit(['ctx']);
        mockCore.emit(['local_search']);
        mockCore.emit(['board', 'local_search']);
        mockCore.emit(['local_search']);
        expect(searches()).toEqual(['mat', 'matr', 'matr', 'matr']);
        expect(mockCore.listeners.size).toBe(0);
    });

    test('a search bar mounted after the load does not load again', () => {
        render(useLocalSearch).search('x');
        render(useLocalSearch);
        Object.assign(mockHooks, { states: [], refs: [], effects: [], index: 0 });
        mockModelState.length = 0;
        render(useLocalSearch).search('y');
        render(useLocalSearch);
        expect(mockModelState.every(({ action }) => action === null)).toBe(true);
    });

    test('the upstream hook still loads on mount and searches the same way', () => {
        const upstream = fs.readFileSync(path.join(SEARCH_BAR, 'useLocalSearch.js'), 'utf8');
        expect(upstream).toMatch(/action: 'Load',\s*args: \{\s*model: 'LocalSearch',?\s*\}/);
        expect(upstream).toContain("useModelState({ model: 'local_search', action })");
        expect(upstream).toMatch(/searchQuery: query,\s*maxResults: 5/);
        expect(upstream).toMatch(/return \{\s*items,\s*search,\s*\};/);
    });
});
