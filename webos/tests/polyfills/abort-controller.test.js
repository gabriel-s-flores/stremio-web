describe('AbortController polyfill', () => {
    const { AbortController: NativeAbortController, AbortSignal: NativeAbortSignal } = global;

    afterEach(() => {
        global.AbortController = NativeAbortController;
        global.AbortSignal = NativeAbortSignal;
    });

    test('keeps the native implementation', () => {
        jest.isolateModules(() => require('../../polyfills/abort-controller'));
        expect(global.AbortController).toBe(NativeAbortController);
        expect(global.AbortSignal).toBe(NativeAbortSignal);
    });

    test('installs a working AbortController where it is missing', () => {
        delete global.AbortController;
        delete global.AbortSignal;
        jest.isolateModules(() => require('../../polyfills/abort-controller'));
        expect(global.AbortController).not.toBe(NativeAbortController);

        const controller = new global.AbortController();
        const onAbort = jest.fn();
        controller.signal.addEventListener('abort', onAbort);
        expect(controller.signal.aborted).toBe(false);
        controller.abort();
        expect(controller.signal.aborted).toBe(true);
        expect(onAbort).toHaveBeenCalledTimes(1);
        expect(controller.signal.reason).toBeInstanceOf(Error);
    });
});
