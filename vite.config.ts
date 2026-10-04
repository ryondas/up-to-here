import type { IncomingMessage } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Serves the Vercel function in api/gemini.ts during `npm run dev`, reading server env vars from .env.local. */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      for (const [key, value] of Object.entries(loadEnv(server.config.mode, process.cwd(), ''))) process.env[key] ??= value
      server.middlewares.use('/api/gemini', async (req: IncomingMessage, res, next) => {
        if (req.method !== 'POST') return next()
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const headers = Object.entries(req.headers).flatMap(([k, v]) => typeof v === 'string' ? [[k, v] as [string, string]] : [])
        const { POST } = await server.ssrLoadModule('/api/gemini.ts') as { POST: (request: Request) => Promise<Response> }
        const response = await POST(new Request(`http://${req.headers.host}/api/gemini`, { method: 'POST', headers, body: Buffer.concat(chunks) }))
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devApi()],
})
