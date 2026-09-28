import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { BackHandler, RegisteredBackHandler, consumeBackEvent, dispatchBackHandlers } from './backHandlers';
import {
    getKeyboardShortcutKey,
    getKeyboardShortcutKeys,
    getWebOSShortcut,
    isBackKeyboardEvent,
    isWebOSShortcutRepeatable,
    shouldThrottleRepeatedKey,
} from './keyboard';
import dispatchWebOSShortcut from './dispatchWebOSShortcut';
import shortcuts from './shortcuts.json';

const SHORTCUTS = shortcuts.map(({ shortcuts }) => shortcuts).flat();

export type ShortcutName = string;
export type ShortcutListener = (combo: number, key: string) => boolean | void;

interface ShortcutsContext {
    grouped: ShortcutGroup[],
    on: (name: ShortcutName, listener: ShortcutListener) => void,
    off: (name: ShortcutName, listener: ShortcutListener) => void,
    registerBackHandler: (handler: BackHandler, priority: number) => () => void,
}

const ShortcutsContext = createContext<ShortcutsContext>({
    grouped: shortcuts,
    on: () => undefined,
    off: () => undefined,
    registerBackHandler: () => () => undefined,
});

type Props = {
    children: JSX.Element,
    onShortcut: (name: ShortcutName, combo: number, key: string) => boolean | void,
    backEnabled?: boolean,
};

const REPEAT_THROTTLE_MS = 130;

const isInputFocused = () => {
    const inputElements = ['INPUT', 'TEXTAREA', 'SELECT'];
    const activeElement = document.activeElement;

    return activeElement instanceof HTMLElement &&
        (inputElements.includes(activeElement.tagName) || activeElement.isContentEditable);
};

const ShortcutsProvider = ({ children, onShortcut, backEnabled = false }: Props) => {
    const listeners = useRef<Map<ShortcutName, Set<ShortcutListener>>>(new Map());
    const lastRepeatTime = useRef<Map<string, number>>(new Map());
    const backHandlers = useRef<Map<number, RegisteredBackHandler>>(new Map());
    const nextBackHandlerOrder = useRef(0);

    const registerBackHandler = useCallback((handler: BackHandler, priority: number) => {
        const order = nextBackHandlerOrder.current++;
        backHandlers.current.set(order, { handler, priority, order });

        return () => {
            backHandlers.current.delete(order);
        };
    }, []);

    const onKeyDown = useCallback((event: KeyboardEvent) => {
        const { ctrlKey, shiftKey, altKey, metaKey, key, repeat } = event;

        if (backEnabled && isBackKeyboardEvent(event)) {
            if (repeat) {
                // Holding Back closes at most one layer for this key press.
                consumeBackEvent(event);
            } else {
                dispatchBackHandlers(event, Array.from(backHandlers.current.values()));
            }
            return;
        }

        const shortcutKeys = getKeyboardShortcutKeys(event);
        const repeatKey = getKeyboardShortcutKey(event);
        const inputFocused = isInputFocused();
        const webOSShortcut = process.env.WEBOS ? getWebOSShortcut(shortcutKeys, inputFocused) : undefined;

        if (webOSShortcut === 'Back') {
            dispatchWebOSShortcut(event, webOSShortcut, [], onShortcut);
            return;
        }

        if (inputFocused) return;

        if (webOSShortcut) {
            if (repeat && !isWebOSShortcutRepeatable(webOSShortcut)) return;
            if (repeat) {
                if (shouldThrottleRepeatedKey(lastRepeatTime.current, repeatKey, Date.now(), REPEAT_THROTTLE_MS)) return;
            }

            dispatchWebOSShortcut(event, webOSShortcut, listeners.current.get(webOSShortcut), onShortcut);
            return;
        }

        if (repeat) {
            if (shouldThrottleRepeatedKey(lastRepeatTime.current, repeatKey, Date.now(), REPEAT_THROTTLE_MS)) return;
        }

        SHORTCUTS.forEach(({ name, combos }) => combos.forEach((keys) => {
            const modifers = (keys.includes('Ctrl') === ctrlKey)
                && (keys.includes('Shift') === shiftKey)
                && !altKey
                && !metaKey;
            const keyMatched = keys.some((shortcutKey) => (
                shortcutKey !== 'Ctrl'
                && shortcutKey !== 'Shift'
                && shortcutKeys.includes(shortcutKey)
            ));

            if (modifers && keyMatched) {
                const combo = combos.indexOf(keys);
                listeners.current.get(name)?.forEach((listener) => listener(combo, key));

                onShortcut(name as ShortcutName, combo, key);
            }
        }));
    }, [backEnabled, onShortcut]);

    const on = (name: ShortcutName, listener: ShortcutListener) => {
        !listeners.current.has(name) && listeners.current.set(name, new Set());
        listeners.current.get(name)!.add(listener);
    };

    const off = (name: ShortcutName, listener: ShortcutListener) => {
        listeners.current.get(name)?.delete(listener);
    };

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onKeyDown]);

    return (
        <ShortcutsContext.Provider value={{ grouped: shortcuts, on, off, registerBackHandler }}>
            {children}
        </ShortcutsContext.Provider>
    );
};

const useShortcuts = () => {
    return useContext(ShortcutsContext);
};

const useBackHandler = (handler: BackHandler, priority: number, enabled = true) => {
    const { registerBackHandler } = useShortcuts();

    useEffect(() => {
        if (!enabled) return;
        return registerBackHandler(handler, priority);
    }, [enabled, handler, priority, registerBackHandler]);
};

export {
    ShortcutsProvider,
    useShortcuts,
    useBackHandler,
};
