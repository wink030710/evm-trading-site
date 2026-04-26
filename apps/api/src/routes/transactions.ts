import express from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";

const querySchema = z.object({
  nominator: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  page: z.coerce.number().int().positive().default(1),
  action: z
    .enum(["delegate", "undelegate"])
    .optional(),
  netuid: z.coerce.number().int().nonnegative().optional(),
});

export function createTransactionsRouter() {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/delegate", async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const { nominator, limit, page, action, netuid } = parsed.data;

    const url = new URL("https://taostats.io/api/delegate/delegate");
    url.searchParams.set("nominator", nominator);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", String(page));
    if (action) url.searchParams.set("action", action);
    if (typeof netuid === "number") url.searchParams.set("netuid", String(netuid));

    try {
      const r = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "evm-trading-site/1.0",
          "X-Bot-Gate-Token": "token"
        },
      });
      const text = await r.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!r.ok) {
        return res.status(502).json({
          error: "upstream_error",
          status: r.status,
          message: data?.error || data?.message || text?.slice?.(0, 200) || "taostats_failed",
        });
      }
      return res.json(data);
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || "taostats_unreachable" });
    }
  });

  return router;
}

