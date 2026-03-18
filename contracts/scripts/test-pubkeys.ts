import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import "dotenv/config";

const CONTRACT_ADDRESS = "0x092dabDB33B2A99bECDeA2C23f6A944763b78986";
const RPC_URL = "http://185.8.107.85:9944";
const ALPHA_NETUID = 44;
const ABI = [
  "function owner() view returns (address)",
  "function ForceStake(uint256 stakeAmount, uint256 alphaNetuid, bytes32 _validatorHotkey)",
];

function loadHotkeysFromPath(inputPath: string): string[] {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  const out: string[] = [];

  if (stat.isDirectory()) {
    const files = fs.readdirSync(resolved);
    for (const file of files) {
      const filePath = path.join(resolved, file);
      if (!fs.statSync(filePath).isFile()) continue;
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as
          | string
          | string[]
          | { publicKey?: string };
        if (typeof data === "string") {
          out.push(data);
        } else if (Array.isArray(data)) {
          out.push(...data);
        } else if (data && typeof data === "object" && data.publicKey) {
          out.push(data.publicKey);
        }
      } catch {
        // ignore
      }
    }
  } else {
    const data = JSON.parse(fs.readFileSync(resolved, "utf8")) as
      | string[]
      | { publicKeys?: string[] };
    if (Array.isArray(data)) {
      out.push(...data);
    } else if (data && typeof data === "object" && Array.isArray(data.publicKeys)) {
      out.push(...data.publicKeys);
    } else {
      throw new Error(
        "Unsupported hotkeys JSON format; expected array of bytes32 strings"
      );
    }
  }

  const uniq = Array.from(
    new Set(out.map((s) => (typeof s === "string" ? s.trim() : s)).filter(Boolean))
  );
  return uniq;
}

async function main(): Promise<void> {
  try {
    const hotkeysInput = process.argv[2];
    if (!hotkeysInput) {
      throw new Error("Usage: npx ts-node scripts/test-pubkeys.ts <hotkey|hotkeysPath>");
    }

    let hotkeys: string[];
    if (typeof hotkeysInput === "string" && hotkeysInput.startsWith("0x")) {
      hotkeys = [hotkeysInput];
    } else {
      hotkeys = loadHotkeysFromPath(hotkeysInput);
    }
    if (!hotkeys || hotkeys.length === 0) {
      throw new Error("No hotkeys provided/found");
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not found in environment variables");

    const signer = new ethers.Wallet(privateKey, provider);
    console.log("Using account:", signer.address);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const owner = await contract.owner();
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(
        `Signer is not contract owner. owner=${owner} signer=${signer.address}`
      );
    }

    const results: { hotkey: string; callStaticOk: boolean; error?: string }[] = [];
    const stakeAmount = 0n;
    for (const hotkey of hotkeys) {
      const r: { hotkey: string; callStaticOk: boolean; error?: string } = { hotkey, callStaticOk: false };
      const hotkeyLastByte = parseInt(hotkey.slice(-2), 16);
      const alphaNetuid = ALPHA_NETUID + hotkeyLastByte;
      try {
        await contract.ForceStake.staticCall(stakeAmount, alphaNetuid, hotkey);
        r.callStaticOk = true;
      } catch (e) {
        r.callStaticOk = false;
        r.error = e && (e as Error).message ? (e as Error).message : String(e);
      }
      results.push(r);
    }

    const failed = results.filter((x) => !x.callStaticOk);
    const failedHotkeys = failed.map((x) => x.hotkey);
    process.stdout.write(JSON.stringify(failedHotkeys, null, 2));

    if (failed.length) process.exitCode = 1;
  } catch (error) {
    const err = error as Error;
    console.error("\nError occurred:");
    if (err.message?.includes("AmountZero")) {
      console.error("Contract has no balance to withdraw");
    } else if (err.message?.includes("Ownable: caller is not the owner")) {
      console.error("Only the contract owner can withdraw");
    } else if (err.message?.includes("insufficient funds")) {
      console.error("Insufficient funds for gas");
    } else {
      console.error(err.message);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
