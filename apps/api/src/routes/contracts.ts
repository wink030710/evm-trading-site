import express from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { parseUnits } from "ethers";
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

const contractCreateSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["MEV", "TradingV3", "TradingV4", "TradingV5", "Unknown"]),
    address: z.string().min(1),
    ownerAddress: z.string().min(1).optional(),
    ownerIndex: z.coerce.number().int().nonnegative().optional(),
    abiFile: z.string().min(1).optional(),
    coldkey: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.ownerIndex !== undefined ||
      (v.ownerAddress && v.ownerAddress.trim().length > 0),
    {
      message: "owner_required",
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
});

function isLikelyAddress(value: string) {
  const v = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

function isLikelyBytes32(value: string) {
  const v = value.trim();
  return /^0x[a-fA-F0-9]{64}$/.test(v);
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
      if (t === "Trading") {
        (c as any).type = "TradingV5";
        changed = true;
      } else if (t !== "MEV" && t !== "TradingV3" && t !== "TradingV4" && t !== "TradingV5" && t !== "Unknown") {
        (c as any).type = "TradingV5";
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

    let resolvedOwnerIndex: number | undefined = undefined;
    let resolvedOwnerAddress: string | undefined = requestedAddress;

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
    }

    if (!resolvedOwnerAddress) {
      return res.status(400).json({ error: "owner_required" });
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
      abiFile: resolvedAbiFile,
      coldkey,
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
      const tx = await contract.add_stakes(amountUnits, netuids);
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
      } else {
        tx = await contract.force_remove_stake(body.data.netuid);
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
      tx = await contract.reset(body.data.netuid);
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
        typeof record.ownerIndex === "number"
          ? await getContractForOwnerIndex(
              record.address,
              abiFile,
              record.ownerIndex,
            )
          : await getContract(record.address, abiFile, record.ownerAddress);
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

    if (!record.coldkey) {
      return res.status(400).json({ error: "coldkey_required" });
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
      }[] = [];
      const contract =
        typeof record.ownerIndex === "number"
          ? await getContractForOwnerIndex(
              record.address,
              abiFile,
              record.ownerIndex,
            )
          : await getContract(record.address, abiFile, record.ownerAddress);
      if (record.type === "TradingV4" || record.type === "TradingV5") {
        const [prices, taoInPool, staked, stakedPrices] = await contract.getInfo();
        const stakedAmounts = await contract.getStakedAmount(record.coldkey);
        for (let i = 0; i < 129; i++) {
          if (!staked[i]) continue;
          stakes.push({
            netuid: i,
            taoAmount: ((Number(stakedAmounts[i]) * Number(prices[i])) / 1e27).toFixed(5),
            stakedPrice: (Number(stakedPrices[i]) / 1e18).toFixed(5),
            currentPrice: (Number(prices[i]) / 1e18).toFixed(5),
            taoInPool: (Number(taoInPool[i]) / 1e9).toFixed(2),
            alphaAmount: (Number(stakedAmounts[i]) / 1e9).toFixed(2),
          });
        }
      }
      // else if (record.type === "TradingV5") {
      //   const [prices, taoInPool, stakedV3, stakedV4, stakedPricesV3, stakedPricesV4] = await contract.getInfo_Old();
      //   const stakedAmountsV3 = await contract.getStakedAmount("0xc9d7c3d30fdb7566bd715a84829c6365a156064a661eeebdf341456e6fc4cb75");
      //   const stakedAmountsV4 = await contract.getStakedAmount(record.coldkey);
      //   for (let i = 0; i < 129; i++) {
      //     if (!stakedV3[i] && !stakedV4[i]) continue;
      //     const stakedPrice = stakedV3[i] ? Number(stakedPricesV3[i]) / 1e18 : Number(stakedPricesV4[i]) / 1e18;
      //     const stakedAmount = stakedV3[i] ? Number(stakedAmountsV3[i]) : Number(stakedAmountsV4[i]);
      //     stakes.push({
      //       netuid: i,
      //       taoAmount: ((Number(stakedAmount) * Number(prices[i])) / 1e27).toFixed(5),
      //       stakedPrice: stakedPrice.toFixed(5),
      //       currentPrice: (Number(prices[i]) / 1e18).toFixed(5),
      //       taoInPool: (Number(taoInPool[i]) / 1e9).toFixed(2),
      //       alphaAmount: (Number(stakedAmount) / 1e9).toFixed(2),
      //     });
      //   }
      // }
      return res.json({ stakes });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "tx_failed" });
    }
  });

  return router;
}
