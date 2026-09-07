// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const { default: Cell } = require('stremio/routes/Calendar/Table/Cell');
const tableStyles = require('stremio/routes/Calendar/Table/Table.less');
const styles = require('./CalendarDebugPage.less');

const poster = (width, height, color, label) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<rect width="100%" height="100%" fill="${color}"/>` +
        `<text x="50%" y="50%" fill="#ffffff" font-size="${Math.round(height / 8)}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${label}</text>` +
        '</svg>';
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const POSTER_2_3 = poster(200, 300, '#7b5bf5', '2:3');
const POSTER_2_3_ALT = poster(240, 360, '#2e7d6b', '2:3 alt');
const POSTER_16_9 = poster(320, 180, '#a14d2e', '16:9');
const FIXTURE_LABEL = 'webOS Calendar fixture (aspect-ratio fallback)';
const CELL_COUNT = 35;

const deepLinks = (id) => ({
    metaDetailsStreams: `#/debug/calendar/${id}`,
});

const item = (id, name, src) => ({
    id,
    name,
    poster: src,
    deepLinks: deepLinks(id),
});

const cells = (row) => {
    const scroll = Array.from({ length: 8 }, (_, index) =>
        item(`r${row}-scroll-${index}`, `Scrollable ${index + 1}`, index % 2 === 0 ? POSTER_2_3 : POSTER_2_3_ALT)
    );

    return [
        [],
        [item(`r${row}-single`, 'Single poster', POSTER_2_3)],
        scroll,
        [
            item(`r${row}-wide-1`, 'Landscape one', POSTER_16_9),
            item(`r${row}-wide-2`, 'Landscape two', POSTER_16_9),
        ],
        scroll.slice(0, 3),
        [item(`r${row}-alt`, 'Single alt', POSTER_2_3_ALT)],
        [item(`r${row}-wide`, 'Landscape solo', POSTER_16_9)],
    ];
};

const CalendarDebugPage = () => {
    const monthInfo = React.useMemo(() => ({ today: 3 }), []);

    return (
        <div className={styles['fixture']} data-webos-calendar-fixture={'true'}>
            <div className={styles['fixture-label']}>{FIXTURE_LABEL}</div>
            <div className={styles['table-mount']}>
                <div className={`${tableStyles['table']} ${styles['table']}`}>
                    <div className={tableStyles['grid']}>
                        {
                            Array.from({ length: CELL_COUNT }, (_, index) => {
                                const day = index + 1;
                                const variant = cells(Math.floor(index / 7))[index % 7];

                                return (
                                    <Cell
                                        key={day}
                                        monthInfo={monthInfo}
                                        selected={day === 4 ? { day } : null}
                                        date={{ day }}
                                        items={variant}
                                        onClick={() => null}
                                    />
                                );
                            })
                        }
                    </div>
                </div>
            </div>
        </div>
    );
};

module.exports = CalendarDebugPage;
