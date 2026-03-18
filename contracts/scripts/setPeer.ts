import { ethers } from "hardhat";

/**
 * Set the peer OApp address for a given destination EID.
 * Use after deploying BSCSender on Base (or BSC) and BittensorReceiver on Bittensor EVM.
 *
 * On Base:  CONTRACT_ADDRESS=<SenderAddress> PEER_EID=30374 PEER_ADDRESS=<BittensorReceiver>
 * On BSC:   CONTRACT_ADDRESS=<SenderAddress> PEER_EID=30374 PEER_ADDRESS=<BittensorReceiver>
 * On Bittensor EVM: CONTRACT_ADDRESS=<BittensorReceiver> PEER_EID=30184 (Base) or 30102 (BSC) PEER_ADDRESS=<SenderAddress>
 */
async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS ?? process.env.MESSENGER_ADDRESS;
  const peerEid = process.env.PEER_EID;
  const peerAddress = process.env.PEER_ADDRESS;

  if (!contractAddress || !peerEid || !peerAddress) {
    console.error("Set CONTRACT_ADDRESS (or MESSENGER_ADDRESS), PEER_EID, and PEER_ADDRESS");
    process.exit(1);
  }

  const network = process.env.HARDHAT_NETWORK;
  const contractName =
    network === "bittensor-evm" ? "BittensorReceiver" : "BSCSender"; // BSCSender used on Base too
  const contract = await ethers.getContractAt(contractName, contractAddress);
  const eid = parseInt(peerEid, 10);
  const peerBytes32 = ethers.zeroPadValue(peerAddress as `0x${string}`, 32);
  const tx = await contract.setPeer(eid, peerBytes32);
  await tx.wait();
  console.log(`Peer set: eid=${eid} peer=${peerAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
