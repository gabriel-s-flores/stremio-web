// webOS TV 4.x build only (F3.6): the diagnostics screen, opened at #/webos-diagnostics and from
// Settings. Everything it collects is read when the screen opens (and on Refresh), never at boot.
// The data comes from webos/lib/diagnostics; see the README there.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, HorizontalNavBar } from 'stremio/components';
import corePackage from '@stremio/stremio-core-web/package.json';
import { collectDiagnostics, formatReport, getRequestedVariant, setRequestedVariant } from '../../../webos/lib/diagnostics';
import styles from './WebosDiagnostics.less';

type Row = [string, string];
type Section = { id: string, title: string, rows: Row[] };
type Report = { generatedAt: string, sections: Section[] };

const REPORT_STORAGE_KEY = 'webos.diagnostics.report';
// Cards stay shorter than the screen: the spatial navigation polyfill scrolls a candidate that is
// not fully visible in 40 px steps before moving the focus, so a taller card would trap the arrows.
const MAX_ROWS_PER_CARD = 10;
const KEY_UP = 38;
const KEY_DOWN = 40;

// A developer tool for the Phase 8 session: English only, outside the translated UI (and the
// i18n scan, which looks for literal JSX text).
const LABELS = {
    title: 'Diagnostics',
    refresh: 'Refresh',
    copy: 'Copy report',
    save: 'Save report',
    collecting: 'Collecting…',
    report: 'Report (selectable text)',
};

type Card = { key: string, title: string, rows: Row[] };

const toCards = (sections: Section[]): Card[] => sections.reduce((cards: Card[], section) => {
    const count = Math.max(1, Math.ceil(section.rows.length / MAX_ROWS_PER_CARD));
    for (let index = 0; index < count; index++) {
        cards.push({
            key: section.id + ':' + index,
            title: count > 1 ? `${section.title} (${index + 1}/${count})` : section.title,
            rows: section.rows.slice(index * MAX_ROWS_PER_CARD, (index + 1) * MAX_ROWS_PER_CARD),
        });
    }
    return cards;
}, []);

const WebosDiagnostics = () => {
    const [report, setReport] = useState<Report | null>(null);
    const [reportText, setReportText] = useState('');
    const [notice, setNotice] = useState('');
    const [requested, setRequested] = useState<string | null>(() => getRequestedVariant(window.localStorage));
    const firstButtonRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLPreElement>(null);
    const mounted = useRef(true);

    const collect = useCallback(() => {
        setNotice('');
        collectDiagnostics({
            app: {
                version: process.env.VERSION,
                commit: process.env.COMMIT_HASH,
                coreVersion: corePackage.version,
            },
        }).then((nextReport: Report) => {
            if (!mounted.current) return;
            const text = formatReport(nextReport);
            // For CDP probes and the Phase 8 session over the inspector.
            const webos = (window as unknown as { __webos?: Record<string, unknown> }).__webos;
            if (webos) {
                webos.diagnostics = nextReport;
                webos.diagnosticsText = text;
            }
            setReport(nextReport);
            setReportText(text);
        });
    }, []);

    useEffect(() => {
        mounted.current = true;
        collect();
        firstButtonRef.current?.focus();
        return () => {
            mounted.current = false;
        };
    }, [collect]);

    const onSwitchVariant = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const variant = event.currentTarget.dataset.variant;
        setRequestedVariant(window.localStorage, variant === 'default' ? null : variant!);
        setRequested(getRequestedVariant(window.localStorage));
        // The loader reads the key when the worker starts: a new page load restarts the core.
        window.location.reload();
    }, []);

    const onCopy = useCallback(() => {
        const block = textRef.current;
        const selection = window.getSelection();
        if (!block || !selection) return;
        // Select the block (a Magic Remote can also drag over it) and copy the selection.
        const range = document.createRange();
        range.selectNodeContents(block);
        selection.removeAllRanges();
        selection.addRange(range);
        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch {
            copied = false;
        }
        setNotice(copied ? 'Copied to the clipboard.' : 'Text selected, but there is no clipboard here: read the block below or use Save.');
    }, []);

    const onSave = useCallback(() => {
        try {
            // One report at a time: the F3.5 mirror copies localStorage to IndexedDB and restores it after
            // a reinstall, so an old report would otherwise outlive the app.
            window.localStorage.removeItem(REPORT_STORAGE_KEY);
            window.localStorage.setItem(REPORT_STORAGE_KEY, reportText);
            // eslint-disable-next-line no-console
            console.info('[webos-diagnostics]\n' + reportText);
            setNotice('Saved to localStorage "' + REPORT_STORAGE_KEY + '" and logged to the console.');
        } catch (error) {
            setNotice('Could not save: ' + String((error as Error).message || error));
        }
    }, [reportText]);

    // The screen is a vertical list: the buttons row, then the cards. Up and down move the focus
    // to the neighbouring stop at once; the spatial navigation polyfill would first scroll a card
    // that is not fully visible, in 40 px steps, and the way up through the page would take dozens
    // of presses.
    const onContentKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.keyCode !== KEY_UP && event.keyCode !== KEY_DOWN) return;
        const content = contentRef.current;
        const active = document.activeElement as HTMLElement | null;
        if (!content || !active || !content.contains(active)) return;
        const cards = Array.from(content.querySelectorAll<HTMLElement>('[data-card]'));
        const inActions = !!active.closest('[data-actions]');
        const current = inActions ? -1 : cards.findIndex((card) => card === active || card.contains(active));
        const next = event.keyCode === KEY_DOWN ? current + 1 : current - 1;
        const target = next < 0 ? (current === 0 ? firstButtonRef.current : null) : cards[next];
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        target.focus();
    }, []);

    const variantButton = (variant: string, label: string) => (
        <Button
            className={styles['action']}
            title={label}
            data-variant={variant}
            onClick={onSwitchVariant}
        >
            {label}{(variant === 'default' ? requested === null : requested === variant) ? ' (current)' : ''}
        </Button>
    );

    return (
        <div className={styles['diagnostics-container']}>
            <HorizontalNavBar
                className={styles['nav-bar']}
                title={LABELS.title}
                backButton={true}
                navMenu={true}
            />
            <div ref={contentRef} className={styles['diagnostics-content']} onKeyDown={onContentKeyDown}>
                <div className={styles['actions']} data-actions={true}>
                    <Button ref={firstButtonRef} className={styles['action']} title={LABELS.refresh} onClick={collect}>{LABELS.refresh}</Button>
                    <Button className={styles['action']} title={LABELS.copy} onClick={onCopy}>{LABELS.copy}</Button>
                    <Button className={styles['action']} title={LABELS.save} onClick={onSave}>{LABELS.save}</Button>
                    {variantButton('wasm2js', 'Core: wasm2js + restart')}
                    {variantButton('wasm', 'Core: WebAssembly + restart')}
                    {variantButton('default', 'Core: default + restart')}
                </div>
                {notice ? <div className={styles['notice']}>{notice}</div> : null}
                {
                    report === null ?
                        <div className={styles['notice']}>{LABELS.collecting}</div>
                        :
                        toCards(report.sections).map((card) => (
                            <div key={card.key} className={styles['section']} tabIndex={0} data-card={true}>
                                <h3 className={styles['section-title']}>{card.title}</h3>
                                {
                                    card.rows.map(([label, value], index) => (
                                        <div key={index} className={styles['row']}>
                                            <div className={styles['row-label']}>{label}</div>
                                            <div className={styles['row-value']}>{value}</div>
                                        </div>
                                    ))
                                }
                            </div>
                        ))
                }
                <div className={styles['section']} tabIndex={0} data-card={true}>
                    <h3 className={styles['section-title']}>{LABELS.report}</h3>
                    <pre ref={textRef} className={styles['report']}>{reportText}</pre>
                </div>
            </div>
        </div>
    );
};

export default WebosDiagnostics;
