// Copyright (C) 2017-2026 Smart code 203358507
const React = require('react');
const { default: Icon } = require('@stremio/stremio-icons/react');
const styles = require('./FontsIconsDebugPage.less');

const names = ['add', 'close', 'play', 'settings', 'checkmark', 'caret-down', 'chevron-forward'];
const labels = {
    title: 'T2.9 — Fontes e ícones',
    text: 'Plus Jakarta Sans — Ação, televisão, 0123456789',
    flag: 'Bandeira (TwemojiFlags): ',
    flagGlyph: '🇧🇷',
    instructions: 'Use Tab ou o controle remoto para percorrer as amostras.',
    stroke: 'stroke control',
};

const FontsIconsDebugPage = () => (
    <main className={styles['fixture']} data-webos-fonts-icons-fixture={'true'}>
        <h1>{labels.title}</h1>
        <p data-t29-text={'true'}>{labels.text}</p>
        <p>{labels.flag}<span className={styles['flag']} data-t29-flag={'true'}>{labels.flagGlyph}</span></p>
        <p>{labels.instructions}</p>
        {['dark', 'light', 'colored'].map((variant) => (
            <section className={styles[variant]} key={variant}>
                <h2>{variant}</h2>
                <div className={styles['row']}>
                    {names.map((name) => (
                        <button type={'button'} tabIndex={0} key={name} data-t29-icon={name} className={styles['sample']}>
                            <Icon name={name} className={styles['icon']} />
                            <span>{name}</span>
                        </button>
                    ))}
                    <button type={'button'} tabIndex={0} data-t29-icon={'stroke-control'} className={styles['sample']}>
                        <svg className={styles['icon']} viewBox={'0 0 24 24'} aria-label={'currentColor stroke control'}>
                            <path d={'M4 12h16M12 4v16'} fill={'none'} stroke={'currentColor'} strokeWidth={'2'} />
                        </svg>
                        <span>{labels.stroke}</span>
                    </button>
                </div>
            </section>
        ))}
    </main>
);

module.exports = FontsIconsDebugPage;
