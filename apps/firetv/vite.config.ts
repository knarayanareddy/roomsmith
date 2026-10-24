export interface ViteServerConfig {
  host: string;
  port: number;
  strictPort?: boolean;
}

export interface ViteBuildConfig {
  outDir: string;
  emptyOutDir: boolean;
  assetsDir: string;
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
  },
});

export default viteConfig;
