import express from 'express'
import type { Response } from 'express'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { requireAuth, type AuthedRequest } from '../middleware/auth.js'

function getPm2AppName(): string {
  return (process.env.name || process.env.PM2_APP_NAME || 'api').trim()
}

/** If set (e.g. "g7"), pm2 restart/flush run as this user via sudo -u */
function getPm2TargetUser(): string | null {
  const u = (process.env.PM2_TARGET_USER || '').trim()
  return u || null
}

function spawnPm2(args: string[]): ReturnType<typeof spawn> {
  const targetUser = getPm2TargetUser()
  if (targetUser) {
    return spawn('sudo', ['-u', targetUser, 'pm2', ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }
  return spawn('pm2', args, {
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function getLogFilePath(): string | null {
  const explicit = (process.env.LOG_FILE_PATH || process.env.PM2_LOG_FILE || '').trim()
  if (explicit) return resolve(explicit)
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const pm2Home = (process.env.PM2_HOME || '').trim() || (home ? `${home}/.pm2` : '')
  if (!pm2Home) return null
  return resolve(pm2Home, 'logs', `${getPm2AppName()}-out.log`)
}

export function createLogsRouter() {
  const router = express.Router()

  router.get('/config', requireAuth, (_req: AuthedRequest, res: Response) => {
    const path = getLogFilePath()
    if (!path) {
      return res.status(503).json({
        error: 'logs_not_configured',
        message: 'Set LOG_FILE_PATH or run under PM2 to stream logs.'
      })
    }
    const available = existsSync(path)
    res.json({ path, available })
  })

  router.get('/stream', requireAuth, (req: AuthedRequest, res: Response) => {
    const path = getLogFilePath()
    if (!path) {
      res.setHeader('Content-Type', 'application/json')
      return res.status(503).json({
        error: 'logs_not_configured',
        message: 'Set LOG_FILE_PATH or run under PM2 to stream logs.'
      })
    }
    if (!existsSync(path)) {
      res.setHeader('Content-Type', 'application/json')
      return res.status(404).json({
        error: 'log_file_not_found',
        path
      })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const send = (line: string) => {
      res.write(`data: ${line}\n\n`)
    }

    const tail = spawn('tail', ['-f', '-n', '200', path], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    tail.stdout.setEncoding('utf8')
    tail.stdout.on('data', (chunk: string) => {
      const lines = chunk.split('\n').filter((l) => l.length > 0)
      lines.forEach(send)
    })

    tail.stderr.setEncoding('utf8')
    tail.stderr.on('data', (chunk: string) => {
      send(`[stderr] ${chunk.trim()}`)
    })

    tail.on('error', (err) => {
      send(`[error] ${err.message}`)
    })

    tail.on('close', (code) => {
      if (code !== null && code !== 0) {
        send(`[tail exited with code ${code}]`)
      }
      res.end()
    })

    req.on('close', () => {
      tail.kill('SIGTERM')
    })
  })

  router.post('/flush', requireAuth, (req: AuthedRequest, res: Response) => {
    const appName = getPm2AppName()
    const pm2 = spawnPm2(['flush', appName])
    let stdout = ''
    let stderr = ''
    pm2.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    pm2.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    pm2.on('close', (code) => {
      if (code === 0) {
        res.json({ ok: true, message: `PM2 flush ${appName} succeeded` })
      } else {
        res.status(500).json({
          error: 'flush_failed',
          message: stderr || stdout || `pm2 flush exited with code ${code}`
        })
      }
    })
    pm2.on('error', (err) => {
      res.status(500).json({
        error: 'flush_failed',
        message: err.message || 'Failed to run pm2 flush'
      })
    })
  })

  router.post('/stop', requireAuth, (req: AuthedRequest, res: Response) => {
    const appName = getPm2AppName()
    const pm2 = spawnPm2(['stop', appName])
    let stdout = ''
    let stderr = ''
    pm2.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    pm2.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    pm2.on('close', (code) => {
      if (code === 0) {
        res.json({ ok: true, message: `PM2 stop ${appName} succeeded` })
      } else {
        res.status(500).json({
          error: 'stop_failed',
          message: stderr || stdout || `pm2 stop exited with code ${code}`
        })
      }
    })
    pm2.on('error', (err) => {
      res.status(500).json({
        error: 'stop_failed',
        message: err.message || 'Failed to run pm2 stop'
      })
    })
  })

  router.post('/restart', requireAuth, (req: AuthedRequest, res: Response) => {
    const appName = getPm2AppName()
    const pm2 = spawnPm2(['restart', appName])
    let stdout = ''
    let stderr = ''
    pm2.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    pm2.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    pm2.on('close', (code) => {
      if (code === 0) {
        res.json({ ok: true, message: `PM2 restart ${appName} succeeded` })
      } else {
        res.status(500).json({
          error: 'restart_failed',
          message: stderr || stdout || `pm2 restart exited with code ${code}`
        })
      }
    })
    pm2.on('error', (err) => {
      res.status(500).json({
        error: 'restart_failed',
        message: err.message || 'Failed to run pm2 restart'
      })
    })
  })

  return router
}
