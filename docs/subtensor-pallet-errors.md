# Subtensor pallet::errors reference

Reference for **pallet::errors** that can occur when calling **Proxy.proxy**, **SubtensorModule** stake extrinsics, and **transfers** on the [opentensor/subtensor](https://github.com/opentensor/subtensor) chain.

---

## 1. Proxy.proxy (Substrate Proxy pallet)

When you dispatch via `Proxy.proxy`, the **Proxy** pallet can return these errors (from Substrate’s `frame/proxy`):

| Error | Description |
|-------|-------------|
| **TooMany** | Too many proxies registered or too many announcements pending. |
| **NotFound** | Proxy registration not found. |
| **NotProxy** | Sender is not a proxy of the account to be proxied. |
| **Unproxyable** | A call incompatible with the proxy type’s filter was attempted. |
| **Duplicate** | Account is already a proxy. |
| **NoPermission** | Call may not be made by proxy because it may escalate privileges. |
| **Unannounced** | Announcement was made too recently or does not exist. |
| **NoSelfProxy** | Cannot add self as proxy. |

From Bittensor docs, the Proxy pallet also documents:

| Error | Description |
|-------|-------------|
| **AnnouncementDepositInvariantViolated** | Invariant violated: deposit recomputation returned None after updating announcements. |

Any **inner call** (e.g. SubtensorModule or Balances) can still return its own pallet errors; those are listed below.

---

## 2. Balances / transfers (Substrate Balances pallet)

For **Balances.transfer** (and other balance operations used under the hood), the **Balances** pallet can return:

| Error | Description |
|-------|-------------|
| **VestingBalance** | Vesting balance too high to send value. |
| **LiquidityRestrictions** | Account liquidity restrictions prevent withdrawal. |
| **InsufficientBalance** | Balance too low to send value. |
| **ExistentialDeposit** | Value too low to create account due to existential deposit. |
| **Expendability** | Transfer/payment would kill account. |
| **ExistingVestingSchedule** | A vesting schedule already exists for this account. |
| **DeadAccount** | Beneficiary account must pre-exist. |
| **TooManyReserves** | Number of named reserves exceeds `MaxReserves`. |
| **TooManyHolds** | Number of holds exceeds limit. |
| **TooManyFreezes** | Number of freezes exceeds `MaxFreezes`. |
| **IssuanceDeactivated** | The issuance cannot be modified (already deactivated). |
| **DeltaZero** | The delta cannot be zero. |

---

## 3. SubtensorModule – stake extrinsics

Source: `pallets/subtensor/src/macros/errors.rs` and related staking code.

### 3.1 SubtensorModule.add_stake

| Error | Description |
|-------|-------------|
| **SubtokenDisabled** | SubToken disabled for this subnet. |
| **NotEnoughBalanceToStake** | Not enough balance on the coldkey. |
| **NonAssociatedColdKey** | The calling coldkey is not associated with this hotkey. |
| **BalanceWithdrawalError** | Could not withdraw from coldkey (e.g. liquidity/balance pallet error). |
| **ZeroBalanceAfterWithdrawn** | Balance would be zero after withdrawal. |
| **SubnetNotExists** | Subnet does not exist. |
| **TxRateLimitExceeded** | Transaction rate limit exceeded. |
| **StakingRateLimitExceeded** | Staking rate limit exceeded. |
| **InsufficientLiquidity** | Not enough liquidity in the swap pool (when staking into subnet). |
| **SlippageTooHigh** | Slippage beyond allowed (if applicable). |

### 3.2 SubtensorModule.add_stake_limit

Same as **add_stake**, plus:

| Error | Description |
|-------|-------------|
| **ZeroMaxStakeAmount** | Max executable amount with the given limit price is zero (e.g. limit too low or no liquidity). |

Doc comments also mention: **NotEnoughBalanceToStake**, **NonAssociatedColdKey**, **BalanceWithdrawalError**, **TxRateLimitExceeded**.

### 3.3 SubtensorModule.swap_stake

Uses `transition_stake_internal` (same coldkey/hotkey, cross-subnet). Possible errors include:

| Error | Description |
|-------|-------------|
| **SubnetNotExists** | Origin or destination subnet does not exist. |
| **HotKeyNotRegisteredInSubNet** | Hotkey not registered on the relevant subnet. |
| **NonAssociatedColdKey** | Origin is not the coldkey that owns the hotkey. |
| **NotEnoughStake** | Not enough stake on (coldkey, hotkey, origin_netuid). |
| **AmountTooLow** | Swap amount below minimum stake requirement. |
| **TransferDisallowed** | Subnet disallows transfer (if transfer toggle checked). |
| **ZeroMaxStakeAmount** | From get_max_amount_* when limit price leaves zero executable amount. |
| **StakingOperationRateLimitExceeded** | Too frequent staking operations. |
| **SubtokenDisabled** | If checked on the subnet. |

### 3.4 SubtensorModule.swap_stake_limit

Same as **swap_stake** (same logic with `limit_price` and `allow_partial`). Additionally:

| Error | Description |
|-------|-------------|
| **ZeroMaxStakeAmount** | Max amount under limit price is zero. |

### 3.5 SubtensorModule.move_stake

Uses `transition_stake_internal` (different hotkeys/coldkeys, cross-subnet). Possible errors:

| Error | Description |
|-------|-------------|
| **SubnetNotExists** | Origin or destination subnet does not exist. |
| **HotKeyNotRegisteredInSubNet** | Hotkey not registered on the relevant subnet. |
| **NonAssociatedColdKey** | Coldkey does not own the origin hotkey. |
| **NotEnoughStake** | Not enough stake to move. |
| **AmountTooLow** | Amount below minimum stake. |
| **TransferDisallowed** | Subnet disallows transfer. |
| **ZeroMaxStakeAmount** | From get_max_amount_move when limit semantics apply. |
| **StakingOperationRateLimitExceeded** | Too frequent staking operations. |
| **SubtokenDisabled** | If checked. |

### 3.6 SubtensorModule.move_stake_limit

`move_stake_limit` was added in [PR #1583](https://github.com/opentensor/subtensor/pull/1583). It uses the same `transition_stake_internal` path as **move_stake** but with `limit_price` and `allow_partial`. So it can return the same errors as **move_stake**, plus:

| Error | Description |
|-------|-------------|
| **ZeroMaxStakeAmount** | Max amount under the given limit price is zero. |

---

## 4. Full Subtensor pallet Error enum (for reference)

From `pallets/subtensor/src/macros/errors.rs`:

- RootNetworkDoesNotExist, InvalidIpType, InvalidIpAddress, InvalidPort  
- HotKeyNotRegisteredInSubNet, HotKeyAccountNotExists, HotKeyNotRegisteredInNetwork  
- NonAssociatedColdKey  
- NotEnoughStake, NotEnoughStakeToWithdraw, NotEnoughStakeToSetWeights, NotEnoughStakeToSetChildkeys  
- NotEnoughBalanceToStake, BalanceWithdrawalError, ZeroBalanceAfterWithdrawn  
- NeuronNoValidatorPermit, WeightVecNotEqualSize, DuplicateUids, UidVecContainInvalidOne, WeightVecLengthIsLow, MaxWeightExceeded  
- HotKeyAlreadyDelegate, SettingWeightsTooFast, IncorrectWeightVersionKey, ServingRateLimitExceeded  
- UidsLengthExceedUidsInSubNet  
- NetworkTxRateLimitExceeded, DelegateTxRateLimitExceeded, HotKeySetTxRateLimitExceeded, StakingRateLimitExceeded  
- SubNetRegistrationDisabled, TooManyRegistrationsThisBlock, TooManyRegistrationsThisInterval  
- HotKeyAlreadyRegisteredInSubNet, NewHotKeyIsSameWithOld  
- TransactorAccountShouldBeHotKey, FaucetDisabled, NotSubnetOwner  
- RegistrationNotPermittedOnRootSubnet, StakeTooLowForRoot, AllNetworksInImmunity  
- NotEnoughBalanceToPaySwapHotKey, NotRootSubnet, CanNotSetRootNetworkWeights  
- NoNeuronIdAvailable, DelegateTakeTooLow, DelegateTakeTooHigh  
- NoWeightsCommitFound, InvalidRevealCommitHashNotMatch, CommitRevealEnabled, CommitRevealDisabled  
- LiquidAlphaDisabled, AlphaHighTooLow, AlphaLowOutOfRange  
- ColdKeyAlreadyAssociated, NotEnoughBalanceToPaySwapColdKey  
- InvalidChild, DuplicateChild, ProportionOverflow, TooManyChildren  
- TxRateLimitExceeded  
- ColdkeySwapAnnouncementNotFound, ColdkeySwapTooEarly, ColdkeySwapReannouncedTooEarly  
- AnnouncedColdkeyHashDoesNotMatch, ColdkeySwapAlreadyDisputed, NewColdKeyIsHotkey  
- InvalidChildkeyTake, TxChildkeyTakeRateLimitExceeded, InvalidIdentity  
- MechanismDoesNotExist, CannotUnstakeLock, SubnetNotExists  
- TooManyUnrevealedCommits, ExpiredWeightCommit, RevealTooEarly, InputLengthsUnequal, CommittingWeightsTooFast  
- AmountTooLow, InsufficientLiquidity, SlippageTooHigh, TransferDisallowed  
- ActivityCutoffTooLow, CallDisabled  
- FirstEmissionBlockNumberAlreadySet, NeedWaitingMoreBlocksToStarCall  
- NotEnoughAlphaOutToRecycle, CannotBurnOrRecycleOnRootSubnet  
- UnableToRecoverPublicKey, InvalidRecoveredPublicKey  
- SubtokenDisabled, HotKeySwapOnSubnetIntervalNotPassed  
- **ZeroMaxStakeAmount**  
- SameNetuid, InsufficientBalance, StakingOperationRateLimitExceeded  
- InvalidLeaseBeneficiary, LeaseCannotEndInThePast, LeaseNetuidNotFound, LeaseDoesNotExist, LeaseHasNoEndBlock, LeaseHasNotEnded  
- Overflow, BeneficiaryDoesNotOwnHotkey, ExpectedBeneficiaryOrigin  
- AdminActionProhibitedDuringWeightsWindow  
- SymbolDoesNotExist, SymbolAlreadyInUse  
- IncorrectCommitRevealVersion, RevealPeriodTooLarge, RevealPeriodTooSmall  
- InvalidValue, SubnetLimitReached, CannotAffordLockCost  
- EvmKeyAssociateRateLimitExceeded, SameAutoStakeHotkeyAlreadySet  
- UidMapCouldNotBeCleared, TrimmingWouldExceedMaxImmunePercentage, ChildParentInconsistency  
- InvalidNumRootClaim, InvalidRootClaimThreshold, InvalidSubnetNumber  
- TooManyUIDsPerMechanism, VotingPowerTrackingNotEnabled, InvalidVotingPowerEmaAlpha  
- PrecisionLoss, Deprecated  
- AddStakeBurnRateLimitExceeded  
- ColdkeySwapAnnounced, ColdkeySwapDisputed  

---

## 5. Summary table by call

| Call | Pallet | Notable errors |
|------|--------|----------------|
| **Proxy.proxy** | Proxy | TooMany, NotFound, NotProxy, Unproxyable, Duplicate, NoPermission, Unannounced, NoSelfProxy (and inner call errors) |
| **Balances.transfer** | Balances | InsufficientBalance, ExistentialDeposit, Expendability, LiquidityRestrictions, VestingBalance, DeadAccount, TooManyReserves, TooManyHolds, TooManyFreezes, IssuanceDeactivated, DeltaZero |
| **SubtensorModule.add_stake** | Subtensor | SubtokenDisabled, NotEnoughBalanceToStake, NonAssociatedColdKey, BalanceWithdrawalError, ZeroBalanceAfterWithdrawn, SubnetNotExists, TxRateLimitExceeded, StakingRateLimitExceeded, InsufficientLiquidity, SlippageTooHigh |
| **SubtensorModule.add_stake_limit** | Subtensor | Same as add_stake + **ZeroMaxStakeAmount** |
| **SubtensorModule.swap_stake** | Subtensor | SubnetNotExists, HotKeyNotRegisteredInSubNet, NonAssociatedColdKey, NotEnoughStake, AmountTooLow, TransferDisallowed, StakingOperationRateLimitExceeded, SubtokenDisabled |
| **SubtensorModule.swap_stake_limit** | Subtensor | Same as swap_stake + **ZeroMaxStakeAmount** |
| **SubtensorModule.move_stake** | Subtensor | Same family as swap_stake (SubnetNotExists, NonAssociatedColdKey, NotEnoughStake, AmountTooLow, TransferDisallowed, etc.) |
| **SubtensorModule.move_stake_limit** | Subtensor | Same as move_stake + **ZeroMaxStakeAmount** |

When using **Proxy.proxy**, you can receive **Proxy** errors from the proxy pallet and **Subtensor** or **Balances** errors from the inner call.

---

## 6. Validating extrinsics in mempool before block inclusion

Ways to validate that an extrinsic is likely to succeed **before** it is included in a block, so you can drop or deprioritize bad txs in the mempool or reject them at submission.

### 6.1 General approaches

| Approach | Description | Limitation |
|----------|-------------|------------|
| **Dry-run / simulate** | Replay the extrinsic at current or specified block (no state write). Use RPCs such as `state_call` (with runtime logic that simulates the call), or `transaction_preview` / `payment_queryCallInfo`-style APIs if the node exposes them. | State can change between simulation and block execution (e.g. balance, stake, rate limits). |
| **Pre-checks from chain state** | Before accepting a tx, query the storage/state needed for the checks below. If any check fails, treat the extrinsic as invalid for that reason. | Same as above; also you must mirror the runtime’s logic for rate limits and dynamic data. |
| **Hybrid** | Run cheap storage pre-checks first (subnet exists, coldkey owns hotkey, etc.). Optionally run a dry-run for the rest. | Balances cost of RPC vs accuracy. |

Use the **same block hash** (e.g. latest finalised or current head) for all queries so the checks are consistent. Re-validate at inclusion time if you keep a mempool for more than one block.

---

### 6.2 Proxy.proxy – validations per error

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **NotFound** | Query `Proxy::Proxies(real_origin)`. If the account has no proxies list or the delegate is not in the list, the proxy call will fail. |
| **NotProxy** | Ensure the **signer** of the tx is one of the entries in `Proxy::Proxies(real_origin)` as `delegate`. |
| **Unproxyable** | Check the **inner call** (method + pallet) against the `proxy_type` filter for that delegate. The runtime’s `IsProxyable` (or equivalent) defines which call is allowed for each proxy type; replicate that filter off-chain. |
| **NoPermission** | Same as Unproxyable: ensure the inner call does not escalate privileges (e.g. no sudo, no adding a proxy type that includes the current one). |
| **TooMany** | Query number of proxies and pending announcements for the account; ensure under `MaxProxies` / `MaxPending`. |
| **Duplicate** | Only relevant when adding a proxy; not applicable when only executing via `proxy`. |
| **Unannounced** | For **announced** proxy types: query announcements for `(real_origin, delegate)` and ensure there is an announcement for the **call hash** of the inner call and that `current_block - announcement_height >= delay`. |
| **NoSelfProxy** | Only when adding; for `proxy` just ensure `real_origin != delegate`. |
| **AnnouncementDepositInvariantViolated** | Hard to pre-check; related to deposit computation. Rely on dry-run or accept rare failure. |

**Practical check:** Resolve `real_origin` from the proxy call args, then: (1) `Proxies(real_origin)` contains `(delegate, proxy_type, delay)`; (2) inner call is allowed by `proxy_type`; (3) if delay &gt; 0, announcement exists and is old enough.

---

### 6.3 Balances / transfer – validations per error

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **InsufficientBalance** | Query free/reducible balance of sender (e.g. `Balances::Account(sender)` or chain’s balance RPC). Ensure `balance >= amount + estimated_fee`. |
| **ExistentialDeposit** | If the **destination** is new, ensure `amount >= ED` (query `ExistentialDeposit` constant and whether destination account exists). |
| **Expendability** | If transfer would **reap** the sender, it can fail (balance goes to 0 and account removed). Check `sender_balance - amount - fee >= ED` (or that the account is allowed to be reaped if the chain permits). |
| **LiquidityRestrictions** | Query locks/holds on sender (e.g. `Balances::Locks(sender)`, `Balances::Holds(sender)`). Ensure the transfer amount is not locked or that the runtime allows drawing from locked. |
| **VestingBalance** | If the chain uses vesting, query vesting schedule for sender and ensure `transfer_amount <= free_balance - vesting_locked`. |
| **DeadAccount** | For “beneficiary must pre-exist” semantics: check if destination account exists (e.g. balance or system account); if not, require `amount >= ED`. |
| **TooManyReserves / TooManyHolds / TooManyFreezes** | Query current count for the account and compare to chain constants; reject if adding one more would exceed the limit. |
| **DeltaZero** | For transfer: ensure `amount > 0`. |
| **IssuanceDeactivated** | Usually a chain-wide constant; no per-tx pre-check beyond dry-run. |

**Practical check:** Get sender balance, ED, and (if available) locks; require `amount > 0`, `sender_balance >= amount + fee`, and if creating a new account then `amount >= ED`.

---

### 6.4 SubtensorModule – validations per error

Use storage and RPC from the Subtensor pallet (exact names depend on the runtime; below uses logical names).

#### Subnet / mechanism

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **SubnetNotExists** | Query that `netuid` (and for move/swap, `origin_netuid` and `destination_netuid`) exist (e.g. subnet registry or `SubnetExists`-style storage). Skip or reject if subnet doesn’t exist. |
| **SubtokenDisabled** | Query per-subnet “subtoken enabled” / mechanism config; reject if staking is disabled for that `netuid`. |

#### Coldkey / hotkey / ownership

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **NonAssociatedColdKey** | Query `Owner(hotkey)` (or equivalent). For the tx signer (or proxy’s real origin) `coldkey`, require `Owner(hotkey) == coldkey`. |
| **HotKeyNotRegisteredInSubNet** | Query registration for `(hotkey, netuid)` (e.g. UID or “is registered” storage). Require hotkey registered on the subnet(s) involved (origin for unstake, destination if required). |
| **HotKeyAccountNotExists** | Same as above: `Owner(hotkey)` or registration must exist where the call expects the hotkey to exist. |

#### Balance / stake amounts

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **NotEnoughBalanceToStake** | Query coldkey balance (Balances + any reserved). Require `coldkey_balance >= amount_staked + fee`. |
| **BalanceWithdrawalError** | Covered by balance + liquidity checks (see Balances section); ensure coldkey has sufficient free balance and no lock that blocks withdrawal. |
| **ZeroBalanceAfterWithdrawn** | Ensure `coldkey_balance - amount_staked > 0` (and &gt; ED if account must stay alive). |
| **NotEnoughStake** | Query stake for `(hotkey, coldkey, netuid)` (e.g. `Alpha` or stake RPC). For swap/move, require `stake_on_origin_netuid >= alpha_amount`. |
| **AmountTooLow** | Query chain constant for minimum stake (e.g. `DefaultMinStake` or subnet min). Require `alpha_amount >= min_stake`. |
| **ZeroMaxStakeAmount** | For **add_stake_limit**: compute or query “max amount at limit_price” (same formula as runtime’s `get_max_amount_add`). Reject if result is 0. For **swap_stake_limit** / **move_stake_limit**: same for `get_max_amount_move` / remove; reject if max executable is 0. |

##### Formula: `get_max_amount_add(netuid, limit_price)`

**Runtime behaviour** (from `pallets/subtensor/src/staking/add_stake.rs`):

1. **Root or stable subnet** (`netuid.is_root()` or `SubnetMechanism(netuid) == 0`):  
   - If `limit_price >= 1_000_000_000` (1e9 RAO): return **max = u64::MAX**.  
   - Else: return **ZeroMaxStakeAmount** (no slippage on root/stable, so any limit &lt; 1e9 allows zero).

2. **Dynamic subnet**: the runtime does **not** use a closed-form expression. It calls  
   `SwapInterface::swap(netuid, GetAlphaForTao::with_amount(u64::MAX), limit_price, false, true)`  
   and returns `result.amount_paid_in + result.fee_paid` (the max RAO that can be spent while staying at or better than `limit_price`). If that sum is zero, it returns **ZeroMaxStakeAmount**.

**Off-chain approximation (constant-product AMM, no fees):**

Subnet reserves follow **τ · α = k**. When adding TAO (`cost`), alpha received is:

- **α_out = α_in · cost / (τ_in + cost)**

Average price in RAO per Alpha is **cost / α_out = (τ_in + cost) / α_in**. To stay at or below `limit_price` (RAO per Alpha):

- **(τ_in + cost) / α_in ≤ limit_price**  
- **τ_in + cost ≤ α_in · limit_price**  
- **cost ≤ α_in · limit_price − τ_in**

So a **no-fee** approximation for the max TAO amount is:

```text
max_amount_add ≈ max(0,  α_in · limit_price − τ_in )
```

- **τ_in** = `SubnetTAO(netuid) + SubnetTaoProvided(netuid)` (TAO in pool, in RAO)  
- **α_in** = `SubnetAlphaIn(netuid) + SubnetAlphaInProvided(netuid)` (alpha in pool)  
- **limit_price** = RAO per 1 Alpha (same units as in the extrinsic)

The real runtime applies fees and uses the swap interface; for exact behaviour use a dry-run or the chain's swap precompile/RPC if available.

##### Formula: `get_max_amount_move(origin_netuid, destination_netuid, limit_price)`

**Returns:** Maximum amount of **origin subnet Alpha** (`x`) that can be moved such that the effective swap price (moved_alpha / unstaked_alpha) does not go below `limit_price`. So the result is in **Alpha** (origin subnet), not RAO.

**limit_price** is in units of **RAO per 1 Alpha** (same scale as elsewhere: 1e9 = 1 TAO per Alpha). The runtime compares the effective price of the move (destination alpha received per origin alpha unstaked) to this limit.

**Runtime behaviour** (from `pallets/subtensor/src/staking/move_stake.rs`):

1. **Both root or stable** (`SubnetMechanism` == 0 for both):  
   - If `limit_price > 1_000_000_000`: **ZeroMaxStakeAmount**.  
   - Else: **max = AlphaCurrency::MAX** (no slippage).

2. **Origin root/stable, destination dynamic**: Uses `get_max_amount_add(destination_netuid, destination_subnet_price)` with a converted price (limit_price is origin/destination ratio; code inverts to get destination price).

3. **Origin dynamic, destination root/stable**: Returns **get_max_amount_remove(origin_netuid, limit_price)** (max alpha you can unstake from origin at that limit).

4. **SubnetTAO or SubnetAlphaIn zero** for either subnet: **ZeroMaxStakeAmount**.

5. **limit_price > current_price** (current origin/destination alpha price ratio): **ZeroMaxStakeAmount**.

6. **limit_price == 0**: **max = AlphaCurrency::MAX**.

7. **Main case (both subnets dynamic):** Closed-form from constant-product on both pools.

**Derivation (constant-product, no fees):**

- Unstake **x** Alpha on origin (pool 1: τ₁, α₁) → TAO out:  
  **unstaked_tao = τ₁ − (α₁ · τ₁) / (α₁ + x)**  
- Stake that TAO on destination (pool 2: τ₂, α₂) → Alpha out:  
  **moved_alpha = α₂ − (α₂ · τ₂) / (τ₂ + unstaked_tao)**  
- Effective price (destination Alpha per origin Alpha): **moved_alpha / x**. Require **moved_alpha / x ≥ limit_price** (in consistent units).  
- Solving for **x** (max origin Alpha at limit_price) gives:

```text
     α₂·τ₁ − limit_price·α₁·τ₂
x = ─────────────────────────────
     limit_price·(τ₁ + τ₂)
```

With:

- **τ₁** = `SubnetTAO(origin_netuid) + SubnetTaoProvided(origin_netuid)`
- **α₁** = `SubnetAlphaIn(origin_netuid) + SubnetAlphaInProvided(origin_netuid)`
- **τ₂** = `SubnetTAO(destination_netuid) + SubnetTaoProvided(destination_netuid)`
- **α₂** = `SubnetAlphaIn(destination_netuid) + SubnetAlphaInProvided(destination_netuid)`
- **limit_price** in same units as the extrinsic (RAO per Alpha; runtime often uses 1e9 scale).

So **max_amount_move ≈ max(0, x)** with **x** above. The runtime uses fixed-point (U64F64) and checks for zero/negative; fees and swap v3 may change the exact value (see TODO in source).

#### Transfer / subnet config

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **TransferDisallowed** | Query `TransferToggle(netuid)` (or equivalent) for the subnets involved; reject if transfer is disabled where the call requires it. |

#### Rate limits

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **TxRateLimitExceeded** | Query rate-limit state for the key (e.g. last tx time or counter per account/key). If the chain exposes it, ensure the new tx would not exceed the limit. |
| **StakingRateLimitExceeded** | Same idea: query staking-specific rate limit for the coldkey/hotkey and ensure under limit. |
| **StakingOperationRateLimitExceeded** | Same as above; use any staking-operation rate limit storage or RPC. |

#### Swap / liquidity

| Error | How to validate before inclusion |
|-------|-----------------------------------|
| **InsufficientLiquidity** | For add_stake / stake_into_subnet: query pool state (SubnetTAO, SubnetAlphaIn, etc.) and ensure the swap can be satisfied. |
| **SlippageTooHigh** | If the call uses a limit price, ensure current implied price (from pool state or RPC) is within the user’s limit; otherwise treat as likely to fail with SlippageTooHigh. |

---

### 6.5 Validation flow by extrinsic type

- **Proxy.proxy**  
  1. Resolve real origin and delegate from call.  
  2. Check Proxy storage (proxies list, announcement if delayed, filter for inner call).  
  3. Run the same pre-checks below on the **inner call** as if it were submitted by `real_origin`.

- **Balances.transfer**  
  1. Sender balance ≥ amount + fee.  
  2. Amount &gt; 0.  
  3. If destination doesn’t exist: amount ≥ ED.  
  4. Optional: check locks/vesting so transfer is not over locked balance.

- **SubtensorModule.add_stake**  
  1. Subnet exists; subtoken enabled.  
  2. `Owner(hotkey) == coldkey` (signer).  
  3. Coldkey balance ≥ amount + fee; after withdraw, balance &gt; 0.  
  4. Optional: rate limit and pool liquidity / slippage.

- **SubtensorModule.add_stake_limit**  
  Same as add_stake, plus: **max amount at limit_price &gt; 0** (query or compute from pool/limit_price).

- **SubtensorModule.swap_stake / swap_stake_limit**  
  1. Origin and destination subnets exist.  
  2. `Owner(hotkey) == coldkey`.  
  3. Hotkey registered on origin subnet.  
  4. Stake on (coldkey, hotkey, origin_netuid) ≥ alpha_amount; alpha_amount ≥ min stake.  
  5. Transfer allowed on subnets if required.  
  6. For swap_stake_limit: max amount at limit_price &gt; 0.  
  7. Optional: rate limits.

- **SubtensorModule.move_stake / move_stake_limit**  
  Same as swap_stake (and swap_stake_limit for the limit case), but check both origin and destination hotkeys/registrations as required by the call.

Running a **dry-run** of the extrinsic (same block, same sender) after these pre-checks gives the highest confidence it will succeed in the next block, at the cost of an extra RPC. For mempool validation, combining storage pre-checks with optional dry-run keeps most invalid extrinsics out before they are included in a block.

### 6.6 Python implementation

A Python implementation of these validations is in the repo:

- **Scripts**: [`scripts/extrinsic_validator/`](../scripts/extrinsic_validator/)
  - `validate_extrinsic.py` – functions for Proxy, Balances, and SubtensorModule (add_stake, add_stake_limit, swap_stake, swap_stake_limit, move_stake, move_stake_limit).
  - `example_usage.py` – runnable examples for each validator.
  - `README.md` – install (`pip install -r requirements.txt`), usage, and custom pallet/storage names.
