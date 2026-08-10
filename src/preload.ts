import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  ping: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:ping'),
  openZhihu: (url?: string): Promise<{ ok: boolean; partition: string }> => ipcRenderer.invoke('zhihu:open', url),
  smokeReady: (): Promise<boolean> => ipcRenderer.invoke('app:smoke-ready'),
});
