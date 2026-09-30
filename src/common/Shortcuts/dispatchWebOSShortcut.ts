import type { ShortcutListener, ShortcutName } from './Shortcuts';

type ShortcutDispatcher = (name: ShortcutName, combo: number, key: string) => boolean | void;

const dispatchWebOSShortcut = (
    event: Pick<KeyboardEvent, 'preventDefault' | 'stopPropagation'>,
    name: ShortcutName,
    listeners: Set<ShortcutListener> | ShortcutListener[] | undefined,
    onShortcut: ShortcutDispatcher,
) => {
    let handled = false;

    if (name !== 'Back') {
        Array.from(listeners ?? []).forEach((listener) => {
            if (listener(0, name) === true) handled = true;
        });
    }

    if (onShortcut(name, 0, name) === true) handled = true;

    if (handled) {
        event.preventDefault();
        event.stopPropagation();
    }

    return handled;
};

export default dispatchWebOSShortcut;
