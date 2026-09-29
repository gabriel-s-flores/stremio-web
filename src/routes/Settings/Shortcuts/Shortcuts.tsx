import React, { forwardRef, useState } from 'react';
import { Section } from '../components';
import { useTranslation } from 'react-i18next';
import { Button, ShortcutsGroup } from 'stremio/components';
import { useShortcuts } from 'stremio/common';
import styles from './Shortcuts.less';

const RemoteControlHelp = process.env.WEBOS ? require('stremio/components/RemoteControlHelp/RemoteControlHelp').default : null;
const ShortcutsModal = process.env.WEBOS ? require('stremio/App/ShortcutsModal').default : null;

const Shortcuts = forwardRef<HTMLDivElement>((_, ref) => {
    const { grouped } = useShortcuts();
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    return (
        <Section ref={ref} label={process.env.WEBOS ? 'TV_REMOTE_TITLE' : 'SETTINGS_NAV_SHORTCUTS'}>
            {
                process.env.WEBOS ? <>
                    <Button onClick={() => setOpen(true)}>{t('TV_REMOTE_OPEN')}</Button>
                    <RemoteControlHelp />
                    {open && <ShortcutsModal onClose={() => setOpen(false)} />}
                </> : grouped.map(({ name, label, shortcuts }) => (
                    <ShortcutsGroup
                        key={name}
                        className={styles['shortcuts-group']}
                        label={label}
                        shortcuts={shortcuts}
                    />
                ))
            }
        </Section>
    );
});

export default Shortcuts;
