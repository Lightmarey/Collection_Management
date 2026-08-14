import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2] ?? 'all';
const root = path.resolve('out', 'make');
const files = fs.existsSync(root)
  ? fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
  : [];
const hasZip = files.some((file) => file.endsWith('.zip'));
const hasMsi = files.some((file) => file.endsWith('.msi'));
const hasDeb = files.some((file) => file.endsWith('.deb'));
const hasRpm = files.some((file) => file.endsWith('.rpm'));
const verifyPortable = mode === 'portable' || (mode === 'all' && process.platform !== 'linux');
const verifyInstaller = mode === 'installer' || (mode === 'all' && process.platform === 'win32');
const verifyLinux = mode === 'linux' || (mode === 'all' && process.platform === 'linux');
if (verifyPortable && !hasZip) throw new Error('ZIP artifact was not created');
if (verifyInstaller && !hasMsi) throw new Error('MSI artifact was not created');
if (verifyLinux && (!hasDeb || !hasRpm)) throw new Error('DEB and RPM artifacts were not both created');
console.log(`Distribution verified: ${mode}.`);
