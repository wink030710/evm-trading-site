const fs = require("fs");

const BASE =
  "https://taostats.io/api/delegate/delegate?nominator=5H3RkJJNc97S7HPHkKvXVi16wNMxLKSuEmfYoatMXxswkYnT&limit=1000&page=";
const OUTPUT_PATH = "taostats_delegate_transactions.json";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  let page = 1;
  const rows = [];

  while (true) {
    const res = await fetch(BASE + page);
    if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
    const payload = await res.json();

    for (const row of payload.data || []) {
      rows.push({
        blockNumber: row?.block_number ?? null,
        action: row?.action ?? null,
        timestamp: row?.timestamp ?? null,
        nominatorSs58: row?.nominator?.ss58 ?? null,
        delegateSs58: row?.delegate?.ss58 ?? null,
        amount: row?.amount ?? null,
        alpha: row?.alpha ?? null,
        netuid: row?.netuid ?? null,
        extrinsic_id: row?.extrinsic_id ?? null,
      });
    }

    const nextPage = payload?.pagination?.next_page;
    if (!nextPage) break;

    page = nextPage;
    await sleep(200);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(rows, null, 2));
  console.log(`Fetched ${rows.length} tx rows; wrote ${OUTPUT_PATH}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});