import fs from "node:fs";
import path from "node:path";

export const MAX_LOG_BYTES = 2 * 1024 * 1024;

export function appendAppLog(directory, entry, maxBytes = MAX_LOG_BYTES) {
  fs.mkdirSync(directory, { recursive: true });
  const current = path.join(directory, "app.jsonl");
  const previous = path.join(directory, "app.previous.jsonl");
  const line = `${JSON.stringify(entry)}\n`;
  if (
    fs.existsSync(current) &&
    fs.statSync(current).size + Buffer.byteLength(line) > maxBytes
  ) {
    fs.rmSync(previous, { force: true });
    fs.renameSync(current, previous);
  }
  fs.appendFileSync(current, line, "utf8");
  return current;
}

export function exportAppLogs(directory, destination, diagnostics) {
  const chunks = [`${JSON.stringify({ event: "diagnostic-export", ...diagnostics })}\n`];
  let files = 0;
  for (const name of ["app.previous.jsonl", "app.jsonl"]) {
    const source = path.join(directory, name);
    if (!fs.existsSync(source)) continue;
    chunks.push(fs.readFileSync(source, "utf8"));
    files += 1;
  }
  fs.writeFileSync(destination, chunks.join(""), "utf8");
  return { path: destination, files };
}
