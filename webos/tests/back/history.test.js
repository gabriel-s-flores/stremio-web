/**
 * @jest-environment jsdom
 */
// F3.2b: each Back leaves exactly one screen. The route layer (webos/back/useRouteBack.js) runs in a
// real HashRouter of react-router-dom, the screens are opened the way the app opens them (push,
// navigateWithOrigin, the setSearchParams of the search bar) and every Back is a 461 keydown on
// window, taken by the app's dispatcher (webos/back/backDispatcher.js). After each press the test
// checks the route and history.state.idx: no entry is pushed on the way back.

// getBackFallback.ts is TypeScript, which this Jest setup does not compile: same rule in plain JS.
jest.mock('../../../src/router/getBackFallback', () => ({
    __esModule: true,
    default: (location) => {
        const match = /^\/player\/[^/]+\/[^/]*\/[^/]*\/([^/]+)\/([^/]+)/.exec(location.pathname);
        return match ? `/metadetails/${match[1]}/${match[2]}` : '/';
    },
}));

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const { HashRouter, useLocation, useNavigate, useSearchParams } = require('react-router-dom');
const backDispatcher = require('../../back/backDispatcher');
const useRouteBack = require('../../back/useRouteBack');

global.IS_REACT_ACT_ENVIRONMENT = true;

const DISCOVER = '/discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/top';
const DISCOVER_SERIES = '/discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/series/top';
const PLAYER = '/player/eAEB/https%3A%2F%2Ftorrentio/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/tt0133093/tt0133093';

// The app, reduced to what moves the history: the screens are opened through `app`.
const app = {};
const Probe = ({ openExitDialog }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [, setSearchParams] = useSearchParams();
    useRouteBack({ openExitDialog });
    app.location = location;
    app.navigate = navigate;
    app.setSearchParams = setSearchParams;
    // src/router/useNavigateWithOrigin.ts (MetaItem, Discover): the first origin is kept.
    app.navigateWithOrigin = (to) => navigate(to, { state: { from: (location.state && location.state.from) || location } });
    return null;
};

let root;
let container;
let openExitDialog;

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

// jsdom does a history traversal (history.go, navigate(-n)) in two nested setTimeout(0) tasks and then
// fires popstate; on a busy host (the whole suite in parallel) 20 ms is not always enough, and the
// test read the route before the Back had landed. So a move is awaited until the router location
// changes, not for a fixed time (F7.3).
const MOVE_TIMEOUT_MS = 5000;
const untilLocationChanges = async (key) => {
    const deadline = Date.now() + MOVE_TIMEOUT_MS;
    while (app.location.key === key && Date.now() < deadline) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    }
};

const step = async (action) => {
    const key = app.location.key;
    await act(async () => {
        action(app);
    });
    await untilLocationChanges(key);
    await settle();
};

const keydown = (keyCode) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    Object.defineProperty(event, 'which', { value: keyCode });
    return event;
};

// One Back press; returns where the app is after it settles. `moves: false` is for a press that is
// expected to leave the route where it is (the quit dialog): there is no move to wait for.
const back = async ({ moves = true } = {}) => {
    const key = app.location.key;
    await act(async () => {
        window.dispatchEvent(keydown(461));
    });
    if (moves) {
        await untilLocationChanges(key);
    }
    await settle();
    return where();
};

const where = () => ({
    path: app.location.pathname + app.location.search,
    idx: window.history.state.idx,
});

const lastDetail = () => {
    const history = backDispatcher.history;
    return history[history.length - 1].detail;
};

beforeEach(async () => {
    // A fresh session for each test: the router starts over at index 0, on the Board.
    window.history.replaceState(null, '', '/');
    openExitDialog = jest.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(React.createElement(HashRouter, null, React.createElement(Probe, { openExitDialog })));
    });
    expect(where()).toEqual({ path: '/', idx: 0 });
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

describe('each Back leaves one screen (F3.2b)', () => {
    test('Board -> Discover -> MetaDetails -> Player and the way back', async () => {
        await step(({ navigate }) => navigate(DISCOVER));
        await step(({ navigateWithOrigin }) => navigateWithOrigin('/metadetails/movie/tt0133093'));
        await step(({ navigate }) => navigate(PLAYER));
        expect(where().idx).toBe(3);

        expect(await back()).toEqual({ path: '/metadetails/movie/tt0133093', idx: 2 });
        expect(lastDetail()).toBe('navigate:-1');
        // MetaDetails: its origin is the entry before, so the history goes back to it.
        expect(await back()).toEqual({ path: DISCOVER, idx: 1 });
        expect(lastDetail()).toBe('navigate:-1');
        expect(await back()).toEqual({ path: '/', idx: 0 });
        expect(openExitDialog).not.toHaveBeenCalled();
        await back({ moves: false });
        expect(openExitDialog).toHaveBeenCalledTimes(1);
        expect(where()).toEqual({ path: '/', idx: 0 });
    });

    test('Discover with another catalog: MetaDetails goes back to that catalog, then one Back to the Board', async () => {
        await step(({ navigate }) => navigate(DISCOVER));
        await step(({ navigate }) => navigate(DISCOVER_SERIES));
        await step(({ navigateWithOrigin }) => navigateWithOrigin('/metadetails/series/tt0944947'));

        expect(await back()).toEqual({ path: DISCOVER_SERIES, idx: 2 });
        expect(await back()).toEqual({ path: '/', idx: 0 });
        expect(lastDetail()).toBe('navigate:-2');
    });

    test('Board -> Search -> queries -> MetaDetails and the way back', async () => {
        // SearchBar: a click on the bar opens /search, each query is setSearchParams (a push).
        await step(({ navigate }) => navigate('/search'));
        await step(({ setSearchParams }) => setSearchParams({ search: 'matrix' }));
        await step(({ setSearchParams }) => setSearchParams({ search: 'matrix reloaded' }));
        await step(({ navigateWithOrigin }) => navigateWithOrigin('/metadetails/movie/tt0234215'));
        expect(where()).toEqual({ path: '/metadetails/movie/tt0234215', idx: 4 });

        expect(await back()).toEqual({ path: '/search?search=matrix+reloaded', idx: 3 });
        expect(await back()).toEqual({ path: '/', idx: 0 });
        expect(lastDetail()).toBe('navigate:-3');
        expect(openExitDialog).not.toHaveBeenCalled();
    });

    test('MetaDetails -> another title from it -> back to the origin in one press', async () => {
        await step(({ navigate }) => navigate(DISCOVER));
        await step(({ navigateWithOrigin }) => navigateWithOrigin('/metadetails/movie/tt0133093'));
        await step(({ navigateWithOrigin }) => navigateWithOrigin('/metadetails/movie/tt0234215'));

        expect(await back()).toEqual({ path: DISCOVER, idx: 1 });
        expect(await back()).toEqual({ path: '/', idx: 0 });
    });

    test('the diagnostics screen (opened with navigate, F3.6) goes back to where it was opened', async () => {
        await step(({ navigate }) => navigate(DISCOVER));
        await step(({ navigate }) => navigate('/webos-diagnostics'));
        expect(await back()).toEqual({ path: DISCOVER, idx: 1 });
        expect(await back()).toEqual({ path: '/', idx: 0 });
    });

    test('MetaDetails whose origin is not in the history still goes to it, replacing its entry', async () => {
        // A MetaDetails entry the app opened with an origin that was never in this history.
        await step(({ navigate }) => navigate('/metadetails/movie/tt0133093', { state: { from: '/library' } }));
        expect(await back()).toEqual({ path: '/library', idx: 1 });
        expect(lastDetail()).toBe('navigate:/library');
        expect(await back()).toEqual({ path: '/', idx: 0 });
    });

    test('two quick presses still move one screen', async () => {
        await step(({ navigate }) => navigate(DISCOVER));
        await step(({ navigateWithOrigin }) => navigateWithOrigin('/metadetails/movie/tt0133093'));
        const key = app.location.key;
        await act(async () => {
            window.dispatchEvent(keydown(461));
            window.dispatchEvent(keydown(461));
        });
        await untilLocationChanges(key);
        await settle();
        expect(where()).toEqual({ path: DISCOVER, idx: 1 });
        expect(lastDetail()).toBe('pending');
    });
});
