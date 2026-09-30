// Copyright (C) 2017-2024 Smart code 203358507

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import classnames from 'classnames';
import { Button, ExternalLink } from 'stremio/components';
import { useCore } from 'stremio/core';
import useProfile from 'stremio/common/useProfile';
import { useNavigate } from 'react-router';
import { usePlatform } from 'stremio/common';
import { withCoreSuspender } from 'stremio/common/CoreSuspender';
import styles from './StreamingServerWarning.less';

type Props = {
    className?: string;
};

const StreamingServerWarning = ({ className }: Props) => {
    const { t } = useTranslation();
    const core = useCore();
    const platform = usePlatform();
    const navigate = useNavigate();
    const profile = useProfile();

    const createDismissalDate = (months: number, years = 0): Date => {
        const dismissalDate = new Date();

        if (months) {
            dismissalDate.setMonth(dismissalDate.getMonth() + months);
        }
        if (years) {
            dismissalDate.setFullYear(dismissalDate.getFullYear() + years);
        }

        return dismissalDate;
    };

    const updateSettings = useCallback((streamingServerWarningDismissed: Date) => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'UpdateSettings',
                args: {
                    ...profile.settings,
                    streamingServerWarningDismissed
                }
            }
        });
    }, [profile.settings]);

    const onLater = useCallback(() => {
        updateSettings(createDismissalDate(1));
    }, [updateSettings]);

    const onDismiss = useCallback(() => {
        updateSettings(createDismissalDate(0, 50));
    }, [updateSettings]);

    return (
        <div className={classnames(className, styles['warning-container'])}>
            <div className={styles['warning-statement']}>
                {t(platform.name === 'webos' ? 'TV_STREAMING_WARNING' : 'SETTINGS_SERVER_UNAVAILABLE')}
            </div>
            <div className={styles['actions']}>
                {platform.name === 'webos' ?
                    <Button className={styles['action']} onClick={() => navigate('/settings?section=streaming')}>
                        <div className={styles['label']}>{t('TV_STREAMING_CONFIGURE')}</div>
                    </Button> : <ExternalLink
                        href='https://www.stremio.com/download-service'
                        target='_blank'
                        rel='noreferrer'
                        className={styles['action']}
                        title={t('SERVICE_INSTALL')}
                    >
                        <div className={styles['label']}>
                            {t('SERVICE_INSTALL')}
                        </div>
                    </ExternalLink>}
                <Button
                    className={styles['action']}
                    title={t('WARNING_STREAMING_SERVER_LATER')}
                    onClick={onLater}
                    tabIndex={-1}
                >
                    <div className={styles['label']}>
                        {t('WARNING_STREAMING_SERVER_LATER')}
                    </div>
                </Button>
                <Button
                    className={styles['action']}
                    title={t('DONT_SHOW_AGAIN')}
                    onClick={onDismiss}
                    tabIndex={-1}
                >
                    <div className={styles['label']}>
                        {t('DONT_SHOW_AGAIN')}
                    </div>
                </Button>
            </div>
        </div>
    );
};

export default withCoreSuspender(StreamingServerWarning);
