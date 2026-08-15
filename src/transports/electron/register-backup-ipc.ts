import { dialog, ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import type { DataBackupService } from "../../services/data-backup-service";

export function registerBackupIpc(options: {
  service: DataBackupService | null;
  getWindow(): BrowserWindow | null;
  assertTrusted(sender: Electron.WebContents): void;
  log(event: string, details?: Record<string, unknown>): void;
}) {
  const { service, getWindow, assertTrusted, log } = options;
  ipcMain.handle("backup:create", async (event) => {
    assertTrusted(event.sender);
    if (!service) return { ok: false, error: "database_unavailable" };
    const window = getWindow();
    if (!window) return { ok: false, error: "window_unavailable" };
    const selected = await dialog.showOpenDialog(window, {
      title: "选择备份保存位置",
      properties: ["openDirectory", "createDirectory"],
    });
    if (selected.canceled || !selected.filePaths[0])
      return { ok: true, cancelled: true };
    try {
      return { ok: true, ...(await service.create(selected.filePaths[0])) };
    } catch (error) {
      log("backup-create-failed", {
        code:
          error instanceof Error && "code" in error
            ? error.code
            : "BACKUP_ERROR",
      });
      return { ok: false, error: "backup_create_failed" };
    }
  });

  ipcMain.handle("backup:restore", async (event) => {
    assertTrusted(event.sender);
    if (!service) return { ok: false, error: "database_unavailable" };
    const window = getWindow();
    if (!window) return { ok: false, error: "window_unavailable" };
    const selected = await dialog.showOpenDialog(window, {
      title: "选择 Innerse 备份文件夹",
      properties: ["openDirectory"],
    });
    if (selected.canceled || !selected.filePaths[0])
      return { ok: true, cancelled: true };
    try {
      return { ok: true, ...(await service.restore(selected.filePaths[0])) };
    } catch (error) {
      const code =
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "backup_restore_failed";
      log("backup-restore-failed", { code });
      return { ok: false, error: code };
    }
  });
}
