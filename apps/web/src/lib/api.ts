export type ApiError = {
  error: string
}

export type ContractRecord = {
  id: string
  name: string
  type: 'MEV' | 'TradingV7' | 'Unknown'
  address: string
  ownerAddress: string
  ownerIndex?: number
  withdrawerAddress?: string
  withdrawerIndex?: number
  abiFile?: string
  hotkey?: string
  coldkey?: string
  ss58?: string
  createdAt: string
}

export const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'

let apiErrorNotifier: ((message: string) => void) | null = null

/** Register a global error notifier for API request failures. */
export function setApiErrorNotifier(fn: ((message: string) => void) | null) {
  apiErrorNotifier = fn
}

/** Public endpoint: fetch TAO USD price from backend (CoinGecko). */
export async function getTaoPrice(): Promise<{ usd: number }> {
  const res = await fetch(`${apiUrl}/price/tao`, { headers: { Accept: 'application/json' } })
  const data = (await res.json()) as { usd?: number; error?: string; message?: string }
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
  const usd = data.usd
  if (typeof usd !== 'number' || !Number.isFinite(usd)) throw new Error('Invalid price response')
  return { usd }
}

export function getToken() {
  return localStorage.getItem('token')
}

export function setToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
}

type RequestOptions = { notifyError?: boolean }

async function request<T>(path: string, init?: RequestInit, opts?: RequestOptions): Promise<T> {
  const notifyError = opts?.notifyError !== false
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers ? (init.headers as Record<string, string>) : {})
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers
    })

    const text = await res.text()
    const contentType = res.headers.get('content-type') || ''
    if (text && !contentType.includes('application/json')) {
      if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<')) {
        throw new Error(
          `Server returned HTML instead of JSON. Is the API URL correct? (${apiUrl})`
        )
      }
    }
    let data: unknown
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      throw new Error(
        res.ok
          ? 'Invalid JSON response from server'
          : `Server error (${res.status}): check API URL and that the backend is running.`
      )
    }

    if (!res.ok) {
      const raw =
        data && typeof data === 'object' && 'error' in data ? (data as { error: unknown }).error : undefined
      throw new Error(typeof raw === 'string' ? raw : `http_${res.status}`)
    }
    return data as T
  } catch (e: any) {
    if (notifyError && e?.name !== 'AbortError') {
      const msg = e?.message || 'Request failed'
      apiErrorNotifier?.(msg)
    }
    throw e
  }
}

export async function get2FARequired(): Promise<{ required: boolean }> {
  return request<{ required: boolean }>('/auth/2fa-required')
}

export async function twoFaSetupStart(currentTotp?: string): Promise<{ uri: string; secret: string }> {
  return request<{ uri: string; secret: string }>('/auth/2fa/setup-start', {
    method: 'POST',
    body: JSON.stringify(currentTotp != null ? { currentTotp } : {})
  })
}

export async function twoFaSetupConfirm(totp: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/2fa/setup-confirm', {
    method: 'POST',
    body: JSON.stringify({ totp })
  })
}

export async function twoFaDisable(totp: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ totp })
  })
}

export async function login(username: string, password: string, totp?: string) {
  return request<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, ...(totp !== undefined && totp !== '' ? { totp } : {}) })
  })
}

export async function listContracts() {
  return request<{ contracts: ContractRecord[] }>('/contracts')
}

export async function listOwners() {
  return request<{ owners: { index: number; address: string }[] }>('/contracts/owners')
}

export async function listAbiFiles() {
  return request<{ files: string[] }>('/contracts/abi-files')
}

export async function createContract(input: {
  name: string
  type: 'MEV' | 'TradingV7' | 'Unknown'
  address: string
  ownerAddress: string
  ownerIndex?: number
  withdrawerAddress: string
  withdrawerIndex?: number
  abiFile?: string
  coldkey?: string
  ss58?: string
}) {
  return request<{ contract: ContractRecord }>('/contracts', {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

export async function deleteContract(id: string) {
  return request<{ ok: true }>(`/contracts/${id}`, { method: 'DELETE' })
}

export type TxResponse = {
  hash: string
  blockNumber: number | null
  status: number | null
}

export type BatchTxResult = {
  netuid: number
  hash: string | null
  blockNumber: number | null
  status: number | null
  error?: string
}

export type BatchTxResponse = {
  results: BatchTxResult[]
}

export async function addStake(id: string, input: { amount: string; netuid?: number; netuids?: number[] }) {
  return request<TxResponse | BatchTxResponse>(`/contracts/${id}/add-stake`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

export async function removeStake(id: string, input: { netuid: number }) {
  return request<TxResponse>(`/contracts/${id}/remove-stake`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

export async function resetStake(id: string, input: { netuid: number }) {
  return request<TxResponse>(`/contracts/${id}/reset-stake`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

export async function withdraw(id: string, input: { amount: string; to?: string; totp?: string }) {
  return request<TxResponse>(`/contracts/${id}/withdraw`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

export type StakeRow = {
  netuid: number
  alphaAmount: string
  taoAmount: string
  taoInPool?: string
  stakedPrice?: string
  currentPrice?: string
  stakeTime?: number | null
}

export async function listStakes(id: string, init?: RequestInit) {
  return request<{ stakes: StakeRow[] }>(`/contracts/${id}/stakes`, init)
}

export type BalancesResponse = {
  ownerAddress: string
  contractAddress: string
  ownerBalanceWei: string
  contractBalanceWei: string
  decimals: number
}

export async function getBalances(id: string, init?: RequestInit) {
  return request<BalancesResponse>(`/contracts/${id}/balances`, init)
}

export type DelegateTxRow = {
  id: string
  block_number: number
  timestamp: string
  action: 'DELEGATE' | 'UNDELEGATE' | string
  delegate: { ss58: string; hex?: string }
  amount: string
  alpha: string
  netuid: number
  extrinsic_id: string
}

export type DelegateTxResponse = {
  pagination?: {
    current_page: number
    per_page: number
    total_items: number
    total_pages: number
    next_page: number | null
    prev_page: number | null
  }
  data: DelegateTxRow[]
}

export async function listDelegateTransactions(input: {
  nominator: string
  limit?: number
  page?: number
  action?: 'delegate' | 'undelegate'
  netuid?: number
}) {
  const params = new URLSearchParams()
  params.set('nominator', input.nominator)
  if (typeof input.limit === 'number') params.set('limit', String(input.limit))
  if (typeof input.page === 'number') params.set('page', String(input.page))
  if (input.action) params.set('action', input.action)
  if (typeof input.netuid === 'number' && Number.isFinite(input.netuid)) params.set('netuid', String(input.netuid))
  return request<DelegateTxResponse>(`/transactions/delegate?${params.toString()}`)
}

export type LogsConfigResponse = {
  path: string
  available: boolean
}

export async function getLogsConfig() {
  return request<LogsConfigResponse>('/logs/config')
}

/** Fetch full log file and trigger browser download. Throws on error. */
export async function downloadLogsFile(): Promise<void> {
  const token = getToken()
  const res = await fetch(`${apiUrl}/logs/download`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (!res.ok) {
    const contentType = res.headers.get('content-type') || ''
    const text = await res.text()
    if (contentType.includes('application/json')) {
      try {
        const data = JSON.parse(text) as { error?: string; message?: string }
        throw new Error(data.message || data.error || `HTTP ${res.status}`)
      } catch (e: any) {
        if (e instanceof Error && e.message !== text) throw e
        throw new Error(text || `HTTP ${res.status}`)
      }
    }
    throw new Error(text || `HTTP ${res.status}`)
  }
  const blob = await res.blob()
  const disp = res.headers.get('content-disposition') || ''
  const match = disp.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : `pm2-logs-${Date.now()}.log`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function flushLogsServer() {
  return request<{ ok: boolean; message?: string }>('/logs/flush', {
    method: 'POST'
  })
}

export async function stopLogsServer() {
  return request<{ ok: boolean; message?: string }>('/logs/stop', {
    method: 'POST'
  })
}

export async function restartLogsServer() {
  return request<{ ok: boolean; message?: string }>('/logs/restart', {
    method: 'POST'
  })
}

export type SubnetIdentityRow = {
  netuid: number
  subnet_name?: string | null
  [k: string]: any
}

export type SubnetIdentityCache = {
  updatedAt: string
  data: SubnetIdentityRow[]
}

export async function getSubnetIdentityCached() {
  return request<SubnetIdentityCache>('/subnets/identity')
}

export async function refreshSubnetIdentity() {
  return request<SubnetIdentityCache>('/subnets/identity/refresh', { method: 'POST' })
}

export type DtaoSubnetRow = {
  netuid?: number
  name?: string | null
  fear_and_greed_index?: number | null
  total_tao?: number | null
  price_change_1_hour?: number | null
  price_change_1_day?: number | null
  price_change_1_week?: number | null
  price_change_1_month?: number | null
  price?: number | null
  tao_buy_volume_24_hr?: number | null
  tao_sell_volume_24_hr?: number | null
  github?: string | null
  subnet_url?: string | null
  incentive_burn?: number | null
  is_immune?: boolean | null
  [k: string]: any
}

export async function listDtaoSubnets() {
  return request<{ data: DtaoSubnetRow[] }>('/subnets/dtao-subnets')
}

/** Open a streaming connection to the logs endpoint. Caller must pass token. Returns an AbortController to disconnect. */
export function openLogsStream(onLine: (line: string) => void, onError: (err: string) => void): AbortController {
  const token = getToken()
  const ac = new AbortController()
  const url = `${apiUrl}/logs/stream`
  fetch(url, {
    signal: ac.signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        onError((data as { message?: string }).message || `HTTP ${res.status}`)
        return
      }
      const reader = res.body?.getReader()
      if (!reader) {
        onError('No response body')
        return
      }
      const dec = new TextDecoder()
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const match = part.match(/^data:\s*(.*)/m)
            if (match) {
              const line = match[1].replace(/\\n/g, '\n').trim()
              if (line) onLine(line)
            }
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') onError(e?.message || 'Stream error')
      }
    })
    .catch((e: any) => onError(e?.message || 'Connection failed'))
  return ac
}
