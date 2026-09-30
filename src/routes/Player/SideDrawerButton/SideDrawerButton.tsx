// Copyright (C) 2017-2024 Smart code 203358507

import React from 'react';
import classNames from 'classnames';
import Icon from '@stremio/stremio-icons/react';
import Button from 'stremio/components/Button';
const TVAction = process.env.WEBOS ? Button : 'div';

import styles from './SideDrawerButton.less';

type Props = {
    className: string,
    onClick: () => void,
};

const SideDrawerButton = ({ className, onClick }: Props) => {
    return (
        <TVAction className={classNames(className, styles['side-drawer-button'])} data-webos-action={process.env.WEBOS_DEBUG ? 'side-drawer' : undefined} onClick={onClick}>
            <Icon name={'chevron-back'} className={styles['icon']} />
        </TVAction>
    );
};

export default SideDrawerButton;
