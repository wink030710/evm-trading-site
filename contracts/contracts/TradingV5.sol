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

interface TradingV4 {
    function getInfo()
        external
        view
        returns (
            uint256[129] memory prices,
            uint64[129] memory taoInPool, 
            bool[129] memory staked,
            uint256[129] memory stakedPrices
        );
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
 * @title TradingV5
 * @notice Trading contract for staking TAO on Bittensor subnets
 * @dev Uses direct calls to precompile to avoid storage layout issues
 */
contract TradingV5 is Ownable, ReentrancyGuard {
    using AlphaMath for uint256;

    // ==================== ERRORS ====================
    error AmountZero();
    error TransferFailed();
    error FunctionNotFound();
    error InvalidNetuid();
    error ArrayLengthMismatch();
    error NotWithdrawer();
    error InvalidAddress();

    // ==================== CONSTANTS ====================
    address constant ISTAKING_ADDRESS = 0x0000000000000000000000000000000000000805;
    IStaking constant ISTAKING = IStaking(ISTAKING_ADDRESS);
    address constant IALPHA_ADDRESS = 0x0000000000000000000000000000000000000808;
    IAlpha constant IALPHA = IAlpha(IALPHA_ADDRESS);
    TradingV4 constant TRADING_V4 = TradingV4(address(0xa41677c076DABE0fcBbfCa30A6c7b39D4b2aCd02));
    bytes32 public constant validatorHotkey = bytes32(uint256(0xb4c087119097fbe3985298eef52f35ef6271c48322a8c2d430902a9cc38d9473));
    // ==================== STATE VARIABLES ====================
    bool[129] public is_staked;
    uint256[129] public staked_prices;
    uint256[129] public lastStakeTimestamp;
    uint256 public priceUpdateThreshold = 1100; //10% threshold
    address public withdrawer = 0x0000000000000000000000000000000000000000;
    bytes32 public taobot = bytes32(uint256(0x56a9aee6291bd03ab6d36d4d13e2bebae7cd403518066c72fba1b417d6ddd748));
    bytes32 public mev_coldkey = bytes32(uint256(0xdc33b0fd5d2ef4647db921764da8787a2b9f27efff6755b1007eb35e55eaf709));

    // ==================== CONSTRUCTOR ====================
    constructor() Ownable() {
        for (uint256 i = 0; i < 129; i++) {
            is_staked[i] = false;
            staked_prices[i] = 0;
            lastStakeTimestamp[i] = 0;
        }
        withdrawer = msg.sender;
    }

    function force_remove_stake(uint256 alphaNetuid)
        external
        payable
        nonReentrant
        onlyOwner
    {
        _requireValidNetuid(alphaNetuid);
        if (is_staked[alphaNetuid] && block.timestamp != lastStakeTimestamp[alphaNetuid]) {
            ISTAKING.removeStakeFull(validatorHotkey, alphaNetuid);
            is_staked[alphaNetuid] = false;
        }
    }

    function force_remove_stake(uint256[] calldata alphaNetuids)
        external
        payable
        nonReentrant
        onlyOwner
    {
        for (uint256 i = 0; i < alphaNetuids.length; i++) {
            uint256 alphaNetuid = alphaNetuids[i];
            _requireValidNetuid(alphaNetuid);
            if (is_staked[alphaNetuid] && block.timestamp != lastStakeTimestamp[alphaNetuid]) {
                ISTAKING.removeStakeFull(validatorHotkey, alphaNetuid);
                is_staked[alphaNetuid] = false;
            }
        }
    }

    function remove_stake(uint256 alphaNetuid)
        external
        payable
        nonReentrant
        onlyOwner
    {
        _requireValidNetuid(alphaNetuid);
        if (is_staked[alphaNetuid] && block.timestamp != lastStakeTimestamp[alphaNetuid]) {
            uint256 mev_staking = ISTAKING.getStake(taobot, mev_coldkey, alphaNetuid);
            if (mev_staking > 0 || IALPHA.getAlphaPrice(uint16(alphaNetuid)) > staked_prices[alphaNetuid] * priceUpdateThreshold / 1000) {
                ISTAKING.removeStakeFull(validatorHotkey, alphaNetuid);
                is_staked[alphaNetuid] = false;
            }
        }
    }

    function remove_stake(uint256 alphaNetuid, bytes32[] calldata hotkeys, bytes32[] calldata coldkeys)
        external
        payable
        nonReentrant
        onlyOwner
    {
        _requireValidNetuid(alphaNetuid);
        if (hotkeys.length != coldkeys.length) revert ArrayLengthMismatch();
        if (is_staked[alphaNetuid] && block.timestamp != lastStakeTimestamp[alphaNetuid]) {
            uint256 totalStaking = 0;
            for (uint256 i = 0; i < hotkeys.length; i++) {
                totalStaking += ISTAKING.getStake(hotkeys[i], coldkeys[i], alphaNetuid);
            }
            if (totalStaking > 0 || IALPHA.getAlphaPrice(uint16(alphaNetuid)) > staked_prices[alphaNetuid] * priceUpdateThreshold / 1000) {
                ISTAKING.removeStakeFull(validatorHotkey, alphaNetuid);
                is_staked[alphaNetuid] = false;
            }
        }
    }

    function remove_stakes(uint256[] calldata alphaNetuids)
        external
        payable
        nonReentrant
        onlyOwner
    {
        for (uint256 i = 0; i < alphaNetuids.length; i++) {
            uint256 alphaNetuid = alphaNetuids[i];
            _requireValidNetuid(alphaNetuid);
            if (is_staked[alphaNetuid] && block.timestamp != lastStakeTimestamp[alphaNetuid]) {
                uint256 mev_staking = ISTAKING.getStake(taobot, mev_coldkey, alphaNetuid);
                if (mev_staking > 0 || IALPHA.getAlphaPrice(uint16(alphaNetuid)) > staked_prices[alphaNetuid] * priceUpdateThreshold / 1000) {
                    ISTAKING.removeStakeFull(validatorHotkey, alphaNetuid);
                    is_staked[alphaNetuid] = false;
                }
            }
        }
    }

    function add_stake(uint256 stakeAmount, uint256 alphaNetuid)
        external
        payable
        nonReentrant
        onlyOwner
    {
        _requireValidNetuid(alphaNetuid);
        if (stakeAmount != 0 && !is_staked[alphaNetuid]) {
            uint256 mev_staking = ISTAKING.getStake(taobot, mev_coldkey, alphaNetuid);
            if (mev_staking > 0)
                return;
            ISTAKING.addStake(validatorHotkey, min(address(this).balance, stakeAmount).weiToRao(), alphaNetuid);
            is_staked[alphaNetuid] = true;
            staked_prices[alphaNetuid] = IALPHA.getAlphaPrice(uint16(alphaNetuid));
            lastStakeTimestamp[alphaNetuid] = block.timestamp;
        }
    }

    function add_stakes(uint256 stakeAmount, uint256[] calldata alphaNetuids)
        external
        payable
        nonReentrant
        onlyOwner
    {
        if (stakeAmount == 0) {
            return;
        }

        for (uint256 i = 0; i < alphaNetuids.length; i++) {
            uint256 alphaNetuid = alphaNetuids[i];
            _requireValidNetuid(alphaNetuid);
            if (!is_staked[alphaNetuid]) {
                uint256 amountToStake = min(address(this).balance, stakeAmount);
                uint256 mev_staking = ISTAKING.getStake(taobot, mev_coldkey, alphaNetuid);
                if (mev_staking > 0)
                    continue;
                if (amountToStake == 0)
                    return;
                ISTAKING.addStake(validatorHotkey, amountToStake.weiToRao(), alphaNetuid);
                is_staked[alphaNetuid] = true;
                staked_prices[alphaNetuid] = IALPHA.getAlphaPrice(uint16(alphaNetuid));
                lastStakeTimestamp[alphaNetuid] = block.timestamp;
            }
        }
    }

    function increase_stake(uint256 stakeAmount, uint256 alphaNetuid)
        external
        payable
        nonReentrant
        onlyOwner
    {
        _requireValidNetuid(alphaNetuid);
        if (stakeAmount != 0 && is_staked[alphaNetuid]) {
            ISTAKING.addStake(validatorHotkey, min(address(this).balance, stakeAmount).weiToRao(), alphaNetuid);
            staked_prices[alphaNetuid] = IALPHA.getAlphaPrice(uint16(alphaNetuid));
            lastStakeTimestamp[alphaNetuid] = block.timestamp;
        }
    }

    function increase_stakes(uint256 stakeAmount, uint256[] calldata alphaNetuids)
        external
        payable
        nonReentrant
        onlyOwner
    {
        if (stakeAmount == 0) return;
        for (uint256 i = 0; i < alphaNetuids.length; i++) {
            uint256 alphaNetuid = alphaNetuids[i];
            _requireValidNetuid(alphaNetuid);
            if (is_staked[alphaNetuid]) {
                uint256 amountToStake = min(address(this).balance, stakeAmount);
                if (amountToStake == 0)
                    return;
                ISTAKING.addStake(validatorHotkey, amountToStake.weiToRao(), alphaNetuid);
                staked_prices[alphaNetuid] = IALPHA.getAlphaPrice(uint16(alphaNetuid));
                lastStakeTimestamp[alphaNetuid] = block.timestamp;
            }
        }
    }

    function reset(uint256 alphaNetuid)
        external
        payable
        nonReentrant
        onlyOwner
    {
        _requireValidNetuid(alphaNetuid);
        staked_prices[alphaNetuid] = IALPHA.getAlphaPrice(uint16(alphaNetuid));
        lastStakeTimestamp[alphaNetuid] = block.timestamp;
    }

    function updatePriceThreshold(uint256 threshold) external onlyOwner {
        priceUpdateThreshold = threshold;
    }

    function getStakedPrices() external view returns (uint256[129] memory) {
        return staked_prices;
    }
    
    function getTimestamps() external view returns (uint256[129] memory) {
        return lastStakeTimestamp;
    }

    function getIsStaked() external view returns (bool[129] memory) {
        return is_staked;
    }

    function getInfo()
        external
        view
        returns (
            uint256[129] memory prices,
            uint64[129] memory taoInPool, 
            bool[129] memory staked,
            uint256[129] memory stakedPrices
        )
    {
        prices[0] = 1e18;
        taoInPool[0] = 1;
        for (uint16 netuid = 1; netuid < 129; netuid++) {
            try IALPHA.getAlphaPrice(netuid) returns (uint256 price) {
                prices[netuid] = price;
            } catch {
                prices[netuid] = 0;
            }
        }

        for (uint16 netuid = 1; netuid < 129; netuid++) {
            try IALPHA.getTaoInPool(netuid) returns (uint64 tao) {
                taoInPool[netuid] = tao;
            } catch {
                taoInPool[netuid] = 0;
            }
        }

        staked = is_staked;
        stakedPrices = staked_prices;
    }

    function getStakedAmount(bytes32 validatorColdkey) external
        view
        returns (uint256[129] memory amount) {
        for (uint16 netuid = 1; netuid < 129; netuid++) {
            amount[netuid] = ISTAKING.getStake(validatorHotkey, validatorColdkey, uint256(netuid));
        }
    }

    function getInfo_Old()
        external
        view
        returns (
            uint256[129] memory prices,
            uint64[129] memory taoInPool,
            bool[129] memory staked_old,
            bool[129] memory staked,
            uint256[129] memory stakedPrices_old,
            uint256[129] memory stakedPrices
        )
    {
        (prices, taoInPool, staked_old, stakedPrices_old) = TRADING_V4.getInfo();
        staked = is_staked;
        stakedPrices = staked_prices;
    }
    
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _requireValidNetuid(uint256 alphaNetuid) private pure {
        if (alphaNetuid >= 129) revert InvalidNetuid();
    }

    // ==================== ADMIN FUNCTIONS ====================
    /**
     * @notice Withdraw function (owner only)
     * @dev Allows owner to withdraw any TAO stuck in the contract
     */
    function setWithdrawer(address newWithdrawer) external {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (newWithdrawer == address(0)) revert InvalidAddress();
        withdrawer = newWithdrawer;
    }

    function withdrawAll(address to) external {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    function emergencyWithdrawTao(address to, uint256 amount) external {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function updateTaobot(bytes32 newTaobot) external onlyOwner {
        taobot = newTaobot;
    }
    
    function updateMevColdkey(bytes32 newMevColdkey) external onlyOwner {
        mev_coldkey = newMevColdkey;
    }
    
    // ==================== FALLBACK ====================
    receive() external payable {}

    fallback() external payable {
        revert FunctionNotFound();
    }
}
