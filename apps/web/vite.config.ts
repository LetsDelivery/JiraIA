import { defineConfig, loadEnv } from 'vite'

/**
 * The panel is plain JavaScript and CSS (ADR-0006): Vite only bundles, splits and serves it.
 *
 * The API is reached through `/api`, proxied to `VITE_API_URL` — `localhost:8280` for
 * `bun run local:serve`, a deployed URL otherwise (same arrangement as the uselets panel).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    // The page editor (TipTap and Yjs, ADR-0009) is its own chunk of ~600 kB, loaded only when a page
    // opens; the rest of the panel stays well under the default 500 kB.
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 700,
      // pdf.js's worker first shipped as application/octet-stream, cached as immutable for a year by
      // CloudFront and by browsers; a hash of unchanged bytes would keep serving that copy. The `.v2`
      // gives it a name no cache has seen. Every other asset keeps Vite's default name.
      rollupOptions: {
        output: {
          assetFileNames: (asset) =>
            asset.names.some((name) => name.endsWith('.mjs'))
              ? 'assets/[name]-[hash].v2[extname]'
              : 'assets/[name]-[hash][extname]'
        }
      }
    },
    server: {
      port: 5280,
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:8280',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    }
  }
})
