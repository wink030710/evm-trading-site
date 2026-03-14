export type ApiError = {
  error: string
}

export type ContractRecord = {
  id: string
  name: string
  type: 'MEV' | 'TradingV3' | 'Unknown'
  address: string
  ownerAddress: string
  ownerIndex?: number
  abiFile?: string
  hotkey?: string
  coldkey?: string
  createdAt: string
}

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export function getToken() {
  return localStorage.getItem('token')
}

export function setToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers ? (init.headers as Record<string, string>) : {})
  }
  if (token) headers.Authorization = `Bearer ${token}`

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
    throw new Error((data && typeof data === 'object' && 'error' in data && String((data as { error: string }).error)) || `http_${res.status}`)
  }
  return data as T
}

export async function login(username: string, password: string) {
  return request<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
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
  type: 'MEV' | 'TradingV3' | 'Unknown'
  address: string
  ownerAddress: string
  ownerIndex?: number
  abiFile?: string
  coldkey?: string
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

export async function withdraw(id: string, input: { amount: string; to?: string }) {
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
}

export async function listStakes(id: string) {
  return request<{ stakes: StakeRow[] }>(`/contracts/${id}/stakes`)
}

export type BalancesResponse = {
  ownerAddress: string
  contractAddress: string
  ownerBalanceWei: string
  contractBalanceWei: string
  decimals: number
}

export async function getBalances(id: string) {
  return request<BalancesResponse>(`/contracts/${id}/balances`)
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
