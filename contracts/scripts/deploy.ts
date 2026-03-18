import { ethers } from "hardhat";
import { LZ_ENDPOINTS } from "./layerzero";

async function main() {
  const network = process.env.HARDHAT_NETWORK ?? "base";
  const lz = LZ_ENDPOINTS[network as keyof typeof LZ_ENDPOINTS];
  if (!lz || !lz.endpoint) {
    throw new Error(
      `No LayerZero endpoint for network "${network}". Use base, bsc, bsc-testnet, or bittensor-evm.`
    );
  }

  const [deployer] = await ethers.getSigners();
  const endpoint = lz.endpoint;

  console.log("Deploying with:", { network, endpoint, deployer: deployer.address });

  if (network === "base" || network === "bsc" || network === "bsc-testnet") {
    const Sender = await ethers.getContractFactory("BSCSender");
    const sender = await Sender.deploy(endpoint, deployer.address);
    await sender.waitForDeployment();
    const senderAddress = await sender.getAddress();
    console.log("BSCSender deployed to:", senderAddress);
    const srcEid = lz.eid;
    console.log("\nNext: Deploy BittensorReceiver on Bittensor EVM, then set peers.");
    console.log("  On " + network + ": setPeer(30374, bittensorReceiverAddress)");
    console.log("  On Bittensor EVM: setPeer(" + srcEid + ", senderAddress)");
  } else if (network === "bittensor-evm") {
    const Receiver = await ethers.getContractFactory("BittensorReceiver");
    const receiver = await Receiver.deploy(endpoint, deployer.address);
    await receiver.waitForDeployment();
    const receiverAddress = await receiver.getAddress();
    console.log("BittensorReceiver deployed to:", receiverAddress);
    console.log("\nNext: Deploy BSCSender on Base (or BSC), then set peers.");
    console.log("  On sender chain: setPeer(30374, bittensorReceiverAddress)");
    console.log("  On Bittensor EVM: setPeer(30184 for Base or 30102 for BSC, senderAddress)");
  } else {
    throw new Error(`Unknown network: ${network}. Use base, bsc, bsc-testnet, or bittensor-evm.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
