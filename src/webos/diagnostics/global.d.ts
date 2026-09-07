type WebosDiagnosticsSnapshot = {
    environment: {
        userAgent: string | null,
        origin: string | null,
        protocol: string | null,
        href: string | null,
        viewport: {
            width: number,
            height: number,
            devicePixelRatio: number,
        } | null,
        documentVisibility: DocumentVisibilityState | null,
        version: string | null,
        commit: string | null,
        performanceMemoryAvailable: boolean,
    },
    marks: Record<string, number>,
    paints: Record<string, number>,
    navigation: {
        navigationStart: number,
        domInteractive: number,
        domContentLoaded: number,
        load: number,
    } | null,
    memory: {
        current: Record<string, number> | null,
        peak: Record<string, number> | null,
    },
    fps: {
        running: boolean,
        durationMs: number,
        frames: number,
        averageFps: number | null,
        p95FrameMs: number | null,
        scrollEvents: number,
    },
    player: {
        implementation: string | null,
        history: string[],
    },
    capturedAt: string,
};

type WebosDiagnostics = {
    getSnapshot: () => WebosDiagnosticsSnapshot,
    refresh: () => WebosDiagnosticsSnapshot,
    mark: (name: string) => void,
    recordPlayerImplementation: (name: string) => void,
    startFps: (durationMs?: number) => boolean,
    stopFps: () => void,
    subscribe: (listener: () => void) => () => void,
};

declare global {
    interface Window {
        __stremioWebosDebug?: WebosDiagnostics,
    }
}

export {};
