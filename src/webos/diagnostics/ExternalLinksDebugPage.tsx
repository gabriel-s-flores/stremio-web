import React, { useEffect, useState } from 'react';
import Button from '../../components/Button';
import ExternalLink from '../../components/ExternalLink';
import { usePlatform } from '../../common/Platform';
import styles from './DebugPage.less';
import linkStyles from './ExternalLinksDebugPage.less';

const LABELS = {
    title: 'T3.8 External links',
    allowed: 'Allowed URL',
    warning: 'Warning URL',
    failure: 'Native failure',
    internal: 'Internal route',
    instructions: 'Close the browser and reopen Stremio. The route and visibility history should remain here.'
};

const ExternalLinksDebugPage = () => {
    const platform = usePlatform();
    const [visibility, setVisibility] = useState<string[]>([]);
    useEffect(() => {
        setVisibility((history) => [...history, platform.webos.hidden ? 'hidden' : 'visible']);
    }, [platform.webos.hidden]);
    const fail = () => {
        const service = window.webOS?.service;
        if (!service) { platform.openExternal('https://www.stremio.com/tos'); return; }
        const request = service.request;
        // Exercise native onFailure through the production seam, only for this call.
        service.request = (uri, options) => request.call(service, uri, {
            ...options, parameters: { ...options.parameters, id: 'com.stremio.t38.nonexistent' }
        });
        try { platform.openExternal('https://www.stremio.com/tos'); }
        finally { service.request = request; }
    };
    return (
        <div className={styles['debug-container']}>
            <h1>{LABELS.title}</h1>
            <div className={linkStyles['actions']}>
                <ExternalLink data-test={'allowed'} href={'https://www.stremio.com/tos'} target={'_blank'}>{LABELS.allowed}</ExternalLink>
                <ExternalLink data-test={'warning'} href={'https://example.org/t38?test=1'} target={'_blank'}>{LABELS.warning}</ExternalLink>
                <Button data-test={'failure'} onClick={fail}>{LABELS.failure}</Button>
                <Button data-test={'internal'} href={'#/debug'}>{LABELS.internal}</Button>
            </div>
            <p data-test={'visibility'}>{visibility.join(' → ')}</p>
            <p>{LABELS.instructions}</p>
        </div>
    );
};

export default ExternalLinksDebugPage;
