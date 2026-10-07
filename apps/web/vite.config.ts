import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  // Load env file from root
  const env = loadEnv(mode, process.cwd() + '/../../', '')

  return {
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: 8080,
      // The API serves the interface on the same origin in production; in
      // development, Vite forwards the API and the terminal websocket to it.
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
          ws: true,
        },
      }
    }
  }
})
