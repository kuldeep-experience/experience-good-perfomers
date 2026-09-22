import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// The API lives in dev-server middleware so there is no second process to run
// and the Anthropic key never reaches the browser.
const api = {
  name: 'campaign-api',
  configureServer(server: any) {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (!req.url?.startsWith('/api/')) return next()
      const { handle } = await server.ssrLoadModule('/server/api.mjs')
      return handle(req, res)
    })
  },
}

export default defineConfig(({ mode }) => {
  // Vite doesn't put .env into process.env, and the API handler runs in Node.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
  plugins: [react(), tailwindcss(), api],
  // Inline (empty) PostCSS config so Vite doesn't walk up and find the parent
  // project's postcss.config.js, which is for a different Tailwind major.
  css: { postcss: { plugins: [] } },
  }
})
