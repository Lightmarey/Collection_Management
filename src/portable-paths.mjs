import fs from 'node:fs';
import path from 'node:path';

export function isSquirrelInstall(execPath, exists = fs.existsSync) {
  const executableDirectory = path.dirname(path.resolve(execPath));
  return /^app-[0-9]/i.test(path.basename(executableDirectory))
    && exists(path.join(path.dirname(executableDirectory), 'Update.exe'));
}

export function runtimeDataRoot({
  isPackaged,
  execPath,
  appPath,
  appDataPath,
  platform = process.platform,
  override = '',
  portable = '',
  exists,
}) {
  const configured = typeof override === 'string' ? override.trim() : '';
  if (configured) return path.resolve(configured);
  if (!isPackaged) return path.join(path.resolve(appPath), '.portable-data');
  const forcedPortable = String(portable).trim() === '1';
  const forcedInstalled = String(portable).trim() === '0';
  const installed = forcedInstalled || (!forcedPortable && platform === 'win32' && isSquirrelInstall(execPath, exists));
  return installed
    ? path.join(path.resolve(appDataPath), 'knowledge-management')
    : path.join(path.dirname(path.resolve(execPath)), 'data');
}
