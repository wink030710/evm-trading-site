import { ethers } from "ethers";
import readline from "readline";
import { blake2b } from "@noble/hashes/blake2b";
import "dotenv/config";

const CONTRACT_ADDRESS = "0xcFC33f8523008E7D128c24F72df9e482DE5d1159";

const ABI = [
  "function owner() view returns (address)",
  "function withdrawer() view returns (address)",
  "function setConfig(address newWithdrawer, bytes32 newDelegatorColdkey) external",
];

function promptVisible(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function evmAddressToSubstrateAccountId(evmAddress: string): string {
  const checksummed = ethers.getAddress(evmAddress); // throws if invalid
  const addrBytes = ethers.getBytes(checksummed); // 20 bytes
  const preimage = new Uint8Array(24);
  preimage.set(new TextEncoder().encode("evm:"), 0);
  preimage.set(addrBytes, 4);
  const hash = blake2b(preimage, { dkLen: 32 });
  return ethers.hexlify(hash);
}

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider("http://185.8.107.85:9944");

  const privateKey = process.env.KEY2;
  if (!privateKey) throw new Error("KEY2 not found in environment variables");

  const signer = new ethers.Wallet(privateKey, provider);
  console.log("Using account:", signer.address);

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  const owner = (await contract.owner()) as string;
  console.log("Contract owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.warn(
      "WARNING: signer is not the contract owner; the transaction will revert with Ownable.",
    );
  }

  const rawAddress = await promptVisible("EVM address (0x...): ");
  if (!ethers.isAddress(rawAddress)) {
    throw new Error(`Invalid address: "${rawAddress}"`);
  }
  const newWithdrawer = ethers.getAddress(rawAddress);
  const newDelegatorColdkey = evmAddressToSubstrateAccountId(newWithdrawer);
  console.log(`  withdrawer        = ${newWithdrawer}`);
  console.log(
    `  delegator coldkey = ${newDelegatorColdkey}  (blake2_256("evm:" || addr))`,
  );

  console.log(
    `\nCalling setConfig(\n  newWithdrawer=${newWithdrawer},\n  newDelegatorColdkey=${newDelegatorColdkey}\n) ...`,
  );

  const tx = (await contract.setConfig(
    newWithdrawer,
    newDelegatorColdkey,
  )) as ethers.ContractTransactionResponse;
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt!.blockNumber);
  console.log("Status:", receipt!.status === 1 ? "success" : "failed");
}

main().catch((error) => {
  const err = error as Error;
  console.error("\nError occurred:");
  if (err.message?.includes("NotWithdrawer")) {
    console.error("Only the current withdrawer can call setConfig");
  } else if (err.message?.includes("Ownable: caller is not the owner")) {
    console.error("Only the contract owner can call this function");
  } else if (err.message?.includes("insufficient funds")) {
    console.error("Insufficient funds for gas");
  } else {
    console.error(err.message ?? err);
  }
  process.exitCode = 1;
});
