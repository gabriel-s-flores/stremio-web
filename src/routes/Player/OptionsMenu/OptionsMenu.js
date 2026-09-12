// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { usePlatform, useToast } = require('stremio/common');
const { default: usePlayOnDevice } = require('../usePlayOnDevice');
const { writeTextToClipboard } = require('stremio/common/clipboard');
const ClipboardFallbackModal = require('stremio/components/ClipboardFallbackModal');
const Option = require('./Option');
const styles = require('./styles');

const OptionsMenu = React.memo(React.forwardRef(({ className, stream, playbackDevices, extraSubtitlesTracks, selectedExtraSubtitlesTrackId }, ref) => {
    const { t } = useTranslation();
    const platform = usePlatform();
    const toast = useToast();
    const { streamingUrl, playOnDevice } = usePlayOnDevice(stream);
    const [downloadUrl, magnetUrl] = React.useMemo(() => {
        return stream !== null ?
            stream.deepLinks &&
            stream.deepLinks.externalPlayer &&
            [
                stream.deepLinks.externalPlayer.download,
                stream.deepLinks.externalPlayer.magnet,
            ]
            :
            [null, null];
    }, [stream]);
    const externalDevices = React.useMemo(() => {
        return playbackDevices.filter(({ type }) => type === 'external');
    }, [playbackDevices]);

    const subtitlesTrackUrl = React.useMemo(() => {
        const track = extraSubtitlesTracks?.find(({ id }) => id === selectedExtraSubtitlesTrackId);
        return track?.fallbackUrl ?? track?.url ?? null;
    }, [extraSubtitlesTracks, selectedExtraSubtitlesTrackId]);
    const [copyFallbackValue, setCopyFallbackValue] = React.useState(null);
    const closeCopyFallback = React.useCallback(() => {
        setCopyFallbackValue(null);
    }, []);

    const copyWithFallback = React.useCallback((value, successKey, errorKey) => {
        if (!value) {
            return;
        }
        try {
            Promise.resolve(writeTextToClipboard(value)).then(
                () => {
                    toast.show({
                        type: 'success',
                        title: 'Copied',
                        message: t(successKey),
                        timeout: 3000
                    });
                },
                () => {
                    setCopyFallbackValue(value);
                    toast.show({
                        type: 'error',
                        title: t('ERROR'),
                        message: t(errorKey),
                        timeout: 3000
                    });
                }
            ).catch(() => {
                setCopyFallbackValue(value);
            });
        } catch (_) {
            setCopyFallbackValue(value);
        }
    }, [t, toast]);

    const onCopyStreamButtonClick = React.useCallback(() => {
        if (streamingUrl || downloadUrl) {
            copyWithFallback(streamingUrl || downloadUrl, 'PLAYER_COPY_STREAM_SUCCESS', 'PLAYER_COPY_STREAM_ERROR');
        }
    }, [streamingUrl, downloadUrl, copyWithFallback]);
    const onCopyMagnetButtonClick = React.useCallback(() => {
        if (magnetUrl) {
            copyWithFallback(magnetUrl, 'PLAYER_COPY_MAGNET_LINK_SUCCESS', 'PLAYER_COPY_MAGNET_LINK_ERROR');
        }
    }, [magnetUrl, copyWithFallback]);
    const onDownloadVideoButtonClick = React.useCallback(() => {
        if (downloadUrl) {
            platform.openExternal(downloadUrl);
        }
    }, [downloadUrl]);

    const onDownloadSubtitlesClick = React.useCallback(() => {
        subtitlesTrackUrl && platform.openExternal(subtitlesTrackUrl);
    }, [subtitlesTrackUrl]);

    const onMouseDown = React.useCallback((event) => {
        event.nativeEvent.optionsMenuClosePrevented = true;
    }, []);

    return (
        <React.Fragment>
            <div ref={ref} className={classnames(className, styles['options-menu-container'])} onMouseDown={onMouseDown}>
                {
                    streamingUrl || downloadUrl ?
                        <Option
                            icon={'link'}
                            label={t('CTX_COPY_STREAM_LINK')}
                            disabled={stream === null}
                            onClick={onCopyStreamButtonClick}
                        />
                        :
                        null
                }
                {
                    magnetUrl ?
                        <Option
                            icon={'magnet-link'}
                            label={t('CTX_COPY_MAGNET_LINK')}
                            disabled={stream === null}
                            onClick={onCopyMagnetButtonClick}
                        />
                        :
                        null
                }
                {
                    downloadUrl ?
                        <Option
                            icon={'download'}
                            label={t('CTX_DOWNLOAD_VIDEO')}
                            disabled={stream === null}
                            onClick={onDownloadVideoButtonClick}
                        />
                        :
                        null
                }
                {
                    subtitlesTrackUrl ?
                        <Option
                            icon={'download'}
                            label={t('CTX_DOWNLOAD_SUBS')}
                            disabled={stream === null}
                            onClick={onDownloadSubtitlesClick}
                        />
                        :
                        null
                }
                {
                    streamingUrl && externalDevices.map(({ id, name }) => (
                        <Option
                            key={id}
                            icon={'vlc'}
                            label={t('PLAYER_PLAY_IN', { device: name })}
                            deviceId={id}
                            disabled={stream === null}
                            onClick={playOnDevice}
                        />
                    ))
                }
            </div>
            {
                copyFallbackValue !== null ?
                    <ClipboardFallbackModal
                        value={copyFallbackValue}
                        onClose={closeCopyFallback}
                    />
                    :
                    null
            }
        </React.Fragment>
    );
}));

OptionsMenu.propTypes = {
    className: PropTypes.string,
    stream: PropTypes.object,
    playbackDevices: PropTypes.array,
    extraSubtitlesTracks: PropTypes.array,
    selectedExtraSubtitlesTrackId: PropTypes.string,
};

module.exports = OptionsMenu;
