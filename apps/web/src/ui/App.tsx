import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  clearToken,
  createContract,
  deleteContract,
  getBalances,
  downloadLogsFile,
  flushLogsServer,
  getLogsConfig,
  getTaoPrice,
  getSubnetIdentityCached,
  listDtaoSubnets,
  listAbiFiles,
  listContracts,
  listOwners,
  listStakes,
  listDelegateTransactions,
  get2FARequired,
  login,
  openLogsStream,
  refreshSubnetIdentity,
  restartLogsServer,
  stopLogsServer,
  setApiErrorNotifier,
  setToken,
  twoFaDisable,
  twoFaSetupConfirm,
  twoFaSetupStart,
  type ContractRecord,
  type DtaoSubnetRow,
  type DelegateTxRow,
  type StakeRow,
  type SubnetIdentityRow
} from '../lib/api'

const TAO_POLL_MS = 60_000 // 1 minute
const TRANSACTIONS_POLL_MS = 60_000 // 1 minute

type NotifyType = 'error' | 'success'
type NotificationItem = { id: string; type: NotifyType; message: string }

function Notifications(props: { items: NotificationItem[]; onDismiss: (id: string) => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 520
      }}
      aria-live="polite"
      aria-relevant="additions removals"
    >
      {props.items.map((n) => (
        <div
          key={n.id}
          role={n.type === 'error' ? 'alert' : 'status'}
          style={{
            background: n.type === 'error' ? 'rgba(160, 45, 45, 0.20)' : 'rgba(30, 150, 90, 0.18)',
            border: n.type === 'error' ? '1px solid rgba(255, 90, 90, 0.35)' : '1px solid rgba(80, 255, 170, 0.30)',
            padding: '10px 12px',
            borderRadius: 12,
            boxShadow: '0 10px 26px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start'
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              {n.type === 'error' ? 'Error' : 'Success'}
            </div>
            <div style={{ overflowWrap: 'anywhere' }}>{n.message}</div>
          </div>
          <button className="btn btnSmall" onClick={() => props.onDismiss(n.id)} aria-label="Dismiss notification">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

function useTaoPrice(): { price: string | null; error: string | null } {
  const [price, setPrice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function fetchPrice() {
      getTaoPrice()
        .then(({ usd }) => {
          setPrice(usd >= 1 ? usd.toFixed(2) : usd.toFixed(4))
          setError(null)
        })
        .catch((e: any) => {
          setError(e?.message || 'Price unavailable')
        })
    }

    fetchPrice()
    const interval = setInterval(fetchPrice, TAO_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  return { price, error }
}

export function App() {
  const [tokenPresent, setTokenPresent] = useState(() => Boolean(localStorage.getItem('token')))
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [subnets, setSubnets] = useState<SubnetIdentityRow[] | null>(null)
  const [subnetsUpdatedAt, setSubnetsUpdatedAt] = useState<string | null>(null)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<null | {
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
    resolve: (v: boolean) => void
  }>(null)
  const { price: taoPrice, error: taoError } = useTaoPrice()

  const notify = useCallback((type: NotifyType, message: string) => {
    if (!message) return
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    setNotifications((prev) => [...prev, { id, type, message }].slice(-6))
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    }, type === 'error' ? 6500 : 4500)
  }, [])

  const onError = useCallback(
    (e: string | null) => {
      if (e) notify('error', e)
    },
    [notify]
  )

  useEffect(() => {
    setApiErrorNotifier((msg) => notify('error', msg))
    return () => setApiErrorNotifier(null)
  }, [notify])

  useEffect(() => {
    if (!tokenPresent) return
    let cancelled = false
    getSubnetIdentityCached()
      .then((resp) => {
        if (cancelled) return
        setSubnets(Array.isArray(resp.data) ? resp.data : [])
        setSubnetsUpdatedAt(resp.updatedAt || null)
      })
      .catch(() => {
        // ignore; global notifier will handle
      })
    return () => {
      cancelled = true
    }
  }, [tokenPresent])

  const subnetByNetuid = useMemo(() => {
    const map = new Map<number, { name: string; logoUrl: string | null }>()
    for (const row of subnets || []) {
      const uid = typeof row?.netuid === 'number' ? row.netuid : null
      if (uid === null) continue
      const name = String((row as any)?.subnet_name ?? '').trim()
      const logoUrl = String((row as any)?.logo_url ?? '').trim() || null
      if (name) map.set(uid, { name, logoUrl })
    }
    return map
  }, [subnets])

  const refreshSubnets = useCallback(async () => {
    const resp = await refreshSubnetIdentity()
    setSubnets(Array.isArray(resp.data) ? resp.data : [])
    setSubnetsUpdatedAt(resp.updatedAt || null)
    notify('success', 'Subnet data updated')
  }, [notify])

  const confirm = useCallback(
    (input: { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setConfirmState({ ...input, resolve })),
    []
  )

  useEffect(() => {
    const onStorage = () => setTokenPresent(Boolean(localStorage.getItem('token')))
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <div className="container">
      <Notifications items={notifications} onDismiss={(id) => setNotifications((prev) => prev.filter((n) => n.id !== id))} />
      <header className="appHeader">
        <div>
          <h1 className="h1">EVM Staking Admin</h1>
          <div className="muted appHeaderApi">
            {import.meta.env.VITE_API_URL || 'http://localhost:4000'}
          </div>
        </div>
        <div className="appHeaderTao">
          {taoError ? (
            <span className="muted" title={taoError}>TAO —</span>
          ) : taoPrice ? (
            <span className="appHeaderTaoPrice">TAO $<span className="mono">{taoPrice}</span></span>
          ) : (
            <span className="muted">TAO …</span>
          )}
        </div>
        {tokenPresent ? (
          <div className="appHeaderNav">
            <nav className="appHeaderNavLinks">
              <NavLink to="/" className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`} end>Dashboard</NavLink>
              <NavLink to="/contracts" className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}>Contracts</NavLink>
              <NavLink to="/transactions" className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}>Transactions</NavLink>
              <NavLink to="/subnets" className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}>Subnets</NavLink>
              <NavLink to="/logs" className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}>Logs</NavLink>
              <NavLink to="/security" className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}>Security</NavLink>
            </nav>
            <div className="appHeaderActions">
              <button
                type="button"
                className="btn btnSmall btnGhost"
                onClick={() => refreshSubnets().catch(() => {})}
                title={subnetsUpdatedAt ? `Last updated ${subnetsUpdatedAt}` : 'Update cached subnet data'}
              >
                Update subnets
              </button>
              <button
                type="button"
                className="btn btnSmall btnGhost"
                onClick={() => setLogoutConfirmOpen(true)}
              >
                Logout
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {logoutConfirmOpen ? (
        <ConfirmDialog
          title="Log out"
          message="Are you sure you want to log out?"
          confirmText="Log out"
          cancelText="Cancel"
          danger
          onClose={(confirmed) => {
            setLogoutConfirmOpen(false)
            if (confirmed) {
              clearToken()
              setTokenPresent(false)
            }
          }}
        />
      ) : null}
      <div className="spacer16" />

      {tokenPresent ? (
        <>
          <Routes>
            <Route path="/" element={<Dashboard onError={onError} />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/contracts" element={<ContractsView onError={onError} onSuccess={(m) => notify('success', m)} confirm={confirm} subnetByNetuid={subnetByNetuid} />} />
            <Route path="/transactions" element={<TransactionsView onError={onError} onSuccess={(m) => notify('success', m)} subnetByNetuid={subnetByNetuid} />} />
            <Route path="/subnets" element={<SubnetsView onError={onError} subnetByNetuid={subnetByNetuid} />} />
            <Route path="/logs" element={<div className="layoutSingle"><LogsView onError={onError} confirm={confirm} /></div>} />
            <Route path="/security" element={<SecurityView onError={onError} onSuccess={(m) => notify('success', m)} />} />
          </Routes>
          {confirmState ? (
            <ConfirmDialog
              title={confirmState.title}
              message={confirmState.message}
              confirmText={confirmState.confirmText}
              cancelText={confirmState.cancelText}
              danger={confirmState.danger}
              onClose={(result) => {
                confirmState.resolve(result)
                setConfirmState(null)
              }}
            />
          ) : null}
        </>
      ) : (
        <div className="loginCenter">
          <Login
            onLoggedIn={() => {
              setTokenPresent(true)
            }}
            onError={onError}
          />
        </div>
      )}
    </div>
  )
}

function Login(props: { onLoggedIn: () => void; onError: (e: string | null) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [twoFaRequired, setTwoFaRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    get2FARequired()
      .then((r) => setTwoFaRequired(r.required))
      .catch(() => setTwoFaRequired(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    props.onError(null)
    setLocalError(null)
    const u = username.trim()
    const p = password
    if (!u || !p) {
      setLocalError('username and password are required')
      return
    }
    if (twoFaRequired && !totp.trim()) {
      setLocalError('2FA code is required')
      return
    }
    setLoading(true)
    try {
      const resp = await login(u, p, twoFaRequired ? totp.trim() : undefined)
      setToken(resp.token)
      props.onLoggedIn()
    } catch (err: any) {
      const msg = err?.message || 'login_failed'
      props.onError(msg === 'invalid_totp' ? 'Invalid 2FA code' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card loginCard">
      <h2 className="loginTitle">Sign in</h2>
      <div className="muted loginSubtitle">Enter your admin credentials</div>
      <div className="spacer16" />

      <form onSubmit={handleSubmit}>
        <div className="label">Username</div>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />

        <div className="spacer12" />
        <div className="label">Password</div>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {twoFaRequired ? (
          <>
            <div className="spacer12" />
            <div className="label">2FA code (Google Authenticator)</div>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={8}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            />
          </>
        ) : null}

        {localError ? <div className="errorText">{localError}</div> : null}

        <div className="spacer16" />
        <button type="submit" className="btn btnPrimary" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function SecurityView(props: { onError: (e: string | null) => void; onSuccess: (message: string) => void }) {
  const [twoFaEnabled, setTwoFaEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<'idle' | 'enter_current' | 'enter_disable' | 'show_qr' | 'success'>('idle')
  const [currentTotp, setCurrentTotp] = useState('')
  const [disableTotp, setDisableTotp] = useState('')
  const [confirmTotp, setConfirmTotp] = useState('')
  const [setupUri, setSetupUri] = useState('')
  const [setupSecret, setSetupSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadRequired = useCallback(() => {
    setLoading(true)
    setError(null)
    get2FARequired()
      .then((r) => setTwoFaEnabled(r.required))
      .catch(() => setTwoFaEnabled(false))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadRequired()
  }, [loadRequired])

  const startEnable = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const r = await twoFaSetupStart()
      setSetupUri(r.uri)
      setSetupSecret(r.secret)
      setStep('show_qr')
    } catch (e: any) {
      const msg = e?.message || 'Failed to start setup'
      setError(msg)
      props.onError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const startChange = () => {
    setError(null)
    setCurrentTotp('')
    setStep('enter_current')
  }

  const submitCurrentAndShowQr = async () => {
    const code = currentTotp.trim()
    if (!code) {
      setError('Enter your current 2FA code')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const r = await twoFaSetupStart(code)
      setSetupUri(r.uri)
      setSetupSecret(r.secret)
      setStep('show_qr')
      setCurrentTotp('')
    } catch (e: any) {
      const msg = e?.message || 'invalid_totp'
      const display = msg === 'invalid_totp' ? 'Invalid current 2FA code' : msg
      setError(display)
      props.onError(display)
    } finally {
      setSubmitting(false)
    }
  }

  const confirmSetup = async () => {
    const code = confirmTotp.trim()
    if (!code || code.length < 6) {
      setError('Enter the 6-digit code from your app')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await twoFaSetupConfirm(code)
      setStep('success')
      setConfirmTotp('')
      setSetupUri('')
      setSetupSecret('')
      loadRequired()
      props.onSuccess('2FA has been enabled')
    } catch (e: any) {
      const msg = e?.message || 'invalid_totp'
      const display = msg === 'invalid_totp' ? 'Invalid code. Scan the QR code and enter the code from your app.' : msg
      setError(display)
      props.onError(display)
    } finally {
      setSubmitting(false)
    }
  }

  const startDisable = () => {
    setError(null)
    setDisableTotp('')
    setStep('enter_disable')
  }

  const submitDisable = async () => {
    const code = disableTotp.trim()
    if (!code) {
      setError('Enter your current 2FA code')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await twoFaDisable(code)
      setStep('idle')
      setDisableTotp('')
      loadRequired()
      props.onSuccess('2FA has been disabled')
    } catch (e: any) {
      const msg = e?.message || 'invalid_totp'
      const display = msg === 'invalid_totp' ? 'Invalid 2FA code' : msg
      setError(display)
      props.onError(display)
    } finally {
      setSubmitting(false)
    }
  }

  const backToIdle = () => {
    setStep('idle')
    setError(null)
    setCurrentTotp('')
    setDisableTotp('')
    setConfirmTotp('')
    setSetupUri('')
    setSetupSecret('')
  }

  if (loading) {
    return (
      <div className="layoutSingle">
        <div className="card">
          <p className="muted">Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="layoutSingle">
      <div className="card">
        <h2 className="h1" style={{ margin: 0 }}>Security</h2>
        <div className="muted" style={{ marginTop: 8 }}>
          Two-factor authentication (2FA) for login and withdraw. Use an app like Google Authenticator and scan the QR code.
        </div>
        <div className="spacer16" />

        {step === 'idle' && (
          <>
            <p>
              {twoFaEnabled ? (
                <>2FA is <strong>enabled</strong>. You can change it or disable it (you will need your current 2FA code).</>
              ) : (
                <>2FA is <strong>not enabled</strong>. Enable it to require a code at login and when withdrawing.</>
              )}
            </p>
            <div className="spacer12" />
            <div className="rowWrap" style={{ gap: 8 }}>
              {twoFaEnabled ? (
                <>
                  <button type="button" className="btn" onClick={startChange} disabled={submitting}>
                    Change 2FA
                  </button>
                  <button type="button" className="btn btnDanger" onClick={startDisable} disabled={submitting}>
                    Disable 2FA
                  </button>
                </>
              ) : (
                <button type="button" className="btn btnPrimary" onClick={startEnable} disabled={submitting}>
                  {submitting ? 'Starting…' : 'Enable 2FA'}
                </button>
              )}
            </div>
          </>
        )}

        {step === 'enter_disable' && (
          <>
            <div className="label">Enter current 2FA code to disable</div>
            <p className="muted">You will no longer be asked for a code at login or withdraw.</p>
            <div className="spacer12" />
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={8}
              value={disableTotp}
              onChange={(e) => setDisableTotp(e.target.value.replace(/\D/g, ''))}
            />
            {error ? <div className="errorText" style={{ marginTop: 8 }}>{error}</div> : null}
            <div className="spacer12" />
            <div className="rowWrap" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={backToIdle} disabled={submitting}>Cancel</button>
              <button type="button" className="btn btnDanger" onClick={submitDisable} disabled={submitting}>
                {submitting ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </div>
          </>
        )}

        {step === 'enter_current' && (
          <>
            <div className="label">Enter current 2FA code</div>
            <p className="muted">To change 2FA, enter the code from your authenticator app.</p>
            <div className="spacer12" />
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={8}
              value={currentTotp}
              onChange={(e) => setCurrentTotp(e.target.value.replace(/\D/g, ''))}
            />
            {error ? <div className="errorText" style={{ marginTop: 8 }}>{error}</div> : null}
            <div className="spacer12" />
            <div className="rowWrap" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={backToIdle} disabled={submitting}>Cancel</button>
              <button type="button" className="btn btnPrimary" onClick={submitCurrentAndShowQr} disabled={submitting}>
                {submitting ? 'Verifying…' : 'Continue'}
              </button>
            </div>
          </>
        )}

        {step === 'show_qr' && (
          <>
            <p><strong>Scan this QR code</strong> with Google Authenticator (or another TOTP app):</p>
            <div className="spacer12" />
            <div style={{ padding: 16, background: '#fff', borderRadius: 8, display: 'inline-block' }}>
              <QRCodeSVG value={setupUri} size={200} level="M" />
            </div>
            <div className="spacer12" />
            <p className="muted">If you can&apos;t scan, enter this secret manually: <code className="mono" style={{ fontSize: 12 }}>{setupSecret}</code></p>
            <div className="spacer16" />
            <div className="label">Enter the 6-digit code from your app</div>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={8}
              value={confirmTotp}
              onChange={(e) => setConfirmTotp(e.target.value.replace(/\D/g, ''))}
            />
            {error ? <div className="errorText" style={{ marginTop: 8 }}>{error}</div> : null}
            <div className="spacer12" />
            <div className="rowWrap" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={backToIdle} disabled={submitting}>Cancel</button>
              <button type="button" className="btn btnPrimary" onClick={confirmSetup} disabled={submitting || confirmTotp.length < 6}>
                {submitting ? 'Verifying…' : 'Confirm and enable 2FA'}
              </button>
            </div>
          </>
        )}

        {step === 'success' && (
          <>
            <p className="successText">2FA has been enabled. You will need your authenticator code when logging in and when withdrawing.</p>
            <div className="spacer12" />
            <button type="button" className="btn" onClick={backToIdle}>Done</button>
          </>
        )}
      </div>
    </div>
  )
}

function LogsView(props: {
  onError: (e: string | null) => void
  confirm: (input: { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>
}) {
  const [lines, setLines] = useState<string[]>([])
  const [config, setConfig] = useState<{ path: string; available: boolean } | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [stopError, setStopError] = useState<string | null>(null)
  const [clearError, setClearError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const streamRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    getLogsConfig()
      .then((c) => {
        if (!cancelled) {
          setConfig(c)
          setConfigError(null)
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setConfig(null)
          setConfigError(e?.message || 'Failed to load logs config')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (configError || !config?.available) return
    setLines([])
    setStreamError(null)
    streamRef.current = openLogsStream(
      (line) => setLines((prev) => [...prev.slice(-1999), line]),
      (err) => setStreamError(err)
    )
    return () => {
      streamRef.current?.abort()
      streamRef.current = null
    }
  }, [config?.path, config?.available, configError])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [lines])

  if (configError) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div className="muted">Logs not available</div>
        <div className="errorText" style={{ marginTop: 8 }}>{configError}</div>
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Set LOG_FILE_PATH on the server or run the API under PM2.
        </div>
      </div>
    )
  }

  const handleClear = async () => {
    setClearError(null)
    setClearing(true)
    try {
      await flushLogsServer()
      setLines([])
    } catch (e: any) {
      setClearError(e?.message || 'Clear (pm2 flush) failed')
    } finally {
      setClearing(false)
    }
  }

  const handleDownload = async () => {
    setDownloadError(null)
    setDownloading(true)
    try {
      await downloadLogsFile()
    } catch (e: any) {
      setDownloadError(e?.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const handleRestart = async () => {
    const ok = await props.confirm({
      title: 'Restart server',
      message: 'Restart the PM2 process? The log stream may disconnect.',
      confirmText: 'Restart',
      cancelText: 'Cancel',
      danger: true
    })
    if (!ok) return
    setRestartError(null)
    setRestarting(true)
    try {
      await restartLogsServer()
    } catch (e: any) {
      setRestartError(e?.message || 'Restart failed')
    } finally {
      setRestarting(false)
    }
  }

  const handleStop = async () => {
    const ok = await props.confirm({
      title: 'Stop server',
      message: 'Stop the PM2 process? You will need to start it again manually.',
      confirmText: 'Stop',
      cancelText: 'Cancel',
      danger: true
    })
    if (!ok) return
    setStopError(null)
    setStopping(true)
    try {
      await stopLogsServer()
    } catch (e: any) {
      setStopError(e?.message || 'Stop failed')
    } finally {
      setStopping(false)
    }
  }

  return (
    <div>
      <div className="rowWrap" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          {config ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Streaming: {config.path}
            </div>
          ) : null}
          {streamError ? (
            <div className="errorText" style={{ marginTop: 4 }}>{streamError}</div>
          ) : null}
          {restartError ? (
            <div className="errorText" style={{ marginTop: 4 }}>{restartError}</div>
          ) : null}
          {stopError ? (
            <div className="errorText" style={{ marginTop: 4 }}>{stopError}</div>
          ) : null}
          {clearError ? (
            <div className="errorText" style={{ marginTop: 4 }}>{clearError}</div>
          ) : null}
          {downloadError ? (
            <div className="errorText" style={{ marginTop: 4 }}>{downloadError}</div>
          ) : null}
        </div>
        <div className="rowWrap" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btnSmall"
            onClick={handleDownload}
            disabled={downloading || !config?.available}
          >
            {downloading ? 'Downloading…' : 'Download'}
          </button>
          <button
            type="button"
            className="btn btnSmall"
            onClick={handleClear}
            disabled={clearing}
          >
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
          <button
            type="button"
            className="btn btnSmall btnDanger"
            onClick={handleStop}
            disabled={stopping || restarting}
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
          <button
            type="button"
            className="btn btnSmall btnPrimary"
            onClick={handleRestart}
            disabled={restarting || stopping}
          >
            {restarting ? 'Restarting…' : 'Restart'}
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="logsStream logsStreamContainer mono"
      >
        {lines.length === 0 && !streamError ? (
          <div className="logsStreamLine">Connecting…</div>
        ) : (
          lines.map((line, i) => {
            const isPlus =
              line.startsWith('Balance changed: +') || line.startsWith('Staking... [')
            const isMinus =
              line.startsWith('Balance changed: -') || line.includes('Attacking: True')
            const lineClass = isPlus
              ? 'logsStreamLinePlus'
              : isMinus
                ? 'logsStreamLineMinus'
                : 'logsStreamLine'
            return (
              <div key={i} className={lineClass}>
                {isPlus && (
                  <span className="logsStreamIcon" title="Positive" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" y1="9" x2="9.01" y2="9" />
                      <line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                  </span>
                )}
                {isMinus && (
                  <>
                    <span className="logsStreamIcon logsStreamIconSad" title="Balance decreased" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                    </span>
                    <span className="logsStreamIcon logsStreamIconWarning" title="Warning" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </span>
                  </>
                )}
                <span className="logsStreamText">{renderHighlightedLogText(line)}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function renderHighlightedLogText(line: string): React.ReactNode {
  const patterns = ['Mev have staked', 'Staked: True']
  let remaining = line
  const segments: React.ReactNode[] = []
  let key = 0

  while (remaining.length > 0) {
    const found = patterns
      .map((p) => ({ p, idx: remaining.indexOf(p) }))
      .filter((r) => r.idx !== -1)
    if (found.length === 0) {
      segments.push(<span key={key++}>{remaining}</span>)
      break
    }
    const next = found.reduce((min, cur) => (cur.idx < min.idx ? cur : min))
    if (next.idx > 0) {
      segments.push(<span key={key++}>{remaining.slice(0, next.idx)}</span>)
    }
    segments.push(
      <span key={key++} className="logsHighlightGood">
        {next.p}
      </span>
    )
    remaining = remaining.slice(next.idx + next.p.length)
  }

  return segments
}

type DashboardRow = {
  id: string
  name: string
  type: string
  ss58?: string
  ownerAddress: string
  stakesCount: number | null
  total: number | null
  free: number | null
  staked: number | null
  fee: number | null
}

function BalanceStatGrid(props: {
  total: string | null
  free: string | null
  staked: string | null
  fee: string | null
  feeError?: string | null
}) {
  const items = [
    { label: 'Total', value: props.total },
    { label: 'Free', value: props.free },
    { label: 'Staked', value: props.staked },
    {
      label: 'Fee',
      value: props.fee ?? (props.feeError ? `(${props.feeError})` : null)
    }
  ]
  return (
    <div className="statGrid">
      {items.map((item) => (
        <div key={item.label} className="statCard">
          <div className="statCardLabel">{item.label}</div>
          <div className="statCardValue mono">{item.value ?? '—'}</div>
        </div>
      ))}
    </div>
  )
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const diffMs = Date.now() - t
  const diffSec = Math.max(0, Math.floor(diffMs / 1000))
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 48) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d`
}

function format1e9(raw: string): string {
  const bi = safeBigIntString(raw)
  if (bi === null) return String(raw)
  const base = 1_000_000_000n
  const whole = bi / base
  const frac = (bi % base).toString().padStart(9, '0').replace(/0+$/, '')
  return frac ? `${whole.toString()}.${frac}` : whole.toString()
}

function format1e9Fixed3(raw: string): string {
  const bi = safeBigIntString(raw)
  if (bi === null) return String(raw)
  const base = 1_000_000_000n
  const whole = bi / base
  const frac9 = (bi % base).toString().padStart(9, '0')
  const frac3 = frac9.slice(0, 3)
  return `${whole.toString()}.${frac3}`
}

function SubnetPill(props: { netuid: number; subnetByNetuid: Map<number, { name: string; logoUrl: string | null }> }) {
  const meta = props.subnetByNetuid.get(props.netuid) || null
  const name = meta?.name || `Subnet`
  const logoUrl = meta?.logoUrl || null
  return (
    <span className="subnetPill" title={meta?.name ? `${meta.name} (SN${props.netuid})` : `SN${props.netuid}`}>
      <span className="subnetPillLogo" aria-hidden="true">
        {logoUrl ? <img src={logoUrl} alt="" loading="lazy" /> : <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.65)' }}>SN</span>}
      </span>
      <span className="subnetPillText">
        <span className="subnetPillName">{meta?.name || `SN${props.netuid}`}</span>
        <span className="subnetPillSn">{`SN${props.netuid}`}</span>
      </span>
    </span>
  )
}

type SubnetsSortKey = 'netuid' | '1h' | '1d' | '1w' | '1m' | 'price' | 'fear' | 'pool' | 'buy' | 'sell' | 'burn' | 'immune'

function SubnetsView(props: { onError: (e: string | null) => void; subnetByNetuid: Map<number, { name: string; logoUrl: string | null }> }) {
  const [rows, setRows] = useState<DtaoSubnetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sorting, setSorting] = useState<{ key: SubnetsSortKey; dir: 'asc' | 'desc' }>({ key: 'netuid', dir: 'asc' })
  const onErrorRef = useRef(props.onError)
  onErrorRef.current = props.onError

  const fmtNum = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }), [])

  const sortRows = useCallback((list: DtaoSubnetRow[]) => {
    const dir = sorting.dir === 'asc' ? 1 : -1
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v === null || v === undefined ? -Infinity : Number(v))
    return [...list].sort((a, b) => {
      if (sorting.key === 'netuid') return ((a.netuid ?? -1) - (b.netuid ?? -1)) * dir
      if (sorting.key === '1h') return (num(a.price_change_1_hour) - num(b.price_change_1_hour)) * dir
      if (sorting.key === '1d') return (num(a.price_change_1_day) - num(b.price_change_1_day)) * dir
      if (sorting.key === '1w') return (num(a.price_change_1_week) - num(b.price_change_1_week)) * dir
      if (sorting.key === '1m') return (num(a.price_change_1_month) - num(b.price_change_1_month)) * dir
      if (sorting.key === 'price') return (num(a.price) - num(b.price)) * dir
      if (sorting.key === 'fear') return (num(a.fear_and_greed_index) - num(b.fear_and_greed_index)) * dir
      if (sorting.key === 'pool') return (num(a.total_tao) - num(b.total_tao)) * dir
      if (sorting.key === 'buy') return (num(a.tao_buy_volume_24_hr) - num(b.tao_buy_volume_24_hr)) * dir
      if (sorting.key === 'sell') return (num(a.tao_sell_volume_24_hr) - num(b.tao_sell_volume_24_hr)) * dir
      if (sorting.key === 'burn') return (num(a.incentive_burn) - num(b.incentive_burn)) * dir
      if (sorting.key === 'immune') {
        const av = a.is_immune === true ? 1 : a.is_immune === false ? 0 : -1
        const bv = b.is_immune === true ? 1 : b.is_immune === false ? 0 : -1
        return (av - bv) * dir
      }
      return 0
    })
  }, [sorting])
  const fmtInt = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }), [])

  const fmt = useCallback(
    (v: unknown, kind: 'num' | 'int' | 'pct' | 'pct3' | 'rao' = 'num') => {
      const n = typeof v === 'number' ? v : v === null || v === undefined ? null : Number(v)
      if (n === null || !Number.isFinite(n)) return '—'
      if (kind === 'pct') return `${n.toFixed(2)}%`
      if (kind === 'pct3') return `${(n * 100).toFixed(2)}%`
      if (kind === 'rao') {
        const tao = n / 1e9
        return tao.toFixed(1)
      }
      return kind === 'int' ? fmtInt.format(n) : fmtNum.format(n)
    },
    [fmtInt, fmtNum]
  )

  const pctCell = useCallback(
    (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v)
      const cls = Number.isFinite(n) ? (n < 0 ? 'pctNegative' : n > 0 ? 'pctPositive' : '') : ''
      return <span className={cls || undefined}>{fmt(v, 'pct')}</span>
    },
    [fmt]
  )

  const normalizeUrl = useCallback((raw: unknown) => {
    const s = String(raw ?? '').trim()
    if (!s) return null
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    return `https://${s}`
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    listDtaoSubnets()
      .then((resp) => setRows(Array.isArray(resp.data) ? resp.data : []))
      .catch((e: any) => {
        const msg = e?.message || 'failed_to_load_subnets'
        setError(msg)
        onErrorRef.current(msg)
        setRows([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="layoutSingle">
      <div className="card">
        <div className="rowWrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h1" style={{ margin: 0 }}>Subnets</h2>
          <button type="button" className="btn" disabled={loading} onClick={refresh}>
            {loading ? (rows.length > 0 ? 'Refreshing…' : 'Loading…') : 'Refresh'}
          </button>
        </div>
        {error ? <div className="muted" style={{ marginTop: 8 }}>{error}</div> : null}
        <div className="spacer12" />

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 1300 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'netuid' ? { key: 'netuid', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'netuid', dir: 'asc' })}>
                    Subnet{sorting.key === 'netuid' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === '1h' ? { key: '1h', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: '1h', dir: 'desc' })}>
                    1h{sorting.key === '1h' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === '1d' ? { key: '1d', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: '1d', dir: 'desc' })}>
                    1d{sorting.key === '1d' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === '1w' ? { key: '1w', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: '1w', dir: 'desc' })}>
                    1w{sorting.key === '1w' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === '1m' ? { key: '1m', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: '1m', dir: 'desc' })}>
                    1m{sorting.key === '1m' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'price' ? { key: 'price', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'price', dir: 'desc' })}>
                    Price{sorting.key === 'price' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th style={{ whiteSpace: 'normal', lineHeight: 1.2, maxWidth: 80 }}>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'fear' ? { key: 'fear', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'fear', dir: 'desc' })}>
                    Fear &<br />Greed{sorting.key === 'fear' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'pool' ? { key: 'pool', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'pool', dir: 'desc' })}>
                    Pool{sorting.key === 'pool' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'buy' ? { key: 'buy', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'buy', dir: 'desc' })}>
                    Buy 24h{sorting.key === 'buy' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'sell' ? { key: 'sell', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'sell', dir: 'desc' })}>
                    Sell 24h{sorting.key === 'sell' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>URLs</th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'burn' ? { key: 'burn', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'burn', dir: 'desc' })}>
                    Burn %{sorting.key === 'burn' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="tableHeaderBtn" onClick={() => setSorting((s) => s.key === 'immune' ? { key: 'immune', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'immune', dir: 'desc' })}>
                    Immune{sorting.key === 'immune' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filtered = rows.filter((r) => r.netuid !== 0)
                const sorted = sortRows(filtered)
                if (sorted.length === 0 && !loading) {
                  return <tr><td colSpan={14} className="muted">No subnets</td></tr>
                }
                return sorted.map((r, idx) => {
                  const gh = normalizeUrl(r.github)
                  const su = normalizeUrl(r.subnet_url)
                  const netuid = typeof r.netuid === 'number' ? r.netuid : null
                  return (
                    <tr key={`${String(r.netuid ?? '')}-${idx}`}>
                      <td className="mono num">{idx + 1}</td>
                      <td style={{ maxWidth: 280 }}>
                        {netuid !== null ? (
                          <SubnetPill netuid={netuid} subnetByNetuid={props.subnetByNetuid} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="mono num">{pctCell(r.price_change_1_hour)}</td>
                      <td className="mono num">{pctCell(r.price_change_1_day)}</td>
                      <td className="mono num">{pctCell(r.price_change_1_week)}</td>
                      <td className="mono num">{pctCell(r.price_change_1_month)}</td>
                      <td className="mono num">{fmt(r.price)}</td>
                      <td className="mono num" style={{ maxWidth: 80 }}>{fmt(r.fear_and_greed_index, 'int')}</td>
                      <td className="mono num">{fmt(r.total_tao, 'rao')}</td>
                      <td className="mono num">{fmt(r.tao_buy_volume_24_hr, 'rao')}</td>
                      <td className="mono num">{fmt(r.tao_sell_volume_24_hr, 'rao')}</td>
                      <td style={{ maxWidth: 80 }}>
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          {gh ? (
                            <a className="link" href={gh} target="_blank" rel="noreferrer" title={gh} aria-label="GitHub">
                              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                              </svg>
                            </a>
                          ) : null}
                          {su ? (
                            <a className="link" href={su} target="_blank" rel="noreferrer" title={su} aria-label="Subnet URL">
                              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M2 12h20" />
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                              </svg>
                            </a>
                          ) : null}
                          {!gh && !su ? <span className="muted">—</span> : null}
                        </span>
                      </td>
                      <td className="mono num">{fmt(r.incentive_burn, 'pct3')}</td>
                      <td>
                        {r.is_immune === true ? (
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M9 12l2 2 4-4" />
                          </svg>
                        ) : r.is_immune === false ? (
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="muted">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M15 9l-6 6M9 9l6 6" />
                          </svg>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TransactionsView(props: { onError: (e: string | null) => void; onSuccess: (message: string) => void; subnetByNetuid: Map<number, { name: string; logoUrl: string | null }> }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const defaultNominator = (import.meta as any).env?.VITE_NOMINATOR_SS58 || '5H3RkJJNc97S7HPHkKvXVi16wNMxLKSuEmfYoatMXxswkYnT'
  const [nominator, setNominator] = useState(String(searchParams.get('nominator') || defaultNominator))
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [actionFilter, setActionFilter] = useState<'ALL' | 'DELEGATE' | 'UNDELEGATE'>('ALL')
  const [netuidFilter, setNetuidFilter] = useState('')
  const [rows, setRows] = useState<DelegateTxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<{ current_page: number; total_pages: number; next_page: number | null; prev_page: number | null } | null>(null)
  const [copiedDelegate, setCopiedDelegate] = useState<string | null>(null)
  const copyTimerRef = useRef<number | null>(null)

  const copyToClipboard = useCallback(async (text: string) => {
    const t = String(text)
    if (!t) return false
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(t)
        return true
      }
    } catch {
      // fall through
    }
    try {
      const el = document.createElement('textarea')
      el.value = t
      el.setAttribute('readonly', 'true')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      el.style.top = '0'
      document.body.appendChild(el)
      el.focus()
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)
      return ok
    } catch {
      return false
    }
  }, [])

  const refresh = useCallback(() => {
    // Avoid table "blink" on auto-refresh: keep existing rows visible.
    setLoading(true)
    setError(null)
    const action =
      actionFilter === 'UNDELEGATE'
        ? 'undelegate'
        : actionFilter === 'DELEGATE'
          ? 'delegate'
          : undefined
    const netuidValue = (() => {
      const raw = netuidFilter.trim()
      if (!raw) return undefined
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0) return undefined
      return n
    })()

    listDelegateTransactions({ nominator: nominator.trim(), limit, page, action, netuid: netuidValue })
      .then((resp) => {
        setRows(Array.isArray(resp.data) ? resp.data : [])
        const p = resp.pagination
        if (p && typeof p.current_page === 'number') {
          setPagination({
            current_page: p.current_page,
            total_pages: p.total_pages,
            next_page: p.next_page,
            prev_page: p.prev_page
          })
        } else {
          setPagination(null)
        }
      })
      .catch((e: any) => {
        const msg = e?.message || 'failed_to_load_transactions'
        setError(msg)
        props.onError(msg)
        setRows([])
        setPagination(null)
      })
      .finally(() => setLoading(false))
  }, [actionFilter, limit, netuidFilter, nominator, page, props])

  useEffect(() => {
    const fromUrl = (searchParams.get('nominator') || '').trim()
    if (fromUrl && fromUrl !== nominator) {
      setNominator(fromUrl)
      setPage(1)
    }
  }, [searchParams, nominator])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      refresh()
    }, TRANSACTIONS_POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const mapped = useMemo(() => {
    return rows.map((r) => {
      const action = String(r.action || '')
      const side = action === 'UNDELEGATE' ? 'Sell' : action === 'DELEGATE' ? 'Buy' : action
      const cls = action === 'UNDELEGATE' ? 'txnSell' : action === 'DELEGATE' ? 'txnBuy' : 'txnNeutral'
      const rowCls = action === 'UNDELEGATE' ? 'txnRowSell' : action === 'DELEGATE' ? 'txnRowBuy' : 'txnRowNeutral'
      const delegate = r.delegate?.ss58 || '—'
      const alpha = format1e9Fixed3(String(r.alpha ?? ''))
      const tao = format1e9Fixed3(String(r.amount ?? ''))
      const txnUrl = `https://taostats.io/extrinsic/${encodeURIComponent(String(r.extrinsic_id || ''))}`
      const blockUrl = `https://taostats.io/block/${encodeURIComponent(String(r.block_number ?? ''))}/extrinsics`
      return { ...r, side, cls, rowCls, delegate, alpha, tao, txnUrl, blockUrl }
    })
  }, [rows])

  return (
    <div className="layoutSingle">
      <div className="card">
        <div className="rowWrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h1" style={{ margin: 0 }}>Transactions</h2>
          <div className="rowWrap" style={{ gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </button>
            <div className="muted" style={{ fontSize: 13 }}>
              Page <span className="mono">{pagination?.current_page ?? page}</span> / <span className="mono">{pagination?.total_pages ?? '—'}</span>
            </div>
            <button type="button" className="btn" disabled={loading || pagination?.next_page === null} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
            <button type="button" className="btn" disabled={loading} onClick={refresh}>
              {loading ? (rows.length > 0 ? 'Refreshing…' : 'Loading…') : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="spacer12" />
        <div className="rowWrap" style={{ gap: 12, alignItems: 'center' }}>
          <div className="label" style={{ margin: 0 }}>Nominator</div>
          <input
            className="input"
            style={{ maxWidth: 520 }}
            value={nominator}
            onChange={(e) => setNominator(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setPage(1)
                setSearchParams({ nominator: nominator.trim() })
                refresh()
              }
            }}
          />
          <div className="label" style={{ margin: 0 }}>Action</div>
          <select
            className="input"
            style={{ width: 160 }}
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value as any)
              setPage(1)
            }}
          >
            <option value="ALL">All</option>
            <option value="DELEGATE">Buy</option>
            <option value="UNDELEGATE">Sell</option>
          </select>
          <div className="label" style={{ margin: 0 }}>Subnet</div>
          <input
            className="input"
            style={{ width: 140 }}
            value={netuidFilter}
            onChange={(e) => setNetuidFilter(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="e.g. 8"
          />
          <div className="label" style={{ margin: 0 }}>Limit</div>
          <select className="input" style={{ width: 110 }} value={limit} onChange={(e) => { setLimit(Number(e.target.value) || 10); setPage(1) }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>

        <div className="spacer16" />
        {error ? (
          <div className="card cardError">
            <div className="muted">Error</div>
            <div>{error}</div>
          </div>
        ) : (
          <div className="dashboardTableWrap">
            <table className="dashboardTable">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Subnet</th>
                  <th>Delegate</th>
                  <th className="num">Alpha</th>
                  <th className="num">Tao</th>
                  <th>TXN</th>
                  <th>Block</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={8} className="muted">Loading…</td></tr>
                ) : mapped.length === 0 ? (
                  <tr><td colSpan={8} className="muted">No transactions</td></tr>
                ) : (
                  mapped.map((r) => (
                    <tr key={r.id} className={r.rowCls}>
                      <td className="mono">{timeAgo(String(r.timestamp || ''))}</td>
                      <td><span className={`txnAction ${r.cls}`}>{r.side}</span></td>
                      <td>
                        <SubnetPill netuid={r.netuid} subnetByNetuid={props.subnetByNetuid} />
                      </td>
                      <td className="mono">
                        <span className="txnDelegateText">{r.delegate}</span>
                        {r.delegate && r.delegate !== '—' ? (
                          <button
                            type="button"
                            className="txnCopyBtn"
                            onClick={async () => {
                              const ok = await copyToClipboard(r.delegate)
                              if (!ok) return
                              setCopiedDelegate(r.delegate)
                              props.onSuccess('Copied')
                              if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
                              copyTimerRef.current = window.setTimeout(() => {
                                setCopiedDelegate(null)
                                copyTimerRef.current = null
                              }, 1200)
                            }}
                            aria-label="Copy delegate"
                            title={copiedDelegate === r.delegate ? 'Copied' : 'Copy delegate'}
                          >
                            {copiedDelegate === r.delegate ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                        ) : null}
                      </td>
                      <td className="mono num">{r.alpha}</td>
                      <td className="mono num">{r.tao}</td>
                      <td className="mono">
                        {r.extrinsic_id ? (
                          <a href={r.txnUrl} target="_blank" rel="noreferrer" className="txnLink">{r.extrinsic_id}</a>
                        ) : '—'}
                      </td>
                      <td>
                        {Number.isFinite(Number(r.block_number)) ? (
                          <a
                            href={r.blockUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="txnBlockBtn"
                            aria-label="Open block extrinsics"
                            title={`Open block ${r.block_number}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M14 3h7v7" />
                              <path d="M10 14L21 3" />
                              <path d="M21 14v7h-7" />
                              <path d="M3 10V3h7" />
                              <path d="M3 21h7v-7" />
                            </svg>
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Dashboard(props: { onError: (e: string | null) => void }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<DashboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setLocalError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLocalError(null)
    setLoading(true)
    listContracts()
      .then(({ contracts }) => {
        if (!contracts.length) {
          setRows([])
          return
        }
        return Promise.all(
          contracts.map(async (c): Promise<DashboardRow> => {
            try {
              const [bal, stakesResp] = await Promise.all([
                getBalances(c.id),
                listStakes(c.id)
              ])
              const freeStr = formatUnitsLike(bal.contractBalanceWei, bal.decimals, 9)
              const feeStr = formatUnitsLike(bal.ownerBalanceWei, bal.decimals, 9)
              const freeNum = safeDecimalNumber(freeStr)
              const feeNum = safeDecimalNumber(feeStr)
              let stakedNum: number | null = 0
              for (const s of stakesResp.stakes) {
                const tn = safeDecimalNumber(s.taoAmount)
                if (tn === null) {
                  stakedNum = null
                  break
                }
                stakedNum += tn
              }
              const totalNum =
                freeNum !== null && stakedNum !== null ? freeNum + stakedNum : null
              return {
                id: c.id,
                name: c.name,
                type: c.type,
                ss58: c.ss58,
                ownerAddress: c.ownerAddress,
                stakesCount: Array.isArray(stakesResp.stakes) ? stakesResp.stakes.length : 0,
                total: totalNum,
                free: freeNum,
                staked: stakedNum,
                fee: feeNum
              }
            } catch {
              return {
                id: c.id,
                name: c.name,
                type: c.type,
                ss58: c.ss58,
                ownerAddress: c.ownerAddress,
                stakesCount: null,
                total: null,
                free: null,
                staked: null,
                fee: null
              }
            }
          })
        ).then((r) => setRows(r))
      })
      .catch((e: any) => {
        const msg = e?.message || 'Failed to load contracts'
        setLocalError(msg)
        props.onError(msg)
        setRows([])
      })
      .finally(() => setLoading(false))
  }, [props.onError])

  useEffect(() => {
    refresh()
  }, [refresh])

  const sums = useMemo(() => {
    let free = 0
    let staked = 0
    let fee = 0
    let stakesCount = 0
    const seenOwners = new Set<string>()
    for (const r of rows) {
      if (r.free !== null) free += r.free
      if (r.staked !== null) staked += r.staked
      if (r.stakesCount !== null) stakesCount += r.stakesCount
      const ownerKey = String(r.ownerAddress || '').toLowerCase()
      if (r.fee !== null && ownerKey && !seenOwners.has(ownerKey)) {
        seenOwners.add(ownerKey)
        fee += r.fee
      }
    }
    // Avoid rounding drift by deriving Total from summed Free + summed Staked.
    const total = free + staked
    return { total, free, staked, fee, stakesCount }
  }, [rows])

  const fmt = (n: number | null) => (n !== null ? n.toFixed(5) : '—')

  return (
    <div className="layoutSingle">
      <div className="card">
        <div className="rowWrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="h1" style={{ margin: 0 }}>Dashboard</h2>
            <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
              Portfolio overview across {rows.length} contract{rows.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={refresh}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="spacer16" />
        {error ? (
          <div className="card cardError">
            <div className="muted">Error</div>
            <div>{error}</div>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="muted">Loading…</div>
        ) : (
          <>
            <BalanceStatGrid
              total={rows.length ? sums.total.toFixed(5) : null}
              free={rows.length ? sums.free.toFixed(5) : null}
              staked={rows.length ? sums.staked.toFixed(5) : null}
              fee={rows.length ? sums.fee.toFixed(5) : null}
            />
            <div className="spacer20" />
            {rows.length === 0 ? (
              <div className="dashboardEmpty">
                <div className="muted">No contracts yet</div>
                <Link to="/contracts" className="btn btnPrimary" style={{ marginTop: 12 }}>
                  Add a contract
                </Link>
              </div>
            ) : (
              <div className="dashboardTableWrap">
                <table className="dashboardTable">
                  <thead>
                    <tr>
                      <th>Contract</th>
                      <th>Type</th>
                      <th>TX</th>
                      <th className="num">Stakes</th>
                      <th className="num">Total</th>
                      <th className="num">Free</th>
                      <th className="num">Staked</th>
                      <th className="num">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="dashboardTableRowClickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/contracts?id=${encodeURIComponent(r.id)}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            navigate(`/contracts?id=${encodeURIComponent(r.id)}`)
                          }
                        }}
                      >
                        <td>
                          <div className="dashboardContractName">{r.name}</div>
                        </td>
                        <td><span className="badge">{r.type}</span></td>
                        <td>
                          {r.ss58 ? (
                            <Link
                              to={`/transactions?nominator=${encodeURIComponent(r.ss58)}`}
                              className="txnGoBtn"
                              onClick={(e) => e.stopPropagation()}
                              title="Open transactions"
                              aria-label="Open transactions"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M14 3h7v7" />
                                <path d="M10 14L21 3" />
                                <path d="M21 14v7h-7" />
                                <path d="M3 10V3h7" />
                                <path d="M3 21h7v-7" />
                              </svg>
                            </Link>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="mono num">{r.stakesCount === null ? '—' : r.stakesCount}</td>
                        <td className="mono num">{fmt(r.total)}</td>
                        <td className="mono num">{fmt(r.free)}</td>
                        <td className="mono num">{fmt(r.staked)}</td>
                        <td className="mono num">{fmt(r.fee)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="dashboardTableFoot">
                      <th>Total</th>
                      <th aria-hidden="true" />
                      <th aria-hidden="true" />
                      <th className="mono num">{sums.stakesCount}</th>
                      <th className="mono num">{sums.total.toFixed(5)}</th>
                      <th className="mono num">{sums.free.toFixed(5)}</th>
                      <th className="mono num">{sums.staked.toFixed(5)}</th>
                      <th className="mono num">{sums.fee.toFixed(5)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ContractsView(props: {
  onError: (e: string | null) => void
  onSuccess: (message: string) => void
  confirm: (input: { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>
  subnetByNetuid: Map<number, { name: string; logoUrl: string | null }>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('id'))
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [copied, setCopied] = useState<null | 'contract_address' | 'owner_address' | 'ss58'>(null)
  const copyTimerRef = useRef<number | null>(null)

  const copyToClipboard = useCallback(async (text: string) => {
    const t = String(text)
    if (!t) return false
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(t)
        return true
      }
    } catch {
      // fall through
    }

    try {
      const el = document.createElement('textarea')
      el.value = t
      el.setAttribute('readonly', 'true')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      el.style.top = '0'
      document.body.appendChild(el)
      el.focus()
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)
      return ok
    } catch {
      return false
    }
  }, [])

  const [globalBusy, setGlobalBusy] = useState(false)

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [selectModalOpen, setSelectModalOpen] = useState(false)
  const [selectQuery, setSelectQuery] = useState('')

  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0)

  const [owners, setOwners] = useState<{ index: number; address: string }[]>([])
  const [ownersLoading, setOwnersLoading] = useState(false)
  const [ownersError, setOwnersError] = useState<string | null>(null)

  const selected = useMemo(() => contracts.find((c) => c.id === selectedId) || null, [contracts, selectedId])

  useEffect(() => {
    const idFromUrl = searchParams.get('id')
    if (idFromUrl && contracts.some((c) => c.id === idFromUrl)) {
      setSelectedId(idFromUrl)
    }
  }, [searchParams, contracts])

  const filteredContracts = useMemo(() => {
    const q = selectQuery.trim().toLowerCase()
    if (!q) return contracts
    return contracts.filter((c) => {
      const name = String((c as any).name || '').toLowerCase()
      const addr = c.address.toLowerCase()
      const owner = c.ownerAddress.toLowerCase()
      return name.includes(q) || addr.includes(q) || owner.includes(q) || c.id.toLowerCase().includes(q)
    })
  }, [contracts, selectQuery])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await listContracts()
      setContracts(resp.contracts)
      const idFromUrl = searchParams.get('id')
      if (idFromUrl && resp.contracts.some((c) => c.id === idFromUrl)) {
        setSelectedId(idFromUrl)
      } else if (resp.contracts.length && !selectedId) {
        setSelectedId(resp.contracts[0].id)
      } else if (selectedId && !resp.contracts.some((c) => c.id === selectedId)) {
        setSelectedId(resp.contracts[0]?.id ?? null)
      }
    } catch (e: any) {
      props.onError(e?.message || 'failed_to_load_contracts')
    } finally {
      setLoading(false)
    }
  }, [props.onError, searchParams, selectedId])

  const refreshAll = useCallback(async () => {
    await refresh()
    setDetailRefreshNonce((n) => n + 1)
  }, [refresh])

  // Load contracts once on mount; use Refresh button or navigation for updates
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshOwners = useCallback(async () => {
    setOwnersLoading(true)
    setOwnersError(null)
    try {
      const resp = await listOwners()
      setOwners(resp.owners)
    } catch (e: any) {
      setOwners([])
      setOwnersError(e?.message || 'failed_to_load_owners')
    } finally {
      setOwnersLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshOwners()
  }, [refreshOwners])

  return (
    <div className="layoutSingle">
      <div className="card">
        <div className="cardHeader">
          <div>
            {selected ? (
              <div className="cardHeaderAddressBox">
                <span className="cardHeaderNameType">{selected.name} ({selected.type})</span>
                <div className="cardHeaderAddressRow">
                  <span className="cardHeaderAddressLabel">Contract</span>
                  <span className="cardHeaderAddressValue truncate" title={selected.address}>
                    {shortAddress(selected.address)}
                  </span>
                  <button
                    type="button"
                    className="cardHeaderCopyBtn"
                    disabled={globalBusy}
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        const ok = await copyToClipboard(selected.address)
                        if (!ok) throw new Error('failed_to_copy')
                        setCopied('contract_address')
                        props.onSuccess('Copied')
                        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
                        copyTimerRef.current = window.setTimeout(() => {
                          setCopied(null)
                          copyTimerRef.current = null
                        }, 1200)
                      } catch {
                        props.onError('failed_to_copy')
                      }
                    }}
                    aria-label="Copy contract address"
                    title="Copy contract address"
                  >
                    {copied === 'contract_address' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="cardHeaderAddressRow">
                  <span className="cardHeaderAddressLabel">
                    {typeof selected.ownerIndex === 'number' ? `Owner #${selected.ownerIndex}` : 'Owner'}
                  </span>
                  <span className="cardHeaderAddressValue truncate" title={selected.ownerAddress}>
                    {shortAddress(selected.ownerAddress)}
                  </span>
                  <button
                    type="button"
                    className="cardHeaderCopyBtn"
                    disabled={globalBusy}
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        const ok = await copyToClipboard(selected.ownerAddress)
                        if (!ok) throw new Error('failed_to_copy')
                        setCopied('owner_address')
                        props.onSuccess('Copied')
                        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
                        copyTimerRef.current = window.setTimeout(() => {
                          setCopied(null)
                          copyTimerRef.current = null
                        }, 1200)
                      } catch {
                        props.onError('failed_to_copy')
                      }
                    }}
                    aria-label="Copy owner address"
                    title="Copy owner address"
                  >
                    {copied === 'owner_address' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                </div>
                {selected.ss58 ? (
                  <div className="cardHeaderAddressRow">
                    <span className="cardHeaderAddressLabel">SS58</span>
                    <span className="cardHeaderAddressValue truncate" title={selected.ss58}>
                      {shortSs58(selected.ss58)}
                    </span>
                    <button
                      type="button"
                      className="cardHeaderCopyBtn"
                      disabled={globalBusy}
                      onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          const ok = await copyToClipboard(selected.ss58 || '')
                          if (!ok) throw new Error('failed_to_copy')
                          setCopied('ss58')
                          props.onSuccess('Copied')
                          if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
                          copyTimerRef.current = window.setTimeout(() => {
                            setCopied(null)
                            copyTimerRef.current = null
                          }, 1200)
                        } catch {
                          props.onError('failed_to_copy')
                        }
                      }}
                      aria-label="Copy ss58"
                      title="Copy ss58"
                    >
                      {copied === 'ss58' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                    <Link
                      to={`/transactions?nominator=${encodeURIComponent(selected.ss58)}`}
                      className="txnGoBtn"
                      title="Open transactions"
                      aria-label="Open transactions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 3h7v7" />
                        <path d="M10 14L21 3" />
                        <path d="M21 14v7h-7" />
                        <path d="M3 10V3h7" />
                        <path d="M3 21h7v-7" />
                      </svg>
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rowWrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <div className="row" style={{ gap: 8 }}>
              <div className="muted">Total</div>
              <div className="badge">{contracts.length}</div>
            </div>
            <button
              className="btn"
              disabled={globalBusy || contracts.length === 0}
              onClick={() => {
                setSelectQuery('')
                setSelectModalOpen(true)
              }}
            >
              Select
            </button>
            <button
              className="btn btnPrimary"
              disabled={globalBusy}
              onClick={() => {
                setCreateError(null)
                setAddModalOpen(true)
              }}
            >
              Add
            </button>
            <button className="btn" disabled={loading || globalBusy} onClick={refreshAll}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="spacer16" />

      {selected ? (
        <ContractDetail
          key={selected.id}
          contract={selected}
          refreshNonce={detailRefreshNonce}
          requestRefresh={() => setDetailRefreshNonce((n) => n + 1)}
          subnetByNetuid={props.subnetByNetuid}
        />
      ) : (
        <div className="muted">Select a contract from the list</div>
      )}
    </div>

      {addModalOpen ? (
        <Modal
          title="Add contract"
          onClose={() => {
            if (globalBusy || creating) return
            setAddModalOpen(false)
          }}
        >
          <ContractCreate
            owners={owners}
            ownersLoading={ownersLoading}
            ownersError={ownersError}
            creating={creating}
            disabled={globalBusy}
            error={createError}
            confirm={props.confirm}
            onCreate={async (input: {
              name: string
              type: 'MEV' | 'TradingV7' | 'Unknown'
              address: string
              ownerAddress: string
              ownerIndex?: number
              withdrawerAddress: string
              withdrawerIndex?: number
              abiFile?: string
              coldkey?: string
            }) => {
              props.onError(null)
              setCreateError(null)
              setCreating(true)
              try {
                const resp = await createContract(input)
                await refresh()
                setSelectedId(resp.contract.id)
                setSearchParams({ id: resp.contract.id })
                setAddModalOpen(false)
                props.onSuccess('Contract added')
              } catch (e: any) {
                const msg = e?.message || 'create_failed'
                if (msg === 'duplicate_name') setCreateError('name already exists')
                else if (msg === 'name_required') setCreateError('name is required')
                else setCreateError(msg)
                if (e?.message === 'unauthorized') {
                  setOwnersError('unauthorized')
                }
              } finally {
                setCreating(false)
              }
            }}
          />
        </Modal>
      ) : null}

      {selectModalOpen ? (
        <Modal
          title="Select contract"
          onClose={() => {
            if (globalBusy) return
            setSelectModalOpen(false)
          }}
        >
          <div className="label">Search</div>
          <input
            className="input"
            value={selectQuery}
            disabled={globalBusy}
            onChange={(e) => setSelectQuery(e.target.value)}
            placeholder="name / address / owner / id"
          />

          <div className="spacer12" />

          {filteredContracts.length === 0 ? (
            <div className="muted">No matches</div>
          ) : (
            <div className="list" style={{ maxHeight: 420, overflow: 'auto' }}>
              {filteredContracts.map((c) => (
                <div
                  key={c.id}
                  className={`listItem ${selectedId === c.id ? 'listItemActive' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-selected={selectedId === c.id}
                  onClick={() => {
                    if (globalBusy) return
                    setSelectedId(c.id)
                    setSearchParams({ id: c.id })
                    setSelectModalOpen(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (globalBusy) return
                      setSelectedId(c.id)
                      setSearchParams({ id: c.id })
                      setSelectModalOpen(false)
                    }
                  }}
                >
                  <div className="listItemMain">
                    <div className="listItemAvatar" aria-hidden="true">
                      {listItemInitial((c as ContractRecord).name)}
                    </div>
                    <div className="listItemDetails">
                      <div className="listItemName">
                        <span className="truncate" title={(c as ContractRecord).name}>
                          {(c as ContractRecord).name}
                        </span>
                        <span className="listItemTypeBadge">{(c as ContractRecord).type}</span>
                      </div>
                      <div className="listItemMeta">
                        <div className="listItemMetaRow">
                          <span className="listItemMetaLabel">Contract</span>
                          <span className="mono truncate" title={c.address}>
                            {shortAddress(c.address)}
                          </span>
                        </div>
                        <div className="listItemMetaRow">
                          <span className="listItemMetaLabel">
                            {typeof c.ownerIndex === 'number' ? `Owner #${c.ownerIndex}` : 'Owner'}
                          </span>
                          <span className="mono truncate" title={c.ownerAddress}>
                            {shortAddress(c.ownerAddress)}
                          </span>
                        </div>
                        {(c as ContractRecord).createdAt ? (
                          <div className="listItemMetaRow">
                            <span className="listItemMetaLabel">Added</span>
                            <span>{formatContractDate((c as ContractRecord).createdAt)}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="rowWrap listItemActions">
                    <span className={`badge ${selectedId === c.id ? 'badgeSelected' : ''}`}>{selectedId === c.id ? 'Selected' : 'Contract'}</span>
                    <button
                      type="button"
                      className="btn btnDanger btnSmall btnIcon"
                      disabled={globalBusy || deletingId === c.id}
                      aria-label="Delete contract"
                      title="Delete contract"
                      onClick={async (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const ok = await props.confirm({
                          title: 'Delete contract',
                          message: `Delete this contract from the list?\n\n${c.address}`,
                          confirmText: 'Delete',
                          cancelText: 'Cancel',
                          danger: true
                        })
                        if (!ok) return
                        props.onError(null)
                        setDeletingId(c.id)
                        try {
                          await deleteContract(c.id)
                          await refresh()
                          props.onSuccess('Contract deleted')
                        } catch (err: any) {
                          props.onError(err?.message || 'delete_failed')
                        } finally {
                          setDeletingId(null)
                        }
                      }}
                    >
                      {deletingId === c.id ? (
                        '…'
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M10 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="spacer12" />
          <div className="rowWrap" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" disabled={globalBusy} onClick={() => setSelectModalOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props])

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="modalTitle">{props.title}</div>
          <button type="button" className="btn btnSmall btnGhost" aria-label="Close" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="spacer12" />
        {props.children}
      </div>
    </div>
  )
}

function ContractCreate(props: {
  owners: { index: number; address: string }[]
  ownersLoading: boolean
  ownersError: string | null
  creating: boolean
  disabled: boolean
  error: string | null
  confirm: (input: { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>
  onCreate: (input: {
    name: string
    type: 'MEV' | 'TradingV7' | 'Unknown'
    address: string
    ownerAddress: string
    ownerIndex?: number
    withdrawerAddress: string
    withdrawerIndex?: number
    abiFile?: string
    coldkey?: string
  }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'MEV' | 'TradingV7' | 'Unknown'>('TradingV7')
  const [address, setAddress] = useState('')
  const [ownerIndex, setOwnerIndex] = useState<string>('')
  const [withdrawerIndex, setWithdrawerIndex] = useState<string>('')
  const [abiFile, setAbiFile] = useState('')
  const [abiFiles, setAbiFiles] = useState<string[] | null>(null)
  const [abiFilesError, setAbiFilesError] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!ownerIndex && props.owners.length > 0) {
      setOwnerIndex(String(props.owners[0]!.index))
    }
  }, [ownerIndex, props.owners])

  useEffect(() => {
    if (!withdrawerIndex && props.owners.length > 0) {
      setWithdrawerIndex(String(props.owners[0]!.index))
    }
  }, [withdrawerIndex, props.owners])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setAbiFilesError(null)
      try {
        const resp = await listAbiFiles()
        if (cancelled) return
        setAbiFiles(resp.files)
      } catch (e: any) {
        if (cancelled) return
        setAbiFiles(null)
        setAbiFilesError(e?.message || 'failed_to_load_abi_files')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedOwner = useMemo(() => {
    const idx = Number(ownerIndex)
    if (!Number.isInteger(idx)) return null
    return props.owners.find((o) => o.index === idx) || null
  }, [ownerIndex, props.owners])

  const selectedWithdrawer = useMemo(() => {
    const idx = Number(withdrawerIndex)
    if (!Number.isInteger(idx)) return null
    return props.owners.find((o) => o.index === idx) || null
  }, [withdrawerIndex, props.owners])

  const selectableAbiFiles = useMemo(() => {
    if (!abiFiles) return []
    return abiFiles.filter(
      (f) => f !== 'IStaking.json' && f !== 'IAlpha.json'
    )
  }, [abiFiles])

  return (
    <div>
      <div className="muted">Add contract</div>
      <div className="spacer12" />

      <div className="label">Name</div>
      <input
        className="input"
        value={name}
        disabled={props.disabled || props.creating}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Main Staking"
      />

      <div className="spacer12" />
      <div className="label">Type</div>
      <select
        className="input"
        value={type}
        disabled={props.disabled || props.creating}
        onChange={(e) => setType(e.target.value as 'MEV' | 'TradingV7' | 'Unknown')}
      >
        <option value="TradingV7">TradingV7</option>
        <option value="MEV">MEV</option>
        <option value="Unknown">Unknown</option>
      </select>

      <div className="label">Contract address</div>
      <input
        className="input mono"
        value={address}
        disabled={props.disabled || props.creating}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="0x…"
      />

      <div className="spacer12" />
      <div className="label">Owner address</div>
      <select
        className="input mono"
        value={ownerIndex}
        onChange={(e) => setOwnerIndex(e.target.value)}
        disabled={props.disabled || props.creating || props.ownersLoading || props.owners.length === 0}
      >
        {props.ownersLoading ? <option value="">Loading…</option> : null}
        {!props.ownersLoading && props.owners.length === 0 ? <option value="">No owners configured</option> : null}
        {props.owners.map((o) => (
          <option key={o.address} value={String(o.index)}>
            {shortAddress(o.address)}
          </option>
        ))}
      </select>

      {props.ownersError ? <div className="errorText">{props.ownersError}</div> : null}

      <div className="spacer12" />
      <div className="label">Withdrawer address</div>
      <select
        className="input mono"
        value={withdrawerIndex}
        onChange={(e) => setWithdrawerIndex(e.target.value)}
        disabled={props.disabled || props.creating || props.ownersLoading || props.owners.length === 0}
      >
        {props.ownersLoading ? <option value="">Loading…</option> : null}
        {!props.ownersLoading && props.owners.length === 0 ? <option value="">No owners configured</option> : null}
        {props.owners.map((o) => (
          <option key={`${o.address}_${o.index}`} value={String(o.index)}>
            {shortAddress(o.address)}
          </option>
        ))}
      </select>

      <div className="spacer12" />
      <div className="label">ABI file</div>
      {selectableAbiFiles.length > 0 ? (
        <select
          className="input"
          value={abiFile}
          disabled={props.disabled || props.creating}
          onChange={(e) => setAbiFile(e.target.value)}
        >
          <option value="" disabled>
            Select ABI file…
          </option>
          {selectableAbiFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input"
          value={abiFile}
          disabled={props.disabled || props.creating}
          onChange={(e) => setAbiFile(e.target.value)}
          placeholder="TradingV1.json"
        />
      )}

      {abiFilesError ? <div className="errorText">{abiFilesError}</div> : null}

      {localError ? <div className="errorText">{localError}</div> : null}
      {props.error ? <div className="errorText">{props.error}</div> : null}

      <div className="spacer16" />
      <button
        className="btn btnPrimary"
        disabled={props.disabled || props.creating}
        onClick={async () => {
          setLocalError(null)
          const n = name.trim()
          const a = address.trim()
          const o = selectedOwner?.address?.trim() || ''
          const w = selectedWithdrawer?.address?.trim() || ''
          if (!n) {
            setLocalError('name is required')
            return
          }
          if (!isLikelyAddress(a)) {
            setLocalError('invalid contract address')
            return
          }
          if (props.owners.length === 0) {
            setLocalError('no owner keys configured on backend')
            return
          }
          if (!isLikelyAddress(o)) {
            setLocalError('invalid owner address')
            return
          }
          if (!isLikelyAddress(w)) {
            setLocalError('invalid withdrawer address')
            return
          }
          if (selectableAbiFiles.length > 0 && !abiFile.trim()) {
            setLocalError('ABI file is required')
            return
          }

          const ok = await props.confirm({
            title: 'Add contract',
            message: `Add this contract?\n\nname=${n}\ntype=${type}\ncontract=${a}\nowner#${selectedOwner?.index ?? ''}=${o}\nwithdrawer#${selectedWithdrawer?.index ?? ''}=${w}`,
            confirmText: 'Add',
            cancelText: 'Cancel'
          })
          if (!ok) return

          await props.onCreate({
            name: n,
            type,
            address: a,
            ownerAddress: o,
            ownerIndex: selectedOwner?.index,
            withdrawerAddress: w,
            withdrawerIndex: selectedWithdrawer?.index,
            abiFile: abiFile.trim() ? abiFile.trim() : undefined,
            // coldkey + ss58 are derived on the backend from the contract address
          })
          setName('')
          setType('TradingV7')
          setAddress('')
          setOwnerIndex('')
          setWithdrawerIndex('')
          setAbiFile('')
        }}
      >
        {props.creating ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}

function ContractDetail(props: {
  contract: ContractRecord
  refreshNonce: number
  requestRefresh: () => void
  subnetByNetuid: Map<number, { name: string; logoUrl: string | null }>
}) {
  const [stakes, setStakes] = useState<StakeRow[]>([])
  const [stakesError, setStakesError] = useState<string | null>(null)
  const [stakesLoading, setStakesLoading] = useState(false)
  const [balances, setBalances] = useState<null | {
    ownerBalanceWei: string
    contractBalanceWei: string
    decimals: number
  }>(null)
  const [balancesError, setBalancesError] = useState<string | null>(null)
  const [sorting, setSorting] = useState<{ key: 'netuid' | 'alpha' | 'tao' | 'pool' | 'pct'; dir: 'asc' | 'desc' }>({
    key: 'tao',
    dir: 'desc'
  })

  const refreshStakes = useCallback(async (signal?: AbortSignal) => {
    const contractId = props.contract.id
    setStakesLoading(true)
    setStakesError(null)
    try {
      const resp = await listStakes(contractId, { signal })
      if (signal?.aborted) return
      if (contractId === props.contract.id) {
        setStakes(resp.stakes)
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      if (contractId === props.contract.id) {
        setStakesError(e?.message || 'failed_to_load_stakes')
      }
    } finally {
      if (!signal?.aborted && contractId === props.contract.id) {
        setStakesLoading(false)
      }
    }
  }, [props.contract.id])

  const refreshBalances = useCallback(async (signal?: AbortSignal) => {
    const contractId = props.contract.id
    setBalancesError(null)
    setBalances(null)
    try {
      const resp = await getBalances(contractId, { signal })
      if (signal?.aborted) return
      if (contractId === props.contract.id) {
        setBalances({
          ownerBalanceWei: resp.ownerBalanceWei,
          contractBalanceWei: resp.contractBalanceWei,
          decimals: resp.decimals
        })
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      if (contractId === props.contract.id) {
        setBalances(null)
        setBalancesError(e?.message || 'failed_to_load_balances')
      }
    }
  }, [props.contract.id])

  const prevContractIdRef = useRef(props.contract.id)
  useEffect(() => {
    const contractChanged = prevContractIdRef.current !== props.contract.id
    prevContractIdRef.current = props.contract.id
    const controller = new AbortController()
    const { signal } = controller
    if (contractChanged) {
      setStakes([])
      setStakesError(null)
    }
    refreshStakes(signal)
    refreshBalances(signal)
    return () => controller.abort()
  }, [props.contract.id, props.refreshNonce, refreshStakes, refreshBalances])

  const ownerBalanceDisplay = useMemo(
    () => (balances ? formatUnitsLike(balances.ownerBalanceWei, balances.decimals) : null),
    [balances]
  )
  const contractBalanceDisplay = useMemo(
    () => (balances ? formatUnitsLike(balances.contractBalanceWei, balances.decimals) : null),
    [balances]
  )

  const sortedStakes = useMemo(() => {
    const copy = [...stakes]

    const dir = sorting.dir === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      if (sorting.key === 'netuid') {
        return (a.netuid - b.netuid) * dir
      }

      if (sorting.key === 'pool') {
        const an = safeDecimalNumber(String(a.taoInPool ?? '').trim())
        const bn = safeDecimalNumber(String(b.taoInPool ?? '').trim())
        if (an !== null && bn !== null) return (an === bn ? 0 : an > bn ? 1 : -1) * dir
        if (an !== null) return 1 * dir
        if (bn !== null) return -1 * dir
        return 0
      }

      if (sorting.key === 'pct') {
        const asp = safeDecimalNumber(String(a.stakedPrice ?? '').trim())
        const acp = safeDecimalNumber(String(a.currentPrice ?? '').trim())
        const bsp = safeDecimalNumber(String(b.stakedPrice ?? '').trim())
        const bcp = safeDecimalNumber(String(b.currentPrice ?? '').trim())
        const ap = asp !== null && acp !== null && asp !== 0 ? ((acp - asp) / asp) * 100 : null
        const bp = bsp !== null && bcp !== null && bsp !== 0 ? ((bcp - bsp) / bsp) * 100 : null
        if (ap !== null && bp !== null) return (ap === bp ? 0 : ap > bp ? 1 : -1) * dir
        if (ap !== null) return 1 * dir
        if (bp !== null) return -1 * dir
        return 0
      }

      const av = sorting.key === 'alpha' ? a.alphaAmount : a.taoAmount
      const bv = sorting.key === 'alpha' ? b.alphaAmount : b.taoAmount
      const abi = safeBigInt(av)
      const bbi = safeBigInt(bv)
      if (abi !== null && bbi !== null) {
        return (abi === bbi ? 0 : abi > bbi ? 1 : -1) * dir
      }

      const an = safeDecimalNumber(av)
      const bn = safeDecimalNumber(bv)
      if (an !== null && bn !== null) {
        return (an === bn ? 0 : an > bn ? 1 : -1) * dir
      }
      return String(av).localeCompare(String(bv)) * dir
    })
    return copy
  }, [stakes, sorting])

  const [stakesNetuidQuery, setStakesNetuidQuery] = useState('')

  const visibleStakes = useMemo(() => {
    const q = stakesNetuidQuery.trim()
    const qDigits = q.replace(/[^\d]/g, '')
    return sortedStakes.filter((s) => {
      if (qDigits) {
        if (!String(s.netuid).includes(qDigits)) return false
      }

      const alphaRaw = String(s.alphaAmount ?? '').trim()
      const taoRaw = String(s.taoAmount ?? '').trim()

      const a = safeBigInt(s.alphaAmount)
      const t = safeBigInt(s.taoAmount)
      if (a !== null && a !== 0n) return true
      if (t !== null && t !== 0n) return true

      const an = safeDecimalNumber(s.alphaAmount)
      const tn = safeDecimalNumber(s.taoAmount)
      if (an !== null && an !== 0) return true
      if (tn !== null && tn !== 0) return true

      if (alphaRaw.includes('.') || taoRaw.includes('.')) return true

      if (a === null && an === null && t === null && tn === null) return true
      return false
    })
  }, [sortedStakes, stakesNetuidQuery])
  const [stakesPageSize, setStakesPageSize] = useState(15)
  const [stakesPage, setStakesPage] = useState(0)

  useEffect(() => {
    setStakesPage(0)
  }, [props.contract.id, sorting.key, sorting.dir, stakesPageSize, stakesNetuidQuery])

  useEffect(() => {
    setStakesNetuidQuery('')
  }, [props.contract.id])

  const stakesTotalCount = visibleStakes.length
  const stakesPageCount = useMemo(() => {
    return Math.max(1, Math.ceil(visibleStakes.length / Math.max(1, stakesPageSize)))
  }, [visibleStakes, stakesPageSize])

  const pagedStakes = useMemo(() => {
    const size = Math.max(1, stakesPageSize)
    const page = Math.min(Math.max(0, stakesPage), Math.max(0, stakesPageCount - 1))
    const start = page * size
    return visibleStakes.slice(start, start + size)
  }, [stakesPage, stakesPageCount, stakesPageSize, visibleStakes])

  const totals = useMemo(() => {
    let alpha: bigint | null = 0n
    let tao: bigint | null = 0n
    let alphaNum: number | null = 0
    let taoNum: number | null = 0
    for (const s of stakes) {
      const a = safeBigInt(s.alphaAmount)
      const t = safeBigInt(s.taoAmount)
      if (a === null) alpha = null
      if (t === null) tao = null
      if (alpha !== null && a !== null) alpha += a
      if (tao !== null && t !== null) tao += t

      const an = safeDecimalNumber(s.alphaAmount)
      const tn = safeDecimalNumber(s.taoAmount)
      if (an === null) alphaNum = null
      if (tn === null) taoNum = null
      if (alphaNum !== null && an !== null) alphaNum += an
      if (taoNum !== null && tn !== null) taoNum += tn
    }
    return { alpha, tao, alphaNum, taoNum }
  }, [stakes])

  const freeContractBalanceNum = useMemo(() => {
    if (!contractBalanceDisplay) return null
    return safeDecimalNumber(contractBalanceDisplay)
  }, [contractBalanceDisplay])

  const totalBalanceDisplay = useMemo(() => {
    if (!contractBalanceDisplay) return null
    if (totals.taoNum === null) return null
    if (freeContractBalanceNum === null) return null
    return (freeContractBalanceNum + totals.taoNum).toFixed(5)
  }, [contractBalanceDisplay, freeContractBalanceNum, totals])

  return (
    <div>
      <BalanceStatGrid
        total={totalBalanceDisplay}
        free={contractBalanceDisplay}
        staked={totals.taoNum !== null ? totals.taoNum.toFixed(5) : null}
        fee={ownerBalanceDisplay}
        feeError={balancesError}
      />

      <div className="spacer20" />

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="sectionTitle">Current stakes</div>
        </div>

        <div className="rowWrap" style={{ alignItems: 'center' }}>
          {stakesLoading ? (
            <svg width="16" height="16" viewBox="0 0 50 50" aria-hidden="true">
              <circle
                cx="25"
                cy="25"
                r="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray="31.4 31.4"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 25 25"
                  to="360 25 25"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          ) : null}
        </div>
      </div>

      <div className="spacer12" />

      {stakesError ? <div className="errorText">{stakesError}</div> : null}

      {stakesLoading && !stakes.length ? (
        <div className="muted">Loading…</div>
      ) : (
        <div>
              <div className="rowWrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="muted" style={{ fontSize: 13 }}>
                  {(() => {
                    const total = stakesTotalCount
                    const size = Math.max(1, stakesPageSize)
                    const page = Math.min(Math.max(0, stakesPage), Math.max(0, stakesPageCount - 1))
                    const start = total === 0 ? 0 : page * size + 1
                    const end = Math.min(total, (page + 1) * size)
                    return `${start}-${end} of ${total}`
                  })()}
                </div>
                <div className="rowWrap" style={{ alignItems: 'center', gap: 8 }}>
                  <input
                    className="input"
                    style={{ width: 180 }}
                    inputMode="numeric"
                    value={stakesNetuidQuery}
                    disabled={stakesLoading}
                    onChange={(e) => setStakesNetuidQuery(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="Search netuid"
                  />
                  <div className="muted" style={{ fontSize: 13 }}>
                    Page size
                  </div>
                  <select
                    className="input"
                    style={{ width: 100 }}
                    value={String(stakesPageSize)}
                    disabled={stakesLoading}
                    onChange={(e) => setStakesPageSize(Number(e.target.value) || 15)}
                  >
                    <option value="10">10</option>
                    <option value="15">15</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                  <button
                    className="btn"
                    disabled={stakesLoading || stakesPage <= 0}
                    onClick={() => setStakesPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <div className="badge">
                    {Math.min(stakesPage + 1, stakesPageCount)} / {stakesPageCount}
                  </div>
                  <button
                    className="btn"
                    disabled={stakesLoading || stakesPage >= stakesPageCount - 1}
                    onClick={() => setStakesPage((p) => Math.min(stakesPageCount - 1, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="spacer12" />

              {visibleStakes && visibleStakes.length === 0 ? (
                <div className="muted">No results</div>
              ) : null}

              <div style={{ overflowX: 'auto' }}>
                <table className="table tableCompact" style={{ width: '100%', minWidth: 780 }}>
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={stakesLoading}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'netuid'
                                ? { key: 'netuid', dir: s.dir === 'asc' ? 'desc' : 'asc' }
                                : { key: 'netuid', dir: 'asc' }
                            )
                          }
                        >
                          Subnet{sorting.key === 'netuid' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={stakesLoading}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'alpha'
                                ? { key: 'alpha', dir: s.dir === 'asc' ? 'desc' : 'asc' }
                                : { key: 'alpha', dir: 'desc' }
                            )
                          }
                        >
                          Alpha{sorting.key === 'alpha' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={stakesLoading}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'tao' ? { key: 'tao', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'tao', dir: 'desc' }
                            )
                          }
                        >
                          Tao{sorting.key === 'tao' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>Current Price</th>
                      <th style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={stakesLoading}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'pct' ? { key: 'pct', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'pct', dir: 'desc' }
                            )
                          }
                        >
                          Change{sorting.key === 'pct' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={stakesLoading}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'pool' ? { key: 'pool', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'pool', dir: 'desc' }
                            )
                          }
                        >
                          Pool{sorting.key === 'pool' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStakes.map((s) => {
                      const stakedPriceNum = safeDecimalNumber(String(s.stakedPrice ?? '').trim())
                      const currentPriceNum = safeDecimalNumber(String(s.currentPrice ?? '').trim())
                      const pctChange =
                        stakedPriceNum !== null && currentPriceNum !== null && stakedPriceNum !== 0
                          ? ((currentPriceNum - stakedPriceNum) / stakedPriceNum) * 100
                          : null

                      return (
                        <tr key={String(s.netuid)}>
                          <td>
                            <SubnetPill netuid={s.netuid} subnetByNetuid={props.subnetByNetuid} />
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.alphaAmount}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.taoAmount}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.currentPrice ?? '-'}
                          </td>
                          <td
                            className={
                              'mono ' +
                              (pctChange === null
                                ? ''
                                : pctChange > 0
                                ? 'pctPositive'
                                : pctChange < 0
                                ? 'pctNegative'
                                : '')
                            }
                            style={{ textAlign: 'right' }}
                          >
                            {pctChange === null ? '-' : `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(2)}%`}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.taoInPool ?? '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
    </div>
  )
}

function isLikelyAddress(value: string) {
  const v = value.trim()
  return /^0x[a-fA-F0-9]{40}$/.test(v)
}

function safeInt(value: string): number | null {
  const v = value.trim()
  if (!v) return null
  if (!/^-?\d+$/.test(v)) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n < 0) return null
  return n
}

function shortAddress(address: string) {
  const a = address.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) return a
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

function shortHash(hash: string) {
  const h = String(hash || '').trim()
  if (!h) return h
  if (h.length <= 12) return h
  return `${h.slice(0, 6)}...${h.slice(-4)}`
}

function shortSs58(value: string) {
  const v = String(value || '').trim()
  if (v.length <= 10) return v
  return `${v.slice(0, 4)}...${v.slice(-4)}`
}

function formatContractDate(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return '—'
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

function listItemInitial(name: string): string {
  const n = (name || '').trim()
  if (!n) return '?'
  return n[0]!.toUpperCase()
}

function isLikelyDecimalAmount(value: string) {
  const v = value.trim()
  if (!v) return false
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(v)) return false
  try {
    const n = Number(v)
    if (!Number.isFinite(n)) return false
    if (n < 0) return false
    return true
  } catch {
    return false
  }
}

function normalizeDecimal(value: string) {
  let v = value.trim()
  if (!v) return ''
  if (v.startsWith('.')) v = `0${v}`
  if (v.endsWith('.')) v = v.slice(0, -1)
  return v
}

function ConfirmDialog(props: {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onClose: (confirmed: boolean) => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props])

  const confirmText = props.confirmText || 'Confirm'
  const cancelText = props.cancelText || 'Cancel'
  return (
    <div
      className="modalOverlay modalOverlayConfirm"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose(false)
      }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="modalTitle">{props.title}</div>
          <button type="button" className="btn btnSmall btnGhost" aria-label="Close" onClick={() => props.onClose(false)}>
            ×
          </button>
        </div>
        <div className="modalMessage">{props.message}</div>
        <div className="modalActions">
          <button type="button" className="btn" onClick={() => props.onClose(false)}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${props.danger ? 'btnDanger' : 'btnPrimary'}`}
            onClick={() => props.onClose(true)}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

function safeBigIntString(value: string): bigint | null {
  try {
    const v = String(value).trim()
    if (!/^\d+$/.test(v)) return null
    return BigInt(v)
  } catch {
    return null
  }
}

function parseDecimalToUnits(value: string, decimals: number): bigint | null {
  const v = normalizeDecimal(value)
  if (!v) return null
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(v)) return null
  const [whole, fracRaw = ''] = v.split('.')
  const frac = fracRaw.slice(0, decimals)
  const fracPadded = frac.padEnd(decimals, '0')
  const wholeBi = safeBigIntString(whole)
  const fracBi = decimals === 0 ? 0n : safeBigIntString(fracPadded)
  if (wholeBi === null) return null
  if (fracBi === null) return null
  const base = 10n ** BigInt(decimals)
  return wholeBi * base + fracBi
}

function formatUnitsLike(wei: string, decimals: number, precision = 4) {
  const bi = safeBigIntString(wei)
  if (bi === null) return wei
  if (decimals === 0) return bi.toString()
  const base = 10n ** BigInt(decimals)
  const whole = bi / base
  const frac = (bi % base).toString().padStart(decimals, '0')
  const trimmed = frac.slice(0, Math.max(0, precision)).replace(/0+$/, '')
  return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString()
}

function safeBigInt(value: unknown): bigint | null {
  try {
    if (typeof value !== 'string') return null
    const v = value.trim()
    if (!v) return null
    if (!/^-?\d+$/.test(v)) return null
    return BigInt(v)
  } catch {
    return null
  }
}

function safeDecimalNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v) return null
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(v)) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n
}
