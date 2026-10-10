// webOS TV 4.x build only (resolved instead of index.ts by webos/webpack/app.js, F6.1).
// No streaming server settings: Settings.tsx keeps its ref, and a section without an element is
// skipped by its scroll tracking (as Shortcuts is on mobile).
import { forwardRef } from 'react';

const Streaming = forwardRef<HTMLDivElement>(() => null);

export default Streaming;
