import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { getConfig } from './config.js'

export async function getProvider() {
  const config = await getConfig()
  return new JsonRpcProvider(config.chain.rpcUrl, config.chain.chainId)
}

export async function getSigner() {
  const privateKey = process.env.PRIVATE_KEY
  if (privateKey) {
    const provider = await getProvider()
    return new Wallet(privateKey, provider)
  }

  const owners = getOwnerKeyMap()
  const first = owners.addresses[0]
  if (!first) {
    throw new Error('no_signer_configured')
  }
  const provider = await getProvider()
  return new Wallet(owners.addressToPrivateKey[first]!, provider)
}

type OwnerKeyMap = {
  addresses: string[]
  addressToPrivateKey: Record<string, string>
}

let cachedOwnerKeyMap: OwnerKeyMap | null = null

function parsePrivateKeys(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return []
    return parsed.map((v) => String(v)).filter(Boolean)
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizePk(pk: string) {
  const t = pk.trim()
  if (!t) return t
  return t.startsWith('0x') ? t : `0x${t}`
}

function getOwnerKeyMap(): OwnerKeyMap {
  if (cachedOwnerKeyMap) return cachedOwnerKeyMap

  const raw = process.env.OWNER_PRIVATE_KEYS
  const pks = raw ? parsePrivateKeys(raw).map(normalizePk) : []
  const addressToPrivateKey: Record<string, string> = {}

  for (const pk of pks) {
    const wallet = new Wallet(pk)
    addressToPrivateKey[wallet.address.toLowerCase()] = pk
  }

  cachedOwnerKeyMap = {
    addresses: Object.keys(addressToPrivateKey),
    addressToPrivateKey
  }

  return cachedOwnerKeyMap
}

export async function getOwnerAddresses(): Promise<string[]> {
  return getOwnerKeyMap().addresses
}

export async function getOwners(): Promise<{ index: number; address: string }[]> {
  const addresses = getOwnerKeyMap().addresses
  return addresses.map((address, index) => ({ index, address }))
}

export async function getSignerForOwnerIndex(ownerIndex: number) {
  const keyMap = getOwnerKeyMap()
  const idx = Number(ownerIndex)
  if (!Number.isInteger(idx) || idx < 0 || idx >= keyMap.addresses.length) {
    throw new Error('owner_index_not_configured')
  }
  const address = keyMap.addresses[idx]!
  const pk = keyMap.addressToPrivateKey[address]!
  const provider = await getProvider()
  return new Wallet(pk, provider)
}

export async function getSignerForOwner(ownerAddress: string) {
  const keyMap = getOwnerKeyMap()
  const pk = keyMap.addressToPrivateKey[ownerAddress.toLowerCase()]
  if (!pk) {
    throw new Error('owner_not_configured')
  }
  const provider = await getProvider()
  return new Wallet(pk, provider)
}

export async function loadAbi(abiFile: string) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const candidatePaths = [
    join(__dirname, '..', '..', '..', '..', 'abis', abiFile),
    join(__dirname, '..', '..', '..', 'abis', abiFile)
  ]

  let lastErr: unknown = null
  for (const abiPath of candidatePaths) {
    try {
      const raw = await readFile(abiPath, 'utf-8')
      return JSON.parse(raw)
    } catch (e: any) {
      lastErr = e
      if (e?.code !== 'ENOENT') throw e
    }
  }

  throw new Error(`abi_not_found:${abiFile}`)
}

export async function listAbiFiles(): Promise<string[]> {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const candidateDirs = [
    join(__dirname, '..', '..', '..', '..', 'abis'),
    join(__dirname, '..', '..', '..', 'abis')
  ]

  const found = new Set<string>()
  let triedAny = false

  for (const dir of candidateDirs) {
    try {
      triedAny = true
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isFile()) continue
        if (!e.name.toLowerCase().endsWith('.json')) continue
        found.add(e.name)
      }
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e
    }
  }

  if (!triedAny) return []
  return Array.from(found).sort((a, b) => a.localeCompare(b))
}

export async function getContract(contractAddress: string, abiFile: string, ownerAddress?: string) {
  const signer = ownerAddress ? await getSignerForOwner(ownerAddress) : await getSigner()
  const abi = await loadAbi(abiFile)
  return new Contract(contractAddress, abi, signer)
}

export async function getReadOnlyContract(contractAddress: string, abiFile: string) {
  const provider = await getProvider()
  const abi = await loadAbi(abiFile)
  return new Contract(contractAddress, abi, provider)
}

export async function getContractForOwnerIndex(contractAddress: string, abiFile: string, ownerIndex: number) {
  const signer = await getSignerForOwnerIndex(ownerIndex)
  const abi = await loadAbi(abiFile)
  return new Contract(contractAddress, abi, signer)
}
