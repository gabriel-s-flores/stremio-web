import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './RemoteControlHelp.less';

// The color order matches remoteMediaKeys.js (T4.3).
export const remoteMappings = [
    ['TV_REMOTE_ARROWS', 'TV_REMOTE_NAVIGATE'],
    ['TV_REMOTE_OK', 'TV_REMOTE_SELECT'],
    ['TV_REMOTE_BACK', 'TV_REMOTE_GO_BACK'],
    ['TV_REMOTE_SEEK_KEYS', 'TV_REMOTE_SEEK'],
    ['TV_REMOTE_PLAY_KEYS', 'TV_REMOTE_PLAY'],
    ['TV_REMOTE_STOP_KEY', 'TV_REMOTE_STOP'],
    ['TV_REMOTE_RED', 'SETTINGS_SHORTCUT_MENU_SUBTITLES'],
    ['TV_REMOTE_GREEN', 'SETTINGS_SHORTCUT_MENU_AUDIO'],
    ['TV_REMOTE_YELLOW', 'TV_REMOTE_DETAILS'],
    ['TV_REMOTE_BLUE', 'SETTINGS_SHORTCUT_MENU_PLAYBACK_SPEED'],
];

const RemoteControlHelp = () => {
    const { t } = useTranslation();
    return (
        <div className={styles['help']}>
            <p>{t('TV_REMOTE_INTRO')}</p>
            {remoteMappings.map(([key, action]) => (
                <div className={styles['mapping']} tabIndex={0} key={key}>
                    <strong>{t(key)}</strong>
                    <span>{t(action)}</span>
                </div>
            ))}
            <p tabIndex={0}>{t('TV_REMOTE_OPTIONAL')}</p>
        </div>
    );
};

export default RemoteControlHelp;
