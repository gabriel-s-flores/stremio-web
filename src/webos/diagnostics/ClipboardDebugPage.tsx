import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../../components/Button';
import { usePlatform } from '../../common/Platform';
import { writeTextToClipboard, readTextFromClipboard, copyTextBySelection } from '../../common/clipboard';
import ClipboardFallbackModal from '../../components/ClipboardFallbackModal';
import PlayUrlModal from '../../components/PlayUrlModal';
import styles from './DebugPage.less';
import linkStyles from './ExternalLinksDebugPage.less';

const FALLBACK_VALUE = 'https://example.org/t39?copy=1';
const HTTP_SAMPLE = 'https://example.org/t39?play=1';

const LABELS = {
    title: 'T3.9 Clipboard fallbacks',
    instructions: 'Exercise copy/read fallbacks without booting the core. Works on hosted HTTP and packaged file://.',
    writeAvailable: 'Write available',
    writeMissingApi: 'Write missing API',
    writeMissingMethod: 'Write missing method',
    writeSync: 'Write sync throw',
    writeReject: 'Write reject',
    readAvailable: 'Read available',
    readMissingApi: 'Read missing API',
    readMissingMethod: 'Read missing method',
    readSync: 'Read sync throw',
    readReject: 'Read reject',
    readInvalid: 'Read invalid',
    selectionApproved: 'Selection approved',
    selectionDenied: 'Selection denied',
    selectionMissing: 'Selection missing',
    fallbackOpen: 'Open fallback',
    playOpen: 'Open play modal',
};

const isHttpOrMagnet = (value: string) => {
    if (/^https?:\/\/.+/i.test(value)) return true;
    if (/^magnet:\?xt=urn:btih:[a-z0-9]{40}/i.test(value)) return true;
    return false;
};

const ClipboardDebugPage = () => {
    const platform = usePlatform();
    const [log, setLog] = useState<string[]>([]);
    const [fallbackValue, setFallbackValue] = useState<string | null>(null);
    const [playOpen, setPlayOpen] = useState(false);
    const [playResult, setPlayResult] = useState('');
    const [visibility, setVisibility] = useState<string[]>([]);
    const [unhandled, setUnhandled] = useState(0);
    const savedClipboard = useRef<unknown>(null);
    const savedExec = useRef<unknown>(null);

    useEffect(() => {
        setVisibility((history) => [...history, platform.webos.hidden ? 'hidden' : 'visible']);
    }, [platform.webos.hidden]);

    useEffect(() => {
        const onUnhandled = () => setUnhandled((count) => count + 1);
        window.addEventListener('unhandledrejection', onUnhandled);
        return () => window.removeEventListener('unhandledrejection', onUnhandled);
    }, []);

    useEffect(() => {
        try {
            savedClipboard.current = (navigator as unknown as { clipboard?: unknown }).clipboard;
        } catch (_) {
            savedClipboard.current = null;
        }
        try {
            savedExec.current = (document as unknown as { execCommand?: unknown }).execCommand;
        } catch (_) {
            savedExec.current = null;
        }
    }, []);

    const push = useCallback((line: string) => {
        setLog((lines) => [...lines, line]);
    }, []);

    const restoreClipboard = useCallback(() => {
        try {
            if (savedClipboard.current) {
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: savedClipboard.current });
            } else {
                try {
                    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
                } catch (_) {
                    // Best effort only.
                }
            }
        } catch (_) {
            // Best effort only.
        }
        try {
            if (typeof savedExec.current === 'function') {
                (document as unknown as { execCommand: unknown }).execCommand = savedExec.current;
            } else {
                try {
                    delete (document as unknown as { execCommand?: unknown }).execCommand;
                } catch (_) {
                    // Best effort only.
                }
            }
        } catch (_) {
            // Best effort only.
        }
    }, []);

    const runWrite = useCallback(async (mode: string) => {
        const tag = `write:${mode}`;
        try {
            if (mode === 'available') {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: () => Promise.resolve(undefined) },
                });
            } else if (mode === 'missing-api') {
                try {
                    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
                } catch (_) {
                    // Best effort only.
                }
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
            } else if (mode === 'missing-method') {
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} });
            } else if (mode === 'sync') {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: () => { throw new Error('sync'); } },
                });
            } else if (mode === 'reject') {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: () => Promise.reject(new Error('async')) },
                });
            }
            await writeTextToClipboard(FALLBACK_VALUE);
            push(`${tag}:resolved`);
        } catch (_) {
            push(`${tag}:rejected`);
            if (mode !== 'available') {
                setFallbackValue(FALLBACK_VALUE);
            }
        } finally {
            restoreClipboard();
        }
    }, [push, restoreClipboard]);

    const runRead = useCallback(async (mode: string) => {
        const tag = `read:${mode}`;
        try {
            if (mode === 'available') {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { readText: () => Promise.resolve(HTTP_SAMPLE) },
                });
            } else if (mode === 'missing-api') {
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
            } else if (mode === 'missing-method') {
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} });
            } else if (mode === 'sync') {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { readText: () => { throw new Error('sync'); } },
                });
            } else if (mode === 'reject') {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { readText: () => Promise.reject(new Error('async')) },
                });
            } else if (mode === 'invalid') {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { readText: () => Promise.resolve(42 as unknown as string) },
                });
            }
            const value = await readTextFromClipboard();
            push(`${tag}:resolved:${value}`);
        } catch (_) {
            push(`${tag}:rejected`);
        } finally {
            restoreClipboard();
        }
    }, [push, restoreClipboard]);

    const runSelection = useCallback((mode: string) => {
        const input = document.createElement('input');
        input.value = FALLBACK_VALUE;
        document.body.appendChild(input);
        try {
            if (mode === 'approved') {
                (document as unknown as { execCommand: (command: string) => boolean }).execCommand = () => true;
            } else if (mode === 'denied') {
                (document as unknown as { execCommand: (command: string) => boolean }).execCommand = () => false;
            } else if (mode === 'missing') {
                try {
                    delete (document as unknown as { execCommand?: unknown }).execCommand;
                } catch (_) {
                    (document as unknown as { execCommand: unknown }).execCommand = undefined;
                }
            }
            const result = copyTextBySelection(input);
            push(`selection:${mode}:${result ? 'true' : 'false'}`);
        } finally {
            try {
                document.body.removeChild(input);
            } catch (_) {
                // Best effort only.
            }
            restoreClipboard();
        }
    }, [push, restoreClipboard]);

    const openFallback = useCallback(() => {
        setFallbackValue(FALLBACK_VALUE);
        push('fallback:opened');
    }, [push]);

    const closeFallback = useCallback(() => {
        setFallbackValue(null);
        push('fallback:closed');
    }, [push]);

    const openPlay = useCallback(() => {
        setPlayResult('');
        setPlayOpen(true);
        push('play:opened');
    }, [push]);

    const closePlay = useCallback(() => {
        setPlayOpen(false);
        push('play:closed');
    }, [push]);

    const submitPlay = useCallback(async (value: string) => {
        const handled = isHttpOrMagnet(value);
        if (handled) {
            setPlayResult(`handled:${value.startsWith('magnet:') ? 'magnet' : 'http'}`);
        } else {
            setPlayResult('invalid');
        }
        push(`play:submit:${handled ? 'handled' : 'invalid'}`);
        return handled;
    }, [push]);

    return (
        <div className={styles['debug-container']}>
            <h1>{LABELS.title}</h1>
            <p>{LABELS.instructions}</p>
            <p data-test={'platform'}>{platform.name}</p>
            <p data-test={'visibility'}>{visibility.join(' → ')}</p>
            <p data-test={'unhandled'}>{`unhandled:${unhandled}`}</p>
            <p data-test={'play-result'}>{playResult}</p>
            <div className={linkStyles['actions']}>
                <Button data-test={'write-available'} onClick={() => runWrite('available')}>{LABELS.writeAvailable}</Button>
                <Button data-test={'write-missing-api'} onClick={() => runWrite('missing-api')}>{LABELS.writeMissingApi}</Button>
                <Button data-test={'write-missing-method'} onClick={() => runWrite('missing-method')}>{LABELS.writeMissingMethod}</Button>
                <Button data-test={'write-sync'} onClick={() => runWrite('sync')}>{LABELS.writeSync}</Button>
                <Button data-test={'write-reject'} onClick={() => runWrite('reject')}>{LABELS.writeReject}</Button>
                <Button data-test={'read-available'} onClick={() => runRead('available')}>{LABELS.readAvailable}</Button>
                <Button data-test={'read-missing-api'} onClick={() => runRead('missing-api')}>{LABELS.readMissingApi}</Button>
                <Button data-test={'read-missing-method'} onClick={() => runRead('missing-method')}>{LABELS.readMissingMethod}</Button>
                <Button data-test={'read-sync'} onClick={() => runRead('sync')}>{LABELS.readSync}</Button>
                <Button data-test={'read-reject'} onClick={() => runRead('reject')}>{LABELS.readReject}</Button>
                <Button data-test={'read-invalid'} onClick={() => runRead('invalid')}>{LABELS.readInvalid}</Button>
                <Button data-test={'selection-approved'} onClick={() => runSelection('approved')}>{LABELS.selectionApproved}</Button>
                <Button data-test={'selection-denied'} onClick={() => runSelection('denied')}>{LABELS.selectionDenied}</Button>
                <Button data-test={'selection-missing'} onClick={() => runSelection('missing')}>{LABELS.selectionMissing}</Button>
                <Button data-test={'fallback-open'} onClick={openFallback}>{LABELS.fallbackOpen}</Button>
                <Button data-test={'play-open'} onClick={openPlay}>{LABELS.playOpen}</Button>
            </div>
            <pre data-test={'log'}>{log.join('\n')}</pre>
            {
                fallbackValue !== null ?
                    <ClipboardFallbackModal value={fallbackValue} onClose={closeFallback} />
                    :
                    null
            }
            {
                playOpen ?
                    <PlayUrlModal initialValue={''} onSubmit={submitPlay} onClose={closePlay} />
                    :
                    null
            }
        </div>
    );
};

export default ClipboardDebugPage;
