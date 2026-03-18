"""
Validate extrinsics before block inclusion (mempool pre-checks).

Implements the validations from docs/subtensor-pallet-errors.md §6.
Use a single block_hash for all queries so checks are consistent.

Usage:
    from validate_extrinsic import (
        validate_proxy_call,
        validate_balances_transfer,
        validate_add_stake,
        validate_add_stake_limit,
        validate_swap_stake,
        validate_swap_stake_limit,
        validate_move_stake,
        validate_move_stake_limit,
    )
    from substrateinterface import SubstrateInterface
    substrate = SubstrateInterface(url="wss://...")
    result = validate_add_stake(substrate, coldkey, hotkey, netuid, amount_staked, block_hash=None)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

# Pallet/storage names for Subtensor (override via subtensor_storage_config if your chain differs)
DEFAULT_SUBTENSOR_PALLET = "SubtensorModule"
DEFAULT_SUBTENSOR_STORAGE = {
    "owner": "Owner",
    "alpha": "Alpha",
    "networks_added": "NetworksAdded",
    "transfer_toggle": "TransferToggle",
    "subnet_mechanism": "SubnetMechanism",
    "subnet_tao": "SubnetTAO",
    "subnet_alpha_in": "SubnetAlphaIn",
    "subnet_tao_provided": "SubnetTaoProvided",
    "subnet_alpha_in_provided": "SubnetAlphaInProvided",
}


@dataclass
class ValidationResult:
    valid: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.valid


def _query(
    substrate: Any,
    pallet: str,
    storage: str,
    params: List[Any],
    block_hash: Optional[str] = None,
) -> Any:
    if block_hash:
        return substrate.query(pallet, storage, params, block_hash=block_hash)
    return substrate.query(pallet, storage, params)


def _get_constant(substrate: Any, pallet: str, constant: str) -> Any:
    return substrate.get_constant(pallet, constant)


# -----------------------------------------------------------------------------
# Proxy.proxy
# -----------------------------------------------------------------------------


def validate_proxy_call(
    substrate: Any,
    real_origin: str,
    delegate: str,
    inner_call: Dict[str, Any],
    block_hash: Optional[str] = None,
    *,
    proxy_pallet: str = "Proxy",
    is_call_allowed: Optional[Callable[[str, str, Dict], bool]] = None,
) -> ValidationResult:
    """
    Validate Proxy.proxy(real_origin, delegate, proxy_type, call) before inclusion.

    inner_call: decoded call dict, e.g. {"call_module": "SubtensorModule", "call_function": "add_stake", ...}.
    is_call_allowed: optional (real_origin, delegate, inner_call) -> bool; if None we only check existence/NotProxy.
    """
    errors: list[str] = []
    warnings: list[str] = []

    # NotFound / NotProxy: Proxies(real_origin) must contain delegate
    try:
        proxies_val = _query(substrate, proxy_pallet, "Proxies", [real_origin], block_hash)
    except Exception as e:
        errors.append(f"Proxy::Proxies query failed: {e}")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    if proxies_val.value is None or (hasattr(proxies_val.value, "value") and proxies_val.value.value is None):
        errors.append("Proxy::NotFound: no proxy list for real_origin")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # Structure is often (deposit, Vec<ProxyDefinition>); ProxyDefinition = (delegate, proxy_type, delay)
    if hasattr(proxies_val.value, "value"):
        pair = proxies_val.value.value
    else:
        pair = proxies_val.value
    if isinstance(pair, (list, tuple)):
        proxy_list = pair[1] if len(pair) > 1 else pair
    else:
        proxy_list = getattr(pair, "proxies", getattr(pair, "value", []) or [])

    delegate_entries = [p for p in proxy_list if (p[0] if isinstance(p, (list, tuple)) else getattr(p, "delegate", None)) == delegate]
    if not delegate_entries:
        errors.append("Proxy::NotProxy: signer is not a proxy of real_origin")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # NoSelfProxy
    if real_origin == delegate:
        errors.append("Proxy::NoSelfProxy")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # TooMany: optional check on length
    try:
        max_proxies = _get_constant(substrate, proxy_pallet, "MaxProxies")
        if max_proxies and len(proxy_list) > int(max_proxies):
            errors.append("Proxy::TooMany: too many proxies")
    except Exception:
        pass

    # Unproxyable / NoPermission: filter inner call by proxy_type
    if is_call_allowed is not None and callable(is_call_allowed):
        if not is_call_allowed(real_origin, delegate, inner_call):
            errors.append("Proxy::Unproxyable or NoPermission: inner call not allowed for this proxy type")
            return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # Unannounced: if proxy has delay > 0, check Announcements(real_origin) for (delegate, call_hash) and block >= height + delay
    entry = delegate_entries[0]
    proxy_type = entry[1] if isinstance(entry, (list, tuple)) else getattr(entry, "proxy_type", None)
    delay = entry[2] if isinstance(entry, (list, tuple)) and len(entry) > 2 else getattr(entry, "delay", 0)
    if delay and int(delay) > 0:
        try:
            ann_val = _query(substrate, proxy_pallet, "Announcements", [real_origin], block_hash)
            # Structure: (deposit, Vec<(delegate, call_hash, height)>)
            if ann_val.value:
                warnings.append("Proxy::Unannounced: delayed proxy requires announcement; cannot fully validate off-chain without call hash and block number")
        except Exception:
            warnings.append("Proxy::Unannounced: could not check announcements")

    return ValidationResult(valid=len(errors) == 0, errors=errors, warnings=warnings)


# -----------------------------------------------------------------------------
# Balances.transfer
# -----------------------------------------------------------------------------


def validate_balances_transfer(
    substrate: Any,
    sender: str,
    destination: str,
    amount: int,
    estimated_fee: int = 0,
    block_hash: Optional[str] = None,
    *,
    balances_pallet: str = "Balances",
    system_pallet: str = "System",
) -> ValidationResult:
    """Validate Balances.transfer(sender, destination, amount) before inclusion."""
    errors: list[str] = []
    warnings: list[str] = []

    # DeltaZero
    if amount <= 0:
        errors.append("Balances::DeltaZero: amount must be > 0")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # Use Balances::Account or System::Account depending on chain
    try:
        bal = _query(substrate, balances_pallet, "Account", [sender], block_hash)
    except Exception:
        try:
            acc = _query(substrate, system_pallet, "Account", [sender], block_hash)
            bal = getattr(acc.value, "data", acc.value) if acc.value else None
        except Exception as e:
            errors.append(f"Failed to query sender balance: {e}")
            return ValidationResult(valid=False, errors=errors, warnings=warnings)

    if bal is None or (hasattr(bal, "value") and bal.value is None):
        errors.append("Balances::InsufficientBalance: sender account not found or zero")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    data = bal.value if hasattr(bal, "value") else bal
    free = int(getattr(data, "free", data) if not isinstance(data, dict) else data.get("free", 0))
    reserved = int(getattr(data, "reserved", 0) if not isinstance(data, dict) else data.get("reserved", 0))
    reducible = free  # simplified; runtime may use locks

    # InsufficientBalance
    if reducible < amount + estimated_fee:
        errors.append("Balances::InsufficientBalance: sender balance < amount + fee")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # ExistentialDeposit / Expendability
    try:
        ed = _get_constant(substrate, balances_pallet, "ExistentialDeposit")
        ed = int(ed) if ed is not None else 0
    except Exception:
        ed = 0
    if ed and (reducible - amount - estimated_fee) < ed:
        errors.append("Balances::Expendability: transfer would reap sender (balance below ED)")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # DeadAccount: destination must exist or amount >= ED
    try:
        dest_bal = _query(substrate, balances_pallet, "Account", [destination], block_hash)
        dest_exists = dest_bal.value is not None and (getattr(dest_bal.value, "free", 0) or getattr(dest_bal.value, "data", None))
    except Exception:
        dest_exists = False
    if not dest_exists and amount < ed:
        errors.append("Balances::ExistentialDeposit: destination does not exist and amount < ED")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    return ValidationResult(valid=True, errors=errors, warnings=warnings)


# -----------------------------------------------------------------------------
# SubtensorModule – helpers
# -----------------------------------------------------------------------------


def _subnet_exists(
    substrate: Any,
    netuid: int,
    block_hash: Optional[str],
    pallet: str,
    storage: Dict[str, str],
) -> bool:
    try:
        # NetworksAdded is often a u16 count; subnets are 0..count-1
        count_val = _query(substrate, pallet, storage["networks_added"], [], block_hash)
        count = int(count_val.value) if count_val.value is not None else 0
        return netuid < count
    except Exception:
        try:
            # Some runtimes have SubnetExists(netuid) or similar
            _query(substrate, pallet, "SubnetExists", [netuid], block_hash)
            return True
        except Exception:
            return False


def _get_owner(
    substrate: Any,
    hotkey: str,
    block_hash: Optional[str],
    pallet: str,
    storage: Dict[str, str],
) -> Optional[str]:
    try:
        r = _query(substrate, pallet, storage["owner"], [hotkey], block_hash)
        return r.value if r.value else None
    except Exception:
        return None


def _get_stake(
    substrate: Any,
    hotkey: str,
    coldkey: str,
    netuid: int,
    block_hash: Optional[str],
    pallet: str,
    storage: Dict[str, str],
) -> int:
    try:
        r = _query(substrate, pallet, storage["alpha"], [hotkey, coldkey, netuid], block_hash)
        if r.value is None:
            return 0
        return int(r.value)
    except Exception:
        return 0


def _get_coldkey_balance(substrate: Any, coldkey: str, block_hash: Optional[str], balances_pallet: str = "Balances") -> int:
    try:
        bal = _query(substrate, balances_pallet, "Account", [coldkey], block_hash)
        data = bal.value if hasattr(bal, "value") else bal
        if data is None:
            return 0
        free = getattr(data, "free", data) if not isinstance(data, dict) else data.get("free", 0)
        return int(free)
    except Exception:
        return 0


def _hotkey_registered(
    substrate: Any,
    hotkey: str,
    netuid: int,
    block_hash: Optional[str],
    pallet: str,
) -> bool:
    try:
        # Uids(netuid, hotkey) or similar; if key exists, hotkey is registered
        r = _query(substrate, pallet, "Uids", [netuid, hotkey], block_hash)
        return r.value is not None
    except Exception:
        try:
            r = _query(substrate, pallet, "IsHotkeyRegistered", [hotkey, netuid], block_hash)
            return bool(r.value) if r.value is not None else False
        except Exception:
            return False


def _transfer_allowed(
    substrate: Any,
    netuid: int,
    block_hash: Optional[str],
    pallet: str,
    storage: Dict[str, str],
) -> bool:
    try:
        r = _query(substrate, pallet, storage["transfer_toggle"], [netuid], block_hash)
        return bool(r.value) if r.value is not None else True
    except Exception:
        return True


# -----------------------------------------------------------------------------
# SubtensorModule.add_stake
# -----------------------------------------------------------------------------


def validate_add_stake(
    substrate: Any,
    coldkey: str,
    hotkey: str,
    netuid: int,
    amount_staked: int,
    estimated_fee: int = 0,
    block_hash: Optional[str] = None,
    *,
    subtensor_pallet: Optional[str] = None,
    subtensor_storage: Optional[Dict[str, str]] = None,
    balances_pallet: str = "Balances",
) -> ValidationResult:
    """Validate SubtensorModule.add_stake(coldkey, hotkey, netuid, amount_staked) before inclusion."""
    errors: list[str] = []
    warnings: list[str] = []
    pallet = subtensor_pallet or DEFAULT_SUBTENSOR_PALLET
    storage = subtensor_storage or DEFAULT_SUBTENSOR_STORAGE

    if not _subnet_exists(substrate, netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::SubnetNotExists")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    owner = _get_owner(substrate, hotkey, block_hash, pallet, storage)
    if owner is None:
        errors.append("SubtensorModule::HotKeyAccountNotExists")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)
    if owner != coldkey:
        errors.append("SubtensorModule::NonAssociatedColdKey")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    balance = _get_coldkey_balance(substrate, coldkey, block_hash, balances_pallet)
    if balance < amount_staked + estimated_fee:
        errors.append("SubtensorModule::NotEnoughBalanceToStake")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)
    if balance - amount_staked <= 0:
        errors.append("SubtensorModule::ZeroBalanceAfterWithdrawn")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    return ValidationResult(valid=True, errors=errors, warnings=warnings)


# -----------------------------------------------------------------------------
# SubtensorModule.add_stake_limit
# -----------------------------------------------------------------------------


def validate_add_stake_limit(
    substrate: Any,
    coldkey: str,
    hotkey: str,
    netuid: int,
    amount_staked: int,
    limit_price: int,
    allow_partial: bool,
    estimated_fee: int = 0,
    block_hash: Optional[str] = None,
    *,
    subtensor_pallet: Optional[str] = None,
    subtensor_storage: Optional[Dict[str, str]] = None,
    balances_pallet: str = "Balances",
    skip_max_amount_check: bool = False,
) -> ValidationResult:
    """Validate SubtensorModule.add_stake_limit(...) before inclusion. ZeroMaxStakeAmount requires runtime logic to compute max amount; set skip_max_amount_check=True to only run balance/ownership checks."""
    result = validate_add_stake(
        substrate, coldkey, hotkey, netuid, amount_staked, estimated_fee, block_hash,
        subtensor_pallet=subtensor_pallet, subtensor_storage=subtensor_storage, balances_pallet=balances_pallet,
    )
    if not result.valid:
        return result
    if skip_max_amount_check:
        return result
    # ZeroMaxStakeAmount: would need get_max_amount_add(netuid, limit_price) from runtime (pool state). Cannot replicate easily off-chain.
    result.warnings.append("SubtensorModule::ZeroMaxStakeAmount: cannot fully validate off-chain; consider dry-run or RPC")
    return result


# -----------------------------------------------------------------------------
# SubtensorModule.swap_stake / swap_stake_limit
# -----------------------------------------------------------------------------


def validate_swap_stake(
    substrate: Any,
    coldkey: str,
    hotkey: str,
    origin_netuid: int,
    destination_netuid: int,
    alpha_amount: int,
    estimated_fee: int = 0,
    block_hash: Optional[str] = None,
    *,
    subtensor_pallet: Optional[str] = None,
    subtensor_storage: Optional[Dict[str, str]] = None,
    balances_pallet: str = "Balances",
) -> ValidationResult:
    """Validate SubtensorModule.swap_stake(coldkey, hotkey, origin_netuid, destination_netuid, alpha_amount) before inclusion."""
    errors: list[str] = []
    warnings: list[str] = []
    pallet = subtensor_pallet or DEFAULT_SUBTENSOR_PALLET
    storage = subtensor_storage or DEFAULT_SUBTENSOR_STORAGE

    if not _subnet_exists(substrate, origin_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::SubnetNotExists (origin_netuid)")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)
    if not _subnet_exists(substrate, destination_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::SubnetNotExists (destination_netuid)")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    owner = _get_owner(substrate, hotkey, block_hash, pallet, storage)
    if owner != coldkey:
        errors.append("SubtensorModule::NonAssociatedColdKey")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)
    if not _hotkey_registered(substrate, hotkey, origin_netuid, block_hash, pallet):
        errors.append("SubtensorModule::HotKeyNotRegisteredInSubNet (origin)")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    stake = _get_stake(substrate, hotkey, coldkey, origin_netuid, block_hash, pallet, storage)
    if stake < alpha_amount:
        errors.append("SubtensorModule::NotEnoughStake")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    try:
        min_stake = int(_get_constant(substrate, pallet, "DefaultMinStake"))
        if alpha_amount < min_stake:
            errors.append("SubtensorModule::AmountTooLow")
            return ValidationResult(valid=False, errors=errors, warnings=warnings)
    except Exception:
        pass

    if not _transfer_allowed(substrate, origin_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::TransferDisallowed (origin)")
    if not _transfer_allowed(substrate, destination_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::TransferDisallowed (destination)")

    return ValidationResult(valid=len(errors) == 0, errors=errors, warnings=warnings)


def validate_swap_stake_limit(
    substrate: Any,
    coldkey: str,
    hotkey: str,
    origin_netuid: int,
    destination_netuid: int,
    alpha_amount: int,
    limit_price: int,
    allow_partial: bool,
    estimated_fee: int = 0,
    block_hash: Optional[str] = None,
    **kwargs: Any,
) -> ValidationResult:
    """Validate SubtensorModule.swap_stake_limit(...). ZeroMaxStakeAmount requires runtime get_max_amount_move; see warnings."""
    result = validate_swap_stake(
        substrate, coldkey, hotkey, origin_netuid, destination_netuid, alpha_amount, estimated_fee, block_hash, **kwargs
    )
    if not result.valid:
        return result
    result.warnings.append("SubtensorModule::ZeroMaxStakeAmount: cannot fully validate off-chain; consider dry-run")
    return result


# -----------------------------------------------------------------------------
# SubtensorModule.move_stake / move_stake_limit
# -----------------------------------------------------------------------------


def validate_move_stake(
    substrate: Any,
    coldkey: str,
    origin_hotkey: str,
    destination_hotkey: str,
    origin_netuid: int,
    destination_netuid: int,
    alpha_amount: int,
    estimated_fee: int = 0,
    block_hash: Optional[str] = None,
    *,
    subtensor_pallet: Optional[str] = None,
    subtensor_storage: Optional[Dict[str, str]] = None,
    balances_pallet: str = "Balances",
) -> ValidationResult:
    """Validate SubtensorModule.move_stake(coldkey, origin_hotkey, destination_hotkey, origin_netuid, destination_netuid, alpha_amount) before inclusion."""
    errors: list[str] = []
    pallet = subtensor_pallet or DEFAULT_SUBTENSOR_PALLET
    storage = subtensor_storage or DEFAULT_SUBTENSOR_STORAGE

    if not _subnet_exists(substrate, origin_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::SubnetNotExists (origin_netuid)")
        return ValidationResult(valid=False, errors=errors)
    if not _subnet_exists(substrate, destination_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::SubnetNotExists (destination_netuid)")
        return ValidationResult(valid=False, errors=errors)

    owner_origin = _get_owner(substrate, origin_hotkey, block_hash, pallet, storage)
    if owner_origin != coldkey:
        errors.append("SubtensorModule::NonAssociatedColdKey")
        return ValidationResult(valid=False, errors=errors)
    if not _hotkey_registered(substrate, origin_hotkey, origin_netuid, block_hash, pallet):
        errors.append("SubtensorModule::HotKeyNotRegisteredInSubNet (origin)")
        return ValidationResult(valid=False, errors=errors)
    # Destination hotkey may need to exist / be registered depending on runtime
    if not _get_owner(substrate, destination_hotkey, block_hash, pallet, storage):
        errors.append("SubtensorModule::HotKeyAccountNotExists (destination)")
        return ValidationResult(valid=False, errors=errors)

    stake = _get_stake(substrate, origin_hotkey, coldkey, origin_netuid, block_hash, pallet, storage)
    if stake < alpha_amount:
        errors.append("SubtensorModule::NotEnoughStake")
        return ValidationResult(valid=False, errors=errors)
    try:
        min_stake = int(_get_constant(substrate, pallet, "DefaultMinStake"))
        if alpha_amount < min_stake:
            errors.append("SubtensorModule::AmountTooLow")
            return ValidationResult(valid=False, errors=errors)
    except Exception:
        pass
    if not _transfer_allowed(substrate, origin_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::TransferDisallowed (origin)")
    if not _transfer_allowed(substrate, destination_netuid, block_hash, pallet, storage):
        errors.append("SubtensorModule::TransferDisallowed (destination)")

    return ValidationResult(valid=len(errors) == 0, errors=errors)


def validate_move_stake_limit(
    substrate: Any,
    coldkey: str,
    origin_hotkey: str,
    destination_hotkey: str,
    origin_netuid: int,
    destination_netuid: int,
    alpha_amount: int,
    limit_price: int,
    allow_partial: bool,
    estimated_fee: int = 0,
    block_hash: Optional[str] = None,
    **kwargs: Any,
) -> ValidationResult:
    """Validate SubtensorModule.move_stake_limit(...). ZeroMaxStakeAmount requires runtime get_max_amount_move; see warnings."""
    result = validate_move_stake(
        substrate, coldkey, origin_hotkey, destination_hotkey,
        origin_netuid, destination_netuid, alpha_amount, estimated_fee, block_hash, **kwargs
    )
    if not result.valid:
        return result
    result.warnings.append("SubtensorModule::ZeroMaxStakeAmount: cannot fully validate off-chain; consider dry-run")
    return result


# -----------------------------------------------------------------------------
# Dry-run helper (if node supports it)
# -----------------------------------------------------------------------------


def dry_run_extrinsic(
    substrate: Any,
    extrinsic_hex: str,
    block_hash: Optional[str] = None,
) -> ValidationResult:
    """
    Simulate extrinsic without applying. Uses state_call or similar if available.
    Returns ValidationResult(valid=True) if dispatch would succeed, else valid=False with error info.
    """
    errors: list[str] = []
    try:
        # SubstrateInterface may expose this; exact API depends on node
        result = substrate.rpc_request("state_call", ["Core_initialize_block", "0x"], block_hash)
        # Decode and check result for dispatch error
        errors.append("dry_run_extrinsic: state_call simulation not fully implemented; check node RPC for dry_run or similar")
        return ValidationResult(valid=False, errors=errors)
    except Exception as e:
        errors.append(f"dry_run_extrinsic failed: {e}")
        return ValidationResult(valid=False, errors=errors)
