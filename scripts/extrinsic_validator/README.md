# Extrinsic validator (Python)

Pre-validate extrinsics before they are included in a block (e.g. in a mempool or at submission). Implements the checks from [docs/subtensor-pallet-errors.md §6](../../docs/subtensor-pallet-errors.md).

## Install

```bash
cd scripts/extrinsic_validator
pip install -r requirements.txt
```

## Usage

```python
from substrateinterface import SubstrateInterface
from validate_extrinsic import (
    validate_balances_transfer,
    validate_add_stake,
    validate_add_stake_limit,
    validate_swap_stake,
    validate_swap_stake_limit,
    validate_move_stake,
    validate_move_stake_limit,
    validate_proxy_call,
)

substrate = SubstrateInterface(url="wss://entrypoint-finney.opentensor.ai:443")
block_hash = None  # or substrate.get_block_hash(block_number) for consistent reads

# Balances.transfer
r = validate_balances_transfer(substrate, sender, dest, amount, estimated_fee=100_000_000, block_hash=block_hash)
if not r.valid:
    print("Reject:", r.errors)

# SubtensorModule.add_stake
r = validate_add_stake(substrate, coldkey, hotkey, netuid, amount_staked, block_hash=block_hash)

# SubtensorModule.add_stake_limit (ZeroMaxStakeAmount cannot be fully checked off-chain)
r = validate_add_stake_limit(substrate, coldkey, hotkey, netuid, amount_staked, limit_price, allow_partial, block_hash=block_hash)

# swap_stake / swap_stake_limit
r = validate_swap_stake(substrate, coldkey, hotkey, origin_netuid, destination_netuid, alpha_amount, block_hash=block_hash)
r = validate_swap_stake_limit(substrate, coldkey, hotkey, origin_netuid, destination_netuid, alpha_amount, limit_price, allow_partial, block_hash=block_hash)

# move_stake / move_stake_limit
r = validate_move_stake(substrate, coldkey, origin_hotkey, destination_hotkey, origin_netuid, destination_netuid, alpha_amount, block_hash=block_hash)
r = validate_move_stake_limit(...)

# Proxy.proxy (then validate inner call separately)
r = validate_proxy_call(substrate, real_origin, delegate, inner_call_decoded, block_hash, is_call_allowed=your_filter_fn)
```

## Run example

```bash
export SUBSTRATE_URL=wss://entrypoint-finney.opentensor.ai:443
python example_usage.py
```

## Custom pallet/storage names

If your chain uses different pallet or storage names, pass them in:

```python
validate_add_stake(
    substrate, coldkey, hotkey, netuid, amount,
    subtensor_pallet="Subtensor",
    subtensor_storage={"owner": "Owner", "alpha": "Alpha", "networks_added": "TotalSubnets", ...},
)
```

## Notes

- **ZeroMaxStakeAmount** for `add_stake_limit`, `swap_stake_limit`, `move_stake_limit` requires the runtime’s `get_max_amount_add` / `get_max_amount_move` logic (pool state). The validator cannot compute this off-chain; use a dry-run RPC if your node supports it, or accept a warning.
- **Rate limits** (TxRateLimitExceeded, StakingRateLimitExceeded): not implemented here; add storage queries for your chain’s rate-limit state if needed.
- **Proxy Unannounced**: for delayed proxies we only warn; full check needs the inner call hash and current block number.
- Use the same `block_hash` for all queries in a single validation so the view of state is consistent.
