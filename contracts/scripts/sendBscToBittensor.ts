import { ethers } from "hardhat";
import { LZ_ENDPOINTS } from "./layerzero";

const BITTENSOR_EID = LZ_ENDPOINTS["bittensor-evm"].eid;

/**
 * Send a message from the sender contract (Base or BSC) to the Bittensor EVM receiver.
 * Run with --network base or --network bsc. Peer must be set to BittensorReceiver address.
 *
 * Env:
 *   MESSENGER_BSC_ADDRESS   - BSCSender contract address on the source chain (Base/BSC)
 *   PAYLOAD                 - (optional) hex bytes or string. Default: test string.
 */
async function main() {
  const messengerAddress = process.env.MESSENGER_BSC_ADDRESS ?? process.env.CONTRACT_ADDRESS;
  if (!messengerAddress) {
    console.error("Set MESSENGER_BSC_ADDRESS or CONTRACT_ADDRESS (BSCSender on BSC)");
    process.exit(1);
  }

  const network = process.env.HARDHAT_NETWORK ?? "base";
  const defaultMsg = network === "base" ? "Hello from Base" : "Hello from BSC";
  const payloadHex = process.env.PAYLOAD;
  const payload =
    payloadHex && payloadHex.startsWith("0x")
      ? ethers.getBytes(payloadHex)
      : ethers.toUtf8Bytes(process.env.PAYLOAD ?? defaultMsg);

  const sender = await ethers.getContractAt("BSCSender", messengerAddress);

  const options = "0x";
  let fee;
  try {
    fee = await sender.quoteSend(BITTENSOR_EID, payload, options, false);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const data = err && typeof err === "object" && "data" in err ? String((err as { data: unknown }).data) : "";
    const revertData = data || (msg.match(/0x[a-fA-F0-9]+/) ?? [])[0] || "";

    // NoPeer(0) or NoPeer(eid): selector 0x6592671c
    const isNoPeer = revertData.includes("6592671c");
    const peerSet = await sender.peers(BITTENSOR_EID).then(
      (p: unknown) => p !== ethers.ZeroHash && p !== "0x" + "0".repeat(64),
      () => false
    ).catch(() => false);

    if (isNoPeer && !peerSet) {
      console.error("NoPeer: Sender has no peer set for Bittensor EVM (eid " + BITTENSOR_EID + ").");
      console.error("Run setPeer on source chain, then: npm run verify-peer:base (or verify-peer:bsc)");
      process.exit(1);
    }
    if (isNoPeer && peerSet) {
      console.error("Peer is set but quote reverted with NoPeer.");
      console.error("This usually means the source -> Bittensor EVM pathway is not configured in LayerZero.");
      console.error("Configure the pathway (send lib, receive lib, DVN) at https://layerzeroscan.com or via LayerZero CLI.");
      process.exit(1);
    }
    console.error("Revert data:", revertData || "(see above)");
    console.error("Check LayerZero pathway config for source chain -> Bittensor EVM (" + BITTENSOR_EID + ").");
    throw err;
  }

  console.log("Sending to Bittensor EVM:", {
    dstEid: BITTENSOR_EID,
    payloadLength: payload.length,
    nativeFee: ethers.formatEther(fee.nativeFee),
  });

  const tx = await sender.send(BITTENSOR_EID, payload, options, {
    value: fee.nativeFee,
  });
  const receipt = await tx.wait();
  console.log("Tx hash:", receipt!.hash);
  console.log("Message sent. It will be delivered and stored on Bittensor EVM (BittensorReceiver).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
