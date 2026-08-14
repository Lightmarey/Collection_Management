export function isSquirrelInstall(execPath: string, exists?: (path: string) => boolean): boolean;
export function isWindowsSystemInstall(execPath: string, programFilesPaths?: Array<string | undefined>): boolean;
export function runtimeDataRoot(input: {
  isPackaged: boolean;
  execPath: string;
  appPath: string;
  appDataPath: string;
  platform?: string;
  override?: string;
  portable?: string;
  exists?: (path: string) => boolean;
  programFilesPaths?: Array<string | undefined>;
}): string;
