import dotenv from 'dotenv'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { createAuthRouter } from './routes/auth.js'
import { createContractsRouter } from './routes/contracts.js'
import { createLogsRouter } from './routes/logs.js'
import { createPriceRouter } from './routes/price.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env') })

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173')
})

const env = envSchema.parse(process.env)

const corsOrigin = (() => {
  const raw = (env.CORS_ORIGIN || '').trim()
  if (!raw) return 'http://localhost:5173'
  if (raw === '*') return '*'
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : 'http://localhost:5173'
})()

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(cors({ origin: corsOrigin }))

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})

app.use('/auth', createAuthRouter())
app.use('/contracts', createContractsRouter())
app.use('/logs', createLogsRouter())
app.use('/price', createPriceRouter())

app.listen(env.PORT, () => {
  console.log(`API listening on :${env.PORT}`)
})
