import { rm } from 'node:fs/promises';

await rm('.vite', { recursive: true, force: true });
