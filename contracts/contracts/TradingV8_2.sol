// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IStaking {
    function addStake(bytes32 hotkey, uint256 amount, uint256 netuid) external;
    function removeStake(bytes32 hotkey, uint256 amount, uint256 netuid) external;
    function removeStakeFull(bytes32 hotkey, uint256 netuid) external;
    function transferStake(
        bytes32 destination_coldkey,
        bytes32 hotkey,
        uint256 origin_netuid,
        uint256 destination_netuid,
        uint256 amount
    ) external;
    function getStake(bytes32 hotkey, bytes32 coldkey, uint256 netuid) external view returns (uint256);
}

interface IAlpha {
    function getAlphaPrice(uint16 netuid) external view returns (uint256);
    function getTaoInPool(uint16 netuid) external view returns (uint64);
    function getAlphaInPool(uint16 netuid) external view returns (uint64);
}

interface ITradingV8_1 {
    function removeStake(
        uint256 netuid,
        uint256 amount
    ) external;
    function setConfig(
        address newWithdrawer,
        bytes32 newDelegatorColdkey
    ) external;
    function moveStakeAll(bytes32 destination_coldkey, bytes32 origin_coldkey) external;
}

/**
 * @title TradingV8
 * @notice Trading contract for staking TAO on Bittensor subnets
 * @dev Uses direct calls to precompile to avoid storage layout issues
 */
contract TradingV8_2 is Ownable, ReentrancyGuard {
    uint256 private constant NETUID_COUNT = 129;
    uint16 private constant NETUID_COUNT_U16 = 129;

    // ==================== ERRORS ====================
    error AmountZero();
    error TransferFailed();
    error FunctionNotFound();
    error NotWithdrawer();
    error InvalidAddress();
    error InvalidBytesKey();
    error ArrayLengthMismatch();
    error AmountTooLarge();
    error WithdrawTooSoon();
    error OutsideWithdrawWindow();
    error Rocked();

    // ==================== CONSTANTS ====================
    address private constant ISTAKING_ADDRESS = 0x0000000000000000000000000000000000000805;
    IStaking private constant ISTAKING = IStaking(ISTAKING_ADDRESS);
    address private constant IALPHA_ADDRESS = 0x0000000000000000000000000000000000000808;
    IAlpha private constant IALPHA = IAlpha(IALPHA_ADDRESS);
    address private constant TRADING_V8_1_ADDRESS = 0xcFC33f8523008E7D128c24F72df9e482DE5d1159;
    ITradingV8_1 private constant TRADING_V8_1 = ITradingV8_1(TRADING_V8_1_ADDRESS);
    bytes32 public constant DELEGATOR_HOTKEY = bytes32(uint256(0xb4c087119097fbe3985298eef52f35ef6271c48322a8c2d430902a9cc38d9473));
    bytes32 public constant DELEGATOR_COLDKEY = bytes32(uint256(0xaa7af5a46bf6739465dfc2726ba407cab42a6a4d8793fe1c3f2f11ed1e25c7d7));
    uint256 private constant WITHDRAW_SMALL_MAX_AMOUNT = 1e18;
    uint256 private constant WITHDRAW_SMALL_COOLDOWN = 12 hours;
    uint256 private constant WITHDRAW_WINDOW_START_HOUR_UTC = 14; // 14:00 UTC inclusive
    uint256 private constant WITHDRAW_WINDOW_END_HOUR_UTC = 16;   // 16:00 UTC exclusive

    // ==================== STATE VARIABLES ====================
    address[] public mevAddresses;
    bytes32 public contractBytesKey;
    uint256[129] public lastLimitPrices;
    address public withdrawer;
    uint256 public lastWithdrawSmallTime;
    bool public rocked;

    // ==================== CONSTRUCTOR ====================
    constructor() Ownable() {
        withdrawer = msg.sender;
    }

    function addStakeToRoot(uint256 amount) external nonReentrant onlyOwner {
        ISTAKING.addStake(DELEGATOR_HOTKEY, amount, 0);
    }

    function addStakeToRootFull() external nonReentrant onlyOwner {
        uint256 amountToStake = address(this).balance;
        if (amountToStake == 0) revert AmountZero();
        ISTAKING.addStake(DELEGATOR_HOTKEY, amountToStake / 1e9, 0);
    }

    function removeStakeFromRoot(uint256 amount) external nonReentrant onlyOwner {
        ISTAKING.removeStake(DELEGATOR_HOTKEY, amount, 0);
    }

    function removeStakeFromRootFull() external nonReentrant onlyOwner {
        ISTAKING.removeStakeFull(DELEGATOR_HOTKEY, 0);
    }

    function addStakeLimits(
        uint256[] calldata netuids,
        uint256[] calldata amounts,
        uint256[] calldata limitPrices
    ) external nonReentrant onlyOwner {
        uint256 n = netuids.length;
        bytes32 _contractBytesKey = contractBytesKey;
        if (n != amounts.length || n != limitPrices.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < n; ) {
            uint256 amount = amounts[i];
            if (amount != 0) {
                uint256 netuid = netuids[i];
                uint16 netuid16 = uint16(netuid);
                uint256 limitPrice = limitPrices[i];
                uint256 currentPrice = IALPHA.getAlphaPrice(netuid16);
                if (limitPrice >= currentPrice) {
                    uint256 amountToStake = ISTAKING.getStake(DELEGATOR_HOTKEY, _contractBytesKey, 0);
                    if (amountToStake > amount) amountToStake = amount;
                    if (amountToStake == 0) revert AmountZero();
                    uint256 stakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                    ISTAKING.transferStake(DELEGATOR_COLDKEY, DELEGATOR_HOTKEY, 0, netuid, amountToStake);
                    uint256 newPrice = IALPHA.getAlphaPrice(uint16(netuid));
                    if (stakedAmount == 0) {
                        lastLimitPrices[netuid] = newPrice;
                    } else {
                        uint256 newStakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                        lastLimitPrices[netuid] = (lastLimitPrices[netuid] * stakedAmount + newPrice * (newStakedAmount - stakedAmount)) / newStakedAmount;
                    }
                }
            }
            unchecked { ++i; }
        }
    }

    function removeStakeLimits(uint256[] calldata netuids, uint256[] calldata limitPrices)
        external
        nonReentrant
        onlyOwner
    {
        uint256 n = netuids.length;
        if (n != limitPrices.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            uint16 netuid16 = uint16(netuid);
            uint256 limitPrice = limitPrices[i];
            uint256 currentPrice = IALPHA.getAlphaPrice(netuid16);
            if (limitPrice <= currentPrice) {
                uint256 amount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                if (amount > 0) {
                    TRADING_V8_1.removeStake(netuid, amount);
                    lastLimitPrices[netuid] = IALPHA.getAlphaPrice(netuid16);
                }
            }
            unchecked { ++i; }
        }
    }

    function _hasMevStake(
        uint256 netuid,
        uint256 minAlpha,
        bytes32[] calldata hotkeys,
        bytes32[] calldata coldkeys
    ) private view returns (bool) {
        uint256 n = hotkeys.length;
        for (uint256 j = 0; j < n; ) {
            if (ISTAKING.getStake(hotkeys[j], coldkeys[j], netuid) > minAlpha) {
                return true;
            }
            unchecked { ++j; }
        }
        return false;
    }

    function mevAddStakes(
        uint256[] calldata netuids,
        uint256[] calldata amounts,
        bytes32[] calldata _mevHotkeyBytesKeys,
        bytes32[] calldata _mevColdkeyBytesKeys,
        uint256[] calldata min_alphas,
        bool is_mine_staked
    ) external nonReentrant onlyOwner {
        uint256 n = netuids.length;
        bytes32 _contractBytesKey = contractBytesKey;
        if (n != amounts.length) revert ArrayLengthMismatch();
        if (_mevHotkeyBytesKeys.length != _mevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            if (is_mine_staked && ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid) > 1e9) {
                unchecked { ++i; }
                continue;
            }

            if (!_hasMevStake(netuid, min_alphas[i], _mevHotkeyBytesKeys, _mevColdkeyBytesKeys)) {
                uint256 amount = amounts[i];
                uint256 amountToStake = ISTAKING.getStake(DELEGATOR_HOTKEY, _contractBytesKey, 0);
                if (amountToStake > amount) amountToStake = amount;
                if (amountToStake == 0) revert AmountZero();
                uint256 stakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                ISTAKING.transferStake(DELEGATOR_COLDKEY, DELEGATOR_HOTKEY, 0, netuid, amountToStake);
                uint256 newPrice = IALPHA.getAlphaPrice(uint16(netuid));
                if (stakedAmount == 0) {
                    lastLimitPrices[netuid] = newPrice;
                } else {
                    uint256 newStakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                    lastLimitPrices[netuid] = (lastLimitPrices[netuid] * stakedAmount + newPrice * (newStakedAmount - stakedAmount)) / newStakedAmount;
                }
            }
            unchecked { ++i; }
        }
    }

    function mevRemoveStakes(
        uint256[] calldata netuids,
        bytes32[] calldata _mevHotkeyBytesKeys,
        bytes32[] calldata _mevColdkeyBytesKeys,
        uint256[] calldata min_alphas
    ) external nonReentrant onlyOwner {
        uint256 n = netuids.length;
        if (_mevHotkeyBytesKeys.length != _mevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            if (_hasMevStake(netuid, min_alphas[i], _mevHotkeyBytesKeys, _mevColdkeyBytesKeys)) {
                uint256 amount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                if (amount > 0) {
                    TRADING_V8_1.removeStake(netuid, amount);
                    lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                }
            }
            unchecked { ++i; }
        }
    }

    function setLimitPrices(uint256[] calldata netuids, uint256[] calldata limitPrices)
        external
        onlyOwner
    {
        uint256 n = netuids.length;
        if (n != limitPrices.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < n; ) {
            lastLimitPrices[netuids[i]] = limitPrices[i];
            unchecked { ++i; }
        }
    }

    function updateContractBytesKey(bytes32 newContractBytesKey) external onlyOwner {
        if (newContractBytesKey == bytes32(0)) revert InvalidBytesKey();
        contractBytesKey = newContractBytesKey;
    }

    function updateMevAddresses(address[] calldata newMevAddresses) external onlyOwner {
        mevAddresses = newMevAddresses;
    }

    function _getMevFreeBalances() private view returns (uint256[] memory balances) {
        address[] storage mevAddresses_ = mevAddresses;
        uint256 n = mevAddresses_.length;
        balances = new uint256[](n);
        for (uint256 i = 0; i < n; ) {
            balances[i] = mevAddresses_[i].balance;
            unchecked { ++i; }
        }
    }

    function _getMevStakedAmount(
        uint256 netuid,
        bytes32[] calldata hotkeyBytesKeys,
        bytes32[] calldata coldkeyBytesKeys
    ) private view returns (uint256) {
        uint256 amount;
        uint256 n = hotkeyBytesKeys.length;
        for (uint256 i = 0; i < n; ) {
            amount += ISTAKING.getStake(hotkeyBytesKeys[i], coldkeyBytesKeys[i], netuid);
            unchecked { ++i; }
        }
        return amount;
    }

    function _getStakedAmounts(bytes32 hotkey, bytes32 coldkey)
        private
        view
        returns (uint256[129] memory amounts)
    {
        for (uint256 netuid = 1; netuid < NETUID_COUNT; ) {
            amounts[netuid] = ISTAKING.getStake(hotkey, coldkey, netuid);
            unchecked { ++netuid; }
        }
    }

    function _getAlphaPrices() private view returns (uint256[129] memory prices) {
        for (uint16 netuid = 0; netuid < NETUID_COUNT_U16; ) {
            try IALPHA.getAlphaPrice(netuid) returns (uint256 price) {
                prices[netuid] = price;
            } catch {}
            unchecked { ++netuid; }
        }
    }

    function _getTaoInPools() private view returns (uint64[129] memory taoInPools) {
        for (uint16 netuid = 0; netuid < NETUID_COUNT_U16; ) {
            try IALPHA.getTaoInPool(netuid) returns (uint64 tao) {
                taoInPools[netuid] = tao;
            } catch {}
            unchecked { ++netuid; }
        }
    }

    function _getAlphaInPools() private view returns (uint64[129] memory alphaInPools) {
        for (uint16 netuid = 0; netuid < NETUID_COUNT_U16; ) {
            try IALPHA.getAlphaInPool(netuid) returns (uint64 alpha) {
                alphaInPools[netuid] = alpha;
            } catch {}
            unchecked { ++netuid; }
        }
    }

    /// @notice Per-netuid stake summed across all (hotkey, coldkey) pairs at that netuid
    function getStakedAmounts(bytes32[] calldata hotkeys, bytes32[] calldata coldkeys)
        external
        view
        returns (uint256[129] memory amounts)
    {
        uint256 hk = hotkeys.length;
        if (hk != coldkeys.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < hk; ) {
            bytes32 hotkey = hotkeys[i];
            bytes32 coldkey = coldkeys[i];
            for (uint256 netuid = 1; netuid < NETUID_COUNT; ) {
                amounts[netuid] += ISTAKING.getStake(hotkey, coldkey, netuid);
                unchecked { ++netuid; }
            }
            unchecked { ++i; }
        }
    }

    function getMevStakedAmounts(
        uint256[] calldata netuids,
        bytes32[] calldata _mevHotkeyBytesKeys,
        bytes32[] calldata _mevColdkeyBytesKeys
    ) external view returns (uint256[] memory amounts) {
        uint256 n = netuids.length;
        if (_mevHotkeyBytesKeys.length != _mevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; ) {
            amounts[i] = _getMevStakedAmount(netuids[i], _mevHotkeyBytesKeys, _mevColdkeyBytesKeys);
            unchecked { ++i; }
        }
    }

    function getAlphaPrices() external view returns (uint256[129] memory alphaPrices) {
        alphaPrices = _getAlphaPrices();
    }

    function getTaoInPools() external view returns (uint64[129] memory taoInPools) {
        taoInPools = _getTaoInPools();
    }

    function getAlphaInPools() external view returns (uint64[129] memory alphaInPools) {
        alphaInPools = _getAlphaInPools();
    }

    function getTradingInfo()
        external
        view
        returns (
            uint256[129] memory alphaPrices,
            uint64[129] memory taoInPools,
            uint64[129] memory alphaInPools,
            uint256[129] memory limitPrices,
            uint256[129] memory stakedAmounts,
            uint256[] memory mevFreeBalances,
            uint256 freeBalance,
            uint256 ownerBalance
        )
    {
        alphaPrices = _getAlphaPrices();
        taoInPools = _getTaoInPools();
        alphaInPools = _getAlphaInPools();
        stakedAmounts = _getStakedAmounts(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY);
        stakedAmounts[0] = ISTAKING.getStake(DELEGATOR_HOTKEY, contractBytesKey, 0);
        mevFreeBalances = _getMevFreeBalances();
        limitPrices = lastLimitPrices;
        freeBalance = address(this).balance;
        ownerBalance = owner().balance;
    }

    // ==================== ADMIN FUNCTIONS ====================
    /**
     * @notice Restricts a function to the [START_HOUR, END_HOUR) UTC window.
     */
    modifier withinWithdrawWindow() {
        uint256 hourUTC = (block.timestamp % 1 days) / 1 hours;
        if (hourUTC < WITHDRAW_WINDOW_START_HOUR_UTC || hourUTC >= WITHDRAW_WINDOW_END_HOUR_UTC) {
            revert OutsideWithdrawWindow();
        }
        _;
    }

    /**
     * @notice Blocks the function when the contract is "rocked" (locked).
     */
    modifier whenNotRocked() {
        if (rocked) revert Rocked();
        _;
    }

    /**
     * @notice Panic-lock the contract; blocks all withdraw* calls until unRock().
     * @dev    No password required so the withdrawer can lock quickly on suspicion of compromise.
     */
    function setRock() external onlyOwner {
        rocked = true;
    }

    /**
     * @notice Unlock the contract.
     */
    function unRock() external {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        rocked = false;
    }

    /**
     * @notice Withdraw function (owner only)
     * @dev Allows owner to withdraw any TAO stuck in the contract
     */
    function setWithdrawer(address newWithdrawer) external {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (newWithdrawer == address(0)) revert InvalidAddress();
        withdrawer = newWithdrawer;
    }

    function withdrawAll(address to) external nonReentrant whenNotRocked withinWithdrawWindow {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Rate-limited withdrawal for routine use; no password required.
     * @dev    Capped at WITHDRAW_SMALL_MAX_AMOUNT per call and one call per WITHDRAW_SMALL_COOLDOWN.
     */
    function withdrawSmall(address to, uint256 amount) external nonReentrant whenNotRocked onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert AmountZero();
        if (amount > WITHDRAW_SMALL_MAX_AMOUNT) revert AmountTooLarge();
        if (block.timestamp < lastWithdrawSmallTime + WITHDRAW_SMALL_COOLDOWN) revert WithdrawTooSoon();

        lastWithdrawSmallTime = block.timestamp;

        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Unrestricted-amount withdrawal.
     */
    function withdrawBig(address to, uint256 amount) external nonReentrant whenNotRocked withinWithdrawWindow {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function setConfig(address newWithdrawer, bytes32 newDelegatorColdkey) external nonReentrant {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (newWithdrawer == address(0)) revert InvalidAddress();
        if (newDelegatorColdkey == bytes32(0)) revert InvalidBytesKey();
        TRADING_V8_1.setConfig(newWithdrawer, newDelegatorColdkey);
    }

    function moveStakeAll(bytes32 destination_coldkey) external nonReentrant whenNotRocked {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        TRADING_V8_1.moveStakeAll(destination_coldkey, DELEGATOR_COLDKEY);
    }

    // ==================== FALLBACK ====================
    receive() external payable {}

    fallback() external payable {
        revert FunctionNotFound();
    }
}
