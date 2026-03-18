"""
Slim validators: minimal checks for Proxy and SubtensorModule stake extrinsics.
Return bool; no block_hash, no ValidationResult.
"""

from __future__ import annotations

from typing import Any, List, Optional

PALLET = "SubtensorModule"
PROXY_PALLET = "Proxy"


def _query(
    substrate: Any,
    pallet: str,
    storage: str,
    params: List[Any],
) -> Any:
    return substrate.query(pallet, storage, params)


def _delegate_from_entry(p: Any) -> Optional[str]:
    """Normalize delegate from storage (tuple or struct) to comparable string."""
    if isinstance(p, (list, tuple)) and len(p) > 0:
        raw = p[0]
    else:
        raw = getattr(p, "delegate", None)
    if raw is None:
        return None
    return str(raw) if not isinstance(raw, str) else raw


def validate_proxy_call(
    substrate: Any,
    real_origin: str,
    delegate: str,
) -> bool:
    """
    Validate Proxy.proxy(real_origin, delegate, ...) before inclusion.
    Checks: Proxies(real_origin) exists, delegate is in the list, real_origin != delegate.
    """
    try:
        proxies_val = _query(substrate, PROXY_PALLET, "Proxies", [real_origin])
    except Exception:
        return False

    if proxies_val.value is None or (hasattr(proxies_val.value, "value") and proxies_val.value.value is None):
        return False

    if hasattr(proxies_val.value, "value"):
        pair = proxies_val.value.value
    else:
        pair = proxies_val.value
    if isinstance(pair, (list, tuple)):
        proxy_list = pair[1] if len(pair) > 1 else pair
    else:
        proxy_list = getattr(pair, "proxies", getattr(pair, "value", []) or [])

    delegate_str = str(delegate)
    delegate_entries = [p for p in proxy_list if _delegate_from_entry(p) == delegate_str]
    if not delegate_entries:
        return False

    if str(real_origin) == delegate_str:
        return False

    return True


def _get_owner(substrate: Any, hotkey: str) -> Optional[str]:
    try:
        r = _query(substrate, PALLET, "Owner", [hotkey])
        if r.value is None:
            return None
        return str(r.value)
    except Exception:
        return None


def _hotkey_registered(substrate: Any, hotkey: str, netuid: int) -> bool:
    try:
        r = _query(substrate, PALLET, "Uids", [netuid, hotkey])
        return r.value is not None
    except Exception:
        try:
            r = _query(substrate, PALLET, "IsHotkeyRegistered", [hotkey, netuid])
            return bool(r.value) if r.value is not None else False
        except Exception:
            return False


def _netuid_in_range(netuid: int) -> bool:
    """True if netuid is in valid range 0..128."""
    return 0 <= netuid <= 128


# -----------------------------------------------------------------------------
# SubtensorModule.add_stake
# -----------------------------------------------------------------------------


def validate_add_stake(
    substrate: Any,
    coldkey: str,
    hotkey: str,
    netuid: int,
) -> bool:
    """Validate SubtensorModule.add_stake(coldkey, hotkey, netuid, amount_staked) before inclusion."""
    if not _netuid_in_range(netuid):
        return False
    owner = _get_owner(substrate, hotkey)
    if owner is None or owner != str(coldkey):
        return False
    return True


# -----------------------------------------------------------------------------
# SubtensorModule.swap_stake / swap_stake_limit
# -----------------------------------------------------------------------------


def validate_swap_stake(
    substrate: Any,
    coldkey: str,
    hotkey: str,
    origin_netuid: int,
    destination_netuid: int,
) -> bool:
    """Validate SubtensorModule.swap_stake(...) before inclusion."""
    if not _netuid_in_range(origin_netuid) or not _netuid_in_range(destination_netuid):
        return False
    owner = _get_owner(substrate, hotkey)
    if owner is None or owner != str(coldkey):
        return False
    if not _hotkey_registered(substrate, hotkey, origin_netuid):
        return False
    return True


# -----------------------------------------------------------------------------
# SubtensorModule.move_stake
# -----------------------------------------------------------------------------


def validate_move_stake(
    substrate: Any,
    coldkey: str,
    origin_hotkey: str,
    destination_hotkey: str,
    origin_netuid: int,
    destination_netuid: int,
) -> bool:
    """Validate SubtensorModule.move_stake(...) before inclusion."""
    if not _netuid_in_range(origin_netuid) or not _netuid_in_range(destination_netuid):
        return False
    owner_origin = _get_owner(substrate, origin_hotkey)
    if owner_origin is None or owner_origin != str(coldkey):
        return False
    if not _hotkey_registered(substrate, origin_hotkey, origin_netuid):
        return False
    if _get_owner(substrate, destination_hotkey) is None:
        return False
    return True
