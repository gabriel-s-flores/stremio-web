const hasOverflow = (element: Element, axis: 'x' | 'y') => {
    const view = element.ownerDocument.defaultView;
    if (!view) return false;

    const style = view.getComputedStyle(element);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    if (!['auto', 'scroll', 'overlay'].includes(overflow)) return false;

    return axis === 'x'
        ? element.scrollWidth > element.clientWidth + 1
        : element.scrollHeight > element.clientHeight + 1;
};

const findWheelTarget = (target: EventTarget | null, document: Document, deltaX: number, deltaY: number) => {
    const node = target as Node | null;
    let element = node?.nodeType === 1 ? node as Element : node?.parentElement || null;

    while (element && element !== document.documentElement) {
        const canScrollX = hasOverflow(element, 'x');
        const canScrollY = hasOverflow(element, 'y');

        if (deltaX !== 0 && canScrollX) return { element, axis: 'x' as const, delta: deltaX };
        if (deltaY !== 0 && canScrollY) return { element, axis: 'y' as const, delta: deltaY };
        // Magic Remote emits a vertical wheel. Let it move the nearest horizontal
        // row when that row is the first scrollable surface under the pointer.
        if (deltaY !== 0 && canScrollX) return { element, axis: 'x' as const, delta: deltaY };

        element = element.parentElement;
    }

    return null;
};

export const installTVWheelScrolling = (document: Document) => {
    const onWheel = (event: WheelEvent) => {
        if (event.defaultPrevented || event.ctrlKey || !event.cancelable) return;

        const lineScale = event.deltaMode === 1 ? 16 : 1;
        const pageScaleX = event.deltaMode === 2 ? document.documentElement.clientWidth || 1920 : 1;
        const pageScaleY = event.deltaMode === 2 ? document.documentElement.clientHeight || 1080 : 1;
        const deltaX = event.deltaX * lineScale * pageScaleX;
        const deltaY = event.deltaY * lineScale * pageScaleY;
        const target = findWheelTarget(event.target, document, deltaX, deltaY);
        if (!target || target.axis !== 'x') return;

        (event as WheelEvent & { tvWheelScrollTarget?: boolean }).tvWheelScrollTarget = true;
        const previous = target.element.scrollLeft;
        target.element.scrollLeft = previous + target.delta;
        if (target.element.scrollLeft !== previous) event.preventDefault();
    };

    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => document.removeEventListener('wheel', onWheel, true);
};
