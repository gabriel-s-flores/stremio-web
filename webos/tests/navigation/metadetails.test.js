/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeEach, afterEach */
// F4.1c: the remote control navigation of the details page (webos/lib/navigation/metadetails.js).
// jsdom has no layout: every element gets a 10x10 rect unless the test gives it one (__rect), and
// a zero rect means "not rendered".

const {
    createMetaDetailsNavigation, keepInView, locate, resolve, offsetInto, _memory, _setLastInput,
} = require('../../lib/navigation/metadetails');

const nativeRect = Element.prototype.getBoundingClientRect;
const rectOf = function rectOf() {
    const rect = this.__rect || { top: 0, left: 0, width: 10, height: 10 };
    return Object.assign({ right: rect.left + rect.width, bottom: rect.top + rect.height }, rect);
};

const STREAMS_PAGE = `
<div class="route-container"><div class="route-content" id="below"><div class="board-x"><a class="meta-item-link-1" href="#/detail/movie/tt1" id="poster">poster</a></div></div></div>
<div class="route-container"><div class="route-content" id="root">
  <div class="metadetails-container-a1">
    <div class="nav-bar-b1 horizontal-nav-bar-container-b2">
      <div class="button-container-1 back-button-container-b3" tabindex="0" id="nav-back">back</div>
      <div class="button-container-1 profile-b4" tabindex="0" id="profile">profile</div>
    </div>
    <div class="metadetails-content-c1">
      <div class="meta-preview-d1 meta-preview-container-d2" id="meta">
        <div class="meta-info-container-e1" id="info">
          <a class="button-container-1 link-container-e2" href="#/search?search=actor" tabindex="0" title="Actor" id="cast">Actor</a>
          <div class="description-container-e3" id="description">Summary</div>
        </div>
        <div class="action-buttons-container-f1">
          <a class="button-container-1 action-button-container-f2" tabindex="0" title="Trailer" id="trailer">Trailer</a>
          <div class="group-container-g1"><div class="icon-container-g2" tabindex="0" id="library">lib</div></div>
        </div>
      </div>
      <div class="spacing-h1"></div>
      <div class="streams-list-i1 streams-list-container-i2" id="list">
        <div class="select-choices-wrapper-j1"><div class="multiselect-menu-j2" tabindex="0" id="filter">All</div></div>
        <div class="streams-container-k1">
          <a class="button-container-1 label-container-k2 stream-container-k3" href="#/player/one" tabindex="0" title="Addon" id="s1">one</a>
          <a class="button-container-1 label-container-k2 stream-container-k3" href="#/player/two" tabindex="0" title="Addon" id="s2">two</a>
          <a class="button-container-1 label-container-k2 stream-container-k3" href="#/player/three" tabindex="0" title="Addon" id="s3">three</a>
        </div>
      </div>
    </div>
  </div>
  <span hidden></span>
</div></div>`;

const VIDEOS_LIST = `
<div class="videos-list-l1 videos-list-container-l2" id="list">
  <div class="seasons-bar-m1"><div class="prev-season-button-m2" tabindex="0" id="prev">prev</div><div class="next-season-button-m3" tabindex="0" id="next">next</div></div>
  <div class="search-bar-n1"><input class="search-input-n2" id="search" /></div>
  <div class="videos-container-o1">
    <div class="button-container-1 label-container-p1 video-container-p2" tabindex="0" title="Pilot" id="v1">1. Pilot</div>
    <div class="button-container-1 label-container-p1 video-container-p2 selected-p3" tabindex="0" title="Second" id="v2">2. Second<div class="play-button-container-p4" tabindex="0" id="v2-play">play</div></div>
    <div class="button-container-1 label-container-p1 video-container-p2" tabindex="0" title="Third" id="v3">3. Third</div>
  </div>
</div>`;

const $ = (id) => document.getElementById(id);
const key = (keyCode, target = document.activeElement || document.body) => {
    const event = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    target.dispatchEvent(event);
    return event;
};
const KEY = { OK: 13, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 };
const noTarget = (container, dir, causedTarget = document.activeElement) => {
    const event = new CustomEvent('navnotarget', { bubbles: true, cancelable: true, detail: { dir, causedTarget } });
    container.dispatchEvent(event);
    return event;
};

let navigation = null;
const open = (pathname = '/detail/movie/tt1/tt1', type = 'PUSH') => {
    navigation = createMetaDetailsNavigation({ root: $('root'), window });
    navigation.setRouteActive(true);
    navigation.setLocation(pathname, type);
    navigation.tick();
    return navigation;
};

beforeEach(() => {
    Element.prototype.getBoundingClientRect = rectOf;
    document.body.innerHTML = STREAMS_PAGE;
    document.documentElement.removeAttribute('data-webos-pointer');
    _setLastInput(null);
    _memory.clear();
});

afterEach(() => {
    if (navigation) navigation.destroy();
    navigation = null;
    Element.prototype.getBoundingClientRect = nativeRect;
});

describe('keepInView', () => {
    it('keeps a margin of half the element so the next one stays partly visible', () => {
        expect(offsetInto(120, 160, 100, 500, 20)).toBe(0);
        expect(offsetInto(470, 510, 100, 500, 20)).toBe(30);
        expect(offsetInto(90, 130, 100, 500, 20)).toBe(-30);
        // Taller than the room: its start goes to the margin.
        expect(offsetInto(200, 700, 100, 500, 20)).toBe(80);
    });

    it('converts screen pixels (the TV zoom) to the CSS pixels of scrollTop', () => {
        const list = document.querySelector('[class*="streams-container"]');
        list.style.overflowY = 'auto';
        Object.defineProperty(list, 'scrollHeight', { value: 1000 });
        Object.defineProperty(list, 'clientHeight', { value: 200 });
        Object.defineProperty(list, 'offsetHeight', { value: 200 });
        list.__rect = { top: 100, left: 0, width: 300, height: 400 }; // zoom 2
        $('s3').__rect = { top: 520, left: 0, width: 300, height: 80 };
        keepInView($('s3'), $('root'), window);
        // bottom 600 must be at 500 - 40 (half of 80): 140 screen px, 70 CSS px.
        expect(list.scrollTop).toBe(70);
    });
});

describe('locate and resolve', () => {
    it('finds a stream by its link, an episode by its title and text, else by position', () => {
        const list = $('list');
        expect(resolve(locate($('s2'), list), list)).toBe($('s2'));
        $('s2').setAttribute('href', '#/player/other');
        expect(resolve({ href: '#/player/gone', title: 'Addon', text: 'three', index: 0 }, list)).toBe($('s3'));
        expect(resolve({ href: null, title: 'x', text: 'y', index: 1 }, list)).toBe($('s1'));
        expect(resolve({ href: null, title: 'x', text: 'y', index: 9 }, list)).toBe(null);
    });
});

describe('initial focus', () => {
    it('focuses the streams list panel, not a stream (the C8 order stays free until the first key)', () => {
        $('poster').focus(); // the Board keeps the focus under the page
        open();
        expect(document.activeElement).toBe($('list'));
        expect($('list').getAttribute('tabindex')).toBe('-1');
        expect(document.activeElement.hasAttribute('data-c8-tier')).toBe(false);
    });

    it('waits for the streams to show up', () => {
        const items = Array.from(document.querySelectorAll('[class*="stream-container"]'));
        items.forEach((item) => { item.__rect = { top: 0, left: 0, width: 0, height: 0 }; });
        const placeholder = document.createElement('div');
        placeholder.className = 'stream-placeholder-container-z1';
        $('list').appendChild(placeholder);
        open();
        expect(document.activeElement).toBe(document.body);
        items.forEach((item) => { delete item.__rect; });
        navigation.tick();
        expect(document.activeElement).toBe($('list'));
    });

    it('focuses the selected episode, or the first one', () => {
        $('list').outerHTML = VIDEOS_LIST;
        open('/detail/series/tt2');
        expect(document.activeElement).toBe($('v2'));
        navigation.destroy();
        document.activeElement.blur();
        $('v2').className = $('v2').className.replace(' selected-p3', '');
        open('/detail/series/tt3');
        expect(document.activeElement).toBe($('v1'));
    });

    it('does nothing while the Magic Remote pointer is in use', () => {
        document.documentElement.setAttribute('data-webos-pointer', 'visible');
        open();
        expect(document.activeElement).toBe(document.body);
        document.documentElement.removeAttribute('data-webos-pointer');
        _setLastInput('pointer');
        navigation.tick();
        expect(document.activeElement).toBe(document.body);
    });

    it('leaves a focus already on the page alone', () => {
        $('trailer').focus();
        open();
        expect(document.activeElement).toBe($('trailer'));
    });

    it('with no streams, focuses the list buttons or the column, never a text field', () => {
        $('list').innerHTML = '<div class="message-container-q1"><input class="search-q2" id="picker" tabindex="0" /><div>No streams</div></div>';
        open();
        expect(document.activeElement).toBe($('trailer'));
    });
});

describe('the streams list panel', () => {
    it('DOWN, RIGHT and OK enter the first stream; UP the list header; LEFT the column', () => {
        open();
        expect(key(KEY.DOWN).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('s1'));
        [KEY.RIGHT, KEY.OK].forEach((code) => {
            $('list').focus();
            key(code);
            expect(document.activeElement).toBe($('s1'));
        });
        $('list').focus();
        key(KEY.UP);
        expect(document.activeElement).toBe($('filter'));
        $('list').focus();
        key(KEY.LEFT);
        expect(document.activeElement).toBe($('trailer'));
    });

    it('the first arrow with no focus on the page places it (and the polyfill does not move)', () => {
        document.documentElement.setAttribute('data-webos-pointer', 'visible');
        open();
        document.documentElement.setAttribute('data-webos-pointer', 'hidden');
        expect(key(KEY.DOWN, document.body).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('list'));
    });
});

describe('list items', () => {
    it('LEFT goes to the column, RIGHT does not jump to the addon filter', () => {
        open();
        $('s2').focus();
        expect(key(KEY.RIGHT).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('s2'));
        key(KEY.LEFT);
        expect(document.activeElement).toBe($('trailer'));
    });

    it('RIGHT on an episode enters its play button', () => {
        $('list').outerHTML = VIDEOS_LIST;
        open('/detail/series/tt2');
        key(KEY.RIGHT);
        expect(document.activeElement).toBe($('v2-play'));
        key(KEY.LEFT);
        expect(document.activeElement).toBe($('trailer'));
    });

    it('UP and DOWN are left to the polyfill', () => {
        open();
        $('s2').focus();
        expect(key(KEY.DOWN).defaultPrevented).toBe(false);
    });
});

describe('moving between sections (navnotarget)', () => {
    it('RIGHT from the column goes to the list item focused there before', () => {
        open();
        $('s3').focus();
        $('cast').focus();
        const event = noTarget($('meta'), 'right');
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('s3'));
    });

    it('LEFT from the list goes to the column element focused there before', () => {
        open();
        $('library').focus();
        $('s1').focus();
        noTarget($('list'), 'left');
        expect(document.activeElement).toBe($('library'));
    });

    it('UP from the top of the column goes to the back button, not to a stream', () => {
        open();
        $('cast').focus();
        noTarget($('meta'), 'up');
        expect(document.activeElement).toBe($('nav-back'));
    });

    it('nothing leaves the bottom of a section; UP from the list is left to the polyfill', () => {
        open();
        $('s3').focus();
        expect(noTarget($('list'), 'down').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('s3'));
        expect(noTarget($('list'), 'up').defaultPrevented).toBe(false);
        $('trailer').focus();
        expect(noTarget($('meta'), 'down').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('trailer'));
    });

    it('ignores menus inside a section (F4.3) and other containers', () => {
        open();
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-r1';
        dropdown.innerHTML = '<div tabindex="0" id="option">Addon</div>';
        $('filter').appendChild(dropdown);
        $('option').focus();
        expect(noTarget($('list'), 'left').defaultPrevented).toBe(false);
        expect(document.activeElement).toBe($('option'));
        expect(noTarget($('info'), 'up').defaultPrevented).toBe(false);
    });
});

describe('restoring the focus', () => {
    it('Back to the page (remount, POP) restores the last focus; a pushed page opens on the default', () => {
        open('/detail/movie/tt1/tt1');
        $('s2').focus();
        navigation.destroy();
        $('s2').blur();
        open('/detail/movie/tt1/tt1', 'POP');
        expect(document.activeElement).toBe($('s2'));
        navigation.destroy();
        $('s2').blur();
        open('/detail/movie/tt1/tt1', 'PUSH');
        expect(document.activeElement).toBe($('list'));
    });

    it('the Player closing (route active again) restores the stream', () => {
        open();
        $('s3').focus();
        navigation.setRouteActive(false);
        $('s3').blur();
        navigation.tick();
        expect(document.activeElement).toBe(document.body);
        navigation.setRouteActive(true);
        navigation.tick();
        expect(document.activeElement).toBe($('s3'));
        // With the ring, whatever the focus-visible polyfill thinks of the last input.
        expect($('s3').hasAttribute('data-focus-visible-added')).toBe(true);
    });

    it('the ring is not forced while the Magic Remote pointer shows', () => {
        open();
        expect($('list').hasAttribute('data-focus-visible-added')).toBe(true);
        $('list').blur();
        $('list').removeAttribute('data-focus-visible-added');
        document.documentElement.setAttribute('data-webos-pointer', 'visible');
        key(KEY.DOWN, document.body);
        expect(document.activeElement).toBe($('list'));
        expect($('list').hasAttribute('data-focus-visible-added')).toBe(false);
    });

    it('the streams list going back to the episodes (replace) restores the episode', () => {
        $('list').outerHTML = VIDEOS_LIST;
        open('/detail/series/tt2');
        $('v3').focus();
        // OK on the episode: the list becomes its streams (another path, replace).
        $('list').outerHTML = STREAMS_PAGE.match(/<div class="streams-list[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];
        navigation.setLocation('/detail/series/tt2/tt2:1:3', 'REPLACE');
        navigation.tick();
        expect(document.activeElement).toBe($('list'));
        $('list').outerHTML = VIDEOS_LIST;
        navigation.setLocation('/detail/series/tt2', 'REPLACE');
        navigation.tick();
        expect(document.activeElement).toBe($('v3'));
    });
});

describe('the summary and the toggles', () => {
    it('the summary is focusable while the column overflows', () => {
        const info = $('info');
        let overflow = true;
        Object.defineProperty(info, 'scrollHeight', { get: () => (overflow ? 600 : 300) });
        Object.defineProperty(info, 'clientHeight', { value: 300 });
        open();
        expect($('description').getAttribute('tabindex')).toBe('0');
        overflow = false;
        navigation.tick();
        expect($('description').getAttribute('tabindex')).toBe(null);
    });

    it('OK clicks the library/watched toggles (a div with only onClick)', () => {
        open();
        const click = jest.fn();
        $('library').addEventListener('click', click);
        $('library').focus();
        key(KEY.OK);
        expect(click).toHaveBeenCalledTimes(1);
        // Not other elements, and not when a handler already took the key (the Button's Enter).
        const other = jest.fn();
        $('trailer').addEventListener('click', other);
        $('trailer').focus();
        key(KEY.OK);
        expect(other).not.toHaveBeenCalled();
        $('library').focus();
        $('library').addEventListener('keydown', (event) => event.preventDefault(), { once: true });
        key(KEY.OK);
        expect(click).toHaveBeenCalledTimes(1);
    });
});

describe('scrollIntoView during an arrow', () => {
    it('the polyfill call keeps the element in view; other calls and other times are untouched', () => {
        const native = Element.prototype.scrollIntoView = jest.fn();
        const calls = [];
        // Registered before the controller, like the polyfill (App.js).
        const polyfill = () => {
            calls.push(Element.prototype.scrollIntoView === native);
            $('s2').scrollIntoView();
            $('s2').scrollIntoView({ block: 'center' });
        };
        window.addEventListener('keydown', polyfill);
        open();
        $('s1').focus();
        key(KEY.DOWN);
        window.removeEventListener('keydown', polyfill);
        expect(calls).toEqual([false]);
        expect(native).toHaveBeenCalledTimes(1);
        expect(native).toHaveBeenCalledWith({ block: 'center' });
        expect(Element.prototype.scrollIntoView).toBe(native);
    });
});

describe('the action buttons row and the summary', () => {
    it('LEFT/RIGHT follow the row (not a summary overlapping it), and RIGHT past its end goes to the list', () => {
        open();
        $('s2').focus();
        $('trailer').focus();
        expect(key(KEY.RIGHT).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('library'));
        key(KEY.RIGHT);
        expect(document.activeElement).toBe($('s2'));
        $('trailer').focus();
        key(KEY.LEFT);
        expect(document.activeElement).toBe($('trailer'));
    });

    it('from the summary, RIGHT goes to the list and LEFT stays', () => {
        open();
        $('description').setAttribute('tabindex', '0');
        $('description').focus();
        key(KEY.LEFT);
        expect(document.activeElement).toBe($('description'));
        key(KEY.RIGHT);
        expect(document.activeElement).toBe($('s1'));
    });
});

describe('reaching the summary and restoring while loading', () => {
    it('UP from the action row goes to the bottom of the column (the summary), even below the fold', () => {
        open();
        $('description').setAttribute('tabindex', '0');
        $('description').__rect = { top: 2000, left: 0, width: 10, height: 10 }; // out of view
        $('library').focus();
        expect(key(KEY.UP).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('description'));
    });

    // Review c1, M1: in the C8 profile the column came back 6.4 s after Back from Discover.
    const remountWithColumnLoading = (now) => {
        now.mockReturnValue(1000);
        open('/detail/movie/tt1/tt1');
        $('cast').focus();
        navigation.destroy();
        $('cast').blur();
        // Remount by Back: the streams are cached, the column is a placeholder.
        const meta = $('meta').innerHTML;
        $('meta').innerHTML = '<div class="meta-preview-placeholder-container-s1"></div>';
        open('/detail/movie/tt1/tt1', 'POP');
        return () => { $('meta').innerHTML = meta; };
    };

    it('a focus to restore is waited for while its section is a placeholder, past 3 s too', () => {
        const now = jest.spyOn(Date, 'now');
        const loadColumn = remountWithColumnLoading(now);
        expect(document.activeElement).toBe(document.body);
        now.mockReturnValue(7400);
        navigation.tick();
        expect(document.activeElement).toBe(document.body);
        loadColumn();
        navigation.tick();
        expect(document.activeElement).toBe($('cast'));
        now.mockRestore();
    });

    it('past the guard the default goes in, and the restored focus replaces it when the column shows up', () => {
        const now = jest.spyOn(Date, 'now');
        const loadColumn = remountWithColumnLoading(now);
        now.mockReturnValue(1000 + 15001);
        navigation.tick();
        expect(document.activeElement).toBe($('list'));
        loadColumn();
        navigation.tick();
        expect(document.activeElement).toBe($('cast'));
        now.mockRestore();
    });

    it('not when a key came after the default went in', () => {
        const now = jest.spyOn(Date, 'now');
        const loadColumn = remountWithColumnLoading(now);
        now.mockReturnValue(1000 + 15001);
        navigation.tick();
        expect(document.activeElement).toBe($('list'));
        key(KEY.DOWN);
        expect(document.activeElement).toBe($('s1'));
        loadColumn();
        navigation.tick();
        expect(document.activeElement).toBe($('s1'));
        now.mockRestore();
    });

    it('a key while the restore is awaited ends the wait: the default goes in', () => {
        const now = jest.spyOn(Date, 'now');
        const loadColumn = remountWithColumnLoading(now);
        expect(key(KEY.DOWN, document.body).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe($('list'));
        loadColumn();
        navigation.tick();
        expect(document.activeElement).toBe($('list'));
        now.mockRestore();
    });

    it('a saved item missing from a loaded section does not hold the page: the default at once', () => {
        open('/detail/movie/tt1/tt1');
        $('s3').focus();
        navigation.destroy();
        $('s3').blur();
        $('s3').parentNode.removeChild($('s3'));
        $('s2').setAttribute('href', '#/player/other');
        open('/detail/movie/tt1/tt1', 'POP');
        // Not by link, label or position (it was the 4th focusable of the list): the default, at once.
        expect(document.activeElement).toBe($('list'));
    });
});

describe('review c1: OK under the page, disabled toggles, the swap and the panel memory', () => {
    it('B1: an OK while the focus is still on the poster of the route below does not reach it', () => {
        const items = Array.from(document.querySelectorAll('[class*="stream-container"]'));
        items.forEach((item) => { item.__rect = { top: 0, left: 0, width: 0, height: 0 }; });
        const placeholder = document.createElement('div');
        placeholder.className = 'stream-placeholder-container-z1';
        $('list').appendChild(placeholder);
        $('poster').focus();
        open();
        const click = jest.fn();
        $('poster').addEventListener('keydown', click);
        const event = key(KEY.OK, $('poster'));
        expect(event.defaultPrevented).toBe(true);
        expect(click).not.toHaveBeenCalled();
        // An OK on the body (nothing below) is left alone.
        document.activeElement.blur();
        expect(key(KEY.OK, document.body).defaultPrevented).toBe(false);
    });

    it('B2: OK does not click a disabled toggle (the ratings while they load)', () => {
        open();
        const click = jest.fn();
        $('library').className += ' disabled-q9';
        $('library').addEventListener('click', click);
        $('library').focus();
        key(KEY.OK);
        expect(click).not.toHaveBeenCalled();
    });

    it('B3: during an arrow, scrollIntoView() on an element outside the page stays native', () => {
        const native = Element.prototype.scrollIntoView = jest.fn();
        const polyfill = () => {
            $('poster').scrollIntoView();
        };
        window.addEventListener('keydown', polyfill);
        open();
        $('s1').focus();
        key(KEY.DOWN);
        window.removeEventListener('keydown', polyfill);
        expect(native).toHaveBeenCalledTimes(1);
        expect(native.mock.instances[0]).toBe($('poster'));
    });

    it('B3: the list panel itself is restored, not an earlier item of the list', () => {
        open('/detail/movie/tt1/tt1');
        $('s2').focus();
        $('list').focus();
        navigation.destroy();
        $('list').blur();
        open('/detail/movie/tt1/tt1', 'POP');
        expect(document.activeElement).toBe($('list'));
    });
});
