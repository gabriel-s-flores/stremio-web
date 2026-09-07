import React, { useEffect, useState } from 'react';
import styles from './DebugPage.less';

const LABELS = {
    title: 'webOS diagnostics',
    environment: 'Environment',
    userAgent: 'User agent',
    origin: 'Origin',
    protocol: 'Protocol',
    viewport: 'Viewport',
    version: 'Version',
    commit: 'Commit',
    memoryApi: 'Memory API',
    timing: 'Timing',
    firstPaint: 'First paint',
    firstContentfulPaint: 'First contentful paint',
    appRender: 'App render',
    coreReady: 'Core ready',
    boardVisible: 'Board visible',
    boardInteractive: 'Board interactive',
    memory: 'Memory',
    currentHeap: 'Current JS heap',
    peakHeap: 'Peak JS heap',
    heapLimit: 'JS heap limit',
    fps: 'Scroll FPS',
    averageFps: 'Average FPS',
    p95Frame: 'P95 frame',
    frames: 'Frames',
    scrollEvents: 'Scroll events',
    running: 'Running',
    player: 'Player',
    implementation: 'Implementation',
    implementationHistory: 'Implementation history',
    available: 'Available',
    unavailable: 'Unavailable',
    refresh: 'Refresh',
    startFps: 'Start 10s FPS sample',
    stopFps: 'Stop FPS sample',
    notRun: 'Not measured',
    yes: 'Yes',
    no: 'No',
};

const diagnostics = typeof window !== 'undefined' ? window.__stremioWebosDebug : null;

const formatMilliseconds = (value: number | null | undefined) => {
    return typeof value === 'number' ? `${value.toFixed(0)} ms` : LABELS.unavailable;
};

const formatBytes = (value: number | null | undefined) => {
    if (typeof value !== 'number') {
        return LABELS.unavailable;
    }

    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
};

const formatNumber = (value: number | null | undefined, digits = 1) => {
    return typeof value === 'number' ? value.toFixed(digits) : LABELS.unavailable;
};

const Metric = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className={styles['metric']}>
        <dt>{label}</dt>
        <dd>{value}</dd>
    </div>
);

const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <section className={styles['section']}>
        <h2>{title}</h2>
        <dl>{children}</dl>
    </section>
);

const getSnapshot = (): WebosDiagnosticsSnapshot | null => {
    return diagnostics ? diagnostics.getSnapshot() : null;
};

const DebugPage = () => {
    const [snapshot, setSnapshot] = useState<WebosDiagnosticsSnapshot | null>(getSnapshot);

    useEffect(() => {
        if (!diagnostics) {
            return undefined;
        }

        const update = () => setSnapshot(diagnostics.getSnapshot());
        const unsubscribe = diagnostics.subscribe(update);
        update();
        return unsubscribe;
    }, []);

    const refresh = () => {
        setSnapshot(diagnostics ? diagnostics.refresh() : null);
    };

    const startFps = () => {
        if (diagnostics) {
            diagnostics.startFps();
            setSnapshot(diagnostics.getSnapshot());
        }
    };

    const stopFps = () => {
        if (diagnostics) {
            diagnostics.stopFps();
            setSnapshot(diagnostics.getSnapshot());
        }
    };

    if (!snapshot) {
        return (
            <main className={styles['debug-container']}>
                <div className={styles['debug-content']}>
                    <h1>{LABELS.title}</h1>
                    <p>{LABELS.unavailable}</p>
                </div>
            </main>
        );
    }

    const environment = snapshot.environment;
    const paints = snapshot.paints;
    const marks = snapshot.marks;
    const currentMemory = snapshot.memory.current;
    const peakMemory = snapshot.memory.peak;

    return (
        <main className={styles['debug-container']}>
            <div className={styles['debug-content']}>
                <header className={styles['header']}>
                    <div>
                        <h1>{LABELS.title}</h1>
                        <p>{snapshot.capturedAt}</p>
                    </div>
                    <div className={styles['actions']}>
                        <button type={'button'} onClick={refresh}>{LABELS.refresh}</button>
                        <button type={'button'} onClick={startFps}>{LABELS.startFps}</button>
                        <button type={'button'} onClick={stopFps}>{LABELS.stopFps}</button>
                    </div>
                </header>

                <Section title={LABELS.environment}>
                    <Metric label={LABELS.userAgent} value={environment.userAgent || LABELS.unavailable} />
                    <Metric label={LABELS.origin} value={environment.origin || LABELS.unavailable} />
                    <Metric label={LABELS.protocol} value={environment.protocol || LABELS.unavailable} />
                    <Metric
                        label={LABELS.viewport}
                        value={environment.viewport ? `${environment.viewport.width} x ${environment.viewport.height} @${environment.viewport.devicePixelRatio}` : LABELS.unavailable}
                    />
                    <Metric label={LABELS.version} value={environment.version || LABELS.unavailable} />
                    <Metric label={LABELS.commit} value={environment.commit || LABELS.unavailable} />
                    <Metric label={LABELS.memoryApi} value={environment.performanceMemoryAvailable ? LABELS.available : LABELS.unavailable} />
                </Section>

                <Section title={LABELS.timing}>
                    <Metric label={LABELS.firstPaint} value={formatMilliseconds(paints['first-paint'])} />
                    <Metric label={LABELS.firstContentfulPaint} value={formatMilliseconds(paints['first-contentful-paint'])} />
                    <Metric label={LABELS.appRender} value={formatMilliseconds(marks['app-render'])} />
                    <Metric label={LABELS.coreReady} value={formatMilliseconds(marks['core-ready'])} />
                    <Metric label={LABELS.boardVisible} value={formatMilliseconds(marks['board-visible'])} />
                    <Metric label={LABELS.boardInteractive} value={formatMilliseconds(marks['board-interactive'])} />
                </Section>

                <Section title={LABELS.memory}>
                    <Metric label={LABELS.currentHeap} value={formatBytes(currentMemory && currentMemory.usedJSHeapSize)} />
                    <Metric label={LABELS.peakHeap} value={formatBytes(peakMemory && peakMemory.usedJSHeapSize)} />
                    <Metric label={LABELS.heapLimit} value={formatBytes(currentMemory && currentMemory.jsHeapSizeLimit)} />
                </Section>

                <Section title={LABELS.fps}>
                    <Metric label={LABELS.averageFps} value={formatNumber(snapshot.fps.averageFps)} />
                    <Metric label={LABELS.p95Frame} value={formatMilliseconds(snapshot.fps.p95FrameMs)} />
                    <Metric label={LABELS.frames} value={snapshot.fps.frames || LABELS.notRun} />
                    <Metric label={LABELS.scrollEvents} value={snapshot.fps.scrollEvents || LABELS.notRun} />
                    <Metric label={LABELS.running} value={snapshot.fps.running ? LABELS.yes : LABELS.no} />
                </Section>

                <Section title={LABELS.player}>
                    <Metric label={LABELS.implementation} value={snapshot.player.implementation || LABELS.unavailable} />
                    <Metric label={LABELS.implementationHistory} value={snapshot.player.history.join(' -> ') || LABELS.unavailable} />
                </Section>

                <pre className={styles['json']}>{JSON.stringify(snapshot, null, 2)}</pre>
            </div>
        </main>
    );
};

export default DebugPage;
