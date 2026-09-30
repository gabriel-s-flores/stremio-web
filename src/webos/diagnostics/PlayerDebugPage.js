// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const classnames = require('classnames');
const ControlBar = require('stremio/routes/Player/ControlBar');
const NextVideoPopup = require('stremio/routes/Player/NextVideoPopup');
const StatisticsMenu = require('stremio/routes/Player/StatisticsMenu');
const OptionsMenu = require('stremio/routes/Player/OptionsMenu');
const SubtitlesMenu = require('stremio/routes/Player/SubtitlesMenu');
const SpeedMenu = require('stremio/routes/Player/SpeedMenu');
const { default: AudioMenu } = require('stremio/routes/Player/AudioMenu');
const { default: CastDevicesMenu } = require('stremio/routes/Player/CastDevicesMenu');
const { default: SideDrawer } = require('stremio/routes/Player/SideDrawer');
const { default: SideDrawerButton } = require('stremio/routes/Player/SideDrawerButton');
const playerStyles = require('stremio/routes/Player/styles.less');
const styles = require('./PlayerDebugPage.less');

const FIXTURE_IMAGE = '/images/empty.png';
const FIXTURE_STREAM_URL = 'https://filesamples.com/samples/video/mp4/sample_640x360.mp4';
const FIXTURE_LABEL = 'webOS Player fixture';
const NOOP = () => null;

const STREAM = {
    name: 'webOS Player Fixture',
    description: 'Static stream data for the webOS Player menu smoke test.',
    url: FIXTURE_STREAM_URL,
    infoHash: '0123456789abcdef0123456789abcdef01234567',
    fileIdx: 0,
    deepLinks: {
        player: '#/debug/player',
        externalPlayer: {
            streaming: 'http://127.0.0.1:11470/fixture.mp4',
            download: 'https://example.com/fixture.mp4',
            magnet: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
        },
    },
};

const videoDeepLinks = (id) => ({
    metaDetailsStreams: `#/debug/player/${id}`,
    player: '#/debug/player',
    externalPlayer: null,
});

const META_ITEM = {
    type: 'series',
    id: 'webos-player-fixture',
    name: 'webOS Player Fixture',
    title: 'webOS Player Fixture',
    poster: FIXTURE_IMAGE,
    background: FIXTURE_IMAGE,
    runtime: '2h 00m',
    releaseInfo: '2026',
    released: new Date('2026-01-01T00:00:00.000Z'),
    description: 'Static metadata used to exercise the TV Player overlays.',
    links: [],
    videos: [
        {
            id: 'webos-player-fixture-1',
            title: 'Fixture episode one',
            thumbnail: FIXTURE_IMAGE,
            season: 1,
            episode: 1,
            released: new Date('2026-01-01T00:00:00.000Z'),
            watched: false,
            progress: 25,
            upcoming: false,
            scheduled: false,
            deepLinks: videoDeepLinks('webos-player-fixture-1'),
        },
        {
            id: 'webos-player-fixture-2',
            title: 'Fixture episode two',
            thumbnail: FIXTURE_IMAGE,
            season: 1,
            episode: 2,
            released: new Date('2026-02-01T00:00:00.000Z'),
            watched: false,
            progress: 0,
            upcoming: false,
            scheduled: false,
            deepLinks: videoDeepLinks('webos-player-fixture-2'),
        },
        {
            id: 'webos-player-fixture-3',
            title: 'Fixture episode three',
            thumbnail: FIXTURE_IMAGE,
            season: 2,
            episode: 1,
            released: new Date('2026-03-01T00:00:00.000Z'),
            watched: false,
            progress: 0,
            upcoming: true,
            scheduled: false,
            deepLinks: videoDeepLinks('webos-player-fixture-3'),
        },
    ],
};

const NEXT_VIDEO = {
    ...META_ITEM.videos[1],
    watched: false,
};

const SUBTITLES_TRACKS = [
    {
        id: 'embedded-en',
        lang: 'eng',
        origin: 'EMBEDDED',
        label: 'English',
        embedded: true,
        ass: false,
    },
];

const EXTRA_SUBTITLES_TRACKS = [
    {
        id: 'external-en',
        lang: 'eng',
        origin: 'Fixture subtitles',
        label: 'English (external)',
        url: 'https://example.com/fixture.vtt',
        fallbackUrl: 'https://example.com/fixture.vtt',
        embedded: false,
        exclusive: false,
        ass: false,
    },
];

const AUDIO_TRACKS = [
    { id: 'audio-en', lang: 'eng', label: 'English stereo' },
    { id: 'audio-jp', lang: 'jpn', label: 'Japanese stereo' },
];

const PLAYBACK_DEVICES = [
    { id: 'fixture-vlc', name: 'Fixture VLC', type: 'external' },
];

const CAST_DEVICES = [
    { id: 'fixture-tv', name: 'Fixture TV' },
];

const MENU_NAMES = {
    subtitles: 'subtitles',
    audio: 'audio',
    speed: 'speed',
    statistics: 'statistics',
    cast: 'cast',
    options: 'options',
    sideDrawer: 'side-drawer',
};

const PlayerDebugPage = () => {
    const [openMenu, setOpenMenu] = React.useState(null);
    const [paused, setPaused] = React.useState(true);
    const [muted, setMuted] = React.useState(false);
    const [volume, setVolume] = React.useState(72);
    const [playbackSpeed, setPlaybackSpeed] = React.useState(1);
    const [videoScale, setVideoScale] = React.useState('contain');

    const setMenu = React.useCallback((menu) => {
        setOpenMenu(menu);
    }, []);
    const cycleVideoScale = React.useCallback(() => {
        setVideoScale((current) => current === 'contain' ? 'cover' : current === 'cover' ? 'fill' : 'contain');
    }, []);

    const menuClassName = classnames(playerStyles['layer'], playerStyles['menu-layer']);
    const sideDrawerClassName = classnames(playerStyles['layer'], playerStyles['side-drawer-layer']);

    return (
        <div className={classnames(playerStyles['player-container'], styles['fixture'])} data-webos-player-fixture={'true'}>
            <div className={classnames(playerStyles['layer'], styles['video-layer'])}>
                <div className={styles['fixture-label']}>{FIXTURE_LABEL}</div>
            </div>

            <SideDrawerButton
                className={classnames(playerStyles['layer'], playerStyles['side-drawer-button-layer'])}
                onClick={() => setMenu(MENU_NAMES.sideDrawer)}
            />

            <ControlBar
                className={classnames(playerStyles['layer'], playerStyles['control-bar-layer'])}
                paused={paused}
                time={17}
                duration={120}
                buffered={60}
                volume={volume}
                muted={muted}
                playbackSpeed={playbackSpeed}
                subtitlesTracks={SUBTITLES_TRACKS.concat(EXTRA_SUBTITLES_TRACKS)}
                audioTracks={AUDIO_TRACKS}
                metaItem={{ type: 'Ready', content: META_ITEM }}
                nextVideo={NEXT_VIDEO}
                stream={STREAM}
                statisticsAvailable={true}
                shellCastSupported={true}
                debugCastSupported={true}
                onPlayRequested={() => setPaused(false)}
                onPauseRequested={() => setPaused(true)}
                onNextVideoRequested={NOOP}
                onMuteRequested={() => setMuted(true)}
                onUnmuteRequested={() => setMuted(false)}
                onVolumeChangeRequested={setVolume}
                onSeekRequested={NOOP}
                onToggleSubtitlesMenu={() => setMenu(MENU_NAMES.subtitles)}
                onToggleAudioMenu={() => setMenu(MENU_NAMES.audio)}
                onToggleSpeedMenu={() => setMenu(MENU_NAMES.speed)}
                onToggleSideDrawer={() => setMenu(MENU_NAMES.sideDrawer)}
                onToggleOptionsMenu={() => setMenu(MENU_NAMES.options)}
                onToggleCastDevicesMenu={() => setMenu(MENU_NAMES.cast)}
                videoScale={videoScale}
                videoScaleLabel={videoScale}
                onVideoScaleChanged={cycleVideoScale}
                onToggleStatisticsMenu={() => setMenu(MENU_NAMES.statistics)}
            />

            <NextVideoPopup
                className={menuClassName}
                metaItem={META_ITEM}
                nextVideo={NEXT_VIDEO}
                onDismiss={NOOP}
                onNextVideoRequested={NOOP}
            />

            {
                openMenu === MENU_NAMES.subtitles ?
                    <SubtitlesMenu
                        className={menuClassName}
                        subtitlesLanguage={'eng'}
                        interfaceLanguage={'eng'}
                        subtitlesTracks={SUBTITLES_TRACKS}
                        selectedSubtitlesTrackId={'embedded-en'}
                        subtitlesOffset={5}
                        subtitlesSize={100}
                        extraSubtitlesTracks={EXTRA_SUBTITLES_TRACKS}
                        selectedExtraSubtitlesTrackId={null}
                        extraSubtitlesOffset={5}
                        extraSubtitlesDelay={250}
                        extraSubtitlesSize={100}
                        assSubtitlesStylingActive={false}
                        onSubtitlesTrackSelected={NOOP}
                        onExtraSubtitlesTrackSelected={NOOP}
                        onSubtitlesOffsetChanged={NOOP}
                        onSubtitlesSizeChanged={NOOP}
                        onExtraSubtitlesOffsetChanged={NOOP}
                        onExtraSubtitlesDelayChanged={NOOP}
                        onExtraSubtitlesSizeChanged={NOOP}
                    />
                    : null
            }
            {
                openMenu === MENU_NAMES.audio ?
                    <AudioMenu
                        className={menuClassName}
                        audioTracks={AUDIO_TRACKS}
                        selectedAudioTrackId={'audio-en'}
                        onAudioTrackSelected={NOOP}
                    />
                    : null
            }
            {
                openMenu === MENU_NAMES.speed ?
                    <SpeedMenu
                        className={menuClassName}
                        playbackSpeed={playbackSpeed}
                        onPlaybackSpeedChanged={setPlaybackSpeed}
                    />
                    : null
            }
            {
                openMenu === MENU_NAMES.statistics ?
                    <StatisticsMenu
                        className={menuClassName}
                        peers={4}
                        speed={2.5}
                        completed={72}
                        infoHash={STREAM.infoHash}
                    />
                    : null
            }
            {
                openMenu === MENU_NAMES.cast ?
                    <CastDevicesMenu
                        className={menuClassName}
                        devices={CAST_DEVICES}
                        loading={false}
                        onDeviceSelected={NOOP}
                    />
                    : null
            }
            {
                openMenu === MENU_NAMES.options ?
                    <OptionsMenu
                        className={menuClassName}
                        stream={STREAM}
                        playbackDevices={PLAYBACK_DEVICES}
                        extraSubtitlesTracks={EXTRA_SUBTITLES_TRACKS}
                        selectedExtraSubtitlesTrackId={'external-en'}
                    />
                    : null
            }
            {
                openMenu === MENU_NAMES.sideDrawer ?
                    <SideDrawer
                        className={sideDrawerClassName}
                        metaItem={META_ITEM}
                        seriesInfo={{ season: 1, episode: 1 }}
                        closeSideDrawer={() => setOpenMenu(null)}
                        selected={'webos-player-fixture-1'}
                    />
                    : null
            }
        </div>
    );
};

module.exports = PlayerDebugPage;
