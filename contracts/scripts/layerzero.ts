/**
 * LayerZero V2 endpoint addresses and EIDs for BASE, Bittensor EVM (and optional BSC).
 * Verify endpoints at https://docs.layerzero.network/v2/deployments/deployed-contracts
 */
export const LZ_ENDPOINTS: Record<string, { eid: number; endpoint: string }> = {
  base: {
    eid: 30184,
    endpoint: "0x28cFB2EDFD9F0b8578fF5645982E0e1e8f7a2c9c",
  },
  bsc: {
    eid: 30102,
    endpoint: "0x1a44076050125825900e736c501f859c50fe728c",
  },
  "bsc-testnet": {
    eid: 40102,
    endpoint: "0x6Fcb97553D41515CbE0033f0924d0E9d2A8B4e1D",
  },
  "bittensor-evm": {
    eid: 30374,
    endpoint: "0x6F475642a6e85809B1c36Fa62763669b1b48DD5B",
  },
};
