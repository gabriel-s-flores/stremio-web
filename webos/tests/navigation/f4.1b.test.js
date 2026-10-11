/**
 * @jest-environment jsdom
 */
// webos/lib/navigation/f4.1b.js (F4.1b): initial focus and restoration, lost focus, lists that
// scroll with the focus, the way back from the side navigation bar, and the upstream classes and
// tab indexes it relies on. jsdom has no layout: every element gets the rect of its data-rect
// attribute ("left,top,width,height", none = not rendered), and spatialNavigationSearch (from the
// polyfill in the app) is a nearest-in-direction stand-in.

const fs = require('fs');
const path = require('path');
const { createNavigation, hasLocalClass, queryLocal, screenForPath, SCREENS } = require('../../lib/navigation/f4.1b');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const rectOf = (element) => {
    const value = element.getAttribute && element.getAttribute('data-rect');
    if (!value) return null;
    const [left, top, width, height] = value.split(',').map(Number);
    // Lists move their children by scrollTop.
    let offset = 0;
    for (let node = element.parentNode; node && node.nodeType === 1; node = node.parentNode) offset += node.scrollTop || 0;
    return { left, top: top - offset, width, height, right: left + width, bottom: top - offset + height };
};

const ZERO = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };

beforeAll(() => {
    // The TV page: 1920x1080 screen pixels.
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
    Element.prototype.getBoundingClientRect = function() {
        return rectOf(this) || ZERO;
    };
    Element.prototype.getClientRects = function() {
        // display: none routes and their content.
        for (let node = this; node && node.nodeType === 1; node = node.parentNode) {
            if (node.hidden) return [];
        }
        return rectOf(this) ? [rectOf(this)] : [];
    };
    Element.prototype.spatialNavigationSearch = function(dir, { candidates }) {
        const from = this.getBoundingClientRect();
        const inDirection = candidates.filter((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return { down: rect.top >= from.bottom, up: rect.bottom <= from.top, right: rect.left >= from.right, left: rect.right <= from.left }[dir];
        });
        const distance = (candidate) => {
            const rect = candidate.getBoundingClientRect();
            return Math.abs(rect.left - from.left) + Math.abs(rect.top - from.top);
        };
        return inDirection.sort((a, b) => distance(a) - distance(b))[0] || null;
    };
});

// A route as the app renders it: the side bar on the left, the screen's content on the right.
const NAV_BAR = `
    <nav class="vertical-nav-bar-container-Ab1c2" data-rect="0,0,100,1080">
        <a class="nav-tab-button-Ab1c2" tabindex="0" href="#/" data-rect="10,100,80,80">Board</a>
        <a class="nav-tab-button-Ab1c2" tabindex="0" href="#/library" data-rect="10,200,80,80">Library</a>
    </nav>`;

const libraryRoute = ({ items = 12, hidden = false } = {}) => `
    <div class="route-container"${hidden ? ' hidden' : ''} data-rect="0,0,1920,1080">
        <div class="route-content" data-rect="0,0,1920,1080">
            ${NAV_BAR}
            <div class="library-content-Zz9_y" data-rect="100,0,1820,1080">
                <div class="selectable-inputs-container-Qq1-2" data-rect="100,100,1820,80">
                    <div class="button-teWrC" tabindex="0" data-rect="120,100,300,80">All</div>
                </div>
                ${items ? `<div class="meta-items-container-Mm3x4" data-rect="100,200,1800,800">
                    ${Array.from({ length: items }, (_, index) => `<a class="meta-item-link-veMqr" href="#/detail/${index}" data-rect="${120 + (index % 3) * 300},${200 + Math.floor(index / 3) * 400},250,380">item ${index}</a>`).join('')}
                </div>` : ''}
            </div>
        </div>
    </div>`;

const boardRoute = () => `
    <div class="route-container" data-rect="0,0,1920,1080">
        <div class="route-content" data-rect="0,0,1920,1080">
            ${NAV_BAR}
            <a class="meta-item-link-veMqr" href="#/detail/b" data-rect="300,200,250,380">board item</a>
        </div>
    </div>`;

const render = (...routes) => {
    document.body.innerHTML = `<div class="routes-container">${routes.join('')}</div>`;
};

const key = (keyCode) => {
    const event = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true });
    (document.activeElement || document.body).dispatchEvent(event);
    return event;
};
const DOWN = 40;
const UP = 38;
const RIGHT = 39;
const LEFT = 37;

const text = () => document.activeElement && document.activeElement.textContent.trim();

let navigation;
let uninstall;
const start = (hash) => {
    window.location.hash = hash;
    navigation = createNavigation({ window });
    uninstall = navigation.install();
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    if (uninstall) uninstall();
    uninstall = null;
    jest.useRealTimers();
    document.body.innerHTML = '';
    window.location.hash = '';
});

describe('local class names', () => {
    test('match the whole local part of a CSS module class', () => {
        const element = document.createElement('div');
        element.className = 'list-container-Ab1c2 item-x_-9Z';
        expect(hasLocalClass(element, 'list-container')).toBe(true);
        expect(hasLocalClass(element, 'list')).toBe(false);
        expect(hasLocalClass(element, 'item')).toBe(true);
        document.body.innerHTML = '<div class="list-Ab1c2"></div><div class="list-container-Ab1c2"></div>';
        expect(queryLocal(document.body, 'list')).toHaveLength(1);
    });

    test('the screens of this task, by the first segment of the route', () => {
        expect(screenForPath('/library/movie').name).toBe('library');
        expect(screenForPath('/continuewatching').name).toBe('library');
        expect(screenForPath('/calendar/2026/10').name).toBe('calendar');
        expect(screenForPath('/addons/movie/x/y').name).toBe('addons');
        expect(screenForPath('/settings').name).toBe('settings');
        expect(screenForPath('/')).toBeNull();
        expect(screenForPath('/discover')).toBeNull();
    });
});

describe('initial focus', () => {
    test('the first item of the list, once the screen is shown', () => {
        render(libraryRoute());
        start('#/library');
        navigation.focusScreen();
        jest.advanceTimersByTime(0);
        expect(text()).toBe('item 0');
        expect(navigation.status.last.reason).toBe('initial');
    });

    test('waits for the list a moment before taking the filters', () => {
        render(libraryRoute({ items: 0 }));
        start('#/library');
        navigation.focusScreen();
        jest.advanceTimersByTime(1000);
        expect(document.activeElement).toBe(document.body);
        jest.advanceTimersByTime(1000);
        expect(text()).toBe('All');
    });

    test('the filters taken while waiting give way to the list when it comes', () => {
        render(libraryRoute({ items: 0 }));
        start('#/library');
        navigation.focusScreen();
        jest.advanceTimersByTime(1800);
        const filter = document.activeElement;
        expect(text()).toBe('All');
        // The grid comes in under the filters, which stay.
        document.querySelector('.library-content-Zz9_y').insertAdjacentHTML('beforeend',
            '<div class="meta-items-container-Mm3x4" data-rect="100,200,1800,800"><a class="meta-item-link-veMqr" href="#/detail/0" data-rect="120,200,250,380">item 0</a></div>');
        expect(filter.isConnected).toBe(true);
        jest.advanceTimersByTime(600);
        expect(text()).toBe('item 0');
    });

    test('a list that comes later still gets the focus', () => {
        render(libraryRoute({ items: 0 }));
        start('#/library');
        navigation.focusScreen();
        jest.advanceTimersByTime(400);
        render(libraryRoute());
        jest.advanceTimersByTime(400);
        expect(text()).toBe('item 0');
    });

    test('a key pressed while waiting stops the search, and that key recovers the focus', () => {
        render(libraryRoute({ items: 0 }));
        start('#/library');
        navigation.focusScreen();
        const event = key(DOWN);
        expect(event.defaultPrevented).toBe(true);
        expect(text()).toBe('All');
        jest.advanceTimersByTime(10000);
        expect(text()).toBe('All');
    });

    test('not on screens of other tasks', () => {
        render(boardRoute());
        start('#/');
        navigation.focusScreen();
        jest.advanceTimersByTime(10000);
        expect(document.activeElement).toBe(document.body);
        const event = key(DOWN);
        expect(event.defaultPrevented).toBe(false);
    });
});

describe('guest placeholder', () => {
    test('Library shows only "log in" to a guest: focused at once', () => {
        render(`
            <div class="route-container" data-rect="0,0,1920,1080">
                ${NAV_BAR}
                <div class="placeholder-Pp1x2" data-rect="200,100,1600,900">
                    <a class="button-GHZkA" href="#/intro?form=login" data-rect="800,850,300,100">Log in</a>
                </div>
            </div>`);
        start('#/library');
        navigation.focusScreen();
        jest.advanceTimersByTime(0);
        expect(text()).toBe('Log in');
    });
});

describe('profile menu', () => {
    test('OK on the profile button puts the focus on the first entry of the menu', () => {
        render(`
            <div class="route-container" data-rect="0,0,1920,1080">
                <nav class="horizontal-nav-bar-container-Hh1x2" data-rect="0,0,1920,100">
                    <div class="label-container-XOyzm nav-menu-popup-label-XmUBo" tabindex="0" data-rect="1760,10,80,80"></div>
                </nav>
            </div>`);
        start('#/');
        const label = document.querySelector('.nav-menu-popup-label-XmUBo');
        label.focus();
        key(13);
        // The menu opens inside the label and the focus falls to body.
        label.innerHTML = '<div class="nav-menu-container-Nn1x2" data-rect="1500,100,400,500"><a href="#/settings" data-rect="1500,120,400,60">Settings</a></div>';
        label.blur();
        expect(document.activeElement).toBe(document.body);
        jest.advanceTimersByTime(200);
        expect(document.activeElement).toBe(label.querySelector('a[href="#/settings"]'));
        expect(navigation.status.last.reason).toBe('profile-menu');
    });
});

describe('restoration', () => {
    test('back on a screen, the element it was left on', () => {
        render(libraryRoute(), boardRoute());
        // The Library below a newer route (display: none), as after opening a title.
        const [library] = document.querySelectorAll('.route-container');
        start('#/library');
        library.querySelectorAll('a.meta-item-link-veMqr')[4].focus();
        library.hidden = true;
        document.activeElement.blur();
        // Back: the newer route goes away and the Library is shown again.
        document.querySelectorAll('.route-container')[1].remove();
        library.hidden = false;
        navigation.focusScreen();
        jest.advanceTimersByTime(0);
        expect(text()).toBe('item 4');
        expect(navigation.status.last.reason).toBe('restored');
    });

    test('a focus already in the screen is left alone', () => {
        render(libraryRoute());
        start('#/library?sort=name');
        document.querySelector('.button-teWrC').focus();
        navigation.focusScreen();
        jest.advanceTimersByTime(0);
        expect(text()).toBe('All');
    });
});

describe('lists', () => {
    test('DOWN goes to the item below, scrolled into the list with a margin', () => {
        render(libraryRoute());
        start('#/library');
        const list = document.querySelector('.meta-items-container-Mm3x4');
        Object.defineProperty(list, 'offsetHeight', { value: 800 });
        Object.defineProperty(list, 'clientHeight', { value: 800 });
        Object.defineProperty(list, 'scrollHeight', { value: 1600 });
        list.querySelectorAll('a')[3].focus();
        // Item 6 (third row, 1000-1380) is below the list (200-1000).
        const event = key(DOWN);
        expect(event.defaultPrevented).toBe(true);
        expect(text()).toBe('item 6');
        // Its bottom 120px (15% of 800) above the bottom of the list.
        expect(list.scrollTop).toBe(1380 - 1000 + 120);
    });

    test('UP reaches the row above even when it is scrolled out of sight', () => {
        render(libraryRoute());
        start('#/library');
        const list = document.querySelector('.meta-items-container-Mm3x4');
        Object.defineProperty(list, 'offsetHeight', { value: 800 });
        Object.defineProperty(list, 'clientHeight', { value: 800 });
        Object.defineProperty(list, 'scrollHeight', { value: 1600 });
        list.scrollTop = 800;
        list.querySelectorAll('a')[6].focus();
        key(UP);
        expect(text()).toBe('item 3');
        expect(list.getBoundingClientRect().top + 120).toBeLessThanOrEqual(document.activeElement.getBoundingClientRect().top);
    });

    test('at the end, DOWN stays and UP leaves the list', () => {
        render(libraryRoute({ items: 3 }));
        start('#/library');
        const list = document.querySelector('.meta-items-container-Mm3x4');
        Object.defineProperty(list, 'clientHeight', { value: 800 });
        Object.defineProperty(list, 'scrollHeight', { value: 800 });
        list.querySelector('a').focus();
        expect(key(DOWN).defaultPrevented).toBe(true);
        expect(text()).toBe('item 0');
        expect(navigation.status.last.reason).toBe('list-end');
        // UP is the polyfill's (to the filters).
        expect(key(UP).defaultPrevented).toBe(false);
    });

    test('nothing focusable below: the list scrolls (content without controls)', () => {
        render(libraryRoute({ items: 3 }));
        start('#/library');
        const list = document.querySelector('.meta-items-container-Mm3x4');
        Object.defineProperty(list, 'clientHeight', { value: 800 });
        Object.defineProperty(list, 'scrollHeight', { value: 2000 });
        list.querySelector('a').focus();
        expect(key(DOWN).defaultPrevented).toBe(true);
        expect(list.scrollTop).toBe(480);
        expect(navigation.status.last.reason).toBe('scroll');
    });
});

describe('interface zoom', () => {
    test('after a resize the focused element is scrolled back into its list', () => {
        render(libraryRoute());
        start('#/library');
        const list = document.querySelector('.meta-items-container-Mm3x4');
        Object.defineProperty(list, 'offsetHeight', { value: 800 });
        list.querySelectorAll('a')[9].focus();
        // Item 9 (1400-1780) below the list (200-1000), as after a zoom change.
        window.dispatchEvent(new Event('resize'));
        jest.advanceTimersByTime(0);
        const rect = document.activeElement.getBoundingClientRect();
        expect(rect.bottom).toBeLessThanOrEqual(1000 - 120);
        expect(rect.top).toBeGreaterThanOrEqual(200);
    });
});

// Settings as on the TV at 100%: the side bar, the menu of sections, and the sections in two columns
// (labels on the left, controls on the right), scrolled to the Interface section: the General links
// at the top of the list are above the screen.
const settingsRoute = ({ menu = true, scrollTop = 600 } = {}) => `
    <div class="route-container" data-rect="0,0,1920,1080">
        <div class="route-content" data-rect="0,0,1920,1080">
            <nav class="horizontal-nav-bar-container-Hh1x2" data-rect="0,0,1920,140">
                <div class="label-container-XOyzm nav-menu-popup-label-XmUBo" tabindex="0" data-rect="1760,50,90,90">profile</div>
            </nav>
            ${NAV_BAR}
            ${menu ? `<div class="menu-Mm1x2" data-rect="230,200,370,700">
                <div class="button-DNmYL" tabindex="0" data-rect="230,240,370,100">General</div>
                <div class="button-DNmYL selected-S7SeK" tabindex="0" data-rect="230,350,370,100">Interface</div>
                <div class="button-DNmYL" tabindex="0" data-rect="230,680,370,100">Diagnostics</div>
            </div>` : ''}
            <div class="sections-container-Ss1x2" data-rect="700,140,900,940" data-scroll="${scrollTop}">
                <a class="link-FrL1t" href="#" data-rect="710,768,860,50">Log in / Sign up</a>
                <a class="link-FrL1t" href="#" data-rect="710,868,860,50">Contact support</a>
                <div class="button-teWrC" tabindex="0" data-rect="1140,1440,430,74">English</div>
                <button class="label-Sbsoe" data-rect="1150,1490,140,24">100%</button>
                <button class="label-Sbsoe" data-rect="1290,1490,140,24">125%</button>
                <div class="toggle-container-lZfHP" tabindex="0" data-rect="1320,1560,80,42">toggle</div>
            </div>
        </div>
    </div>`;

const startSettings = (options) => {
    render(settingsRoute(options));
    start('#/settings');
    const list = document.querySelector('.sections-container-Ss1x2');
    Object.defineProperty(list, 'offsetHeight', { value: 940 });
    Object.defineProperty(list, 'clientHeight', { value: 940 });
    Object.defineProperty(list, 'scrollHeight', { value: 3000 });
    list.scrollTop = Number(list.getAttribute('data-scroll'));
    return list;
};

const byText = (value) => Array.prototype.find.call(document.querySelectorAll('[tabindex], a, button'), (element) => element.textContent.trim() === value);

describe('Settings, two columns', () => {
    test.each(['English', '100%', 'toggle'])('LEFT from "%s" goes to the menu, the list stays where it is', (from) => {
        const list = startSettings();
        byText(from).focus();
        const event = key(LEFT);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(byText('Interface'));
        expect(list.scrollTop).toBe(600);
    });

    test('without the menu (125% zoom), LEFT goes to the side bar, not to the links above the screen', () => {
        const list = startSettings({ menu: false });
        byText('toggle').focus();
        key(LEFT);
        expect(document.activeElement.className).toContain('nav-tab-button');
        expect(list.scrollTop).toBe(600);
    });

    test('RIGHT from the menu goes back to the row LEFT came from', () => {
        const list = startSettings();
        byText('toggle').focus();
        key(LEFT);
        expect(document.activeElement).toBe(byText('Interface'));
        key(RIGHT);
        expect(document.activeElement).toBe(byText('toggle'));
        expect(navigation.status.last.reason).toBe('menu-return');
        expect(list.scrollTop).toBe(600);
    });

    test('LEFT/RIGHT between the zoom steps of the same row', () => {
        startSettings();
        byText('100%').focus();
        key(RIGHT);
        expect(document.activeElement).toBe(byText('125%'));
        key(LEFT);
        expect(document.activeElement).toBe(byText('100%'));
    });

    test('RIGHT at the end of a row stays, never to the profile button at the top', () => {
        startSettings();
        byText('125%').focus();
        const event = key(RIGHT);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(byText('125%'));
        expect(navigation.status.last.reason).toBe('row-end');
    });

    test('UP and DOWN still search the whole list', () => {
        const list = startSettings();
        byText('English').focus();
        key(UP);
        expect(document.activeElement).toBe(byText('Contact support'));
        expect(list.scrollTop).toBeLessThan(600);
    });
});

// Addons: the details modal is rendered inside the route (.modals-container).
const addonsRoute = (modal = false) => `
    <div class="route-container" data-rect="0,0,1920,1080">
        <div class="route-content" data-rect="0,0,1920,1080">
            ${NAV_BAR}
            <div class="addons-list-container-Aa1x2" data-rect="200,300,1600,780">
                <div class="addon-whmdO" tabindex="0" data-rect="230,300,1590,270">Cinemeta</div>
                <div class="addon-whmdO" tabindex="0" data-rect="230,580,1590,270">YouTube</div>
                <div class="addon-whmdO" tabindex="0" data-rect="230,860,1590,270">WatchHub</div>
            </div>
        </div>
        <div class="modals-container">${modal ? `
            <div class="modal-container" data-rect="0,0,1920,1080">
                <div class="close-button-container-Cc1x2" tabindex="0" data-rect="1500,100,80,80">Close</div>
                <div class="action-button-Ab1x2" tabindex="0" data-rect="800,800,300,80">Install</div>
            </div>` : ''}</div>
    </div>`;

describe('modal inside the route', () => {
    test('closing the addon details goes back to the opened addon', () => {
        render(addonsRoute(true));
        start('#/addons');
        // The addon was opened with OK...
        byText('WatchHub').focus();
        // ...and the modal focused its close button.
        byText('Close').focus();
        // Keys inside the modal are the modal's, even with the focus lost.
        byText('Close').blur();
        expect(key(DOWN).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(document.body);
        // Back closes it: the modal goes away and the location changes (?addon= removed).
        document.querySelector('.modals-container').innerHTML = '';
        navigation.focusScreen();
        jest.advanceTimersByTime(0);
        expect(document.activeElement).toBe(byText('WatchHub'));
        expect(navigation.status.last.reason).toBe('restored');
    });

    test('no screen focus while a modal is opening', () => {
        render(addonsRoute(true));
        start('#/addons?addon=x');
        navigation.focusScreen();
        jest.advanceTimersByTime(1000);
        expect(document.activeElement).toBe(document.body);
    });
});

describe('a list replaced after the initial focus', () => {
    test('the new list gets the focus (Addons: Installed to Community)', () => {
        render(addonsRoute());
        start('#/addons/community');
        navigation.focusScreen();
        jest.advanceTimersByTime(0);
        expect(document.activeElement).toBe(byText('Cinemeta'));
        // The remote catalog replaces the list: the focused element goes away with the focus.
        document.querySelector('.addons-list-container-Aa1x2').innerHTML =
            '<div class="addon-whmdO" tabindex="0" data-rect="230,300,1590,270">Torrentio</div>';
        expect(document.activeElement).toBe(document.body);
        jest.advanceTimersByTime(600);
        expect(document.activeElement).toBe(byText('Torrentio'));
    });
});

describe('lost focus', () => {
    test('an arrow with the focus on body goes back to the screen', () => {
        render(libraryRoute());
        start('#/library');
        const items = document.querySelectorAll('a.meta-item-link-veMqr');
        items[2].focus();
        // The item is removed (a list reloaded): the focus falls to body.
        items[2].remove();
        expect(document.activeElement).toBe(document.body);
        const event = key(DOWN);
        expect(event.defaultPrevented).toBe(true);
        expect(text()).toBe('item 0');
        expect(navigation.status.last.reason).toBe('recovered');
    });
});

describe('side navigation bar', () => {
    test('RIGHT goes back to the item the bar was entered from, on any screen', () => {
        render(boardRoute());
        start('#/');
        document.querySelector('a[href="#/detail/b"]').focus();
        document.querySelectorAll('.nav-tab-button-Ab1c2')[1].focus();
        const event = key(RIGHT);
        expect(event.defaultPrevented).toBe(true);
        expect(text()).toBe('board item');
        expect(navigation.status.last.reason).toBe('nav-bar-return');
    });

    test('without a known item, RIGHT goes into the content, not to the top bar', () => {
        render(`
            <div class="route-container" data-rect="0,0,1920,1080">
                <div class="route-content" data-rect="0,0,1920,1080">
                    <nav class="horizontal-nav-bar-container-Hh1x2" data-rect="0,0,1920,100">
                        <div class="submit-button-container-MImNa" tabindex="0" data-rect="1200,10,100,80">search</div>
                    </nav>
                    ${NAV_BAR}
                    <a class="meta-item-link-veMqr" href="#/detail/b" data-rect="300,200,250,380">board item</a>
                </div>
            </div>`);
        start('#/');
        document.querySelector('.nav-tab-button-Ab1c2').focus();
        const event = key(RIGHT);
        expect(event.defaultPrevented).toBe(true);
        expect(text()).toBe('board item');
        expect(navigation.status.last.reason).toBe('nav-bar-enter');
    });

    test('the bar is not where the screen restores to', () => {
        render(libraryRoute());
        start('#/library');
        document.querySelectorAll('a.meta-item-link-veMqr')[1].focus();
        document.querySelector('.nav-tab-button-Ab1c2').focus();
        document.activeElement.blur();
        navigation.focusScreen();
        jest.advanceTimersByTime(0);
        expect(text()).toBe('item 1');
    });
});

// The upstream code this task relies on: if one of these changes, the selectors of f4.1b.js or the
// reason for an override is gone.
describe('upstream contract', () => {
    const lessHasClass = (file, name) => new RegExp(`\\.${name}\\s*\\{`).test(read(file));

    test('the classes the screens are found by', () => {
        const classes = [
            ['src/routes/Library/styles.less', ['meta-items-container', 'selectable-inputs-container']],
            ['src/routes/Library/Placeholder/Placeholder.less', ['placeholder']],
            ['src/routes/Calendar/Table/Cell/Cell.less', ['cell', 'today']],
            ['src/routes/Calendar/Table/Table.less', ['table', 'grid']],
            ['src/routes/Calendar/List/List.less', ['list']],
            ['src/routes/Addons/styles.less', ['addons-list-container', 'selectable-inputs-container']],
            ['src/routes/Settings/Menu/Menu.less', ['menu', 'selected']],
            ['src/routes/Settings/Settings.less', ['sections-container']],
            ['src/components/NavBar/VerticalNavBar/styles.less', ['vertical-nav-bar-container']],
            ['src/components/NavBar/HorizontalNavBar/styles.less', ['horizontal-nav-bar-container']],
            ['src/components/NavBar/HorizontalNavBar/NavMenu/styles.less', ['nav-menu-popup-label', 'nav-menu-container']],
        ];
        classes.forEach(([file, names]) => names.forEach((name) => {
            expect([file, name, lessHasClass(file, name)]).toEqual([file, name, true]);
        }));
        const names = SCREENS.reduce((all, screen) => all.concat(screen.lists, ...screen.initial.filter(Array.isArray)), []);
        expect(names.sort()).toEqual(['addons-list-container', 'addons-list-container', 'grid', 'list', 'menu', 'meta-items-container', 'meta-items-container', 'placeholder', 'placeholder', 'sections-container', 'sections-container', 'selectable-inputs-container', 'selectable-inputs-container', 'table']);
    });

    test('the CSS module class format', () => {
        expect(read('webpack.config.js')).toContain("localIdentName: '[local]-[hash:base64:5]'");
    });

    test('what the overrides change is still there upstream', () => {
        // NavTabButton.webos.js: the side bar buttons are out of the focus order upstream.
        expect(read('src/components/NavBar/VerticalNavBar/NavTabButton/NavTabButton.js')).toMatch(/<Link [^>]*tabIndex=\{-1\}/);
        // NavMenu.webos.js: the profile button too, rendered by renderLabel.
        expect(read('src/components/NavBar/HorizontalNavBar/HorizontalNavBar.js')).toMatch(/menu-button-container'\]\)\} tabIndex=\{-1\}/);
        expect(read('src/components/NavBar/HorizontalNavBar/NavMenu/NavMenu.js')).toContain('props.renderLabel({');
        // Option.webos.tsx: the settings toggles.
        ['General/General.tsx', 'Interface/Interface.tsx', 'Player/Player.tsx'].forEach((file) => {
            expect(read(`src/routes/Settings/${file}`)).toMatch(/tabIndex=\{-1\}/);
        });
        // Scale.webos.tsx: tabIndex goes to the range input, the ticks are buttons.
        const scale = read('src/components/Scale/Scale.tsx');
        expect(scale).toMatch(/type=\{'range'\}\s+tabIndex=\{tabIndex\}/);
        expect(scale).toMatch(/<button\s+type=\{'button'\}/);
        expect(scale).toContain("if (event.key.startsWith('Arrow')) event.stopPropagation();");
    });

    test('the overrides import the upstream file, not themselves', () => {
        expect(read('src/components/NavBar/VerticalNavBar/NavTabButton/NavTabButton.webos.js')).toContain("require('./NavTabButton.js')");
        expect(read('src/components/NavBar/HorizontalNavBar/NavMenu/NavMenu.webos.js')).toContain("require('./NavMenu.js')");
        expect(read('src/routes/Settings/components/Option/Option.webos.tsx')).toContain("from './Option.tsx'");
        expect(read('src/components/Scale/Scale.webos.tsx')).toContain("from './Scale.tsx'");
    });
});
