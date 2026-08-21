import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('element-plus')) {
            return 'vendor-element-plus'
          }
          if (id.includes('@xterm')) {
            return 'vendor-xterm'
          }
          if (id.includes('/node_modules/vue/') || id.includes('\\node_modules\\vue\\') || id.includes('/node_modules/@vue/') || id.includes('\\node_modules\\@vue\\')) {
            return 'vendor-vue'
          }
          return undefined
        },
      },
    },
  },
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            emptyOutDir: true,
            rollupOptions: {
              // Native / complex Node drivers must not be rolled into main.js
              // (bundling `pg` causes TDZ: Cannot access 'Bt' before initialization).
              external: [
                'ssh2',
                'mysql2',
                'mysql2/promise',
                'pg',
                'pg-connection-string',
                'pg-pool',
                'pg-protocol',
                'pg-types',
                'pgpass',
                'oracledb',
              ],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            emptyOutDir: false,
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // shared pure modules used by renderer + main
      '@shared': resolve(__dirname, 'shared'),
    },
  },
})
