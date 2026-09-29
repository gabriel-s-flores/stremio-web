// Copyright (C) 2017-2023 Smart code 203358507

import React, { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { BACK_HANDLER_PRIORITIES, useBackHandler, useShortcuts } from 'stremio/common';
import { Button, ShortcutsGroup } from 'stremio/components';
import FocusLock from 'react-focus-lock';
import { useGamepad } from 'stremio/services/GamepadContext';
const FocusScope = process.env.WEBOS ? FocusLock : 'div';

import styles from './styles.less';
const RemoteControlHelp = process.env.WEBOS ? require('stremio/components/RemoteControlHelp/RemoteControlHelp').default : null;

type Props = {
    onClose: () => void,
};

const ShortcutsModal = ({ onClose }: Props) => {
    const { t } = useTranslation();
    const { grouped } = useShortcuts();
    const gamepad = useGamepad();
    useEffect(() => {
        if (!process.env.WEBOS || !gamepad) return;
        gamepad.lock('tv-help-');
        const select = () => (document.activeElement as HTMLElement)?.click();
        const move = (direction?: string) => {
            const keys: Record<string, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
            const key = keys[direction || ''];
            const codes: Record<string, number> = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
            if (key) document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: codes[key], bubbles: true }));
        };
        gamepad.on('buttonB', 'tv-help-close', onClose);
        gamepad.on('buttonA', 'tv-help-select', select);
        gamepad.on('analog', 'tv-help-move', move);
        return () => {
            gamepad.off('buttonB', 'tv-help-close');
            gamepad.off('buttonA', 'tv-help-select');
            gamepad.off('analog', 'tv-help-move');
            gamepad.unlock();
        };
    }, [gamepad, onClose]);
    const backOnRequest = useCallback(() => {
        onClose();
        return true;
    }, [onClose]);
    useBackHandler(backOnRequest, BACK_HANDLER_PRIORITIES.MODAL);

    useEffect(() => {
        const onKeyDown = ({ key }: KeyboardEvent) => {
            key === 'Escape' && onClose();
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    return createPortal((
        <FocusScope {...(process.env.WEBOS ? { returnFocus: true, autoFocus: true, lockProps: { 'data-tv-remote-help': true } } : {})} className={styles['shortcuts-modal']}>
            <div className={styles['backdrop']} onClick={onClose} />

            <div className={styles['container']}>
                <div className={styles['header']}>
                    <div className={styles['title']}>
                        {t(process.env.WEBOS ? 'TV_REMOTE_TITLE' : 'SETTINGS_NAV_SHORTCUTS')}
                    </div>

                    <Button className={styles['close-button']} title={t('BUTTON_CLOSE')} onClick={onClose}>
                        <Icon className={styles['icon']} name={'close'} />
                    </Button>
                </div>

                <div className={styles['content']}>
                    {
                        process.env.WEBOS ? <RemoteControlHelp /> : grouped.map(({ name, label, shortcuts }) => (
                            <ShortcutsGroup
                                key={name}
                                label={label}
                                shortcuts={shortcuts}
                            />
                        ))
                    }
                </div>
            </div>
        </FocusScope>
    ), document.body);
};

export default ShortcutsModal;
