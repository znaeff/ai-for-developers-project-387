import { fileURLToPath } from 'node:url'
import { createServer } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const staticDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url))

createServer({
  staticDir,
  apiPrefix: '/api',
  allowTestReset: process.env.E2E_RESET === '1',
}).listen(port, () => {
  console.log(`App is listening on http://localhost:${port}`)
})
