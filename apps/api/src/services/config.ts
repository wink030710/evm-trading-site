import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const configSchema = z.object({
  chain: z.object({
    chainId: z.number().int().nonnegative(),
    rpcUrl: z.string(),
  }),
  security: z.object({
    jwtIssuer: z.string(),
    jwtAudience: z.string(),
    tokenTtlSeconds: z.number().int().positive(),
  }),
  contracts: z.object({
    defaultAbiFile: z.string().min(1),
    stakingAbiFile: z.string().min(1),
    stakingAddress: z.string().min(1),
    alphaAbiFile: z.string().min(1),
    alphaAddress: z.string().min(1),
    hotkey: z.string().min(1),
  }),
});

export type AppConfig = z.infer<typeof configSchema>

let cached: AppConfig | null = null

export async function getConfig(): Promise<AppConfig> {
  if (cached) return cached
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const filePath = join(__dirname, '..', '..', 'config.json')
  const raw = await readFile(filePath, 'utf-8')
  cached = configSchema.parse(JSON.parse(raw))
  return cached
}
