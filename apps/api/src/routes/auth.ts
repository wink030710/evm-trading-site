import bcrypt from 'bcryptjs'
import express from 'express'
import jwt from 'jsonwebtoken'
import { timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { getConfig } from '../services/config.js'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
})

export function createAuthRouter() {
  const router = express.Router()

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
