// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { decodeMagnet } = require('./decodeMagnet');
const { useTranslation } = require('react-i18next');
const { useCore } = require('stremio/core');
const useToast = require('stremio/common/Toast/useToast');
const useStreamingServer = require('stremio/common/useStreamingServer');

const CREATE_TORRENT_TIMEOUT = 20000;

const useTorrent = () => {
    const core = useCore();
    const { t } = useTranslation();
    const streamingServer = useStreamingServer();
    const toast = useToast();
    const createTorrentTimeout = React.useRef(null);
    const parsingToastId = React.useRef(null);
    const clearPending = React.useCallback(() => {
        clearTimeout(createTorrentTimeout.current);
        createTorrentTimeout.current = null;
        if (parsingToastId.current !== null) toast.remove(parsingToastId.current);
        parsingToastId.current = null;
    }, [toast]);
    const reportFailure = React.useCallback(() => {
        clearPending();
        toast.show({
            type: 'error',
            title: process.env.WEBOS ? t('TV_PLAYER_NETWORK_ERROR') : 'Failed to parse magnet link. Try again.',
            timeout: 8000
        });
    }, [clearPending, toast, t]);
    const createTorrentFromMagnet = React.useCallback((text) => {
        const parsed = decodeMagnet(text);
        if (parsed && typeof parsed.infoHash === 'string') {
            clearPending();
            parsingToastId.current = toast.show({
                type: 'success',
                title: 'Loading magnet link…',
                timeout: CREATE_TORRENT_TIMEOUT
            });
            core.transport.dispatch({
                action: 'StreamingServer',
                args: {
                    action: 'CreateTorrent',
                    args: text
                }
            });
            createTorrentTimeout.current = setTimeout(reportFailure, CREATE_TORRENT_TIMEOUT);
        }
    }, [core, toast, clearPending, reportFailure]);
    React.useEffect(() => {
        if (streamingServer.torrent !== null && streamingServer.torrent !== undefined && parsingToastId.current !== null) {
            const [, { type }] = streamingServer.torrent;
            if (type === 'Ready') {
                clearPending();
            } else if (type === 'Err') {
                reportFailure();
            }
        }
    }, [streamingServer.torrent, clearPending, reportFailure]);
    React.useEffect(() => {
        return clearPending;
    }, [clearPending]);
    return {
        createTorrentFromMagnet
    };
};

module.exports = useTorrent;
