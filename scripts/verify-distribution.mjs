import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2] ?? 'all';
const root = path.resolve('out', 'make');
const files = fs.existsSync(root)
  ? fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
  : [];
const hasZip = files.some((file) => file.endsWith('.zip'));
const hasInstaller = files.some((file) => /Setup\.exe$/i.test(file));
if ((mode === 'portable' || mode === 'all') && !hasZip) throw new Error('portable ZIP artifact was not created');
if ((mode === 'installer' || mode === 'all') && !hasInstaller) throw new Error('Squirrel Setup.exe artifact was not created');
console.log(`Distribution verified: ${mode}.`);
