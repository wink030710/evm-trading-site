#!/usr/bin/env python3
"""
Fetch and decode a Bittensor extrinsic by block hash + extrinsic hash.
Usage: python decode_extrinsic.py [ws_url]
"""
import sys
import hashlib
from substrateinterface import SubstrateInterface


BT_WS = "wss://entrypoint-finney.opentensor.ai:443"

BLOCK_HASH = "0x40af903d14c119ad3b04e247a7a959b39b7036f3c16d20ca208e9d2e1013e222"
EXTRINSIC_HASH = "0xfa1b741aa288d4f827c4f6af3da78113286bcaf0abbad8374028e5c898ab518f"


def connect(url: str = BT_WS) -> SubstrateInterface:
    return SubstrateInterface(
        url=url,
        ss58_format=42,
        type_registry_preset="substrate-node-template",
    )


def rpc_get_block(substrate: SubstrateInterface, block_hash: str) -> dict:
    if not (isinstance(block_hash, str) and block_hash.startswith("0x") and len(block_hash) == 66):
        raise ValueError(f"block_hash must be 0x + 64 hex chars, got: {block_hash!r}")

    resp = substrate.rpc_request("chain_getBlock", [block_hash])
    if not resp or "error" in resp:
        raise RuntimeError(f"chain_getBlock RPC error: {resp}")

    result = resp.get("result")
    if result is None:
        raise ValueError(
            "chain_getBlock returned null result. The node may not have this block (wrong hash or pruned)."
        )

    return result


def blake2_256_hex(extrinsic_hex: str) -> str:
    """Substrate extrinsic hash = blake2b-256 of raw SCALE bytes."""
    raw = bytes.fromhex(extrinsic_hex.removeprefix("0x"))
    return "0x" + hashlib.blake2b(raw, digest_size=32).hexdigest().lower()


def find_extrinsic(substrate: SubstrateInterface, block_hash: str, extrinsic_hash: str):
    if not (isinstance(extrinsic_hash, str) and extrinsic_hash.startswith("0x") and len(extrinsic_hash) == 66):
        raise ValueError(f"extrinsic_hash must be 0x + 64 hex chars, got: {extrinsic_hash!r}")

    block_obj = rpc_get_block(substrate, block_hash)
    extrinsics = block_obj["block"].get("extrinsics", []) or []

    target = extrinsic_hash.lower()
    if not target.startswith("0x"):
        target = "0x" + target
    for idx, extrinsic_hex in enumerate(extrinsics):
        if blake2_256_hex(extrinsic_hex) == target:
            return idx, extrinsic_hex

    raise ValueError("Extrinsic hash not found in that block")


def decode_extrinsic(substrate: SubstrateInterface, extrinsic_hex: str) -> dict:
    decoded = substrate.decode_scale(type_string="Extrinsic", scale_bytes=extrinsic_hex)
    return decoded.value


def main():
    block_hash = BLOCK_HASH
    extrinsic_hash = EXTRINSIC_HASH
    ws_url = sys.argv[1] if len(sys.argv) >= 2 else BT_WS

    print("Connecting to", ws_url, "...")
    substrate = connect(ws_url)

    print("Fetching block...")
    idx, extrinsic_hex = find_extrinsic(substrate, block_hash, extrinsic_hash)
    print("Decoding extrinsic...")
    decoded = decode_extrinsic(substrate, extrinsic_hex)

    print()
    print("block_hash:     ", block_hash)
    print("extrinsic_index:", idx)
    print("extrinsic_hash: ", extrinsic_hash)
    print()
    print("decoded:")
    import json
    print(json.dumps(decoded, indent=2, default=str))


if __name__ == "__main__":
    main()
