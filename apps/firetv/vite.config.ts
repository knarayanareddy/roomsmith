export interface ViteServerConfig {
  host: string;
  port: number;
  strictPort?: boolean;
}

export interface ViteStaticAssetCopy {
  src: string;
  dest: string;
}

export interface ViteBuildConfig {
  outDir: string;
  emptyOutDir: boolean;
  assetsDir: string;
  copyAssets: readonly ViteStaticAssetCopy[];
}

export interface RoomSmithViteConfig {
  base: "/roomsmith/";
  root: string;
  publicDir: string;
  server: ViteServerConfig;
  preview: ViteServerConfig;
  build: ViteBuildConfig;
}

export function defineRoomSmithViteConfig(
  config: RoomSmithViteConfig,
): RoomSmithViteConfig {
  return config;
}

/**
 * Vite configuration for the standalone RoomSmith GitHub Pages rendition
 * deployed at `https://knarayanareddy.github.io/roomsmith/`.
 */
export const viteConfig: RoomSmithViteConfig = defineRoomSmithViteConfig({
  base: "/roomsmith/",
  root: ".",
  publicDir: "public",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
  build: {
    outDir: "../../dist/pages",
    emptyOutDir: true,
    assetsDir: "assets",
    copyAssets: [
      {
        src: "../../docs/media/roomsmith-demo.webm",
        dest: "media/roomsmith-demo.webm",
      },
      {
        src: "../../docs/media/roomsmith-demo.mp4",
        dest: "media/roomsmith-demo.mp4",
      },
      {
        src: "../../docs/media/roomsmith-narration.mp3",
        dest: "media/roomsmith-narration.mp3",
      },
    ],
  },
});

export default viteConfig;
