// Copyright (C) 2017-2024 Smart code 203358507

import React, { forwardRef, useCallback } from 'react';
import { type KeyboardEvent, type InputHTMLAttributes } from 'react';
import classnames from 'classnames';
import styles from './styles.less';

type Props = InputHTMLAttributes<HTMLInputElement> & {
    className?: string;
    disabled?: boolean;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onSubmit?: (event: KeyboardEvent<HTMLInputElement>) => void;
};

const TextInput = forwardRef<HTMLInputElement, Props>((props, ref) => {
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        props.onKeyDown && props.onKeyDown(event);

        if (event.key === 'Enter' && !(process.env.WEBOS && (event.repeat || props.disabled || event.defaultPrevented))) {
            if (process.env.WEBOS && props.onSubmit) event.preventDefault();
            props.onSubmit && props.onSubmit(event);
        }
    }, [props.onKeyDown, props.onSubmit, props.disabled]);

    return (
        <input
            size={1}
            autoCorrect={'off'}
            autoCapitalize={'off'}
            autoComplete={'off'}
            spellCheck={false}
            tabIndex={0}
            {...props}
            {...(process.env.WEBOS ? { tabIndex: props.disabled || props.type === 'hidden' ? -1 : 0 } : {})}
            ref={ref}
            className={classnames(props.className, styles['text-input'], { 'disabled': props.disabled })}
            onKeyDown={onKeyDown}
        />
    );
});

TextInput.displayName = 'TextInput';

export default TextInput;
