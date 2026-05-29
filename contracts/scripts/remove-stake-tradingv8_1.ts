import { ethers } from "ethers";
import { parseUnits } from "ethers";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import "dotenv/config";

const CONTRACT_ADDRESS = "0xD689D29f7eA0c511F4DDE84171b10D34078bb17C";

const ABI = [
  "function owner() view returns (address)",
  "function removeStake(uint256 netuid, uint256 amount) external",
  "function setWithdrawer(address newWithdrawer) external",
];

const QUIT_TOKENS = new Set(["q", "quit", "exit"]);

function isQuit(value: string): boolean {
  return QUIT_TOKENS.has(value.trim().toLowerCase());
}

async function promptRemoveStakeInput(
  rl: readline.Interface,
): Promise<{ netuid: number; amount: bigint } | null> {
  while (true) {
    const raw = (
      await rl.question("\nnetuid amount (or 'q' to quit): ")
    ).trim();
    if (isQuit(raw)) return null;

    const parts = raw.split(/[\s,]+/).filter((part) => part.length > 0);
    if (parts.length !== 2) {
      console.log(
        "  -> Invalid input. Provide netuid and amount on one line. Example: 5 12.5",
      );
      continue;
    }

    const [netuidRaw, amountRaw] = parts;
    const netuid = Number(netuidRaw);
    if (!Number.isInteger(netuid) || netuid < 0) {
      console.log("  -> Invalid netuid. Please enter a non-negative integer.");
      continue;
    }

    let amount: bigint;
    try {
      amount = parseUnits(amountRaw, 9);
    } catch {
      console.log("  -> Invalid amount. Example: 250 or 12.5");
      continue;
    }
    if (amount <= 0n) {
      console.log("  -> Amount must be greater than zero.");
      continue;
    }

    return { netuid, amount };
  }
}

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider("http://185.8.107.85:9944");

  const privateKey = process.env.KEY2;
  if (!privateKey) throw new Error("KEY2 not found in environment variables");

  const signer = new ethers.Wallet(privateKey, provider);
  console.log("Using account:", signer.address);
  console.log("Contract:       ", CONTRACT_ADDRESS);

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  const contractBalance = await provider.getBalance(CONTRACT_ADDRESS);
  console.log("Contract balance:", ethers.formatEther(contractBalance), "TAO");

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const result = await promptRemoveStakeInput(rl);
      if (result === null) break;
      const { netuid, amount } = result;

      console.log(
        `\nSending removeStake(netuid=${netuid}, amount=${ethers.formatUnits(
          amount,
          9,
        )} TAO)...`,
      );

      try {
        const tx = await contract.removeStake(
          netuid,
          amount,
        );
        console.log("  tx hash:", tx.hash);

        const receipt = await tx.wait();
        if (receipt) {
          console.log(
            `  confirmed in block ${receipt.blockNumber} (status=${receipt.status})`,
          );
        } else {
          console.log("  no receipt returned");
        }
      } catch (error) {
        const err = error as Error;
        console.error("  Transaction failed:");
        if (err.message?.includes("NotWithdrawerOrOwner")) {
          console.error("  -> Caller is not withdrawer or owner.");
        } else if (err.message?.includes("insufficient funds")) {
          console.error("  -> Insufficient funds for gas.");
        } else {
          console.error("  ->", err.message);
        }
      }
    }
  } finally {
    rl.close();
  }

  const finalContractBalance = await provider.getBalance(CONTRACT_ADDRESS);
  const finalOwnerBalance = await provider.getBalance(signer.address);
  console.log("\nFinal balances:");
  console.log(
    "  Contract balance:",
    ethers.formatEther(finalContractBalance),
    "TAO",
  );
  console.log(
    "  Account balance: ",
    ethers.formatEther(finalOwnerBalance),
    "TAO",
  );
  console.log("Bye.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
