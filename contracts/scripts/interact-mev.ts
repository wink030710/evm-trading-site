import { ethers } from "ethers";
import "dotenv/config";

const CONTRACT_ADDRESS = "0xa077D6273ce42ef75B7301F43Ff3955E839C5f9D";

const ABI = [
  "function owner() view returns (address)",
  "function removeStakeAlpha() external",
  "function withdrawAll(address to)",
  "function emergencyWithdrawTao(address to, uint256 amount)",
  "function getInfo() view returns (bool staked, uint256 ownerBalance, uint256 contractBalance)",
  "function balance() view returns (uint256)",
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

    const info = await contract.getInfo();
    console.log("getInfo.staked:", info.staked);
    console.log("getInfo.contractBalance:", ethers.formatEther(info.contractBalance), "TAO");

    const contractBalanceBefore = await provider.getBalance(CONTRACT_ADDRESS);
    const signerBalanceBefore = await provider.getBalance(signer.address);
    console.log("\nContract balance:", ethers.formatEther(contractBalanceBefore), "TAO");
    console.log("Signer balance:", ethers.formatEther(signerBalanceBefore), "TAO");

    const tx = await contract.removeStakeAlpha();
    // const tx = await contract.emergencyWithdrawTao("0x369850c48b0bdE46076d067C4379A658C6d3d167", ethers.parseEther("10"));
    // const tx = await contract.withdrawAll("0xa077D6273ce42ef75B7301F43Ff3955E839C5f9D");
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
