export function isSquirrelInstall(execPath: string, exists?: (path: string) => boolean): boolean;
export function runtimeDataRoot(input: {
  isPackaged: boolean;
  execPath: string;
  appPath: string;
  appDataPath: string;
  platform?: string;
  override?: string;
  portable?: string;
  exists?: (path: string) => boolean;
}): string;
