import { JSONFilePreset } from 'lowdb/node'
import { nanoid } from 'nanoid'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

type DbSchema = {
  contracts: ContractRecord[]
}

const defaultData: DbSchema = {
  contracts: []
}

export async function getDb() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const dbPath = join(__dirname, '..', '..', 'data', 'db.json')
  await mkdir(dirname(dbPath), { recursive: true })
  const db = await JSONFilePreset<DbSchema>(dbPath, defaultData)
  return db
}

export function newId() {
  return nanoid()
}
