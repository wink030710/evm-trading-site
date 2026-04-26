import { ethers } from "ethers";
import "dotenv/config";

const CONTRACT_ADDRESS = "0x4c62cA356DcFe44cCB0D2F3579017170421C72f9";

const ABI = [
  "function owner() view returns (address)",
  "function ForceStake(uint256 stakeAmount, uint256 alphaNetuid, bytes32 _validatorHotkey)",
  "function withdrawAll(address to)",
  "function emergencyWithdrawTao(address to, uint256 amount)",
  "function balance() view returns (uint256)",
  "function updateMevKeys(bytes32[] calldata newMevHotkeyBytesKeys, bytes32[] calldata newMevColdkeyBytesKeys)",
  "function getInfo() view returns (bool staked, uint256 ownerBalance, uint256 contractBalance)",
  "function setWithdrawer(address newWithdrawer) external",
];

async function main(): Promise<void> {
  try {
    const provider = new ethers.JsonRpcProvider("http://185.8.107.85:9944");

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not found in environment variables");

    const signer = new ethers.Wallet(privateKey, provider);
    console.log("Using account:", signer.address);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    const stakeAmount = 0n;
    const alphaNetuid = 93;
    const validatorHotkey =
      "0x50d511a150f3eebccfde98c11d3bbe007e33c5034b69709be99579e51f281c27";

    const hotkeyLastByte = parseInt(validatorHotkey.slice(-2), 16);
    const netuidsIndex = alphaNetuid + hotkeyLastByte;
    console.log("\nvalidatorHotkey lastByte:", hotkeyLastByte);
    console.log("Computed netuids index (alphaNetuid + lastByte):", netuidsIndex);

    const info = await contract.getInfo();
    console.log("getInfo.staked:", info.staked);
    console.log("getInfo.contractBalance:", ethers.formatEther(info.contractBalance), "TAO");

    const contractBalanceBefore = await provider.getBalance(CONTRACT_ADDRESS);
    const signerBalanceBefore = await provider.getBalance(signer.address);
    console.log("\nContract balance:", ethers.formatEther(contractBalanceBefore), "TAO");
    console.log("Signer balance:", ethers.formatEther(signerBalanceBefore), "TAO");

    // try {
    //       await contract.callStatic.ForceStake(stakeAmount, netuidsIndex, validatorHotkey);
    //       console.log("Preflight callStatic: OK");
    //     } catch (e) {
    //       console.log("Preflight callStatic: REVERT");
    //       throw e;
    //     }

    // const tx = await contract.ForceStake(stakeAmount, netuidsIndex, validatorHotkey);
    // const tx = await contract.emergencyWithdrawTao("0x369850c48b0bdE46076d067C4379A658C6d3d167", ethers.parseEther("10"));
    // const tx = await contract.withdrawAll("0x4c62cA356DcFe44cCB0D2F3579017170421C72f9");
    // const tx = await contract.updateMevAddress("0x18C71A8B99EeEA233bB02D89f5C9F73744BeB590");
    const tx = await contract.updateMevKeys(
      [
        "0x56a9aee6291bd03ab6d36d4d13e2bebae7cd403518066c72fba1b417d6ddd748",
        "0x56a9aee6291bd03ab6d36d4d13e2bebae7cd403518066c72fba1b417d6ddd748",
        "0x56a9aee6291bd03ab6d36d4d13e2bebae7cd403518066c72fba1b417d6ddd748",
        "0x56a9aee6291bd03ab6d36d4d13e2bebae7cd403518066c72fba1b417d6ddd748",
        "0x56a9aee6291bd03ab6d36d4d13e2bebae7cd403518066c72fba1b417d6ddd748",
      ],
      [
        "0x46d07f1fc991931bdce777cbc0d37f3203bca583b41ee31b7b4bbda0ded6b004", // 5DfZ9PkYnkjSSxCHxtkfLC6n7RJ2rkJTLZ5sEecQdYsoktwW
        "0xae3156088c769e7c88c115774e0ed79f661dd3fbc9f08420ccfacec8736bd421", // 5G16qxjvPK2icLWe7Laa9efCSHdQZqsBY2eMnUY3YRm9FMJq
        "0x09444b8b0fce65fd5d0bad167e408da02e20780a6eb2e43f0a432eee6175ed2f", // 5CGraMvdERLYa6HcMwCS2T4PWYM8AVyUbH3Vpa5FHVhWqWXj
        "0xb711c553dfaba640246819f1159900ad84e3cc6eceb617ed7add39cfc12852eb", // 5GWzvRFauhhUQ4tz6KwXSsEiaqA8hvF5HhRG1fK4V2nS9NZ7
        "0xd608394e2227c932de7d4be6c4038598f72353e106ac926f9c21c686d4d10e73", // 5GuLYhyfPPMRqu9j57FUBLvQgx3wDjgL3WvqoyKnLjpuYeET
        // "0xd608394e2227c932de7d4be6c4038598f72353e106ac926f9c21c686d4d10e73",
      ],
    );
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt!.blockNumber);

    const newContractBalance = await provider.getBalance(CONTRACT_ADDRESS);
    const newOwnerBalance = await provider.getBalance(signer.address);
    console.log("\nFinal balances:");
    console.log("Contract balance:", ethers.formatEther(newContractBalance), "TAO");
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
