import express from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getDb } from "../services/storage.js";
import { z } from "zod";

const identityResponseSchema = z.object({
  pagination: z
    .object({
      current_page: z.number().optional(),
      per_page: z.number().optional(),
      total_items: z.number().optional(),
      total_pages: z.number().optional(),
      next_page: z.number().nullable().optional(),
      prev_page: z.number().nullable().optional(),
    })
    .optional(),
  data: z.array(
    z.object({
      netuid: z.number(),
      subnet_name: z.string().nullable().optional(),
    }).passthrough(),
  ),
});

const TAOSTATS_TIMEOUT_MS = 15_000;

function taostatsErrorToMessage(e: any): string {
  const msg = e?.message || "taostats_unreachable";
  if (msg === "taostats_timeout") return "Taostats API timeout";
  if (msg === "taostats_unreachable") return "Taostats API unavailable";
  return msg;
}

async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const { timeoutMs = TAOSTATS_TIMEOUT_MS, ...init } = opts;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    return r;
  } finally {
    clearTimeout(id);
  }
}

async function fetchIdentityFromTaostats() {
  const url = "https://taostats.io/api/subnet/identity";
  let r: Awaited<ReturnType<typeof fetch>>;
  try {
    r = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "evm-trading-site/1.0",
      },
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("taostats_timeout");
    throw new Error(e?.message || "taostats_unreachable");
  }
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok) {
    throw new Error(
      data?.error || data?.message || text?.slice?.(0, 200) || "taostats_failed",
    );
  }
  const parsed = identityResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error("invalid_identity_response");
  return parsed.data;
}

// Taostats returns many numeric fields as strings; accept string | number | null and normalize to number | null.
const numericLike = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  });

const numOrStr = z.union([z.number(), z.string()]);
const numOrStrOrNull = z.union([z.number(), z.string(), z.null()]);

const dtaoSubnetsRowSchema = z
  .object({
    netuid: numOrStr.optional().transform((v) => (v === undefined ? undefined : Number(v))),
    name: z.string().nullable().optional(),
    fear_and_greed_index: numOrStrOrNull.optional().transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    }),
    total_tao: numericLike,
    price_change_1_hour: numericLike,
    price_change_1_day: numericLike,
    price_change_1_week: numericLike,
    price_change_1_month: numericLike,
    price: numericLike,
    tao_buy_volume_24_hr: numericLike,
    tao_sell_volume_24_hr: numericLike,
    github: z.string().nullable().optional(),
    subnet_url: z.string().nullable().optional(),
    incentive_burn: numericLike,
    is_immune: z.boolean().nullable().optional(),
  })
  .passthrough();

const dtaoSubnetsResponseSchema = z.union([
  z.array(dtaoSubnetsRowSchema),
  z.object({ data: z.array(dtaoSubnetsRowSchema) }).passthrough(),
]);

async function fetchDtaoSubnetsFromTaostats() {
  const url = "https://taostats.io/api/dtao/dtaoSubnets?order=netuid_asc";
  let r: Awaited<ReturnType<typeof fetch>>;
  try {
    r = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "evm-trading-site/1.0",
      },
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("taostats_timeout");
    throw new Error(e?.message || "taostats_unreachable");
  }
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok) {
    throw new Error(
      data?.error || data?.message || text?.slice?.(0, 200) || "taostats_failed",
    );
  }
  const parsed = dtaoSubnetsResponseSchema.safeParse(data["data"]);
  if (!parsed.success) throw new Error("invalid_dtao_subnets_response");
  const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
  return { data: rows };
}

export function createSubnetsRouter() {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/identity", async (_req: Request, res: Response) => {
    const db = await getDb();
    await db.read();
    const cached = (db.data as any).subnetIdentity;
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
      return res.json(cached);
    }
    try {
      const fresh = await fetchIdentityFromTaostats();
      (db.data as any).subnetIdentity = {
        updatedAt: new Date().toISOString(),
        data: fresh.data,
      };
      await db.write();
      return res.json((db.data as any).subnetIdentity);
    } catch (e: any) {
      return res.status(502).json({ error: taostatsErrorToMessage(e) });
    }
  });

  router.post("/identity/refresh", async (_req: Request, res: Response) => {
    const db = await getDb();
    await db.read();
    try {
      const fresh = await fetchIdentityFromTaostats();
      (db.data as any).subnetIdentity = {
        updatedAt: new Date().toISOString(),
        data: fresh.data,
      };
      await db.write();
      return res.json((db.data as any).subnetIdentity);
    } catch (e: any) {
      return res.status(502).json({ error: taostatsErrorToMessage(e) });
    }
  });

  router.get("/dtao-subnets", async (_req: Request, res: Response) => {
    try {
      const fresh = await fetchDtaoSubnetsFromTaostats();
      return res.json(fresh);
    } catch (e: any) {
      return res.status(502).json({ error: taostatsErrorToMessage(e) });
    }
  });

  return router;
}

