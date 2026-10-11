// webos/back/routes.js: what Back does on each route when no overlay is open.

const { createHistoryStack, getScreen, isMetaDetailsPath, resolveRouteBack } = require('../../back/routes');

const back = (pathname, { state = null, historyIndex = 0, fallbackPath = '/', getEntry } = {}) => (
    resolveRouteBack({ pathname, state, historyIndex, fallbackPath, getEntry })
);

// The app's history as the router went through it: paths in index order, null for an entry the app
// did not see. Returns what resolveRouteBack needs to go back from the last one.
const historyOf = (...paths) => {
    const getEntry = (index) => {
        const path = paths[index];
        if (typeof path !== 'string') return null;
        const [pathname, search = ''] = path.split('?');
        return { pathname, search: search ? `?${search}` : '' };
    };
    return { historyIndex: paths.length - 1, getEntry };
};

const DISCOVER = '/discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/top';
const DISCOVER_SERIES = '/discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/series/top';

describe('resolveRouteBack', () => {
    test('the Board and /intro ask to quit, whatever the history holds', () => {
        expect(back('/')).toEqual({ type: 'exit' });
        expect(back('/', { historyIndex: 3 })).toEqual({ type: 'exit' });
        expect(back('/intro', { historyIndex: 1 })).toEqual({ type: 'exit' });
    });

    test('MetaDetails returns to the stored origin, like its on-screen back button', () => {
        const from = { pathname: '/discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/top', search: '?genre=Drama' };
        expect(back('/metadetails/movie/tt0133093', { state: { from }, historyIndex: 4 })).toEqual({
            type: 'navigate',
            to: '/discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/top?genre=Drama',
            replace: true,
        });
        expect(back('/detail/series/tt0944947/tt0944947%3A1%3A1', { state: { from: '/library' } })).toEqual({
            type: 'navigate',
            to: '/library',
            replace: true,
        });
        expect(back('/metadetails/movie/tt0133093', { state: { from: '/' } })).toEqual({ type: 'navigate', to: '/', replace: true });
    });

    test('MetaDetails without an origin and the other routes go one entry back', () => {
        expect(back('/metadetails/movie/tt0133093', { historyIndex: 2 })).toEqual({ type: 'navigate', to: -1, replace: false });
        expect(back('/metadetails/movie/tt0133093', { state: { from: '' }, historyIndex: 2 }).to).toBe(-1);
        expect(back('/discover', { historyIndex: 1 })).toEqual({ type: 'navigate', to: -1, replace: false });
        expect(back('/settings', { historyIndex: 5 }).to).toBe(-1);
        expect(back('/player/abc/def', { historyIndex: 3 }).to).toBe(-1);
    });

    test('with nothing to go back to, the getBackFallback() path replaces the current entry', () => {
        expect(back('/discover', { historyIndex: 0 })).toEqual({ type: 'navigate', to: '/', replace: true });
        expect(back('/player/abc', { historyIndex: undefined, fallbackPath: '/metadetails/movie/tt0133093' })).toEqual({
            type: 'navigate',
            to: '/metadetails/movie/tt0133093',
            replace: true,
        });
        expect(back('/library', { historyIndex: 0, fallbackPath: undefined })).toEqual({ type: 'navigate', to: '/', replace: true });
    });

    test('only /metadetails and the legacy /detail are MetaDetails', () => {
        expect(isMetaDetailsPath('/metadetails')).toBe(true);
        expect(isMetaDetailsPath('/metadetails/movie/tt1')).toBe(true);
        expect(isMetaDetailsPath('/detail/movie/tt1')).toBe(true);
        expect(isMetaDetailsPath('/metadetailsx')).toBe(false);
        expect(isMetaDetailsPath('/details')).toBe(false);
        expect(back('/metadetailsx', { state: { from: '/library' }, historyIndex: 1 }).to).toBe(-1);
    });

    test('without the app history, MetaDetails still replaces its entry with the origin (F3.2)', () => {
        expect(back('/metadetails/movie/tt1', { state: { from: '/library' }, historyIndex: 3, getEntry: () => null })).toEqual({
            type: 'navigate',
            to: '/library',
            replace: true,
        });
    });
});

describe('resolveRouteBack with the app history (F3.2b: each Back leaves one screen)', () => {
    test('MetaDetails goes back through the history when the entry before is its origin', () => {
        const from = { pathname: DISCOVER, search: '?genre=Drama', key: 'k1' };
        expect(back('/metadetails/movie/tt1', { state: { from }, ...historyOf('/', `${DISCOVER}?genre=Drama`, '/metadetails/movie/tt1') }))
            .toEqual({ type: 'navigate', to: -1, replace: false });
        expect(back('/metadetails/movie/tt1', { state: { from: '/' }, ...historyOf('/', '/metadetails/movie/tt1') }).to).toBe(-1);
    });

    test('MetaDetails opened from another title of the same origin goes back to that origin', () => {
        // useNavigateWithOrigin keeps the first origin: the second title came from the first one.
        expect(back('/metadetails/movie/tt2', { state: { from: { pathname: DISCOVER } }, ...historyOf('/', DISCOVER, '/metadetails/movie/tt1', '/metadetails/movie/tt2') }))
            .toEqual({ type: 'navigate', to: -2, replace: false });
    });

    test('MetaDetails whose origin is not in the known history replaces its entry, as before', () => {
        // Search with another query in the entry before: the query of the origin is what counts.
        expect(back('/metadetails/movie/tt1', { state: { from: { pathname: '/search', search: '?search=matrix' } }, ...historyOf('/', '/search?search=other', '/metadetails/movie/tt1') }))
            .toEqual({ type: 'navigate', to: '/search?search=matrix', replace: true });
        // An entry the app did not see stops the search.
        expect(back('/metadetails/movie/tt1', { state: { from: '/' }, ...historyOf('/', null, '/metadetails/movie/tt1') }))
            .toEqual({ type: 'navigate', to: '/', replace: true });
    });

    test('Search queries count as one screen: Back leaves the Search', () => {
        expect(back('/search', historyOf('/', '/search', '/search?search=matrix', '/search?search=matrix+reloaded')))
            .toEqual({ type: 'navigate', to: -3, replace: false });
        expect(back('/search', historyOf('/', DISCOVER, '/search', '/search?search=matrix')).to).toBe(-2);
        expect(back('/search', historyOf('/', '/search')).to).toBe(-1);
    });

    test('Discover catalogs and filters, Library types and Calendar months count as one screen', () => {
        expect(back('/discover', historyOf('/', DISCOVER, DISCOVER_SERIES, `${DISCOVER_SERIES}?genre=Drama`)).to).toBe(-3);
        expect(back('/library/movie', historyOf('/', '/library', '/library/movie')).to).toBe(-2);
        expect(back('/calendar/2026/11', historyOf('/', '/calendar', '/calendar/2026/11')).to).toBe(-2);
        // Another screen of the nav bar in between is a screen of its own.
        expect(back('/discover', historyOf('/', DISCOVER, '/library', DISCOVER_SERIES)).to).toBe(-1);
    });

    test('two titles are two screens; the episode streams of a title are the same one', () => {
        expect(back('/metadetails/movie/tt2', historyOf('/', '/metadetails/movie/tt1', '/metadetails/movie/tt2')).to).toBe(-1);
        expect(back('/metadetails/series/tt3', historyOf('/', DISCOVER, '/metadetails/series/tt3', '/metadetails/series/tt3/tt3%3A1%3A2')).to).toBe(-2);
        expect(back('/detail/series/tt3', historyOf('/', '/metadetails/series/tt3', '/detail/series/tt3')).to).toBe(-2);
    });

    test('the Player goes back to MetaDetails, the diagnostics screen to where it was opened', () => {
        expect(back('/player/abc/def', historyOf('/', DISCOVER, '/metadetails/movie/tt1', '/player/abc/def')).to).toBe(-1);
        expect(back('/webos-diagnostics', historyOf('/', '/webos-diagnostics')).to).toBe(-1);
        expect(back('/webos-diagnostics', historyOf('/', '/metadetails/movie/tt1', '/player/abc', '/webos-diagnostics')).to).toBe(-1);
    });

    test('an entry the app did not see is one entry back, as before', () => {
        expect(back('/search', historyOf('/', null, '/search')).to).toBe(-1);
        expect(back('/search', historyOf('/', null, '/search', '/search?search=matrix')).to).toBe(-2);
    });

    test('when the app was opened on the screen, the fallback path replaces the entry', () => {
        expect(back('/search', historyOf('/search', '/search?search=matrix'))).toEqual({ type: 'navigate', to: '/', replace: true });
        expect(back('/discover', { historyIndex: 0, getEntry: historyOf(DISCOVER).getEntry })).toEqual({ type: 'navigate', to: '/', replace: true });
    });

    test('the Board still asks to quit', () => {
        expect(back('/', historyOf('/', '/search', '/'))).toEqual({ type: 'exit' });
    });
});

describe('getScreen', () => {
    test('the first segment, or the title for MetaDetails', () => {
        expect(getScreen('/search')).toBe('search');
        expect(getScreen(DISCOVER)).toBe('discover');
        expect(getScreen('/discover')).toBe('discover');
        expect(getScreen('/player/a/b/c/movie/tt1')).toBe('player');
        expect(getScreen('/')).toBe('');
        expect(getScreen('/metadetails/series/tt3/tt3%3A1%3A2')).toBe('metadetails/series/tt3');
        expect(getScreen('/detail/series/tt3')).toBe('metadetails/series/tt3');
        expect(getScreen('/metadetails')).toBe('metadetails');
    });
});

describe('createHistoryStack', () => {
    test('records each index; a PUSH drops the entries after it', () => {
        const stack = createHistoryStack();
        stack.record(0, { pathname: '/', search: '' }, 'POP');
        stack.record(1, { pathname: '/search', search: '' }, 'PUSH');
        stack.record(2, { pathname: '/search', search: '?search=a' }, 'PUSH');
        stack.record(1, { pathname: '/search', search: '' }, 'POP');
        expect(stack.get(2)).toEqual({ pathname: '/search', search: '?search=a' });
        stack.record(2, { pathname: '/metadetails/movie/tt1' }, 'REPLACE');
        expect(stack.get(2)).toEqual({ pathname: '/metadetails/movie/tt1', search: '' });
        stack.record(3, { pathname: '/player/x', search: '' }, 'PUSH');
        stack.record(1, { pathname: '/library', search: '' }, 'PUSH');
        expect(stack.get(0)).toEqual({ pathname: '/', search: '' });
        expect(stack.get(1)).toEqual({ pathname: '/library', search: '' });
        expect(stack.get(2)).toBeNull();
        expect(stack.get(3)).toBeNull();
    });

    test('an index that is not a number is not recorded', () => {
        const stack = createHistoryStack();
        stack.record(undefined, { pathname: '/', search: '' }, 'POP');
        stack.record(null, { pathname: '/', search: '' }, 'POP');
        stack.record(-1, { pathname: '/', search: '' }, 'POP');
        expect(stack.get(0)).toBeNull();
        expect(stack.get(-1)).toBeNull();
    });
});
