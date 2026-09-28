// Copyright (C) 2017-2023 Smart code 203358507

import { createElement, forwardRef, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { LongPressEventType, useLongPress } from 'use-long-press';
import styles from './Button.less';

type Props = {
    className?: string,
    style?: object,
    href?: string,
    target?: string
    download?: string,
    title?: string,
    disabled?: boolean,
    tabIndex?: number,
    children: React.ReactNode,
    onKeyDown?: (event: React.KeyboardEvent) => void,
    onBlur?: (event: React.FocusEvent<HTMLDivElement>) => void,
    onMouseDown?: (event: React.MouseEvent) => void,
    onMouseUp?: (event: React.MouseEvent) => void,
    onMouseLeave?: (event: React.MouseEvent) => void,
    onLongPress?: () => void,
    onClick?: (event: React.MouseEvent<HTMLDivElement>) => void,
    onDoubleClick?: () => void,
};

const isOKKey = (event: Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'which'>) => (
    event.key === 'Enter' || event.key === 'Accept' || event.key === 'Select' || event.key === 'OK' ||
    event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13 || event.which === 13
);

type KeyboardPress = {
    timer: ReturnType<typeof setTimeout> | null,
    longPressed: boolean,
    target: HTMLDivElement,
    onKeyUp: (event: KeyboardEvent) => void,
};

const Button = forwardRef(({ className, href, disabled, children, onLongPress, onDoubleClick, ...props }: Props, ref) => {
    const longPress = useLongPress(onLongPress!, { detect: LongPressEventType.Pointer });
    // Several legacy callers express disabled through the shared CSS class.
    const tvDisabled = !!process.env.WEBOS && (disabled || /(^|\s)disabled(\s|$)/.test(className || ''));
    const keyboardPress = useRef<KeyboardPress | null>(null);
    const onLongPressRef = useRef(onLongPress);
    onLongPressRef.current = onLongPress;

    const clearKeyboardPress = useCallback(() => {
        const press = keyboardPress.current;
        if (press === null) return;

        if (press.timer !== null) clearTimeout(press.timer);
        window.removeEventListener('keyup', press.onKeyUp, true);
        keyboardPress.current = null;
    }, []);

    useEffect(() => clearKeyboardPress, [clearKeyboardPress]);

    const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (process.env.WEBOS && (tvDisabled || event.target !== event.currentTarget)) return;
        if (process.env.WEBOS && event.repeat) {
            if (isOKKey(event)) event.preventDefault();
            return;
        }
        if (typeof props.onKeyDown === 'function') {
            props.onKeyDown(event);
        }
        if (process.env.WEBOS && event.defaultPrevented) return;

        if (process.env.WEBOS ? isOKKey(event) : event.key === 'Enter') {
            event.preventDefault();
            // @ts-expect-error: Property 'buttonClickPrevented' does not exist on type 'KeyboardEvent'.
            if (!event.nativeEvent.buttonClickPrevented) {
                if (process.env.WEBOS && typeof onLongPress === 'function') {
                    clearKeyboardPress();

                    const press: KeyboardPress = {
                        timer: null,
                        longPressed: false,
                        target: event.currentTarget,
                        onKeyUp: () => undefined,
                    };
                    press.onKeyUp = (keyUpEvent) => {
                        if (!isOKKey(keyUpEvent)) return;

                        window.removeEventListener('keyup', press.onKeyUp, true);
                        if (press.timer !== null) clearTimeout(press.timer);
                        if (keyboardPress.current !== press) return;

                        keyboardPress.current = null;
                        if (!press.longPressed && !keyUpEvent.defaultPrevented) {
                            press.target.click();
                        }
                    };
                    press.timer = setTimeout(() => {
                        if (keyboardPress.current !== press) return;
                        press.longPressed = true;
                        onLongPressRef.current?.();
                    }, 500);
                    keyboardPress.current = press;
                    window.addEventListener('keyup', press.onKeyUp, true);
                    return;
                }

                event.currentTarget.click();
            }
        }
    }, [props.onKeyDown, tvDisabled, onLongPress, clearKeyboardPress]);

    const onBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
        if (keyboardPress.current?.target === event.currentTarget && !keyboardPress.current.longPressed) {
            clearKeyboardPress();
        }
        if (typeof props.onBlur === 'function') {
            props.onBlur(event);
        }
    }, [props.onBlur, clearKeyboardPress]);

    const onMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (typeof props.onMouseDown === 'function') {
            props.onMouseDown(event);
        }

        // @ts-expect-error: Property 'buttonBlurPrevented' does not exist on type 'MouseEvent'.
        if (!event.nativeEvent.buttonBlurPrevented) {
            event.preventDefault();
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
        }
    }, [props.onMouseDown]);

    return createElement(
        typeof href === 'string' && href.length > 0 ? 'a' : 'div',
        {
            tabIndex: 0,
            ...props,
            ...(process.env.WEBOS ? { tabIndex: tvDisabled ? -1 : 0, 'aria-disabled': !!tvDisabled } : {}),
            ref,
            className: classNames(className, styles['button-container'], { 'disabled': disabled }),
            href,
            onKeyDown,
            onBlur,
            onMouseDown,
            onDoubleClick,
            ...longPress()
        },
        children
    );
});

export default Button;
