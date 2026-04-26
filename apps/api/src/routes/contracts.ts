import express from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { MaxUint256, parseUnits } from "ethers";
import { blake2AsHex, encodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, stringToU8a, u8aConcat } from "@polkadot/util";
import { requireAuth } from "../middleware/auth.js";
import { getConfig } from "../services/config.js";
import {
  getContract,
  getContractForOwnerIndex,
  getOwners,
  getProvider,
  getReadOnlyContract,
  listAbiFiles,
} from "../services/evm.js";
import { type ContractRecord, getDb, newId } from "../services/storage.js";
import { is2FARequired, verifyTotp } from "../services/twoFa.js";

const contractCreateSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["MEV", "TradingV7", "Unknown"]),
    address: z.string().min(1),
    ownerAddress: z.string().min(1).optional(),
    ownerIndex: z.coerce.number().int().nonnegative().optional(),
    withdrawerAddress: z.string().min(1).optional(),
    withdrawerIndex: z.coerce.number().int().nonnegative().optional(),
    abiFile: z.string().min(1).optional(),
    coldkey: z.string().min(1).optional(),
    ss58: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.ownerIndex !== undefined ||
      (v.ownerAddress && v.ownerAddress.trim().length > 0),
    {
      message: "owner_required",
    },
  )
  .refine(
    (v) =>
      v.withdrawerIndex !== undefined ||
      (v.withdrawerAddress && v.withdrawerAddress.trim().length > 0),
    {
      message: "withdrawer_required",
    },
  );

const addStakeSchema = z
  .object({
    amount: z.string().min(1),
    netuid: z.coerce.number().int().nonnegative().optional(),
    netuids: z.array(z.coerce.number().int().nonnegative()).optional(),
  })
  .refine((v) => typeof v.netuid === "number" || (Array.isArray(v.netuids) && v.netuids.length > 0), {
    message: "netuid_required",
  });

const removeStakeSchema = z.object({
  netuid: z.coerce.number().int().nonnegative(),
});

const resetStakeSchema = z.object({
  netuid: z.coerce.number().int().nonnegative(),
});

const withdrawSchema = z.object({
  amount: z.string().min(1),
  to: z.string().optional(),
  totp: z.string().optional(),
});

function isLikelyAddress(value: string) {
  const v = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

function isLikelyBytes32(value: string) {
  const v = value.trim();
  return /^0x[a-fA-F0-9]{64}$/.test(v);
}

function coldkeyFromEvmAddress(address: string) {
  const v = address.trim();
  if (!isLikelyAddress(v)) return "";
  // Frontier-style mapping: blake2_256("evm:" ++ H160(address))
  return blake2AsHex(u8aConcat(stringToU8a("evm:"), hexToU8a(v)), 256);
}

function getSs58Prefix() {
  const raw = String(process.env.SS58_PREFIX || "").trim();
  const n = raw ? Number(raw) : 42;
  if (!Number.isInteger(n) || n < 0 || n > 16383) return 42;
  return n;
}

function addressToSs58(address: string) {
  const bytes32 = coldkeyFromEvmAddress(address);
  if (!bytes32) return "";
  try {
    return encodeAddress(hexToU8a(bytes32), getSs58Prefix());
  } catch {
    return "";
  }
}

function getAmountDecimals() {
  const raw = String(process.env.AMOUNT_DECIMALS || "").trim();
  const n = raw ? Number(raw) : 18;
  if (!Number.isInteger(n) || n < 0 || n > 36) return 18;
  return n;
}

function parseAmount(amount: string) {
  let v = String(amount).trim();
  if (!v) throw new Error("invalid_amount");
  if (v.startsWith(".")) v = `0${v}`;
  if (v.endsWith(".")) v = v.slice(0, -1);
  try {
    return parseUnits(v, getAmountDecimals());
  } catch {
    throw new Error("invalid_amount");
  }
}

async function resolveAbiFile(preferred: string | undefined) {
  const config = await getConfig();
  const available = await listAbiFiles();

  const requested = (preferred || "").trim();
  if (requested) {
    if (!available.includes(requested)) throw new Error("invalid_abi_file");
    return requested;
  }

  const defaultAbi = (config.contracts.defaultAbiFile || "").trim();
  if (defaultAbi && available.includes(defaultAbi)) return defaultAbi;

  const first = available[0];
  if (first) return first;

  throw new Error("no_abi_files_available");
}

async function submitWithdraw(contract: any, to: string, amount: bigint) {
  const iface = contract?.interface;
  const fragments = Array.isArray(iface?.fragments) ? iface.fragments : [];

  const twoArgCandidates = ["emergencyWithdrawTao"];
  for (const name of twoArgCandidates) {
    const matches = fragments.filter(
      (f: any) => f && f.type === "function" && f.name === name,
    );
    for (const frag of matches) {
      if (
        Array.isArray(frag.inputs) &&
        frag.inputs.length === 2 &&
        frag.inputs[0]?.type === "address"
      ) {
        const fn = contract.getFunction(frag.format());
        return fn(to, amount);
      }
    }
  }

  const oneArgMatches = fragments.filter(
    (f: any) => f && f.type === "function" && f.name === "withdrawTAO",
  );
  for (const frag of oneArgMatches) {
    if (Array.isArray(frag.inputs) && frag.inputs.length === 1) {
      const fn = contract.getFunction(frag.format());
      return fn(amount);
    }
  }

  if (typeof contract.withdrawTAO === "function") {
    return contract.withdrawTAO(amount);
  }

  throw new Error("withdraw_function_not_found");
}

export function createContractsRouter() {
  const router = express.Router();

  router.use(requireAuth);

  router.get("/abi-files", async (_req: Request, res: Response) => {
    try {
      const files = await listAbiFiles();
      return res.json({ files });
    } catch (e: any) {
      return res
        .status(500)
        .json({ error: e?.message || "failed_to_list_abi_files" });
    }
  });

  router.get("/owners", async (_req: Request, res: Response) => {
    const owners = await getOwners();
    return res.json({ owners });
  });

  router.get("/", async (_req: Request, res: Response) => {
    const db = await getDb();
    await db.read();
    let changed = false;

    for (const c of db.data.contracts) {
      if (!(c as any).name || String((c as any).name).trim().length === 0) {
        (c as any).name = String(c.address);
        changed = true;
      }
      const t = String((c as any).type || "").trim();
      if (
        t === "Trading" ||
        t === "TradingV3" ||
        t === "TradingV4" ||
        t === "TradingV5"
      ) {
        (c as any).type = "TradingV7";
        changed = true;
      } else if (t !== "MEV" && t !== "TradingV7" && t !== "Unknown") {
        (c as any).type = "TradingV7";
        changed = true;
      }

      const af = String((c as any).abiFile || "").trim();
      if (
        af === "TradingV3.json" ||
        af === "TradingV4.json" ||
        af === "TradingV5.json"
      ) {
        (c as any).abiFile = "TradingV7.json";
        changed = true;
      }

      if (!(c as any).coldkey || String((c as any).coldkey).trim().length === 0) {
        const derived = coldkeyFromEvmAddress(String((c as any).address || ""));
        if (derived) {
          (c as any).coldkey = derived;
          changed = true;
        }
      }
      if (!(c as any).ss58 || String((c as any).ss58).trim().length === 0) {
        const derived = addressToSs58(String((c as any).address || ""));
        if (derived) {
          (c as any).ss58 = derived;
          changed = true;
        }
      }

      if (!(c as any).withdrawerAddress || String((c as any).withdrawerAddress).trim().length === 0) {
        (c as any).withdrawerAddress = String((c as any).ownerAddress || "");
        changed = true;
      }
      if (
        (c as any).withdrawerIndex === undefined &&
        typeof (c as any).ownerIndex === "number"
      ) {
        (c as any).withdrawerIndex = (c as any).ownerIndex;
        changed = true;
      }
    }

    const owners = await getOwners();
    if (owners.length > 0) {
      for (const c of db.data.contracts) {
        if (typeof c.ownerIndex === "number") continue;
        const match = owners.find(
          (o) => o.address === c.ownerAddress.toLowerCase(),
        );
        if (match) {
          c.ownerIndex = match.index;
          c.ownerAddress = match.address;
          changed = true;
        }
      }
    }

    if (changed) {
      await db.write();
    }
    return res.json({ contracts: db.data.contracts });
  });

  router.get("/:id/balances", async (req: Request, res: Response) => {
    const id = req.params.id;
    const db = await getDb();
    await db.read();
    const record = db.data.contracts.find((c: ContractRecord) => c.id === id);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }

    try {
      const provider = await getProvider();
      const [ownerBalance, contractBalance] = await Promise.all([
        provider.getBalance(record.ownerAddress),
        provider.getBalance(record.address),
      ]);

      return res.json({
        ownerAddress: record.ownerAddress,
        contractAddress: record.address,
        ownerBalanceWei: ownerBalance.toString(),
        contractBalanceWei: contractBalance.toString(),
        decimals: getAmountDecimals(),
      });
    } catch (e: any) {
      return res
        .status(500)
        .json({ error: e?.message || "failed_to_load_balances" });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    const body = contractCreateSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const name = body.data.name.trim();
    if (!name) return res.status(400).json({ error: "name_required" });

    const type = body.data.type;

    const owners = await getOwners();
    const requestedIndex = body.data.ownerIndex;
    const requestedAddress = body.data.ownerAddress?.trim();
    const requestedWithdrawerIndex = body.data.withdrawerIndex;
    const requestedWithdrawerAddress = body.data.withdrawerAddress?.trim();

    let resolvedOwnerIndex: number | undefined = undefined;
    let resolvedOwnerAddress: string | undefined = requestedAddress;
    let resolvedWithdrawerIndex: number | undefined = undefined;
    let resolvedWithdrawerAddress: string | undefined = requestedWithdrawerAddress;

    if (owners.length > 0) {
      if (requestedIndex !== undefined) {
        const owner = owners.find((o) => o.index === requestedIndex);
        if (!owner)
          return res.status(400).json({ error: "owner_index_not_available" });
        resolvedOwnerIndex = owner.index;
        resolvedOwnerAddress = owner.address;
      } else if (requestedAddress) {
        const owner = owners.find(
          (o) => o.address === requestedAddress.toLowerCase(),
        );
        if (!owner)
          return res.status(400).json({ error: "owner_not_available" });
        resolvedOwnerIndex = owner.index;
        resolvedOwnerAddress = owner.address;
      }

      if (requestedWithdrawerIndex !== undefined) {
        const w = owners.find((o) => o.index === requestedWithdrawerIndex);
        if (!w)
          return res.status(400).json({ error: "withdrawer_index_not_available" });
        resolvedWithdrawerIndex = w.index;
        resolvedWithdrawerAddress = w.address;
      } else if (requestedWithdrawerAddress) {
        const w = owners.find(
          (o) => o.address === requestedWithdrawerAddress.toLowerCase(),
        );
        if (!w)
          return res.status(400).json({ error: "withdrawer_not_available" });
        resolvedWithdrawerIndex = w.index;
        resolvedWithdrawerAddress = w.address;
      }
    }

    if (!resolvedOwnerAddress) {
      return res.status(400).json({ error: "owner_required" });
    }
    if (!resolvedWithdrawerAddress) {
      return res.status(400).json({ error: "withdrawer_required" });
    }

    let resolvedAbiFile: string;
    try {
      resolvedAbiFile = await resolveAbiFile(body.data.abiFile);
    } catch (e: any) {
      const msg = e?.message || "invalid_abi_file";
      if (msg === "invalid_abi_file")
        return res.status(400).json({ error: "invalid_abi_file" });
      if (msg === "no_abi_files_available")
        return res.status(500).json({ error: "no_abi_files_available" });
      return res.status(500).json({ error: msg });
    }

    let coldkey: string | undefined = undefined;
    const ck = (body.data.coldkey || "").trim();
    if (ck) {
      if (!isLikelyBytes32(ck))
        return res.status(400).json({ error: "invalid_coldkey" });
      coldkey = ck.toLowerCase();
    }
    if (!coldkey) {
      const derived = coldkeyFromEvmAddress(body.data.address);
      if (!derived) return res.status(400).json({ error: "invalid_contract_address" });
      coldkey = derived;
    }

    let ss58: string | undefined = undefined;
    const ss = (body.data.ss58 || "").trim();
    if (ss) ss58 = ss;
    if (!ss58) {
      const derived = addressToSs58(body.data.address);
      if (derived) ss58 = derived;
    }

    const db = await getDb();
    await db.read();

    const nameKey = name.toLowerCase();
    if (
      db.data.contracts.some(
        (c: any) =>
          String(c?.name || "")
            .trim()
            .toLowerCase() === nameKey,
      )
    ) {
      return res.status(400).json({ error: "duplicate_name" });
    }

    const record = {
      id: newId(),
      name,
      type,
      address: body.data.address,
      ownerAddress: resolvedOwnerAddress,
      ownerIndex: resolvedOwnerIndex,
      withdrawerAddress: resolvedWithdrawerAddress,
      withdrawerIndex: resolvedWithdrawerIndex,
      abiFile: resolvedAbiFile,
      coldkey,
      ss58,
      createdAt: new Date().toISOString(),
    };

    db.data.contracts.push(record);
    await db.write();

    return res.status(201).json({ contract: record });
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const id = req.params.id;
    const db = await getDb();
    await db.read();
    const before = db.data.contracts.length;
    db.data.contracts = db.data.contracts.filter(
      (c: ContractRecord) => c.id !== id,
    );
    if (db.data.contracts.length === before) {
      return res.status(404).json({ error: "not_found" });
    }
    await db.write();
    return res.json({ ok: true });
  });

  router.post("/:id/add-stake", async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = addStakeSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const requestedNetuids = Array.isArray(body.data.netuids)
      ? body.data.netuids
      : typeof body.data.netuid === "number"
        ? [body.data.netuid]
        : [];

    const netuids = Array.from(
      new Set(requestedNetuids.filter((n) => Number.isInteger(n) && n >= 0)),
    ).sort((a, b) => a - b);

    if (netuids.length === 0) {
      return res.status(400).json({ error: "netuid_required" });
    }

    const db = await getDb();
    await db.read();
    const record = db.data.contracts.find((c: ContractRecord) => c.id === id);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }
    if (record.type !== "TradingV7") {
      return res.status(400).json({ error: "add_stake_requires_trading_v7" });
    }

    let abiFile: string;
    try {
      abiFile = await resolveAbiFile(record.abiFile);
    } catch (e: any) {
      return res
        .status(500)
        .json({ error: e?.message || "abi_resolve_failed" });
    }
    try {
      const amountUnits = parseAmount(body.data.amount);

      const provider = await getProvider();
      const contractBal = await provider.getBalance(record.address);
      const totalRequired = amountUnits * BigInt(netuids.length);
      if (totalRequired > contractBal) {
        return res.status(400).json({
          error: "insufficient_contract_balance",
          contractBalanceWei: contractBal.toString(),
        });
      }

      const contract =
        typeof record.ownerIndex === "number"
          ? await getContractForOwnerIndex(
              record.address,
              abiFile,
              record.ownerIndex,
            )
          : await getContract(record.address, abiFile, record.ownerAddress);
      const limits = netuids.map(() => MaxUint256);
      const amounts = netuids.map(() => amountUnits);
      const tx = await contract.addStakeLimits(netuids, amounts, limits);
      const receipt = await tx.wait();
      return res.json({
        hash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        status: typeof receipt?.status === "number" ? receipt.status : null,
      });
    } catch (e: any) {
      const msg = e?.message || "tx_failed";
      if (msg === "invalid_amount")
        return res.status(400).json({ error: "invalid_amount" });
      return res.status(500).json({ error: msg });
    }
  });

  router.post("/:id/remove-stake", async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = removeStakeSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const db = await getDb();
    await db.read();
    const record = db.data.contracts.find((c: ContractRecord) => c.id === id);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }

    let abiFile: string;
    try {
      abiFile = await resolveAbiFile(record.abiFile);
    } catch (e: any) {
      return res
        .status(500)
        .json({ error: e?.message || "abi_resolve_failed" });
    }
    try {
      const contract =
        typeof record.ownerIndex === "number"
          ? await getContractForOwnerIndex(
              record.address,
              abiFile,
              record.ownerIndex,
            )
          : await getContract(record.address, abiFile, record.ownerAddress);
      let tx, receipt;
      if (record.type === "MEV") {
        tx = await contract.ForceStake(0, 0);
      } else if (record.type === "TradingV7") {
        tx = await contract.removeStakeLimits([body.data.netuid], [0n]);
      } else {
        return res.status(400).json({ error: "remove_stake_requires_mev_or_trading_v7" });
      }
      receipt = await tx.wait();
      return res.json({
        hash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        status: typeof receipt?.status === "number" ? receipt.status : null,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "tx_failed" });
    }
  });

  router.post("/:id/reset-stake", async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = resetStakeSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const db = await getDb();
    await db.read();
    const record = db.data.contracts.find((c: ContractRecord) => c.id === id);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }
    if (record.type !== "TradingV7") {
      return res.status(400).json({ error: "reset_stake_requires_trading_v7" });
    }

    let abiFile: string;
    try {
      abiFile = await resolveAbiFile(record.abiFile);
    } catch (e: any) {
      return res
        .status(500)
        .json({ error: e?.message || "abi_resolve_failed" });
    }
    try {
      const contract =
        typeof record.ownerIndex === "number"
          ? await getContractForOwnerIndex(
              record.address,
              abiFile,
              record.ownerIndex,
            )
          : await getContract(record.address, abiFile, record.ownerAddress);
      let tx, receipt;
      tx = await contract.resetLimitPrices([body.data.netuid]);
      receipt = await tx.wait();
      return res.json({
        hash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        status: typeof receipt?.status === "number" ? receipt.status : null,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "tx_failed" });
    }
  });

  router.post("/:id/withdraw", async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = withdrawSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    if (await is2FARequired()) {
      const totpOk = await verifyTotp(body.data.totp ?? "");
      if (!totpOk) {
        return res.status(401).json({ error: "invalid_totp" });
      }
    }

    const db = await getDb();
    await db.read();
    const record = db.data.contracts.find((c: ContractRecord) => c.id === id);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }

    let abiFile: string;
    try {
      abiFile = await resolveAbiFile(record.abiFile);
    } catch (e: any) {
      return res
        .status(500)
        .json({ error: e?.message || "abi_resolve_failed" });
    }
    const to = (body.data.to?.trim() || record.ownerAddress).trim();
    if (!isLikelyAddress(to)) {
      return res.status(400).json({ error: "invalid_withdraw_recipient" });
    }
    try {
      const amountUnits = parseAmount(body.data.amount);

      const provider = await getProvider();
      const contractBal = await provider.getBalance(record.address);
      if (amountUnits > contractBal) {
        return res.status(400).json({
          error: "insufficient_contract_balance",
          contractBalanceWei: contractBal.toString(),
        });
      }

      const contract =
        typeof (record as any).withdrawerIndex === "number"
          ? await getContractForOwnerIndex(
              record.address,
              abiFile,
              (record as any).withdrawerIndex,
            )
          : typeof record.ownerIndex === "number"
            ? await getContractForOwnerIndex(
                record.address,
                abiFile,
                record.ownerIndex,
              )
            : await getContract(
                record.address,
                abiFile,
                ((record as any).withdrawerAddress || record.ownerAddress).trim(),
              );
      const tx = await submitWithdraw(contract, to, amountUnits);
      const receipt = await tx.wait();
      return res.json({
        hash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        status: typeof receipt?.status === "number" ? receipt.status : null,
      });
    } catch (e: any) {
      const msg = e?.message || "tx_failed";
      if (msg === "invalid_amount")
        return res.status(400).json({ error: "invalid_amount" });
      return res.status(500).json({ error: msg });
    }
  });

  router.get("/:id/stakes", async (req: Request, res: Response) => {
    const id = req.params.id;
    const db = await getDb();
    await db.read();
    const record = db.data.contracts.find((c: ContractRecord) => c.id === id);
    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }

    if (record.type !== "TradingV7") {
      return res.json({ stakes: [] });
    }

    let abiFile: string;
    try {
      abiFile = await resolveAbiFile(record.abiFile);
    } catch (e: any) {
      return res
        .status(500)
        .json({ error: e?.message || "abi_resolve_failed" });
    }
    try {
      const stakes: {
        netuid: number;
        stakedPrice: string;
        currentPrice: string;
        alphaAmount: string;
        taoAmount: string;
        taoInPool: string;
        stakeTime: number | null;
      }[] = [];
      const contract =
        typeof record.ownerIndex === "number"
          ? await getContractForOwnerIndex(
              record.address,
              abiFile,
              record.ownerIndex,
            )
          : await getContract(record.address, abiFile, record.ownerAddress);
      if (record.type === "TradingV7") {
        const r = await contract.getTradingInfo();
        const prices = r.alphaPrices ?? r[0];
        const taoInPool = r.taoInPools ?? r[1];
        const staked = r.staked ?? r[2];
        const limitPrices = r.limitPrices ?? r[3];
        const stakedAmounts = r.stakedAmounts ?? r[4];
        for (let i = 0; i < 129; i++) {
          if (!staked[i]) continue;
          stakes.push({
            netuid: i,
            taoAmount: ((Number(stakedAmounts[i]) * Number(prices[i])) / 1e27).toFixed(5),
            stakedPrice: (Number(limitPrices[i]) / 1e18).toFixed(5),
            currentPrice: (Number(prices[i]) / 1e18).toFixed(5),
            taoInPool: (Number(taoInPool[i]) / 1e9).toFixed(2),
            alphaAmount: (Number(stakedAmounts[i]) / 1e9).toFixed(2),
            stakeTime: null,
          });
        }
        await Promise.all(
          stakes.map(async (stake) => {
            try {
              const raw = await contract.lastStakeTimestamps(stake.netuid);
              const n = Number(raw);
              stake.stakeTime = Number.isFinite(n) && n > 0 ? n : null;
            } catch {
              stake.stakeTime = null;
            }
          }),
        );
      }
      return res.json({ stakes });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "tx_failed" });
    }
  });

  return router;
}
