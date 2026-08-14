/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type { DesktopApi } from './contracts/desktop';

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export {};
