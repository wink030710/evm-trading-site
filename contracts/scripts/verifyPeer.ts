import { ethers } from "hardhat";
import { LZ_ENDPOINTS } from "./layerzero";

/**
 * Verify peer is set on BSCSender (Base/BSC) or BittensorReceiver (Bittensor EVM).
 * Run with --network base, --network bsc, or --network bittensor-evm.
 *
 * Env: MESSENGER_BSC_ADDRESS (for Base/BSC sender) or CONTRACT_ADDRESS for either.
 */
async function main() {
  const network = process.env.HARDHAT_NETWORK;
  const contractAddress =
    network === "bittensor-evm"
      ? process.env.CONTRACT_ADDRESS
      : (process.env.CONTRACT_ADDRESS ?? process.env.MESSENGER_BSC_ADDRESS);

  if (!contractAddress) {
    console.error("Set MESSENGER_BSC_ADDRESS (Base/BSC) or CONTRACT_ADDRESS (bittensor-evm)");
    process.exit(1);
  }

  const baseEid = LZ_ENDPOINTS.base.eid;
  const bscEid = LZ_ENDPOINTS.bsc.eid;
  const bittensorEid = LZ_ENDPOINTS["bittensor-evm"].eid;

  const contractName = network === "bittensor-evm" ? "BittensorReceiver" : "BSCSender";
  const contract = await ethers.getContractAt(contractName, contractAddress);

  if (network === "base" || network === "bsc") {
    const peerBittensor = await contract.peers(bittensorEid);
    const hex = typeof peerBittensor === "string" ? peerBittensor : ethers.hexlify(peerBittensor);
    const asAddr = hex === ethers.ZeroHash || hex === "0x" + "0".repeat(64) ? null : ethers.getAddress("0x" + hex.slice(-40));
    console.log("BSCSender at", contractAddress, "(" + network + ")");
    console.log("  peers(" + bittensorEid + ") [Bittensor EVM]:", asAddr ?? "(not set)");
    if (!asAddr) {
      console.error("\nSet peer first: CONTRACT_ADDRESS=" + contractAddress + " PEER_EID=" + bittensorEid + " PEER_ADDRESS=<BittensorReceiver> npx hardhat run scripts/setPeer.ts --network " + network);
      process.exit(1);
    }
  } else if (network === "bittensor-evm") {
    const srcEid = baseEid; // default: Base; use PEER_EID=30102 for BSC
    const peerSrc = await contract.peers(srcEid);
    const hex = typeof peerSrc === "string" ? peerSrc : ethers.hexlify(peerSrc);
    const asAddr = hex === ethers.ZeroHash || hex === "0x" + "0".repeat(64) ? null : ethers.getAddress("0x" + hex.slice(-40));
    console.log("BittensorReceiver at", contractAddress);
    console.log("  peers(" + srcEid + ") [Base]:", asAddr ?? "(not set)");
    if (!asAddr) {
      console.error("\nSet peer first: CONTRACT_ADDRESS=" + contractAddress + " PEER_EID=" + srcEid + " PEER_ADDRESS=<Sender> npx hardhat run scripts/setPeer.ts --network bittensor-evm");
      process.exit(1);
    }
  } else {
    console.error("Unknown network. Use base, bsc, or bittensor-evm.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
