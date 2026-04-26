import { generateSecret, generateURI, verify } from 'otplib'
import { getDb } from './storage.js'

const PENDING_TTL_MS = 5 * 60 * 1000 // 5 minutes
const ISSUER = 'EVM Staking Admin'
const LABEL = 'Admin'

function envSecret(): string {
  return process.env.ADMIN_TOTP_SECRET?.trim() || ''
}

export async function getStoredSecret(): Promise<string> {
  const db = await getDb()
  await db.read()
  const twoFa = (db.data as any).twoFa
  if (twoFa?.secret && typeof twoFa.secret === 'string') return twoFa.secret
  return envSecret()
}

export async function is2FARequired(): Promise<boolean> {
  const secret = await getStoredSecret()
  return secret.length > 0
}

export async function verifyTotp(token: string): Promise<boolean> {
  const secret = await getStoredSecret()
  if (!secret) return true
  const t = String(token ?? '').replace(/\s/g, '')
  if (!t || t.length < 6) return false
  try {
    const result = await verify({
      secret,
      token: t,
      epochTolerance: 1
    })
    return !!result?.valid
  } catch {
    return false
  }
}

export async function start2FASetup(currentTotp?: string): Promise<{ uri: string; secret: string } | { error: string }> {
  const db = await getDb()
  await db.read()
  const twoFa = (db.data as any).twoFa || {}
  const existingSecret = twoFa.secret || envSecret()

  if (existingSecret) {
    if (!currentTotp || !(await verifyTotpWithSecret(existingSecret, currentTotp))) {
      return { error: 'invalid_totp' }
    }
  }

  const pendingSecret = generateSecret()
  const uri = generateURI({
    issuer: ISSUER,
    label: LABEL,
    secret: pendingSecret
  })

  ;(db.data as any).twoFa = {
    ...twoFa,
    pendingSecret,
    pendingExpiresAt: Date.now() + PENDING_TTL_MS
  }
  await db.write()

  return { uri, secret: pendingSecret }
}

export async function confirm2FASetup(totp: string): Promise<boolean> {
  const db = await getDb()
  await db.read()
  const twoFa = (db.data as any).twoFa || {}
  const pending = twoFa.pendingSecret
  const expiresAt = twoFa.pendingExpiresAt

  if (!pending || typeof expiresAt !== 'number' || Date.now() > expiresAt) {
    return false
  }

  if (!(await verifyTotpWithSecret(pending, totp))) return false

  ;(db.data as any).twoFa = {
    secret: pending,
    enabledAt: new Date().toISOString(),
    pendingSecret: undefined,
    pendingExpiresAt: undefined
  }
  await db.write()
  return true
}

function verifyTotpWithSecret(secret: string, token: string): Promise<boolean> {
  const t = String(token ?? '').replace(/\s/g, '')
  if (!t || t.length < 6) return Promise.resolve(false)
  return verify({
    secret,
    token: t,
    epochTolerance: 1
  }).then((r) => !!r?.valid).catch(() => false)
}

/** Disable 2FA: requires current TOTP if a secret is stored in DB. Returns true if disabled. */
export async function disable2FA(currentTotp: string): Promise<boolean> {
  const db = await getDb()
  await db.read()
  const twoFa = (db.data as any).twoFa || {}
  const secret = twoFa.secret || envSecret()
  if (!secret) return true // already off
  if (!(await verifyTotpWithSecret(secret, currentTotp))) return false
  ;(db.data as any).twoFa = {}
  await db.write()
  return true
}
