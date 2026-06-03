import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Plugin: replace %%VITE_BASE_BE_URL%% in public/demo-connect.js at build time
function demoEnvPlugin(env: Record<string, string>) {
  return {
    name: 'demo-env-inject',
    // Runs after Vite copies the public folder into dist
    closeBundle() {
      const apiUrl = env.VITE_BASE_BE_URL || 'https://truemile-v2-demo-dev.up.railway.app'
      for (const file of ['demo-connect.js', 'demo-tour.js']) {
        const distFile = path.resolve(__dirname, `dist/${file}`)
        if (!fs.existsSync(distFile)) continue
        let src = fs.readFileSync(distFile, 'utf-8')
        src = src.replace(/%%VITE_BASE_BE_URL%%/g, apiUrl)
        fs.writeFileSync(distFile, src)
        console.log(`[demo-env-inject] Injected VITE_BASE_BE_URL into dist/${file}`)
      }
    },
    // Dev server: transform on the fly
    transform(code: string, id: string) {
      if (id.includes('demo-connect.js')) {
        return code.replace(/%%VITE_BASE_BE_URL%%/g, env.VITE_BASE_BE_URL || 'https://truemile-v2-demo-dev.up.railway.app')
      }
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), demoEnvPlugin(env)],
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'esbuild',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor': ['react', 'react-dom', 'react-router-dom'],
            'icons': ['lucide-react'],
            'http': ['axios']
          }
        }
      }
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: process.env.API_TARGET || env.VITE_BASE_BE_URL || 'https://truemile-v2-demo-dev.up.railway.app',
          changeOrigin: true
        }
      }
    }
  }
})
