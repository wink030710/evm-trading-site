# Bittensor Cross-Chain Messaging (LayerZero)

Two contracts for **one-way** messaging **Base (or BSC) → Bittensor EVM** using [LayerZero V2](https://docs.layerzero.network/v2/home/intro).

## Contracts

| Contract | Network | Role |
|----------|---------|------|
| **BSCSender** | Base or BSC | Sends data to Bittensor EVM. No receive logic. |
| **BittensorReceiver** | Bittensor EVM only | Receives data and **saves it on-chain** (array of messages with `srcEid`, `sender`, `payload`, `blockNumber`). |

## Prerequisites

- Node.js 18+
- Wallet with ETH on Base (or BNB on BSC) and native token on Bittensor EVM

## Install & build

```bash
cd contracts
npm install --legacy-peer-deps
npm run compile
```

## Deploy

**1. Deploy BSCSender on Base**

```bash
PRIVATE_KEY=0x... npm run deploy:base
```

(Or on BSC: `npm run deploy:bsc`.)

**2. Deploy BittensorReceiver on Bittensor EVM**

```bash
PRIVATE_KEY=0x... BITTENSOR_EVM_RPC_URL=... npm run deploy:bittensor
```

**3. Set peers**

- On **Base** (BSCSender): set peer to the BittensorReceiver address so sends go to it.
- On **Bittensor EVM** (BittensorReceiver): set peer to the BSCSender address so it accepts messages from Base.

```bash
# On Base
CONTRACT_ADDRESS=<BSCSender> PEER_EID=30374 PEER_ADDRESS=<BittensorReceiver> npx hardhat run scripts/setPeer.ts --network base

# On Bittensor EVM
CONTRACT_ADDRESS=<BittensorReceiver> PEER_EID=30184 PEER_ADDRESS=<BSCSender> npx hardhat run scripts/setPeer.ts --network bittensor-evm
```

**EIDs:** Base = `30184`, BSC = `30102`, Bittensor EVM = `30374` (see `scripts/layerzero.ts`).

## Send data (Base → Bittensor EVM)

```bash
MESSENGER_BSC_ADDRESS=<BSCSender address on Base> PRIVATE_KEY=0x... npm run send:base-to-bittensor
```

For BSC: `npm run send:bsc-to-bittensor` with `--network bsc`.

Optional: `PAYLOAD=0x68656c6c6f` (hex) or `PAYLOAD="your string"`. Default is a test string.

Messages are delivered to **BittensorReceiver** and appended to on-chain storage. Read them with `messages(index)`, `getMessage(index)`, or `messageCount()`.

## Troubleshooting

**Peer set but `send` / `quoteSend` still reverts with NoPeer**

- Your OApp peer is set correctly (check with `npm run verify-peer:base` or `verify-peer:bsc`).
- The revert is coming from **LayerZero’s pathway config**: the route Base/BSC → Bittensor EVM (eid 30374) must have send library, receive library, and DVN set for your OApp.
- Configure the pathway:
  - [LayerZero Scan](https://layerzeroscan.com) → your BSCSender → set default or custom config for the path.
  - Or use the **LayerZero CLI**: see **[docs/LAYERZERO-CLI-PATHWAY.md](docs/LAYERZERO-CLI-PATHWAY.md)**.

**Verify peer on-chain**

```bash
npm run verify-peer:base
npm run verify-peer:bsc
npm run verify-peer:bittensor
```

## Configuration

- **Base EndpointV2**: `0x28cFB2EDFD9F0b8578fF5645982E0e1e8f7a2c9c` (verify at [LayerZero deployments](https://docs.layerzero.network/v2/deployments/chains/base))
- **BSC EndpointV2**: `0x1a44076050125825900e736c501f859c50fe728c`
- **Bittensor EVM**: set in `scripts/layerzero.ts`

For production, configure send/receive libraries and DVNs (e.g. [LayerZero CLI](https://docs.layerzero.network/v2/get-started/create-lz-oapp/start) or [LayerZero Scan](https://layerzeroscan.com/)).

## Network config (hardhat.config.ts)

| Network          | Chain ID | Use |
|------------------|----------|-----|
| `base`           | 8453     | Deploy BSCSender (default) |
| `bsc`            | 56       | Deploy BSCSender |
| `bsc-testnet`    | 97       | Test BSCSender |
| `bittensor-evm`  | 964      | Deploy BittensorReceiver |
