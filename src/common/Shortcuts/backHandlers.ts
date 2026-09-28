export const BACK_HANDLER_PRIORITIES = {
    FALLBACK: 100,
    SEEK: 200,
    ROUTE_MODAL: 300,
    PLAYER_MENU: 400,
    MODAL: 500,
    POPUP: 600,
} as const;

export type BackHandler = (event: KeyboardEvent) => boolean;

export type RegisteredBackHandler = {
    handler: BackHandler,
    priority: number,
    order: number,
};

const consumeBackEvent = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
};

const dispatchBackHandlers = (event: KeyboardEvent, handlers: RegisteredBackHandler[]) => {
    const orderedHandlers = handlers.slice().sort((left, right) => (
        right.priority - left.priority || right.order - left.order
    ));

    for (const { handler } of orderedHandlers) {
        if (handler(event)) {
            consumeBackEvent(event);
            return true;
        }
    }

    return false;
};

export {
    consumeBackEvent,
    dispatchBackHandlers,
};
