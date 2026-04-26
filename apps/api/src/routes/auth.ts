import bcrypt from 'bcryptjs'
import express from 'express'
import jwt from 'jsonwebtoken'
import { timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { getConfig } from '../services/config.js'
import {
  confirm2FASetup,
  disable2FA,
  is2FARequired,
  start2FASetup,
  verifyTotp
} from '../services/twoFa.js'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().optional()
})

const setupStartSchema = z.object({ currentTotp: z.string().optional() })
const setupConfirmSchema = z.object({ totp: z.string().min(1) })
const disableSchema = z.object({ totp: z.string().min(1) })

export function createAuthRouter() {
  const router = express.Router()

  router.get('/2fa-required', async (_req: Request, res: Response) => {
    const required = await is2FARequired()
    return res.json({ required })
  })

  router.post('/2fa/setup-start', requireAuth, async (req: Request, res: Response) => {
    const body = setupStartSchema.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'invalid_request' })
    const result = await start2FASetup(body.data.currentTotp)
    if ('error' in result) return res.status(401).json({ error: result.error })
    return res.json({ uri: result.uri, secret: result.secret })
  })

  router.post('/2fa/setup-confirm', requireAuth, async (req: Request, res: Response) => {
    const body = setupConfirmSchema.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'invalid_request' })
    const ok = await confirm2FASetup(body.data.totp)
    if (!ok) return res.status(400).json({ error: 'invalid_totp' })
    return res.json({ ok: true })
  })

  router.post('/2fa/disable', requireAuth, async (req: Request, res: Response) => {
    const body = disableSchema.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'invalid_request' })
    const ok = await disable2FA(body.data.totp)
    if (!ok) return res.status(401).json({ error: 'invalid_totp' })
    return res.json({ ok: true })
  })

  router.post('/login', async (req: Request, res: Response) => {
    const body = loginSchema.safeParse(req.body)
    if (!body.success) {
      return res.status(400).json({ error: 'invalid_request' })
    }

    const adminUsername = process.env.ADMIN_USERNAME
    const adminPassword = process.env.ADMIN_PASSWORD
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH
    const jwtSecret = process.env.JWT_SECRET

    if (!adminUsername || (!adminPassword && !adminPasswordHash) || !jwtSecret) {
      return res.status(500).json({ error: 'server_not_configured' })
    }

    if (body.data.username !== adminUsername) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }

    const passwordOk = adminPasswordHash
      ? await bcrypt.compare(body.data.password, adminPasswordHash)
      : (() => {
          if (!adminPassword) return false
          const a = Buffer.from(body.data.password)
          const b = Buffer.from(adminPassword)
          return a.length === b.length && timingSafeEqual(a, b)
        })()

    if (!passwordOk) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }

    if (await is2FARequired()) {
      const totpOk = await verifyTotp(body.data.totp ?? '')
      if (!totpOk) {
        return res.status(401).json({ error: 'invalid_totp' })
      }
    }

    const config = await getConfig()
    const token = jwt.sign(
      { sub: adminUsername, role: 'admin' },
      jwtSecret,
      {
        expiresIn: config.security.tokenTtlSeconds,
        issuer: config.security.jwtIssuer,
        audience: config.security.jwtAudience
      }
    )

    return res.json({ token })
  })

  return router
}
