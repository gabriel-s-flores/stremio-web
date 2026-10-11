// System keyboard on webOS TV 4.x (owner: F3.4). Behaviour: webos/keyboard/README.md.
// Required by src/App/index.webos.js: installs at once, before React renders, like webos/back.

const keyboard = require('./keyboard');

if (typeof window !== 'undefined') {
    keyboard.install(window);
}

module.exports = keyboard;
