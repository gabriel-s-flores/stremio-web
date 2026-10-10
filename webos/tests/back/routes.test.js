// webos/back/routes.js: what Back does on each route when no overlay is open.

const { isMetaDetailsPath, resolveRouteBack } = require('../../back/routes');

const back = (pathname, { state = null, historyIndex = 0, fallbackPath = '/' } = {}) => (
    resolveRouteBack({ pathname, state, historyIndex, fallbackPath })
);

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
});
