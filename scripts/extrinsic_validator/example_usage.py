"""
Example: validate extrinsics before submitting or including in mempool.

Run:
  pip install -r requirements.txt
  export SUBSTRATE_URL=wss://entrypoint-finney.opentensor.ai:443
  python example_usage.py
"""

import os
import sys

# Add parent so we can import from validate_extrinsic when run from repo root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from validate_extrinsic import (
    ValidationResult,
    validate_balances_transfer,
    validate_add_stake,
    validate_add_stake_limit,
    validate_swap_stake,
    validate_swap_stake_limit,
    validate_move_stake,
    validate_move_stake_limit,
    validate_proxy_call,
)


def main() -> None:
    url = os.environ.get("SUBSTRATE_URL", "wss://entrypoint-finney.opentensor.ai:443")
    try:
        from substrateinterface import SubstrateInterface
    except ImportError:
        print("Install: pip install -r requirements.txt")
        sys.exit(1)

    print(f"Connecting to {url} ...")
    substrate = SubstrateInterface(url=url)
    block_hash = None  # use latest; or substrate.get_block_hash(N) for a specific block

    # Example 1: Balances.transfer
    print("\n--- Balances.transfer ---")
    sender = "5F3sa2TJAWMqDhXG6jhV4N8ko9SxwGy8TpaNS1repo5EYjQX"
    destination = "5GrwvaEF5zXb26Fz9rcQpDWM57oq2V2FneCHZ7DdTb4TbK9"
    amount = 1_000_000_000  # 1 TAO in rao (example)
    fee = 100_000_000
    r = validate_balances_transfer(substrate, sender, destination, amount, estimated_fee=fee, block_hash=block_hash)
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    # Example 2: SubtensorModule.add_stake
    print("\n--- SubtensorModule.add_stake ---")
    coldkey = sender
    hotkey = destination
    netuid = 1
    amount_staked = 1_000_000_000
    r = validate_add_stake(substrate, coldkey, hotkey, netuid, amount_staked, estimated_fee=fee, block_hash=block_hash)
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    # Example 3: SubtensorModule.add_stake_limit
    print("\n--- SubtensorModule.add_stake_limit ---")
    limit_price = 1_000_000_000
    r = validate_add_stake_limit(
        substrate, coldkey, hotkey, netuid, amount_staked, limit_price, True, estimated_fee=fee, block_hash=block_hash
    )
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    # Example 4: SubtensorModule.swap_stake
    print("\n--- SubtensorModule.swap_stake ---")
    origin_netuid = 1
    destination_netuid = 2
    alpha_amount = 1_000_000
    r = validate_swap_stake(
        substrate, coldkey, hotkey, origin_netuid, destination_netuid, alpha_amount, estimated_fee=fee, block_hash=block_hash
    )
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    # Example 5: SubtensorModule.swap_stake_limit
    print("\n--- SubtensorModule.swap_stake_limit ---")
    r = validate_swap_stake_limit(
        substrate, coldkey, hotkey, origin_netuid, destination_netuid,
        alpha_amount, limit_price, True, estimated_fee=fee, block_hash=block_hash
    )
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    # Example 6: SubtensorModule.move_stake
    print("\n--- SubtensorModule.move_stake ---")
    origin_hotkey = hotkey
    destination_hotkey = "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNLj85R6E1Bqdzc5B6"
    r = validate_move_stake(
        substrate, coldkey, origin_hotkey, destination_hotkey,
        origin_netuid, destination_netuid, alpha_amount, estimated_fee=fee, block_hash=block_hash
    )
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    # Example 7: SubtensorModule.move_stake_limit
    print("\n--- SubtensorModule.move_stake_limit ---")
    r = validate_move_stake_limit(
        substrate, coldkey, origin_hotkey, destination_hotkey,
        origin_netuid, destination_netuid, alpha_amount, limit_price, True, estimated_fee=fee, block_hash=block_hash
    )
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    # Example 8: Proxy.proxy (only structure check; real_origin/delegate must be valid on chain)
    print("\n--- Proxy.proxy ---")
    real_origin = coldkey
    delegate = hotkey
    inner_call = {"call_module": "SubtensorModule", "call_function": "add_stake"}
    r = validate_proxy_call(substrate, real_origin, delegate, inner_call, block_hash)
    print(f"  valid={r.valid}, errors={r.errors}, warnings={r.warnings}")

    print("\nDone.")


if __name__ == "__main__":
    main()
