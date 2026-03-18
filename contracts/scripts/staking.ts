import { ethers } from "ethers";
import "dotenv/config";

const CONTRACT_ADDRESS = "0x369850c48b0bdE46076d067C4379A658C6d3d167";

const ABI = [
  "function add_stake(uint256 stakeAmount, uint256 alphaNetuid)",
  "function force_remove_stake(uint256 alphaNetuid)",
  "function remove_stake(uint256 alphaNetuid)",
  "function updatePriceThreshold(uint256 threshold)",
  "function priceUpdateThreshold() view returns (uint256)",
  "function getIsStaked() external view returns (bool[129] memory)",
  "function getInfo() external view returns (uint256[129] memory prices, uint64[129] memory taoInPool, bool[129] memory staked, uint256[129] memory stakedPrices)",
  "function getInfo_Old() external view returns (uint256[129] memory prices, uint64[129] memory taoInPool, bool[129] memory staked_old, bool[129] memory staked, uint256[129] memory stakedPrices_old, uint256[129] memory stakedPrices)",
];

async function main(): Promise<void> {
  try {
    const provider = new ethers.JsonRpcProvider("http://88.216.68.239:9944");

    const privateKey = process.env.KEY2;
    if (!privateKey) {
      throw new Error("PRIVATE_KEY not found in environment variables");
    }

    const signer = new ethers.Wallet(privateKey, provider);
    console.log("Using account:", signer.address);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    const info = await contract.getInfo_Old();
    const taoInPool = info.taoInPool as bigint[];
    const staked_old = info.staked_old as boolean[];
    const staked = info.staked as boolean[];

    const results: { netuid: number; tao: number }[] = [];
    const blacklist_uids = [104];
    for (let i = 1; i < taoInPool.length; i++) {
      const taoInPoolForNetuid = Number(taoInPool[i]) / 1e9;

      if (
        taoInPoolForNetuid > 100 &&
        !staked[i] && !staked_old[i] &&
        !blacklist_uids.includes(i)
      ) {
        results.push({ netuid: i, tao: taoInPoolForNetuid });
      }
    }

    results.sort((a, b) => a.tao - b.tao);

    const uids: number[] = [];
    for (const r of results) {
      console.log(`TAO in pool for netuid ${r.netuid}: not staked - ${r.tao}`);
      uids.push(r.netuid);
    }

    console.log(`Total netuids with TAO in pool: ${results.length}`);
    console.log(`UIDs: ${uids.join(", ")}`);
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
