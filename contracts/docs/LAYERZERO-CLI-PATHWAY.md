# LayerZero CLI: Pathway configuration for BSC ↔ Bittensor EVM

This guide explains how to use the **LayerZero CLI** to generate and apply **pathway config** (send/receive libraries, DVNs, peers) for your existing **BSCSender** and **BittensorReceiver** so that `quoteSend` and `send` work.

## What the CLI does

The **wire** command (`npx hardhat lz:oapp:wire`) applies the config from `layerzero.config.ts` by sending transactions that:

1. **Set peers** – `OApp.setPeer(dstEid, peer)` on both contracts (you may have done this already).
2. **Set send library** – `EndpointV2.setSendLibrary(oapp, dstEid, sendLib)` so the source chain knows how to send.
3. **Set receive library** – `EndpointV2.setReceiveLibrary(oapp, dstEid, receiveLib, gracePeriod)` so the destination can receive.
4. **Set config** – `EndpointV2.setConfig(...)` for **Executor** and **DVNs** (who verifies and executes the message).

Without (2)–(4), the pathway is not fully configured and you can get reverts (e.g. NoPeer from internal checks) even when your OApp peer is set.

---

## Step 1: Install CLI dependencies

From the `contracts/` directory:

```bash
cd contracts
npm install --save-dev \
  @layerzerolabs/toolbox-hardhat \
  @layerzerolabs/lz-definitions \
  @layerzerolabs/metadata-tools \
  @layerzerolabs/lz-v2-utilities
```

Use `--legacy-peer-deps` if you hit peer dependency conflicts.

---

## Step 2: Register the Hardhat plugin

In `hardhat.config.ts`, add:

```ts
import "@layerzerolabs/toolbox-hardhat";
```

So the start of the file looks like:

```ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "dotenv/config";
import "@layerzerolabs/toolbox-hardhat";
// ... rest of config
```

---

## Step 3: Add `eid` to network config

The LayerZero toolbox expects each network to have an `eid` (endpoint ID). In `hardhat.config.ts`, add `eid` to each network (the toolbox reads it from the config):

```ts
networks: {
  bsc: {
    url: process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org",
    chainId: 56,
    accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    eid: 30102,  // BSC mainnet
  },
  "bittensor-evm": {
    url: process.env.BITTENSOR_EVM_RPC_URL ?? "http://185.8.107.85:9944",
    chainId: 964,
    accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    eid: 30374,  // your Bittensor EVM EID
  },
},
```

(You can add `bsc-testnet` with `eid: 40102` if you use it.)

---

## Step 4: Get library and DVN addresses

You need the **send library**, **receive library**, **executor**, and **DVN** addresses for:

- **BSC** (30102) – for sending from BSC and for receiving on BSC if you ever add that path.
- **Bittensor EVM** (30374) – for receiving on Bittensor EVM and for sending from Bittensor EVM if needed.

**Option A – Endpoint metadata API (by chain/eid):**

```bash
curl -s "https://metadata.layerzero-api.com/v1/metadata" | jq '.chains[] | select(.eid == 30102)'
```

In the JSON, look for `sendLib`, `receiveLib`, `executor`, and DVN-related fields. Repeat for `eid == 30374` if Bittensor EVM is in the metadata.

**Option B – Docs:**

- Deployed contracts (by chain):  
  https://docs.layerzero.network/v2/deployments/deployed-contracts  
- DVN addresses:  
  https://docs.layerzero.network/v2/deployments/dvn-addresses  
- BSC page:  
  https://docs.layerzero.network/v2/deployments/chains/bsc  

Replace the placeholder addresses in the example below with the ones you find for BSC and (if available) for Bittensor EVM.

---

## Step 5: Create `layerzero.config.ts`

Create `contracts/layerzero.config.ts` and define your two OApps by **address** (since you deployed manually):

```ts
import { ExecutorOptionType } from "@layerzerolabs/lz-v2-utilities";
import type { OAppEnforcedOption, OmniPointHardhat } from "@layerzerolabs/toolbox-hardhat";
import { generateConnectionsConfig } from "@layerzerolabs/metadata-tools";

// EIDs (must match hardhat networks)
const BSC_EID = 30102;
const BITTENSOR_EID = 30374;

// Your deployed contract addresses
const BSC_SENDER_ADDRESS = process.env.MESSENGER_BSC_ADDRESS ?? "0x1F2cf117F5DABFb56dD9C0725b125136b1cDa1EE";
const BITTENSOR_RECEIVER_ADDRESS = process.env.BITTENSOR_RECEIVER_ADDRESS ?? "0xA936FdAc53dfF0161Ca81A7cA8610930066b34d4";

const bscSender: OmniPointHardhat = {
  eid: BSC_EID,
  contractName: "BSCSender",
  address: BSC_SENDER_ADDRESS,
};

const bittensorReceiver: OmniPointHardhat = {
  eid: BITTENSOR_EID,
  contractName: "BittensorReceiver",
  address: BITTENSOR_RECEIVER_ADDRESS,
};

const ENFORCED_OPTIONS: OAppEnforcedOption[] = [
  {
    msgType: 1,
    optionType: ExecutorOptionType.LZ_RECEIVE,
    gas: 80000,
    value: 0,
  },
];

export default async function () {
  const connections = await generateConnectionsConfig([
    [
      bscSender,
      bittensorReceiver,
      [["LayerZero Labs"], []],
      [1, 1],
      [ENFORCED_OPTIONS, ENFORCED_OPTIONS],
    ],
  ]);

  // Replace placeholder library/DVN addresses with real ones from LayerZero docs or metadata API
  const BSC_SEND_LIB = "0x...";      // SendUln302 on BSC
  const BSC_RECEIVE_LIB = "0x...";   // ReceiveUln302 on BSC
  const BSC_EXECUTOR = "0x...";      // Executor on BSC
  const BITTENSOR_SEND_LIB = "0x...";
  const BITTENSOR_RECEIVE_LIB = "0x...";
  const BITTENSOR_EXECUTOR = "0x...";

  connections.forEach((c) => {
    if (c.from.eid === BSC_EID && c.to.eid === BITTENSOR_EID) {
      c.config = {
        sendLibrary: BSC_SEND_LIB,
        receiveLibraryConfig: { receiveLibrary: BSC_RECEIVE_LIB, gracePeriod: BigInt(0) },
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: BSC_EXECUTOR },
          ulnConfig: {
            confirmations: BigInt(0),
            requiredDVNs: [],
            optionalDVNs: [],  // or LayerZero DVN address on BSC
            optionalDVNThreshold: 0,
          },
        },
        receiveConfig: {
          ulnConfig: {
            confirmations: BigInt(0),
            requiredDVNs: [],
            optionalDVNs: [],
            optionalDVNThreshold: 0,
          },
        },
        enforcedOptions: ENFORCED_OPTIONS,
      };
    }
    if (c.from.eid === BITTENSOR_EID && c.to.eid === BSC_EID) {
      c.config = {
        sendLibrary: BITTENSOR_SEND_LIB,
        receiveLibraryConfig: { receiveLibrary: BITTENSOR_RECEIVE_LIB, gracePeriod: BigInt(0) },
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: BITTENSOR_EXECUTOR },
          ulnConfig: {
            confirmations: BigInt(0),
            requiredDVNs: [],
            optionalDVNs: [],
            optionalDVNThreshold: 0,
          },
        },
        receiveConfig: {
          ulnConfig: {
            confirmations: BigInt(0),
            requiredDVNs: [],
            optionalDVNs: [],
            optionalDVNThreshold: 0,
          },
        },
        enforcedOptions: ENFORCED_OPTIONS,
      };
    }
  });

  return {
    contracts: [{ contract: bscSender }, { contract: bittensorReceiver }],
    connections,
  };
}
```

Important:

- Fill in `BSC_SEND_LIB`, `BSC_RECEIVE_LIB`, `BSC_EXECUTOR` (and Bittensor equivalents if you have them) from the LayerZero deployed-contracts / metadata for each chain.
- If the toolbox expects `contractName` for EVM and resolves address from deployments, you may need to put a minimal `deployments/bsc/BSCSender.json` (and same for Bittensor EVM) with the correct `address` so the CLI can resolve the contract. Otherwise use `address` in the OmniPoint if the toolbox supports it for EVM (as in the Solana example).
- For Bittensor EVM (30374), if it’s not in the official list, the metadata might not have entries; you’ll need to get lib/executor/DVN from whoever runs LayerZero on that chain, or use defaults if they provide them.

---

## Step 6: Run the wire command

From `contracts/`:

```bash
npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts
```

The CLI will:

- Resolve your OApp addresses (from config / deployments).
- Propose transactions to set peers, send lib, receive lib, and config on the Endpoint.
- Prompt you to confirm; after you confirm, it sends the transactions.

After a successful run, the BSC → Bittensor EVM (and optionally Bittensor EVM → BSC) pathway is configured. You can then call `quoteSend` and `send` again.

---

## Step 7: Verify peers (optional)

```bash
npx hardhat lz:oapp:peers:get --oapp-config layerzero.config.ts
```

This prints a small table of which contracts are connected to which.

---

## If Bittensor EVM is not in LayerZero’s list

If Bittensor EVM (eid 30374) is a custom or partner chain:

1. **Libraries/DVN/Executor** – Get the correct SendUln302, ReceiveUln302, Executor, and DVN addresses for that chain from the chain operator or LayerZero.
2. **Metadata** – It may not appear in `https://metadata.layerzero-api.com/v1/metadata`; you have to fill config manually.
3. **Defaults** – Some chains expose “default” config; check their docs or LayerZero Scan for that chain.

---

## References

- [Quickstart – Create OApp](https://docs.layerzero.network/v2/get-started/create-lz-oapp/start)
- [Configuring pathways](https://docs.layerzero.network/v2/developers/evm/create-lz-oapp/configuring-pathways)
- [create-lz-oapp CLI guide](https://docs.layerzero.network/v2/tools/create-lz-oapp-cli/guide)
- [Deployed contracts](https://docs.layerzero.network/v2/deployments/deployed-contracts)
- [DVN addresses](https://docs.layerzero.network/v2/deployments/dvn-addresses)
- [Endpoint metadata API](https://docs.layerzero.network/v2/tools/endpoint-metadata)
