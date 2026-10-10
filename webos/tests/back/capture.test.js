/**
 * @jest-environment jsdom
 */
// webos/back/dispatcher.js install(): the Back key is taken in the capture phase on window, before
// any listener of the page sees it, including window listeners registered earlier (the Player's
// keydown handler, spatial navigation, ShortcutsProvider on document).

const { createBackDispatcher } = require('../../back/dispatcher');

const keydown = (keyCode) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    Object.defineProperty(event, 'which', { value: keyCode });
    return event;
};

test('listeners on window (registered before), document and the target never see Back; other keys reach them', () => {
    document.body.innerHTML = '<input id="field">';
    const field = document.getElementById('field');
    const seen = [];
    const onWindow = (event) => seen.push(`window:${event.keyCode}`);
    const onDocument = (event) => seen.push(`document:${event.keyCode}`);
    const onField = (event) => seen.push(`field:${event.keyCode}`);
    window.addEventListener('keydown', onWindow);
    document.addEventListener('keydown', onDocument);
    field.addEventListener('keydown', onField);

    const dispatcher = createBackDispatcher();
    const handler = jest.fn(() => true);
    dispatcher.register(handler, { name: 'handler' });
    const uninstall = dispatcher.install(window);

    const back = keydown(461);
    field.dispatchEvent(back);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(back.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);

    field.dispatchEvent(keydown(13));
    expect(seen).toEqual(['field:13', 'document:13', 'window:13']);
    expect(handler).toHaveBeenCalledTimes(1);

    uninstall();
    window.removeEventListener('keydown', onWindow);
    document.removeEventListener('keydown', onDocument);
});
