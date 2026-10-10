// webOS TV 4.x build only (resolved instead of interfaceScale.ts by webos/webpack/app.js).
// Same as interfaceScale.ts but for the same-origin check of the style sheets;
// webos/tests/styles/interfaceScale.test.js fails when the two drift apart.

// Copyright (C) 2017-2026 Smart code 203358507

import { INTERFACE_SCALES } from './CONSTANTS';

const mediaQueries = new Map<CSSMediaRule, string>();
let cssScale = 1;

const normalizeInterfaceScale = (value: number) => (
    INTERFACE_SCALES.includes(value) ? value : 100
);

const getInterfaceScale = () => cssScale;

// Pointer coordinates include CSS zoom; positioned UI uses unzoomed CSS pixels.
const getInterfaceRect = (element: Element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return new DOMRect(x / cssScale, y / cssScale, width / cssScale, height / cssScale);
};

const setInterfaceScale = (scale: number) => {
    if (scale === cssScale) return;

    const collectMediaQueries = (rules: CSSRuleList) => {
        Array.from(rules).forEach((rule) => {
            if (rule instanceof CSSMediaRule && !mediaQueries.has(rule)) {
                mediaQueries.set(rule, rule.media.mediaText);
            }
            if ('cssRules' in rule) collectMediaQueries((rule as CSSGroupingRule).cssRules);
        });
    };

    // The app's extracted styles are same-origin and loaded before React mounts.
    Array.from(document.styleSheets).forEach((sheet) => {
        // webOS: core-js replaces the native URL, and the origin it gives a file: URL is "null",
        // while location.origin is not; compare origins computed by the same URL.
        if (sheet.href && new URL(sheet.href).origin === new URL(location.href).origin) {
            collectMediaQueries(sheet.cssRules);
        }
    });

    // CSS zoom does not change viewport media queries like native page zoom does.
    mediaQueries.forEach((query, rule) => {
        rule.media.mediaText = query.replace(
            /((?:min|max)-(?:width|height):\s*)([\d.]+)px/g,
            (_, feature, value) => `${feature}${Number(value) * scale}px`
        );
    });

    cssScale = scale;
    document.documentElement.style.setProperty('--interface-scale', String(scale));
    window.dispatchEvent(new Event('resize'));
};

export { normalizeInterfaceScale, getInterfaceScale, getInterfaceRect, setInterfaceScale };
