import express from 'express'
import type { Request, Response } from 'express'

const COINGECKO_TAO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd'
const CACHE_MS = 15_000 // 15 seconds

let cached: { usd: number; at: number } | null = null

export function createPriceRouter() {
  const router = express.Router()

  router.get('/tao', async (_req: Request, res: Response) => {
    const now = Date.now()
    if (cached && now - cached.at < CACHE_MS) {
      return res.json({ usd: cached.usd, updatedAt: new Date(cached.at).toISOString() })
    }
    try {
      const resp = await fetch(COINGECKO_TAO_URL, {
        headers: { 'Accept': 'application/json' }
      })
      if (!resp.ok) {
        const text = await resp.text()
        return res.status(502).json({
          error: 'price_fetch_failed',
          message: `CoinGecko returned ${resp.status}: ${text.slice(0, 200)}`
        })
      }
      const data = (await resp.json()) as { bittensor?: { usd?: number } }
      const usd = data?.bittensor?.usd
      if (typeof usd !== 'number' || !Number.isFinite(usd)) {
        return res.status(502).json({
          error: 'price_fetch_failed',
          message: 'Invalid price data from CoinGecko'
        })
      }
      cached = { usd, at: now }
      res.json({ usd, updatedAt: new Date(now).toISOString() })
    } catch (e: any) {
      res.status(502).json({
        error: 'price_fetch_failed',
        message: e?.message || 'Failed to fetch TAO price'
      })
    }
  })

  return router
}
