export const MAX_LOG_BYTES: number;
export function appendAppLog(
  directory: string,
  entry: Record<string, unknown>,
  maxBytes?: number,
): string;
export function exportAppLogs(
  directory: string,
  destination: string,
  diagnostics: Record<string, unknown>,
): { path: string; files: number };
