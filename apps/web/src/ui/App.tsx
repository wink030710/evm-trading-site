import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import {
  addStake,
  clearToken,
  createContract,
  deleteContract,
  getBalances,
  downloadLogsFile,
  flushLogsServer,
  getLogsConfig,
  getTaoPrice,
  listAbiFiles,
  listContracts,
  listOwners,
  listStakes,
  login,
  openLogsStream,
  removeStake,
  restartLogsServer,
  stopLogsServer,
  resetStake,
  setToken,
  withdraw,
  type ContractRecord,
  type StakeRow
} from '../lib/api'

const TAO_POLL_MS = 15_000 // 15 seconds

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
  const [error, setError] = useState<string | null>(null)
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
          <div className="rowWrap" style={{ gap: 12, alignItems: 'center' }}>
            <nav className="rowWrap" style={{ gap: 8 }}>
              <Link to="/" className="btn btnSmall">Dashboard</Link>
              <Link to="/contracts" className="btn btnSmall">Contracts</Link>
              <Link to="/logs" className="btn btnSmall">Logs</Link>
            </nav>
            <button
              className="btn btnSmall"
              onClick={() => setLogoutConfirmOpen(true)}
            >
              Logout
            </button>
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

      {error ? (
        <div className="card cardError">
          <div className="muted">Error</div>
          <div>{error}</div>
        </div>
      ) : null}

      <div className="spacer16" />

      {tokenPresent ? (
        <>
          <Routes>
            <Route path="/" element={<Dashboard onError={setError} />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/contracts" element={<ContractsView onError={setError} confirm={confirm} />} />
            <Route path="/logs" element={<div className="layoutSingle"><LogsView onError={setError} confirm={confirm} /></div>} />
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
              setError(null)
            }}
            onError={setError}
          />
        </div>
      )}
    </div>
  )
}

function Login(props: { onLoggedIn: () => void; onError: (e: string | null) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

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
    setLoading(true)
    try {
      const resp = await login(u, p)
      setToken(resp.token)
      props.onLoggedIn()
    } catch (err: any) {
      props.onError(err?.message || 'login_failed')
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

        {localError ? <div className="errorText">{localError}</div> : null}

        <div className="spacer16" />
        <button type="submit" className="btn btnPrimary" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
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
  total: number | null
  free: number | null
  staked: number | null
  fee: number | null
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
              const freeStr = formatUnitsLike(bal.contractBalanceWei, bal.decimals)
              const feeStr = formatUnitsLike(bal.ownerBalanceWei, bal.decimals)
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
    let total = 0
    let free = 0
    let staked = 0
    let fee = 0
    for (const r of rows) {
      if (r.total !== null) total += r.total
      if (r.free !== null) free += r.free
      if (r.staked !== null) staked += r.staked
      if (r.fee !== null) fee += r.fee
    }
    return { total, free, staked, fee }
  }, [rows])

  const fmt = (n: number | null) => (n !== null ? n.toFixed(5) : '—')

  return (
    <div className="layoutSingle">
      <div className="card">
        <div className="rowWrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h1" style={{ margin: 0 }}>Dashboard</h2>
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
        ) : loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="dashboardTableWrap">
            <table className="dashboardTable">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Type</th>
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
                    <td>{r.name}</td>
                    <td><span className="badge">{r.type}</span></td>
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
                  <th className="mono num">{sums.total.toFixed(5)}</th>
                  <th className="mono num">{sums.free.toFixed(5)}</th>
                  <th className="mono num">{sums.staked.toFixed(5)}</th>
                  <th className="mono num">{sums.fee.toFixed(5)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ContractsView(props: {
  onError: (e: string | null) => void
  confirm: (input: { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('id'))
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [copied, setCopied] = useState<null | 'contract_address' | 'owner_address'>(null)
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

  useEffect(() => {
    refresh()
  }, [refresh])

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
          onError={(e) => {
            props.onError(e)
          }}
          confirm={props.confirm}
          setGlobalBusy={setGlobalBusy}
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
              type: 'MEV' | 'TradingV3' | 'TradingV4' | 'TradingV5' | 'Unknown'
              address: string
              ownerAddress: string
              ownerIndex?: number
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
    type: 'MEV' | 'TradingV3' | 'TradingV4' | 'TradingV5' | 'Unknown'
    address: string
    ownerAddress: string
    ownerIndex?: number
    abiFile?: string
    coldkey?: string
  }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'MEV' | 'TradingV3' | 'TradingV4' | 'TradingV5' | 'Unknown'>('TradingV5')
  const [address, setAddress] = useState('')
  const [ownerIndex, setOwnerIndex] = useState<string>('')
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
        onChange={(e) => setType(e.target.value as 'MEV' | 'TradingV3' | 'TradingV4' | 'TradingV5' | 'Unknown')}
      >
        <option value="TradingV3">TradingV3</option>
        <option value="TradingV4">TradingV4</option>
        <option value="TradingV5">TradingV5</option>
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
          if (selectableAbiFiles.length > 0 && !abiFile.trim()) {
            setLocalError('ABI file is required')
            return
          }

          const coldkeyBytes32 = addressToBytes32(a)

          const ok = await props.confirm({
            title: 'Add contract',
            message: `Add this contract?\n\nname=${n}\ntype=${type}\ncontract=${a}\nowner#${selectedOwner?.index ?? ''}=${o}`,
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
            abiFile: abiFile.trim() ? abiFile.trim() : undefined,
            coldkey: coldkeyBytes32 || undefined
          })
          setName('')
          setType('TradingV5')
          setAddress('')
          setOwnerIndex('')
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
  onError: (e: string | null) => void
  confirm: (input: { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>
  setGlobalBusy: (busy: boolean) => void
}) {
  const [netuid, setNetuid] = useState('')
  const [amount, setAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawTo, setWithdrawTo] = useState('')

  const parsedNetuids = useMemo(() => {
    const raw = netuid.trim()
    if (!raw) return [] as number[]
    const parts = raw
      .split(/,+/g)
      .map((p) => p.trim())
      .filter(Boolean)
    const nums = parts
      .map((p) => safeInt(p))
      .filter((n): n is number => n !== null)
    return Array.from(new Set(nums)).sort((a, b) => a - b)
  }, [netuid])

  const [touchedNetuid, setTouchedNetuid] = useState(false)
  const [touchedAmount, setTouchedAmount] = useState(false)
  const [touchedWithdraw, setTouchedWithdraw] = useState(false)
  const [touchedWithdrawTo, setTouchedWithdrawTo] = useState(false)

  const [actionError, setActionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<'add' | 'remove' | 'reset' | 'withdraw' | null>(null)

  const actionsDisabled = submitting !== null

  useEffect(() => {
    props.setGlobalBusy(actionsDisabled)
    return () => props.setGlobalBusy(false)
  }, [actionsDisabled, props.setGlobalBusy])

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
      setActionError(null)
      setTouchedNetuid(false)
      setTouchedAmount(false)
      setTouchedWithdraw(false)
      setTouchedWithdrawTo(false)
    }
    refreshStakes(signal)
    refreshBalances(signal)
    return () => controller.abort()
  }, [props.contract.id, props.refreshNonce, refreshStakes, refreshBalances])

  const parsedNetuid = useMemo(() => safeInt(netuid), [netuid])
  const netuidOk = parsedNetuids.length > 0
  const amountOk = useMemo(() => isLikelyDecimalAmount(amount), [amount])
  const withdrawOk = useMemo(() => isLikelyDecimalAmount(withdrawAmount), [withdrawAmount])
  const withdrawToValue = useMemo(() => {
    const t = withdrawTo.trim()
    return t ? t : props.contract.ownerAddress
  }, [withdrawTo, props.contract.ownerAddress])
  const withdrawToOk = useMemo(() => isLikelyAddress(withdrawToValue), [withdrawToValue])

  const ownerBalUnits = useMemo(() => (balances ? safeBigIntString(balances.ownerBalanceWei) : null), [balances])
  const contractBalUnits = useMemo(() => (balances ? safeBigIntString(balances.contractBalanceWei) : null), [balances])
  const amountUnits = useMemo(() => {
    if (!balances) return null
    if (!amountOk) return null
    return parseDecimalToUnits(normalizeDecimal(amount), balances.decimals)
  }, [amount, amountOk, balances])
  const withdrawUnits = useMemo(() => {
    if (!balances) return null
    if (!withdrawOk) return null
    return parseDecimalToUnits(normalizeDecimal(withdrawAmount), balances.decimals)
  }, [withdrawAmount, withdrawOk, balances])

  const amountExceedsContract = useMemo(() => {
    if (amountUnits === null || contractBalUnits === null) return false
    return amountUnits > contractBalUnits
  }, [amountUnits, contractBalUnits])

  const withdrawExceedsContract = useMemo(() => {
    if (withdrawUnits === null || contractBalUnits === null) return false
    return withdrawUnits > contractBalUnits
  }, [withdrawUnits, contractBalUnits])

  const ownerBalanceDisplay = useMemo(
    () => (balances ? formatUnitsLike(balances.ownerBalanceWei, balances.decimals) : null),
    [balances]
  )
  const contractBalanceDisplay = useMemo(
    () => (balances ? formatUnitsLike(balances.contractBalanceWei, balances.decimals) : null),
    [balances]
  )

  const netuidError = useMemo(() => {
    const v = netuid.trim()
    if (!v) return 'netuid is required'
    const invalid = v
      .split(/,+/g)
      .map((p) => p.trim())
      .filter(Boolean)
      .some((p) => safeInt(p) === null)
    if (invalid) return 'netuid must be a non-negative integer (or a comma-separated list like 1,2,3)'
    if (parsedNetuids.length === 0) return 'netuid is required'
    return null
  }, [netuid, parsedNetuids.length])

  const amountError = useMemo(() => {
    const v = amount.trim()
    if (!v) return 'amount is required'
    if (!amountOk) return 'amount must be a number'
    if (balances && amountExceedsContract) return `amount exceeds contract balance (max ${contractBalanceDisplay ?? ''})`
    return null
  }, [amount, amountOk, amountExceedsContract, balances, contractBalanceDisplay])

  const withdrawToError = useMemo(() => {
    const v = withdrawTo.trim()
    if (v && !isLikelyAddress(v)) return 'invalid recipient address'
    return null
  }, [withdrawTo])

  const withdrawAmountError = useMemo(() => {
    const v = withdrawAmount.trim()
    if (!v) return 'amount is required'
    if (!withdrawOk) return 'amount must be a number'
    if (balances && withdrawExceedsContract) return `amount exceeds contract balance (max ${contractBalanceDisplay ?? ''})`
    return null
  }, [withdrawAmount, withdrawOk, withdrawExceedsContract, balances, contractBalanceDisplay])

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
  const [stakesPageSize, setStakesPageSize] = useState(10)
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
      <div className="rowWrap" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="rowWrap" style={{ alignItems: 'baseline', gap: 12 }}>
            <div className="muted" style={{ fontSize: 15 }}>
              Total:
            </div>
            <div className="mono" style={{ fontSize: 15 }}>
              {totalBalanceDisplay ?? '—'}
            </div>

            <div className="muted" style={{ fontSize: 15 }}>
              Free:
            </div>
            <div className="mono" style={{ fontSize: 15 }}>
              {contractBalanceDisplay ?? '—'}
            </div>

            <div className="muted" style={{ fontSize: 15 }}>
              Staked:
            </div>
            <div className="mono" style={{ fontSize: 15 }}>
              {totals.taoNum !== null ? totals.taoNum.toFixed(5) : '—'}
            </div>

            <div className="muted" style={{ fontSize: 15 }}>
              Fee:
            </div>
            <div className="mono" style={{ fontSize: 15 }}>
              {ownerBalanceDisplay ?? (balancesError ? `(${balancesError})` : '—')}
            </div>
          </div>
        </div>
      </div>

      <div className="spacer16" />

      <div className="detailGrid">
        <div>
          <div className="muted">Actions (backend-signed)</div>
          <div className="spacer12" />

          <div className="actionsGrid">
            <div>
              <div className="label">Netuid</div>
              <input
                className={`input ${touchedNetuid && netuidError ? 'inputError' : ''}`}
                value={netuid}
                disabled={actionsDisabled}
                onChange={(e) => {
                  setTouchedNetuid(true)
                  setNetuid(e.target.value)
                }}
                placeholder="e.g. 1 or 1,2,3"
              />
              <div className="fieldErrorSlot">
                {touchedNetuid && netuidError ? <div className="errorText">{netuidError}</div> : null}
              </div>
            </div>

            <div>
              <div className="label">Amount</div>
              <input
                className={`input ${touchedAmount && amountError ? 'inputError' : ''}`}
                value={amount}
                disabled={actionsDisabled}
                onChange={(e) => {
                  setTouchedAmount(true)
                  setAmount(e.target.value)
                }}
                placeholder="e.g. 1.5"
              />
              <div className="fieldErrorSlot">
                {touchedAmount && amountError ? <div className="errorText">{amountError}</div> : null}
              </div>
            </div>
          </div>

          <div className="spacer12" />

          {actionError ? <div className="errorText">{actionError}</div> : null}

          <div className="spacer12" />
          <div className="rowWrap">
            <button
              className="btn btnPrimary"
              disabled={actionsDisabled}
              onClick={async () => {
                props.onError(null)
                setActionError(null)
                setTouchedWithdraw(false)
                setTouchedWithdrawTo(false)
                setTouchedNetuid(true)
                setTouchedAmount(true)
                if (netuidError || amountError) return
                if (parsedNetuids.length === 0) return

                const netuidsValue = parsedNetuids

                let nextBalances = balances
                if (!nextBalances) {
                  try {
                    const resp = await getBalances(props.contract.id)
                    nextBalances = {
                      ownerBalanceWei: resp.ownerBalanceWei,
                      contractBalanceWei: resp.contractBalanceWei,
                      decimals: resp.decimals
                    }
                    setBalances(nextBalances)
                  } catch {
                    // ignore; backend will enforce
                  }
                }

                if (nextBalances) {
                  const contractWei = safeBigIntString(nextBalances.contractBalanceWei)
                  const units = parseDecimalToUnits(normalizeDecimal(amount), nextBalances.decimals)
                  if (contractWei !== null && units !== null && units * BigInt(netuidsValue.length) > contractWei) {
                    setTouchedAmount(true)
                    return
                  }
                }

                const ok = await props.confirm({
                  title: 'Submit add stake',
                  message: `netuids=${netuidsValue.join(',')}\namount=${normalizeDecimal(amount)}`,
                  confirmText: 'Submit',
                  cancelText: 'Cancel'
                })
                if (!ok) return

                setSubmitting('add')
                try {
                  const resp = await addStake(props.contract.id, {
                    netuids: netuidsValue,
                    amount: normalizeDecimal(amount)
                  })
                  props.requestRefresh()
                } catch (e: any) {
                  const msg = e?.message || 'add_stake_failed'
                  props.onError(msg)
                  setActionError(msg)
                } finally {
                  setSubmitting(null)
                }
              }}
            >
              {submitting === 'add' ? 'Submitting…' : 'Add stake'}
            </button>
          </div>

          <div className="spacer16" />
          <div className="label">Withdraw recipient address (optional)</div>
          <input
            className={`input mono ${touchedWithdrawTo && withdrawToError ? 'inputError' : ''}`}
            value={withdrawTo}
            disabled={actionsDisabled}
            onChange={(e) => {
              setTouchedWithdrawTo(true)
              setWithdrawTo(e.target.value)
            }}
            placeholder={shortAddress(props.contract.ownerAddress)}
          />
          <div className="fieldErrorSlot">
            {touchedWithdrawTo && withdrawToError ? <div className="errorText">{withdrawToError}</div> : null}
          </div>

          <div className="spacer12" />

          <div className="label">Withdraw TAO amount</div>
          <input
            className={`input ${touchedWithdraw && withdrawAmountError ? 'inputError' : ''}`}
            value={withdrawAmount}
            disabled={actionsDisabled}
            onChange={(e) => {
              setTouchedWithdraw(true)
              setWithdrawAmount(e.target.value)
            }}
            placeholder="e.g. 1.5"
          />
          <div className="fieldErrorSlot">
            {touchedWithdraw && withdrawAmountError ? <div className="errorText">{withdrawAmountError}</div> : null}
          </div>

          <div className="spacer12" />
          <button
            className="btn"
            disabled={actionsDisabled}
            onClick={async () => {
              props.onError(null)
              setActionError(null)
              setTouchedNetuid(false)
              setTouchedAmount(false)
              setTouchedWithdraw(true)
              setTouchedWithdrawTo(true)
              if (withdrawToError || withdrawAmountError) return
              if (!withdrawToOk) return

              let nextBalances = balances
              if (!nextBalances) {
                try {
                  const resp = await getBalances(props.contract.id)
                  nextBalances = {
                    ownerBalanceWei: resp.ownerBalanceWei,
                    contractBalanceWei: resp.contractBalanceWei,
                    decimals: resp.decimals
                  }
                  setBalances(nextBalances)
                } catch {
                  // ignore; backend will enforce
                }
              }

              if (nextBalances) {
                const contractWei = safeBigIntString(nextBalances.contractBalanceWei)
                const units = parseDecimalToUnits(normalizeDecimal(withdrawAmount), nextBalances.decimals)
                if (contractWei !== null && units !== null && units > contractWei) {
                  setTouchedWithdraw(true)
                  return
                }
              }

              const ok = await props.confirm({
                title: 'Submit withdraw',
                message: `to=${withdrawToValue}\namount=${normalizeDecimal(withdrawAmount)}`,
                confirmText: 'Submit',
                cancelText: 'Cancel'
              })
              if (!ok) return

              setSubmitting('withdraw')
              try {
                const resp = await withdraw(props.contract.id, {
                  amount: normalizeDecimal(withdrawAmount),
                  to: withdrawToValue
                })
                props.requestRefresh()
              } catch (e: any) {
                const msg = e?.message || 'withdraw_failed'
                props.onError(msg)
                setActionError(msg)
              } finally {
                setSubmitting(null)
              }
            }}
          >
            {submitting === 'withdraw' ? 'Submitting…' : 'Withdraw TAO'}
          </button>
        </div>

        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="muted">Current stakes</div>
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

          {stakesLoading && !stakes ? (
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
                    disabled={actionsDisabled}
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
                    disabled={actionsDisabled}
                    onChange={(e) => setStakesPageSize(Number(e.target.value) || 10)}
                  >
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                  <button
                    className="btn"
                    disabled={actionsDisabled || stakesPage <= 0}
                    onClick={() => setStakesPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <div className="badge">
                    {Math.min(stakesPage + 1, stakesPageCount)} / {stakesPageCount}
                  </div>
                  <button
                    className="btn"
                    disabled={actionsDisabled || stakesPage >= stakesPageCount - 1}
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
                <table className="table" style={{ width: '100%', minWidth: 880 }}>
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={actionsDisabled}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'netuid'
                                ? { key: 'netuid', dir: s.dir === 'asc' ? 'desc' : 'asc' }
                                : { key: 'netuid', dir: 'asc' }
                            )
                          }
                        >
                          Netuid{sorting.key === 'netuid' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={actionsDisabled}
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
                          disabled={actionsDisabled}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'tao' ? { key: 'tao', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'tao', dir: 'desc' }
                            )
                          }
                        >
                          Tao{sorting.key === 'tao' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>Staked Price</th>
                      <th style={{ textAlign: 'right' }}>Current Price</th>
                      <th style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={actionsDisabled}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'pool' ? { key: 'pool', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'pool', dir: 'desc' }
                            )
                          }
                        >
                          Pool{sorting.key === 'pool' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tableHeaderBtn"
                          disabled={actionsDisabled}
                          onClick={() =>
                            setSorting((s) =>
                              s.key === 'pct' ? { key: 'pct', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: 'pct', dir: 'desc' }
                            )
                          }
                        >
                          % Change{sorting.key === 'pct' ? (sorting.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
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
                          <td>{s.netuid}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.alphaAmount}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.taoAmount}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.stakedPrice ?? '-'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.currentPrice ?? '-'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.taoInPool ?? '-'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {pctChange === null ? '-' : `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(2)}%`}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btnTiny"
                              style={{ marginRight: 8 }}
                              disabled={actionsDisabled}
                              onClick={async (e) => {
                                e.preventDefault()
                                props.onError(null)
                                setActionError(null)

                                const netuidValue = s.netuid

                                const ok = await props.confirm({
                                  title: 'Submit reset stake',
                                  message: `netuid=${netuidValue}`,
                                  confirmText: 'Submit',
                                  cancelText: 'Cancel',
                                  danger: true
                                })
                                if (!ok) return

                                setSubmitting('reset')
                                try {
                                  await resetStake(props.contract.id, { netuid: netuidValue })
                                  props.requestRefresh()
                                } catch (err: any) {
                                  const msg = err?.message || 'reset_stake_failed'
                                  props.onError(msg)
                                  setActionError(msg)
                                } finally {
                                  setSubmitting(null)
                                }
                              }}
                            >
                              {submitting === 'reset' ? 'Submitting…' : 'Reset'}
                            </button>
                            <button
                              type="button"
                              className="btn btnDanger btnTiny"
                              disabled={actionsDisabled}
                              onClick={async (e) => {
                                e.preventDefault()
                                props.onError(null)
                                setActionError(null)

                                const netuidValue = s.netuid

                                const ok = await props.confirm({
                                  title: 'Submit remove stake',
                                  message: `netuid=${netuidValue}`,
                                  confirmText: 'Submit',
                                  cancelText: 'Cancel',
                                  danger: true
                                })
                                if (!ok) return

                                setSubmitting('remove')
                                try {
                                  const resp = await removeStake(props.contract.id, { netuid: netuidValue })
                                  props.requestRefresh()
                                } catch (err: any) {
                                  const msg = err?.message || 'remove_stake_failed'
                                  props.onError(msg)
                                  setActionError(msg)
                                } finally {
                                  setSubmitting(null)
                                }
                              }}
                            >
                              Remove
                            </button>
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
      </div>
    </div>
  )
}

function isLikelyAddress(value: string) {
  const v = value.trim()
  return /^0x[a-fA-F0-9]{40}$/.test(v)
}

/** Convert 20-byte contract address to bytes32 (left-pad with zeros). */
function addressToBytes32(address: string): string {
  const v = address.trim().replace(/^0x/i, '')
  if (v.length !== 40 || !/^[a-fA-F0-9]{40}$/.test(v)) return ''
  return '0x' + v.padStart(64, '0').toLowerCase()
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
