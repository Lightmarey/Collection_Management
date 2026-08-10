/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

interface Window {
  desktop: {
    ping(): Promise<{ ok: boolean }>;
    openZhihu(url?: string): Promise<{ ok: boolean; partition: string }>;
    zhihuSessionSummary(): Promise<{ partition: string; cookieCount: number }>;
    smokeReady(): Promise<boolean>;
  };
}
