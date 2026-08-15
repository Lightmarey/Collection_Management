import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerWix } from '@electron-forge/maker-wix';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/*.node' },
    icon: 'assets/innerse',
    ignore: (file) =>
      (file.includes('/node_modules/better-sqlite3/prebuilds/')
        && !file.endsWith(`/better-sqlite3/prebuilds/${process.platform}-${process.arch}.node`))
      || (Boolean(file) && !file.startsWith('/.vite') && !file.startsWith('/node_modules')),
  },
  rebuildConfig: {},
  makers: [
    new MakerWix({
      manufacturer: 'Lightmarey',
      defaultInstallMode: 'perMachine',
    }, ['win32']),
    new MakerZIP({}, ['win32', 'darwin']),
    new MakerDeb({
      options: {
        maintainer: 'Lightmarey',
        homepage: 'https://github.com/Lightmarey/Collection_Management',
        categories: ['Office'],
        icon: 'assets/innerse.png',
      },
    }, ['linux']),
    new MakerRpm({
      options: {
        license: 'AGPL-3.0-only',
        homepage: 'https://github.com/Lightmarey/Collection_Management',
        categories: ['Office'],
        icon: 'assets/innerse.png',
      },
    }, ['linux']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
