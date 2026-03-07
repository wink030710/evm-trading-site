export type ApiError = {
  error: string
}

export type ContractRecord = {
  id: string
  name: string
  type: 'MEV' | 'Trading' | 'Unknown'
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
  const data = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    throw new Error((data && data.error) || `http_${res.status}`)
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
  type: 'MEV' | 'Trading' | 'Unknown'
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

export async function addStake(id: string, input: { netuid: number; amount: string }) {
  return request<TxResponse>(`/contracts/${id}/add-stake`, {
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
