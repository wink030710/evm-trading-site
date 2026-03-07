import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { getConfig } from '../services/config.js'

export type AuthedRequest = Request & { user?: unknown }

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const token = header.slice('Bearer '.length)
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    return res.status(500).json({ error: 'server_not_configured' })
  }

  try {
    const config = await getConfig()
    const payload = jwt.verify(token, jwtSecret, {
      issuer: config.security.jwtIssuer,
      audience: config.security.jwtAudience
    })
    req.user = payload
    return next()
  } catch {
    return res.status(401).json({ error: 'unauthorized' })
  }
}
