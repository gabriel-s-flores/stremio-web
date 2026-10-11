// Library, Calendar, Addons and Settings: screens of ./core/screenFocus.js with scrolling lists
// (./core/lists.js). Each route component gets them in its index.webos.js (withScreenNavigation).
//
// - Initial focus: the first item of the screen (the first poster, addon, calendar day or settings
//   menu entry). Lists load after the route: the first `preferred` entries of `initial` are waited
//   for a moment (INITIAL_FOCUS_PREFERRED_MS) before the others (the filters above the list), which
//   give way to the list when it comes, if the user did not take over. Library and Calendar show
//   only a "log in" placeholder to a guest.
// - A list replaced under the focus (a filter of Addons, a sort of Library) gets the focus again.
// - Modals inside the route (the addon details of Addons) are the modal's (modals.js); what is
//   focused inside one is not where the screen restores to.
// Classes are CSS modules (`<local>-<hash>`); webos/tests/navigation/screens.test.js fails if the
// upstream ones used here are renamed.

const { closestLocal, hasLocalName, queryLocalAll } = require('./core/dom');
const { findEntry, navigateLists } = require('./core/lists');
const { revealInList } = require('./core/scroll');

// For a while only the first choice of the screen is taken (its list comes after the filters above it).
const INITIAL_FOCUS_PREFERRED_MS = 1500;
// The whole wait for the list, the fallback included.
const INITIAL_FOCUS_TIMEOUT_MS = 12000;

// The Settings menu entry of the section on screen.
const selectedMenuEntry = (container) => queryLocalAll(container, 'menu')
    .map((menu) => queryLocalAll(menu, 'selected')[0])
    .filter(Boolean)[0] || null;

// `initial`: tried in order (see findEntry), the first `preferred` (default 1) of them right away
// and the others only after a moment; `lists`: the scrolling containers; `leftExit`, `rightReturn`:
// see ./core/lists.js.
const SPECS = {
    library: {
        initial: [['placeholder'], ['meta-items-container'], ['selectable-inputs-container']],
        preferred: 2,
        lists: ['meta-items-container'],
    },
    calendar: {
        initial: [
            ['placeholder'],
            (container) => queryLocalAll(container, 'cell').filter((cell) => hasLocalName(cell, 'today'))[0],
            ['table', 'grid'],
        ],
        preferred: 2,
        lists: ['list'],
    },
    addons: {
        initial: [['addons-list-container'], ['selectable-inputs-container']],
        lists: ['addons-list-container'],
    },
    settings: {
        initial: [selectedMenuEntry, ['menu'], ['sections-container']],
        lists: ['sections-container'],
        // LEFT out of the sections: the entry of the section on screen; RIGHT from the menu: back to
        // the row the user left (when it is still on screen).
        leftExit: selectedMenuEntry,
        rightReturn: { from: 'menu', to: 'sections-container' },
    },
};

const listScreen = (spec) => ({
    initial: (container) => findEntry(spec.initial.slice(0, spec.preferred || 1), container),
    fallback: (container) => findEntry(spec.initial, container),
    fallbackDelay: INITIAL_FOCUS_PREFERRED_MS,
    timeout: INITIAL_FOCUS_TIMEOUT_MS,
    // A list replaced by another one: the same place may hold a filter now.
    path: false,
    // Before the open dropdowns' own keys.
    capture: true,
    isContent: (element, container) => !element.closest('[role="listbox"]') && closestLocal(element, spec.lists, container) !== null,
    navigate: (target, dir, container, memory) => navigateLists(spec, target, dir, container, memory),
    // The interface zoom changed the layout: the focused element back into its list.
    realign: (element, container) => {
        const list = closestLocal(element, spec.lists, container);
        if (list !== null) revealInList(list, element);
    },
});

module.exports = {
    INITIAL_FOCUS_PREFERRED_MS,
    INITIAL_FOCUS_TIMEOUT_MS,
    SPECS,
    listScreen,
    libraryScreen: listScreen(SPECS.library),
    calendarScreen: listScreen(SPECS.calendar),
    addonsScreen: listScreen(SPECS.addons),
    settingsScreen: listScreen(SPECS.settings),
};
