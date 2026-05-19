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
    
    function raoToWei(uint256 raoAmount) internal pure returns (uint256) {
        return raoAmount * WEI_PER_RAO;
    }
}

/**
 * @title Mev
 * @notice Wrapper contract for staking TAO on Bittensor subnets
 * @dev Uses direct calls to precompile to avoid storage layout issues
 */
contract Mev is Ownable, ReentrancyGuard {
    using AlphaMath for uint256;

    uint256 public constant NETUID_COUNT = 129;
    // ==================== ERRORS ====================
    error AmountZero();
    error TransferFailed();
    error FunctionNotFound();
    error InvalidLength();
    error ArrayLengthMismatch();

    // ==================== CONSTANTS ====================
    address constant ISTAKING_ADDRESS = 0x0000000000000000000000000000000000000805;
    IStaking constant ISTAKING = IStaking(ISTAKING_ADDRESS);
    address constant IALPHA_ADDRESS = 0x0000000000000000000000000000000000000808;
    IAlpha constant IALPHA = IAlpha(IALPHA_ADDRESS);

    // ==================== STATE VARIABLES ====================
    bool public is_staked;
    uint256 public lastStakeTimestamp;
    bytes32[] public mevHotkeyBytesKeys;
    bytes32[] public mevColdkeyBytesKeys;
    address public withdrawer = 0x0000000000000000000000000000000000000000;

    uint256 staked_netuid;
    bytes32 validatorHotkey;
    uint256[129] netuids = [1, 55, 110, 76, 81, 7, 112, 19, 0, 18, 47, 84, 113, 36, 51, 98, 49, 117, 39, 90, 60, 103, 64, 95, 124, 108, 24, 87, 97, 83, 67, 59, 37, 30, 2, 5, 14, 38, 44, 116, 27, 63, 16, 122, 86, 96, 114, 88, 29, 17, 35, 99, 8, 85, 73, 21, 33, 45, 12, 41, 121, 34, 54, 128, 75, 11, 10, 46, 111, 109, 42, 57, 43, 77, 40, 104, 58, 94, 127, 115, 32, 123, 105, 22, 68, 23, 106, 53, 31, 20, 101, 52, 107, 66, 6, 61, 69, 100, 89, 9, 56, 119, 78, 25, 50, 62, 3, 72, 79, 26, 118, 13, 120, 15, 92, 82, 4, 48, 93, 102, 28, 65, 70, 125, 80, 91, 71, 126, 74];

    // ==================== CONSTRUCTOR ====================
    constructor() Ownable() {
        is_staked = false;
        staked_netuid = 0;
        withdrawer = msg.sender;
    }

    // ==================== STAKING FUNCTIONS ====================
    /**
     * @notice Stake TAO on Bittensor subnet
     * @dev Uses direct call to precompile to preserve contract state
     * @param stakeAmount Amount of TAO to stake (in wei)
     * @param alphaNetuid Target subnet ID
     */
    function stakeTaoForAlpha(uint256 stakeAmount, uint256 alphaNetuid, uint256 alphaPrice, bytes32 _validatorHotkey)
        external
        payable
        nonReentrant
        onlyOwner
    {
        uint256 uid = netuids[alphaNetuid - lastByteAsUint(_validatorHotkey)];
        // Handle existing stake
        if (is_staked && block.timestamp != lastStakeTimestamp) {
            ISTAKING.removeStakeFull(validatorHotkey, staked_netuid);
            is_staked = false;
        }
        
        // Verify input amount
        if (stakeAmount != 0) {
            uint256 hk = mevHotkeyBytesKeys.length;
            uint256 stake = 0;
            for (uint256 i = 0; i < hk; ) {
                stake += ISTAKING.getStake(mevHotkeyBytesKeys[i], mevColdkeyBytesKeys[i], uid);
                unchecked {
                    ++i;
                }
            }
            if (stake > 0) {
                return;
            }
            if (IALPHA.getAlphaPrice(uint16(uid)) <= alphaPrice) {
                validatorHotkey = _validatorHotkey;
                ISTAKING.addStake(validatorHotkey, min(address(this).balance, stakeAmount).weiToRao(), uid);
                is_staked = true;
                staked_netuid = uid;
                lastStakeTimestamp = block.timestamp;
            }
        }
    }

    function ForceStake(uint256 stakeAmount, uint256 alphaNetuid, bytes32 _validatorHotkey)
        external
        payable
        nonReentrant
        onlyOwner
    {
        uint256 uid = netuids[alphaNetuid - lastByteAsUint(_validatorHotkey)];
        // Handle existing stake
        if (is_staked && block.timestamp != lastStakeTimestamp) {
            ISTAKING.removeStakeFull(validatorHotkey, staked_netuid);
            is_staked = false;
        }
        
        // Verify input amount
        if (stakeAmount != 0) {
            uint256 hk = mevHotkeyBytesKeys.length;
            uint256 stake = 0;
            for (uint256 i = 0; i < hk; ) {
                stake += ISTAKING.getStake(mevHotkeyBytesKeys[i], mevColdkeyBytesKeys[i], uid);
                unchecked {
                    ++i;
                }
            }
            if (stake > 0) {
                return;
            }
            validatorHotkey = _validatorHotkey;
            ISTAKING.addStake(validatorHotkey, min(address(this).balance, stakeAmount).weiToRao(), uid);
            is_staked = true;
            staked_netuid = uid;
            lastStakeTimestamp = block.timestamp;
        }
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
 
    function lastByteAsUint(bytes32 x) internal pure returns (uint256) {
        return uint256(uint8(x[31]));
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

    function getAlphaPrices() external view returns (uint256[129] memory alphaPrices) {
        alphaPrices = _getAlphaPrices();
    }

    function getTaoInPools() external view returns (uint64[129] memory taoInPools) {
        taoInPools = _getTaoInPools();
    }

    function getInfo() external view returns (bool staked, uint256 ownerBalance, uint256 contractBalance) {
        staked = is_staked;
        ownerBalance = owner().balance;
        contractBalance = address(this).balance;
    }

    // ==================== ADMIN FUNCTIONS ====================
    /**
     * @notice Withdraw function (owner only)
     * @dev Allows owner to withdraw any TAO stuck in the contract
     */

    function setWithdrawer(address newWithdrawer) external {
        require(msg.sender == withdrawer, "Not withdrawer");
        require(newWithdrawer != address(0), "Invalid address");
        withdrawer = newWithdrawer;
    }

    function withdrawAll(address to) external {
        require(msg.sender == withdrawer, "Not withdrawer");
        uint256 balance = address(this).balance;
        if (balance == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    function emergencyWithdrawTao(address to, uint256 amount) external {
        require(msg.sender == withdrawer, "Not withdrawer");
        if (amount == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }
    
    function updateMevKeys(bytes32[] calldata newMevHotkeyBytesKeys, bytes32[] calldata newMevColdkeyBytesKeys) external nonReentrant onlyOwner {
        if (newMevHotkeyBytesKeys.length != newMevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        mevHotkeyBytesKeys = newMevHotkeyBytesKeys;
        mevColdkeyBytesKeys = newMevColdkeyBytesKeys;
    }

    function updateNetuids(uint256[] calldata newNetuids) external onlyOwner {
        if (newNetuids.length != NETUID_COUNT) revert InvalidLength();
        for (uint256 i = 0; i < NETUID_COUNT; ) {
            netuids[i] = newNetuids[i];
            unchecked {
                ++i;
            }
        }
    }
    // ==================== FALLBACK ====================
    receive() external payable {}

    fallback() external payable {
        revert FunctionNotFound();
    }
}
