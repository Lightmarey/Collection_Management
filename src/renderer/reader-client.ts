import type { ReaderClient } from '../contracts/reader-client';

// Web/mobile builds replace this composition file with an HTTPS implementation.
export const readerClient: ReaderClient = window.desktop;
