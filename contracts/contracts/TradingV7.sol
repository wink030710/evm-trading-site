// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IStaking {
    function addStake(bytes32 hotkey, uint256 amount, uint256 netuid) external;
    function removeStakeFull(bytes32 hotkey, uint256 netuid) external;
    function getStake(bytes32 hotkey, bytes32 coldkey, uint256 netuid) external view returns (uint256);
}

interface IAlpha {
    function getAlphaPrice(uint16 netuid) external view returns (uint256);
    function getTaoInPool(uint16 netuid) external view returns (uint64);
}

/**
 * @title TradingV7
 * @notice Trading contract for staking TAO on Bittensor subnets
 * @dev Uses direct calls to precompile to avoid storage layout issues
 */
contract TradingV7 is Ownable, ReentrancyGuard {
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

    // ==================== CONSTANTS ====================
    address private constant ISTAKING_ADDRESS = 0x0000000000000000000000000000000000000805;
    IStaking private constant ISTAKING = IStaking(ISTAKING_ADDRESS);
    address private constant IALPHA_ADDRESS = 0x0000000000000000000000000000000000000808;
    IAlpha private constant IALPHA = IAlpha(IALPHA_ADDRESS);
    uint256 private constant WEI_PER_RAO = 1e9;
    uint256 private constant MIN_STAKE_AMOUNT_WEI = 1e9;
    bytes32 public constant DELEGATOR_BYTES_KEY = bytes32(uint256(0xb4c087119097fbe3985298eef52f35ef6271c48322a8c2d430902a9cc38d9473));

    // ==================== STATE VARIABLES ====================
    address[] public mevAddresses;
    bytes32 public contractBytesKey;
    bool[129] public isStaked;
    uint256[129] public lastLimitPrices;
    uint256[129] public lastStakeTimestamps;
    address public withdrawer;

    // ==================== CONSTRUCTOR ====================
    constructor() Ownable() {
        withdrawer = msg.sender;
    }

    function addStakeLimits(
        uint256[] calldata netuids,
        uint256[] calldata amounts,
        uint256[] calldata limitPrices
    ) external payable nonReentrant onlyOwner {
        uint256 n = netuids.length;
        if (n != amounts.length || n != limitPrices.length) revert ArrayLengthMismatch();

        uint256 timestamp = block.timestamp;
        for (uint256 i = 0; i < n; ) {
            uint256 amount = amounts[i];
            if (amount != 0) {
                uint256 netuid = netuids[i];

                uint16 netuid16 = uint16(netuid);
                uint256 limitPrice = limitPrices[i];
                uint256 currentPrice = IALPHA.getAlphaPrice(netuid16);
                // Skip add when caller limit is below market (would pay too much vs threshold)
                if (limitPrice >= currentPrice) {
                    uint256 amountToStake = address(this).balance;
                    if (amountToStake > amount) amountToStake = amount;
                    if (amountToStake == 0) revert AmountZero();
                    ISTAKING.addStake(DELEGATOR_BYTES_KEY, amountToStake / WEI_PER_RAO, netuid);
                    lastLimitPrices[netuid] = IALPHA.getAlphaPrice(netuid16);
                    isStaked[netuid] = true;
                    lastStakeTimestamps[netuid] = timestamp;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function removeStakeLimits(uint256[] calldata netuids, uint256[] calldata limitPrices)
        external
        payable
        nonReentrant
        onlyOwner
    {
        uint256 n = netuids.length;
        if (n != limitPrices.length) revert ArrayLengthMismatch();

        uint256 timestamp = block.timestamp;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];

            uint16 netuid16 = uint16(netuid);
            uint256 limitPrice = limitPrices[i];
            uint256 currentPrice = IALPHA.getAlphaPrice(netuid16);
            if (limitPrice <= currentPrice) {
                if (timestamp != lastStakeTimestamps[netuid]) {
                    ISTAKING.removeStakeFull(DELEGATOR_BYTES_KEY, netuid);
                    lastLimitPrices[netuid] = IALPHA.getAlphaPrice(netuid16);
                    isStaked[netuid] = false;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function mevAddStakes(
        uint256[] calldata netuids,
        uint256[] calldata amounts,
        bytes32[] calldata _mevHotkeyBytesKeys,
        bytes32[] calldata _mevColdkeyBytesKeys
    ) external payable nonReentrant onlyOwner {
        uint256 n = netuids.length;
        if (n != amounts.length) revert ArrayLengthMismatch();
        if (_mevHotkeyBytesKeys.length != _mevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        uint256 keyCount = _mevHotkeyBytesKeys.length;
        uint256 timestamp = block.timestamp;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];

            bool hasMevStake = false;
            for (uint256 j = 0; j < keyCount; ) {
                if (ISTAKING.getStake(_mevHotkeyBytesKeys[j], _mevColdkeyBytesKeys[j], netuid) > MIN_STAKE_AMOUNT_WEI) {
                    hasMevStake = true;
                    break;
                }
                unchecked {
                    ++j;
                }
            }

            if (!hasMevStake) {
                uint256 amount = amounts[i];
                uint256 amountToStake = address(this).balance;
                if (amountToStake > amount) amountToStake = amount;
                if (amountToStake == 0) revert AmountZero();
                ISTAKING.addStake(DELEGATOR_BYTES_KEY, amountToStake / WEI_PER_RAO, netuid);
                isStaked[netuid] = true;
                lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                lastStakeTimestamps[netuid] = timestamp;
            }
            unchecked {
                ++i;
            }
        }
    }

    function mevRemoveStakes(
        uint256[] calldata netuids,
        bytes32[] calldata _mevHotkeyBytesKeys,
        bytes32[] calldata _mevColdkeyBytesKeys
    ) external payable nonReentrant onlyOwner {
        uint256 n = netuids.length;
        if (_mevHotkeyBytesKeys.length != _mevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        uint256 keyCount = _mevHotkeyBytesKeys.length;
        uint256 timestamp = block.timestamp;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            if (timestamp != lastStakeTimestamps[netuid]) {
                for (uint256 j = 0; j < keyCount; ) {
                    if (ISTAKING.getStake(_mevHotkeyBytesKeys[j], _mevColdkeyBytesKeys[j], netuid) > MIN_STAKE_AMOUNT_WEI) {
                        ISTAKING.removeStakeFull(DELEGATOR_BYTES_KEY, netuid);
                        lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                        isStaked[netuid] = false;
                        break;
                    }
                    unchecked {
                        ++j;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function resetLimitPrices(uint256[] calldata netuids) external nonReentrant onlyOwner {
        uint256 n = netuids.length;
        uint256 timestamp = block.timestamp;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
            lastStakeTimestamps[netuid] = timestamp;
            unchecked {
                ++i;
            }
        }
    }

    function updateContractBytesKey(bytes32 newContractBytesKey) external nonReentrant onlyOwner {
        if (newContractBytesKey == bytes32(0)) revert InvalidBytesKey();
        contractBytesKey = newContractBytesKey;
    }

    function updateMevAddresses(address[] calldata newMevAddresses) external nonReentrant onlyOwner {
        mevAddresses = newMevAddresses;
    }

    function removeDeregisteredStakes(uint256[] calldata netuids) external nonReentrant onlyOwner {
        uint256 n = netuids.length;
        bytes32 contractBytesKey_ = contractBytesKey;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            if (ISTAKING.getStake(DELEGATOR_BYTES_KEY, contractBytesKey_, netuid) == 0) {
                isStaked[netuid] = false;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _getMevFreeBalances() private view returns (uint256[] memory balances) {
        address[] storage mevAddresses_ = mevAddresses;
        uint256 n = mevAddresses_.length;
        balances = new uint256[](n);
        for (uint256 i = 0; i < n; ) {
            balances[i] = mevAddresses_[i].balance;
            unchecked {
                ++i;
            }
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
            unchecked {
                ++i;
            }
        }
        return amount;
    }

    function _getStakedAmounts(bytes32 hotkey, bytes32 coldkey)
        private
        view
        returns (uint256[129] memory amounts)
    {
        for (uint256 netuid = 1; netuid < NETUID_COUNT; ) {
            if (isStaked[netuid]) {
                amounts[netuid] = ISTAKING.getStake(hotkey, coldkey, netuid);
            }
            unchecked {
                ++netuid;
            }
        }
    }

    function _getAlphaPrices() private view returns (uint256[129] memory prices) {
        for (uint16 netuid = 0; netuid < NETUID_COUNT_U16; ) {
            try IALPHA.getAlphaPrice(netuid) returns (uint256 price) {
                prices[netuid] = price;
            } catch {}
            unchecked {
                ++netuid;
            }
        }
    }

    function _getTaoInPools() private view returns (uint64[129] memory taoInPools) {
        for (uint16 netuid = 0; netuid < NETUID_COUNT_U16; ) {
            try IALPHA.getTaoInPool(netuid) returns (uint64 tao) {
                taoInPools[netuid] = tao;
            } catch {}
            unchecked {
                ++netuid;
            }
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
                unchecked {
                    ++netuid;
                }
            }
            unchecked {
                ++i;
            }
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
            unchecked {
                ++i;
            }
        }
    }

    function getAlphaPrices() external view returns (uint256[129] memory alphaPrices) {
        alphaPrices = _getAlphaPrices();
    }

    function getTaoInPools() external view returns (uint64[129] memory taoInPools) {
        taoInPools = _getTaoInPools();
    }

    function getTradingInfo()
        external
        view
        returns (
            uint256[129] memory alphaPrices,
            uint64[129] memory taoInPools,
            bool[129] memory staked,
            uint256[129] memory limitPrices,
            uint256[129] memory stakedAmounts,
            uint256[] memory mevFreeBalances,
            uint256 freeBalance,
            uint256 ownerBalance
        )
    {
        alphaPrices = _getAlphaPrices();
        taoInPools = _getTaoInPools();
        staked = isStaked;
        stakedAmounts = _getStakedAmounts(DELEGATOR_BYTES_KEY, contractBytesKey);
        mevFreeBalances = _getMevFreeBalances();
        limitPrices = lastLimitPrices;
        freeBalance = address(this).balance;
        ownerBalance = owner().balance;
    }

    // ==================== ADMIN FUNCTIONS ====================
    /**
     * @notice Withdraw function (owner only)
     * @dev Allows owner to withdraw any TAO stuck in the contract
     */
    function setWithdrawer(address newWithdrawer) external nonReentrant {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (newWithdrawer == address(0)) revert InvalidAddress();
        withdrawer = newWithdrawer;
    }

    function withdrawAll(address to) external nonReentrant {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    function emergencyWithdrawTao(address to, uint256 amount) external nonReentrant {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ==================== FALLBACK ====================
    receive() external payable {}

    fallback() external payable {
        revert FunctionNotFound();
    }
}
