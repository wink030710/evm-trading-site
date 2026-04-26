import fs from "fs";
import "dotenv/config";

const API_URL = "https://api.cherryservers.com/v1/teams";
const OUTPUT_PATH = "cherry_teams.json";
const TOKEN = process.env.CHERRY_API_TOKEN;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTeams() {
  if (!TOKEN) {
    throw new Error("Missing CHERRY_API_TOKEN environment variable.");
  }

  const res = await fetch(API_URL, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return res.json();
}

(async () => {
  while (true) {
    try {
      const payload = await fetchTeams();
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));

      const now = new Date().toISOString();
      console.log(`[${now}] Fetched teams data; wrote ${OUTPUT_PATH}`);

      for (const team of payload || []) {
        const teamName = team?.name ?? `team-${team?.id ?? "unknown"}`;
        const accountRemaining = team?.credit?.account?.remaining ?? "n/a";
        const currency = team?.credit?.account?.currency ?? "";
        console.log(`- ${teamName}: remaining ${accountRemaining} ${currency}`.trim());
      }
    } catch (err) {
      const now = new Date().toISOString();
      console.error(`[${now}] Failed to fetch teams data:`, err?.message || err);
    }

    console.log(`Waiting ${Math.floor(CHECK_INTERVAL_MS / 60000)} minutes before next check...`);
    await sleep(CHECK_INTERVAL_MS);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
