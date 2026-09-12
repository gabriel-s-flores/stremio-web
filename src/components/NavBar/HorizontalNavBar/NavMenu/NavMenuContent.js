// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { default: ExternalLink } = require('stremio/components/ExternalLink');
const { useNavigate } = require('react-router');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { useCore } = require('stremio/core');
const { Button } = require('stremio/components');
const { useFullscreen } = require('stremio/common/Fullscreen');
const useProfile = require('stremio/common/useProfile');
const usePWA = require('stremio/common/usePWA');
const { default: usePlayUrl } = require('stremio/common/usePlayUrl');
const useToast = require('stremio/common/Toast/useToast');
const { withCoreSuspender } = require('stremio/common/CoreSuspender');
const useStreamingServer = require('stremio/common/useStreamingServer');
const { usePlatform } = require('stremio/common/Platform');
const { readTextFromClipboard } = require('stremio/common/clipboard');
const PlayUrlModal = require('stremio/components/PlayUrlModal');
const styles = require('./styles');

const NavMenuContent = ({ onClick }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const core = useCore();
    const profile = useProfile();
    const platform = usePlatform();
    const streamingServer = useStreamingServer();
    const { handlePlayUrl } = usePlayUrl();
    const toast = useToast();
    const [manualPlayOpen, setManualPlayOpen] = React.useState(false);
    const [fullscreen, requestFullscreen, exitFullscreen, , supported] = useFullscreen();
    const [, isAndroidPWA] = usePWA();
    const streamingServerWarningDismissed = React.useMemo(() => {
        return streamingServer.settings !== null && streamingServer.settings.type === 'Ready' || (
            !isNaN(profile.settings.streamingServerWarningDismissed.getTime()) &&
            profile.settings.streamingServerWarningDismissed.getTime() > Date.now()
        );
    }, [profile.settings, streamingServer.settings]);
    const logoutButtonOnClick = React.useCallback(() => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'Logout'
            }
        });
    }, []);
    const closeManualPlay = React.useCallback(() => {
        setManualPlayOpen(false);
    }, []);
    const onPlayMagnetLinkClick = React.useCallback(async () => {
        try {
            const clipboardText = await readTextFromClipboard();
            const handled = await handlePlayUrl(clipboardText);
            if (!handled) {
                toast.show({
                    type: 'error',
                    title: t('CLIPBOARD_PLAY_INVALID', { defaultValue: 'Clipboard does not contain a valid URL or magnet link.' }),
                    timeout: 5000
                });
            }
        } catch (_) {
            // webOS Chromium 68 usually lacks clipboard-read; open the editable
            // manual fallback instead of failing silently. Desktop keeps the
            // previous behaviour (no modal, no value in logs).
            if (platform.name === 'webos') {
                setManualPlayOpen(true);
            }
        }
    }, [handlePlayUrl, platform.name, t, toast]);
    const handleAuth = React.useCallback(() => {
        return profile.auth !== null
            ? logoutButtonOnClick()
            : navigate('/intro');
    }, [profile.auth, logoutButtonOnClick, navigate]);

    return (
        <React.Fragment>
            <div className={classnames(styles['nav-menu-container'], 'animation-fade-in', { [styles['with-warning']]: !streamingServerWarningDismissed } )} onClick={onClick}>
                <div className={styles['user-info-container']}>
                    <div
                        className={styles['avatar-container']}
                        style={{
                            backgroundImage: profile.auth === null ?
                                `url('${require('/assets/images/anonymous.png')}')`
                                :
                                profile.auth.user.avatar ?
                                    `url('${profile.auth.user.avatar}')`
                                    :
                                    `url('${require('/assets/images/default_avatar.png')}')`
                        }}
                    />
                    <div className={styles['user-info-details']}>
                        <div className={styles['email-container']}>
                            <div className={styles['email-label']}>{profile.auth === null ? t('ANONYMOUS_USER') : profile.auth.user.email}</div>
                        </div>
                        <Button className={styles['logout-button-container']} title={profile.auth === null ? `${t('LOG_IN')} / ${t('SIGN_UP')}` : t('LOG_OUT')} onClick={handleAuth}>
                            <div className={styles['logout-label']}>{profile.auth === null ? `${t('LOG_IN')} / ${t('SIGN_UP')}` : t('LOG_OUT')}</div>
                        </Button>
                    </div>
                </div>
                {
                    supported && !isAndroidPWA ?
                        <div className={styles['nav-menu-section']}>
                            <Button className={styles['nav-menu-option-container']} title={fullscreen ? t('EXIT_FULLSCREEN') : t('ENTER_FULLSCREEN')} onClick={fullscreen ? exitFullscreen : requestFullscreen}>
                                <Icon className={styles['icon']} name={fullscreen ? 'minimize' : 'maximize'} />
                                <div className={styles['nav-menu-option-label']}>{fullscreen ? t('EXIT_FULLSCREEN') : t('ENTER_FULLSCREEN')}</div>
                            </Button>
                        </div>
                        :
                        null
                }
                <div className={styles['nav-menu-section']}>
                    <Button className={styles['nav-menu-option-container']} title={ t('SETTINGS') } href={'#/settings'}>
                        <Icon className={styles['icon']} name={'settings'} />
                        <div className={styles['nav-menu-option-label']}>{ t('SETTINGS') }</div>
                    </Button>
                    <Button className={styles['nav-menu-option-container']} title={ t('ADDONS') } href={'#/addons'}>
                        <Icon className={styles['icon']} name={'addons-outline'} />
                        <div className={styles['nav-menu-option-label']}>{ t('ADDONS') }</div>
                    </Button>
                    <Button className={styles['nav-menu-option-container']} title={ t('PLAY_URL_MAGNET_LINK') } onClick={onPlayMagnetLinkClick}>
                        <Icon className={styles['icon']} name={'magnet-link'} />
                        <div className={styles['nav-menu-option-label']}>{ t('PLAY_URL_MAGNET_LINK') }</div>
                    </Button>
                    <ExternalLink className={styles['nav-menu-option-container']} title={ t('HELP_FEEDBACK') } href={'https://stremio.zendesk.com/'} target={'_blank'}>
                        <Icon className={styles['icon']} name={'help'} />
                        <div className={styles['nav-menu-option-label']}>{ t('HELP_FEEDBACK') }</div>
                    </ExternalLink>
                </div>
                <div className={styles['nav-menu-section']}>
                    <ExternalLink className={styles['nav-menu-option-container']} title={ t('TERMS_OF_SERVICE') } href={'https://www.stremio.com/tos'} target={'_blank'}>
                        <div className={styles['nav-menu-option-label']}>{ t('TERMS_OF_SERVICE') }</div>
                    </ExternalLink>
                    <ExternalLink className={styles['nav-menu-option-container']} title={ t('PRIVACY_POLICY') } href={'https://www.stremio.com/privacy'} target={'_blank'}>
                        <div className={styles['nav-menu-option-label']}>{ t('PRIVACY_POLICY') }</div>
                    </ExternalLink>
                    {
                        profile.auth !== null ?
                            <ExternalLink className={styles['nav-menu-option-container']} title={ t('USER_PANEL') } href={'https://www.stremio.com/acc-settings'} target={'_blank'}>
                                <div className={styles['nav-menu-option-label']}>{ t('USER_PANEL') }</div>
                            </ExternalLink>
                            :
                            null
                    }
                </div>
            </div>
            {
                manualPlayOpen ?
                    <PlayUrlModal
                        initialValue={''}
                        onSubmit={handlePlayUrl}
                        onClose={closeManualPlay}
                    />
                    :
                    null
            }
        </React.Fragment>
    );
};

NavMenuContent.propTypes = {
    onClick: PropTypes.func
};

const NavMenuContentFallback = () => (
    <div className={styles['nav-menu-container']} />
);

module.exports = withCoreSuspender(NavMenuContent, NavMenuContentFallback);
