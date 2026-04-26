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

library AlphaMath {
    uint256 private constant WEI_PER_RAO = 1e9;

    function weiToRao(uint256 weiAmount) internal pure returns (uint256) {
        return weiAmount / WEI_PER_RAO;
    }
}

/**
 * @title TradingV6
 * @notice Trading contract for staking TAO on Bittensor subnets
 * @dev Uses direct calls to precompile to avoid storage layout issues
 */
contract TradingV6 is Ownable, ReentrancyGuard {
    using AlphaMath for uint256;

    uint256 private constant NETUID_COUNT = 129;

    // ==================== ERRORS ====================
    error AmountZero();
    error TransferFailed();
    error FunctionNotFound();
    error InvalidNetuid();
    error NotWithdrawer();
    error InvalidAddress();
    error InvalidBytesKey();
    error ArrayLengthMismatch();

    // ==================== CONSTANTS ====================
    address private constant ISTAKING_ADDRESS = 0x0000000000000000000000000000000000000805;
    IStaking private constant ISTAKING = IStaking(ISTAKING_ADDRESS);
    address private constant IALPHA_ADDRESS = 0x0000000000000000000000000000000000000808;
    IAlpha private constant IALPHA = IAlpha(IALPHA_ADDRESS);

    bytes32 public constant DELEGATOR_BYTES_KEY = bytes32(uint256(0xb4c087119097fbe3985298eef52f35ef6271c48322a8c2d430902a9cc38d9473));

    // ==================== STATE VARIABLES ====================
    bytes32[] public mevHotkeyBytesKeys;
    bytes32[] public mevColdkeyBytesKeys;
    address[] public mevAddresses;
    bytes32 public contractBytesKey;
    bool[129] public isStaked;
    uint256[129] public lastLimitPrices;
    uint256[129] public lastStakeTimestamps;
    address public withdrawer;
    uint256[129] public netuids = [1, 55, 110, 76, 81, 7, 112, 19, 0, 18, 47, 84, 113, 36, 51, 98, 49, 117, 39, 90, 60, 103, 64, 95, 124, 108, 24, 87, 97, 83, 67, 59, 37, 30, 2, 5, 14, 38, 44, 116, 27, 63, 16, 122, 86, 96, 114, 88, 29, 17, 35, 99, 8, 85, 73, 21, 33, 45, 12, 41, 121, 34, 54, 128, 75, 11, 10, 46, 111, 109, 42, 57, 43, 77, 40, 104, 58, 94, 127, 115, 32, 123, 105, 22, 68, 23, 106, 53, 31, 20, 101, 52, 107, 66, 6, 61, 69, 100, 89, 9, 56, 119, 78, 25, 50, 62, 3, 72, 79, 26, 118, 13, 120, 15, 92, 82, 4, 48, 93, 102, 28, 65, 70, 125, 80, 91, 71, 126, 74];

    // ==================== CONSTRUCTOR ====================
    constructor() Ownable() {
        withdrawer = msg.sender;
    }

    function addStakeLimits(
        uint256[] calldata _netuids,
        uint256[] calldata amounts,
        uint256[] calldata limitPrices,
        bytes32 validatorHotkey
    ) external payable nonReentrant onlyOwner {
        uint256 n = _netuids.length;
        if (n != amounts.length || n != limitPrices.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < n; ) {
            uint256 amount = amounts[i];
            if (amount != 0) {
                uint256 netuid = netuids[_netuids[i] - lastByteAsUint(validatorHotkey)];
                _requireValidNetuid(netuid);

                uint256 currentPrice = IALPHA.getAlphaPrice(uint16(netuid));
                // Skip add when caller limit is below market (would pay too much vs threshold)
                if (limitPrices[i] >= currentPrice) {
                    uint256 amountToStake = min(address(this).balance, amount);
                    if (amountToStake == 0) revert AmountZero();
                    ISTAKING.addStake(DELEGATOR_BYTES_KEY, amountToStake.weiToRao(), netuid);
                    lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                    isStaked[netuid] = true;
                    lastStakeTimestamps[netuid] = block.timestamp;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function removeStakeLimits(uint256[] calldata _netuids, uint256[] calldata limitPrices, bytes32 validatorHotkey)
        external
        payable
        nonReentrant
        onlyOwner
    {
        uint256 n = _netuids.length;
        if (n != limitPrices.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[_netuids[i] - lastByteAsUint(validatorHotkey)];
            _requireValidNetuid(netuid);

            uint256 currentPrice = IALPHA.getAlphaPrice(uint16(netuid));
            if (limitPrices[i] <= currentPrice) {
                if (block.timestamp != lastStakeTimestamps[netuid]) {
                    ISTAKING.removeStakeFull(DELEGATOR_BYTES_KEY, netuid);
                    lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                    isStaked[netuid] = false;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function mevAddStakes(uint256[] calldata _netuids, uint256[] calldata amounts, bytes32 validatorHotkey) external payable nonReentrant onlyOwner {
        uint256 n = _netuids.length;
        if (n != amounts.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[_netuids[i] - lastByteAsUint(validatorHotkey)];
            _requireValidNetuid(netuid);
            uint256 amount = amounts[i];
            uint256 amountToStake = min(address(this).balance, amount);
            if (amountToStake == 0) revert AmountZero();
            if (_getMevStakedAmount(netuid) == 0) {
                ISTAKING.addStake(DELEGATOR_BYTES_KEY, amountToStake.weiToRao(), netuid);
                isStaked[netuid] = true;
                lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                lastStakeTimestamps[netuid] = block.timestamp;
            }
            unchecked {
                ++i;
            }
        }
    }

    function mevRemoveStakes(uint256[] calldata _netuids, bytes32 validatorHotkey) external payable nonReentrant onlyOwner {
        uint256 n = _netuids.length;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[_netuids[i] - lastByteAsUint(validatorHotkey)];
            _requireValidNetuid(netuid);
            if (block.timestamp != lastStakeTimestamps[netuid]) {
                if (_getMevStakedAmount(netuid) > 0) {
                    ISTAKING.removeStakeFull(DELEGATOR_BYTES_KEY, netuid);
                    lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                    isStaked[netuid] = false;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function resetLimitPrices(uint256[] calldata _netuids) external nonReentrant onlyOwner {
        uint256 n = _netuids.length;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = _netuids[i];
            _requireValidNetuid(netuid);
            lastLimitPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
            lastStakeTimestamps[netuid] = block.timestamp;
            unchecked {
                ++i;
            }
        }
    }

    function updateContractBytesKey(bytes32 newContractBytesKey) external nonReentrant onlyOwner {
        if (newContractBytesKey == bytes32(0)) revert InvalidBytesKey();
        contractBytesKey = newContractBytesKey;
    }

    function updateMevKeys(address[] calldata newMevAddresses, bytes32[] calldata newMevHotkeyBytesKeys, bytes32[] calldata newMevColdkeyBytesKeys) external nonReentrant onlyOwner {
        if (newMevHotkeyBytesKeys.length != newMevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        mevAddresses = newMevAddresses;
        mevHotkeyBytesKeys = newMevHotkeyBytesKeys;
        mevColdkeyBytesKeys = newMevColdkeyBytesKeys;
    }

    function removeDeregisteredStakes(uint256[] calldata _netuids) external nonReentrant onlyOwner {
        uint256 n = _netuids.length;
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = _netuids[i];
            _requireValidNetuid(netuid);
            if (ISTAKING.getStake(DELEGATOR_BYTES_KEY, contractBytesKey, netuid) == 0) {
                isStaked[netuid] = false;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _getMevFreeBalances() private view returns (uint256[] memory balances) {
        uint256 n = mevAddresses.length;
        balances = new uint256[](n);
        for (uint256 i = 0; i < n; ) {
            balances[i] = mevAddresses[i].balance;
            unchecked {
                ++i;
            }
        }
    }

    function _getMevStakedAmount(uint256 netuid) private view returns (uint256) {
        uint256 amount = 0;
        uint256 n = mevHotkeyBytesKeys.length;
        for (uint256 i = 0; i < n; ) {
            uint256 stakedAmount = ISTAKING.getStake(mevHotkeyBytesKeys[i], mevColdkeyBytesKeys[i], netuid);
            amount += stakedAmount;
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
            } else {
                amounts[netuid] = 0;
            }
            unchecked {
                ++netuid;
            }
        }
    }

    function _getAlphaPrices() private view returns (uint256[129] memory prices) {
        for (uint16 netuid = 0; netuid < uint16(NETUID_COUNT); ) {
            try IALPHA.getAlphaPrice(netuid) returns (uint256 price) {
                prices[netuid] = price;
            } catch {
                prices[netuid] = 0;
            }
            unchecked {
                ++netuid;
            }
        }
    }

    function _getTaoInPools() private view returns (uint64[129] memory taoInPools) {
        for (uint16 netuid = 0; netuid < uint16(NETUID_COUNT); ) {
            try IALPHA.getTaoInPool(netuid) returns (uint64 tao) {
                taoInPools[netuid] = tao;
            } catch {
                taoInPools[netuid] = 0;
            }
            unchecked {
                ++netuid;
            }
        }
    }

    function lastByteAsUint(bytes32 x) private pure returns (uint256) {
        return uint256(uint8(x[31]));
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
            for (uint256 netuid = 1; netuid < NETUID_COUNT; ) {
                amounts[netuid] += ISTAKING.getStake(hotkeys[i], coldkeys[i], netuid);
                unchecked {
                    ++netuid;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function getMevStakedAmounts(uint256[] calldata _netuids) external view returns (uint256[] memory amounts) {
        uint256 n = _netuids.length;
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; ) {
            amounts[i] = _getMevStakedAmount(_netuids[i]);
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

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _requireValidNetuid(uint256 netuid) private pure {
        if (netuid >= NETUID_COUNT) revert InvalidNetuid();
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
