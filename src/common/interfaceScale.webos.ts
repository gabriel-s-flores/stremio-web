// webOS TV 4.x build only (resolved instead of interfaceScale.ts by webos/webpack/app.js).
// Same as interfaceScale.ts but for the same-origin check of the style sheets and, from F2.6, the TV
// scale and the element rects in screen pixels (the `webOS:` blocks);
// webos/tests/styles/interfaceScale.test.js fails when the two drift apart.

// Copyright (C) 2017-2026 Smart code 203358507

import { INTERFACE_SCALES } from './CONSTANTS';

const mediaQueries = new Map<CSSMediaRule, string>();
let cssScale = 1;

// webOS: the TV scale (F2.6). The interface scale setting multiplies it, so the default 100% is sized
// for a 55" screen seen from 3 m: 1rem (14px at this zoom) is drawn 24.5px tall on the 1920x1080 page,
// the minimum of LG's TV UI guideline (18pt), and the layout gets the 1097px wide viewport the app is
// built for. webos/webpack/postcss-math-functions.js resolves min()/max() for this scale
// (webos/tests/styles/tv-scale.test.js keeps the two equal).
const TV_SCALE = 1.75;

// webOS: the steps of the interface zoom setting on the TV (F4.1b). Below 100% the text gets smaller
// than LG's minimum; from 150% the layout is the small-screen one (no Settings menu, the last tab of
// the side bar below the screen, measured in the emulator). A stored value outside these steps is
// normalized to 100%. Scale.webos.tsx shows only these.
const TV_INTERFACE_SCALES = [100, 125];

// webOS: Chromium before 128 (every webOS TV) gives getBoundingClientRect() in the unzoomed CSS pixels
// of the element, while pointer coordinates, innerWidth and elementFromPoint() are in screen pixels.
// The app (getInterfaceRect below, Slider, SeekBar) and spatial-navigation-polyfill (hitTest) are
// written for the standardized zoom of Chromium 128+, where the rects are in screen pixels too. While
// the zoom is not 1 on such an engine, rects are scaled to screen pixels (not getClientRects(): unused).
const nativeGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let rectScale = 1;

function getScreenRect(this: Element) {
    const { left, top, width, height } = nativeGetBoundingClientRect.call(this);
    return new DOMRect(left * rectScale, top * rectScale, width * rectScale, height * rectScale);
}

const setRectScale = (scale: number) => {
    // html is as wide as the screen: 100vw over the zoom, drawn zoomed (src/App/styles.less).
    const { width } = nativeGetBoundingClientRect.call(document.documentElement);
    const unzoomed = Math.abs(width * scale - window.innerWidth) < Math.abs(width - window.innerWidth);
    rectScale = unzoomed ? scale : 1;
    Element.prototype.getBoundingClientRect = rectScale === 1 ? nativeGetBoundingClientRect : getScreenRect;
};

const normalizeInterfaceScale = (value: number) => (
    // webOS: only the TV steps.
    INTERFACE_SCALES.includes(value) && TV_INTERFACE_SCALES.includes(value) ? value : 100
);

const getInterfaceScale = () => cssScale;

// Pointer coordinates include CSS zoom; positioned UI uses unzoomed CSS pixels.
const getInterfaceRect = (element: Element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return new DOMRect(x / cssScale, y / cssScale, width / cssScale, height / cssScale);
};

const setInterfaceScale = (setting: number) => {
    // webOS: the TV scale.
    const scale = setting * TV_SCALE;
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
    // webOS: rects in screen pixels.
    setRectScale(scale);
    window.dispatchEvent(new Event('resize'));
};

export { normalizeInterfaceScale, getInterfaceScale, getInterfaceRect, setInterfaceScale };
// webOS: the TV steps of the setting.
export { TV_INTERFACE_SCALES };
