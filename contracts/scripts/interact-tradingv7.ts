import { ethers } from "ethers";
import "dotenv/config";

const CONTRACT_ADDRESS = "0x33Ca7fA48c2c31830bF0980fBC97830D4767c437";

const ABI = [
  "function owner() view returns (address)",
  "function addStakeLimits(uint256[] calldata amounts, uint256[] calldata netuids, uint256[] calldata limitPrices) external payable",
  "function removeStakeLimits(uint256[] calldata netuids, uint256[] calldata limitPrices) external payable",
  "function resetLimitPrices(uint256[] calldata netuids) external",
  "function updateContractBytesKey(bytes32 newContractBytesKey) external",
  "function updateMevAddresses(address[] calldata newMevAddresses) external",
  "function removeDeregisteredStakes(uint256[] calldata netuids) external",
  "function setWithdrawer(address newWithdrawer) external",
  "function withdrawAll(address to) external",
  "function emergencyWithdrawTao(address to, uint256 amount) external",
  "function getTradingInfo() external view returns (uint256[129] memory alphaPrices, uint64[129] memory taoInPool, bool[129] memory staked, uint256[129] memory limitPrices, uint256[129] memory stakedAmounts, uint256[129] memory timestamps, uint256 freeBalance)",
  "function getStakedAmounts(bytes32[] calldata hotkeys, bytes32[] calldata coldkeys) external view returns (uint256[129] memory amounts)",
];

async function main(): Promise<void> {
  try {
    const provider = new ethers.JsonRpcProvider("http://185.8.107.85:9944");

    // const privateKey = process.env.PRIVATE_KEY;
    const privateKey = process.env.KEY2;
    if (!privateKey)
      throw new Error("PRIVATE_KEY not found in environment variables");

    const signer = new ethers.Wallet(privateKey, provider);
    console.log("Using account:", signer.address);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    const balance = await provider.getBalance(CONTRACT_ADDRESS);
    console.log("\nContract balance:", ethers.formatEther(balance), "TAO");

    // const tx = await contract.updateContractBytesKey('0x90fa224a5999a26784cf2537c0311f68ff689ff247f68622abaec12e27fb42e4');
    // const tx = await contract.updateMevAddresses(
    //   [
    //     "0x6F5cCE257F9333104d67aa6B271D728168D850E6", // 5Fzn8ZBk2VWkp8iASwanhbGbMgLcYcEdmzjWA7c9yzLTY7ka
    //     // "0x31E32A1585D2d22FbD89c956DD47e7324F134C1e", // 5EyvRbmfhR9JQvjzu1pPis1JsPaazQbEmhVqCrp2eAUn6eFk
    //     "0x0E69826457632B4c2d778190f3af6Bc8535d9235", // 5DfZ9PkYnkjSSxCHxtkfLC6n7RJ2rkJTLZ5sEecQdYsoktwW
    //     "0xb18160915ee122449c4aC1770640510FDf791E41", // 5G16qxjvPK2icLWe7Laa9efCSHdQZqsBY2eMnUY3YRm9FMJq
    //     "0x011AD1a10E559C6AcD2EcCDFA67ba035e55B1217", // 5CGraMvdERLYa6HcMwCS2T4PWYM8AVyUbH3Vpa5FHVhWqWXj
    //     "0xb18160915ee122449c4aC1770640510FDf791E41", // 5G16qxjvPK2icLWe7Laa9efCSHdQZqsBY2eMnUY3YRm9FMJq
    //     "0xb18160915ee122449c4aC1770640510FDf791E41", // 5G16qxjvPK2icLWe7Laa9efCSHdQZqsBY2eMnUY3YRm9FMJq
    //     // "0x5aB11e290b0865E1e8532c7750C1405CF532a9De", // 5G16qxjvPK2icLWe7Laa9efCSHdQZqsBY2eMnUY3YRm9FMJq
    //     // "0xb18160915ee122449c4aC1770640510FDf791E41", // 5G16qxjvPK2icLWe7Laa9efCSHdQZqsBY2eMnUY3YRm9FMJq
    //     // "0x03ff1d1265547979cfb5e917007003a08d1854d8" // 5GuLYhyfPPMRqu9j57FUBLvQgx3wDjgL3WvqoyKnLjpuYeET
    //   ],
    // );
    // const tx = await contract.addStakeLimits([ethers.parseEther("0.1")], [64], [alphaPrices[64]]);
    // const tx = await contract.removeStakeLimits([99,103,105,109,112,117,122], [0,0,0,0,0,0,0]);
    // const tx = await contract.removeDeregisteredStakes([82]);
    // const tx = await contract.emergencyWithdrawTao(
    //   "0xe2fc9873166079715d80375ecd52d545cb284fdb",
    //   ethers.parseEther("0.1")
    // );
    const tx = await contract.withdrawAll(
      "0x9774B5D7f946DF59F6e19f5805bFBb7A35e9A3CB"
    );
    console.log("Transaction hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt!.blockNumber);

    const newContractBalance = await provider.getBalance(CONTRACT_ADDRESS);
    const newOwnerBalance = await provider.getBalance(signer.address);
    console.log("\nFinal balances:");
    console.log(
      "Contract balance:",
      ethers.formatEther(newContractBalance),
      "TAO",
    );
    console.log("Owner balance:", ethers.formatEther(newOwnerBalance), "TAO");
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
