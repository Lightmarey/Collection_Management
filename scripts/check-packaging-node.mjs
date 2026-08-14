const major = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(major) || major > 24) {
  console.error(`Packaging requires Node.js 24 LTS or earlier; current runtime is ${process.version}. Node 26 can exit successfully before Electron Packager writes an artifact.`);
  process.exit(1);
}
