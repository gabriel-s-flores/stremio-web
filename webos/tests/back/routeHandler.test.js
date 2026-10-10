// webos/back/routes.js createRouteBackHandler: the route layer that BackNavigation registers.
// The guard is what keeps two quick presses on the same location from navigating twice.

const { PENDING_MS, createRouteBackHandler } = require('../../back/routes');

const setup = ({ pathname = '/discover', historyIndex = 2, pageBackButton = null, state = null } = {}) => {
    let time = 1000;
    const location = { pathname, state, key: 'k1' };
    const navigate = jest.fn();
    const openExitDialog = jest.fn();
    const handler = createRouteBackHandler({
        getLocation: () => location,
        getHistoryIndex: () => historyIndex,
        getFallbackPath: () => '/',
        findPageBackButton: () => pageBackButton,
        navigate,
        openExitDialog,
        now: () => time,
    });
    const press = () => {
        const context = {};
        return { consumed: handler(context), detail: context.detail };
    };
    return {
        press,
        navigate,
        openExitDialog,
        location,
        advance: (ms) => {
            time += ms;
        },
    };
};

describe('createRouteBackHandler', () => {
    test('a second press before the location changes is consumed without navigating again', () => {
        const { press, navigate } = setup();
        expect(press()).toEqual({ consumed: true, detail: 'navigate:-1' });
        expect(press()).toEqual({ consumed: true, detail: 'pending' });
        expect(press()).toEqual({ consumed: true, detail: 'pending' });
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith(-1);
    });

    test('once the location changes, the next press navigates again', () => {
        const { press, navigate, location, advance } = setup();
        press();
        advance(50);
        location.key = 'k2';
        expect(press()).toEqual({ consumed: true, detail: 'navigate:-1' });
        expect(navigate).toHaveBeenCalledTimes(2);
    });

    test('the guard expires, so a navigation that never happened does not leave Back stuck', () => {
        const { press, navigate, advance } = setup();
        press();
        advance(PENDING_MS - 1);
        expect(press().detail).toBe('pending');
        advance(1);
        expect(press().detail).toBe('navigate:-1');
        expect(navigate).toHaveBeenCalledTimes(2);
    });

    test('the streams list back button is clicked, and guarded the same way', () => {
        const pageBackButton = { click: jest.fn() };
        const { press, navigate } = setup({ pathname: '/metadetails/series/tt1/tt1%3A1%3A1', pageBackButton });
        expect(press()).toEqual({ consumed: true, detail: 'page' });
        expect(press()).toEqual({ consumed: true, detail: 'pending' });
        expect(pageBackButton.click).toHaveBeenCalledTimes(1);
        expect(navigate).not.toHaveBeenCalled();
    });

    test('paths and replace come from resolveRouteBack', () => {
        const fromOrigin = setup({ pathname: '/metadetails/movie/tt1', state: { from: '/library' } });
        fromOrigin.press();
        expect(fromOrigin.navigate).toHaveBeenCalledWith('/library', { replace: true });
        const noHistory = setup({ pathname: '/settings', historyIndex: 0 });
        noHistory.press();
        expect(noHistory.navigate).toHaveBeenCalledWith('/', { replace: true });
    });

    test('on the Board it opens the quit dialog every time and never navigates', () => {
        const { press, navigate, openExitDialog } = setup({ pathname: '/', historyIndex: 3 });
        expect(press()).toEqual({ consumed: true, detail: 'exit-dialog' });
        expect(press()).toEqual({ consumed: true, detail: 'exit-dialog' });
        expect(openExitDialog).toHaveBeenCalledTimes(2);
        expect(navigate).not.toHaveBeenCalled();
    });
});
