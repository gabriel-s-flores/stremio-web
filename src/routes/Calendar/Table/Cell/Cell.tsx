// Copyright (C) 2017-2024 Smart code 203358507

import React, { useCallback, useLayoutEffect, useMemo, useRef, MouseEvent } from 'react';
import Icon from '@stremio/stremio-icons/react';
import classNames from 'classnames';
import { useNavigateWithOrigin } from 'stremio-router';
import { Button, HorizontalScroll, Image } from 'stremio/components';
import styles from './Cell.less';

// Chromium 68 (webOS TV 5) lacks `aspect-ratio` and cannot size a box width from
// its height in CSS. Item heights still resolve fine in the table, so the legacy
// path measures the rendered height and pins `width = height * 2/3` once per
// commit. Modern browsers run zero extra work (see the @supports fallback in
// Cell.less for the poster/icon part of the fallback).
const ASPECT_RATIO_UNSUPPORTED = typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && !CSS.supports('aspect-ratio', '2 / 3');

type Props = {
    selected: CalendarDate | null,
    monthInfo: CalendarMonthInfo,
    date: CalendarDate,
    items: CalendarContentItem[],
    onClick: (date: CalendarDate) => void,
};

const Cell = ({ selected, monthInfo, date, items, onClick }: Props) => {
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const itemRefs = useRef<(HTMLElement | null)[]>([]);
    itemRefs.current = [];

    const [active, today] = useMemo(() => [
        date.day === selected?.day,
        date.day === monthInfo.today,
    ], [selected, monthInfo, date]);

    const onCellClick = () => {
        onClick && onClick(date);
    };

    const onPosterClick = useCallback((event: MouseEvent<HTMLDivElement>, target: string) => {
        event.preventDefault();
        event.stopPropagation();
        navigateWithOrigin(target);
    }, [navigateWithOrigin]);

    const onItemRef = useCallback((element: HTMLElement | null) => {
        if (element) itemRefs.current.push(element);
    }, []);

    useLayoutEffect(() => {
        if (!ASPECT_RATIO_UNSUPPORTED) return;

        itemRefs.current.forEach((element) => {
            const height = element.clientHeight;
            element.style.width = height > 0 ? `${height * 2 / 3}px` : '';
        });
    });

    return (
        <Button
            className={classNames(styles['cell'], { [styles['active']]: active, [styles['today']]: today })}
            onClick={onCellClick}
        >
            <div className={styles['heading']}>
                <div className={styles['day']}>
                    {date.day}
                </div>
            </div>
            <HorizontalScroll className={styles['items']}>
                {
                    items.map(({ id, name, poster, deepLinks }) => (
                        <Button key={id} ref={onItemRef} className={styles['item']} href={deepLinks.metaDetailsStreams} tabIndex={-1} onClick={(event) => onPosterClick(event, deepLinks.metaDetailsStreams)}>
                            <Icon className={styles['icon']} name={'play'} />
                            <Image
                                className={styles['poster']}
                                src={poster}
                                alt={name}
                            />
                        </Button>
                    ))
                }
            </HorizontalScroll>
            {
                items.length > 0 ?
                    <Icon className={styles['more']} name={'more-horizontal'} />
                    :
                    null
            }
        </Button>
    );
};

export default Cell;
