// The app's Back dispatcher (owner: F3.2). Installed when this module loads, before React renders,
// so its capture listener runs before any other keydown listener on window. The keyboard and
// overlay layers do not depend on React and are registered here; the route layer and the quit
// dialog come with webos/back/BackNavigation.js.

const { PRIORITY, createBackDispatcher } = require('./dispatcher');
const { closeTopOverlay } = require('./overlays');
const { trackKeyboard, closeVirtualKeyboard } = require('./platform');

const backDispatcher = createBackDispatcher();

backDispatcher.install(window);
const isKeyboardVisible = trackKeyboard(window);
backDispatcher.register(() => closeVirtualKeyboard(window, isKeyboardVisible), { priority: PRIORITY.KEYBOARD, name: 'keyboard' });
backDispatcher.register((context) => {
    context.detail = closeTopOverlay(window);
    return context.detail !== null;
}, { priority: PRIORITY.OVERLAY, name: 'overlay' });

// For the emulator tests (webos/tests/back/emulator) and the diagnostics screen (F3.6).
window.__webosBack = backDispatcher;

module.exports = backDispatcher;
