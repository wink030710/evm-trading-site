import { ethers } from "ethers";
import "dotenv/config";

const CONTRACT_ADDRESS = "0xa41677c076DABE0fcBbfCa30A6c7b39D4b2aCd02";

const ABI = [
  "function owner() view returns (address)",
  "function withdrawAll(address to)",
  "function emergencyWithdrawTao(address to, uint256 amount)",
  "function increase_stake(uint256 stakeAmount, uint256 alphaNetuid)",
  "function balance() view returns (uint256)",
  "function setWithdrawer(address newWithdrawer) external",
  "function getIsStaked() external view returns (bool[129] memory)",
  "function force_remove_stake(uint256 alphaNetuid) external payable nonReentrant onlyOwner",
];

async function main(): Promise<void> {
  try {
    const provider = new ethers.JsonRpcProvider("http://185.8.107.85:9944");

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not found in environment variables");

    const signer = new ethers.Wallet(privateKey, provider);
    console.log("Using account:", signer.address);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    const balance = await provider.getBalance(CONTRACT_ADDRESS);
    console.log("\nContract balance:", ethers.formatEther(balance), "TAO");

    // const tx = await contract.emergencyWithdrawTao(
    //   "0x369850c48b0bdE46076d067C4379A658C6d3d167",
    //   ethers.parseEther("1")
    // );
    const tx = await contract.withdrawAll(
      "0x369850c48b0bdE46076d067C4379A658C6d3d167",
    );

    // const tx = await contract.setWithdrawer("0xa54b69d659916256d53fa0d6082497e3728d2c88");

    console.log("Transaction hash:", tx.hash);
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
