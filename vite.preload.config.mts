import { defineConfig } from 'vite';

export default defineConfig({ server: { watch: { ignored: ['**/.portable-data/**', '**/out/**'] } } });
