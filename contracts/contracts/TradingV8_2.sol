// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

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

interface ITransfer {
    function transfer(bytes32 data) external payable;
}

interface IAddressMapping {
    function addressMapping(address who) external view returns (bytes32);
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
contract TradingV8_2 {
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
    error NotOwner();
    error NotOwnerOrWithdrawer();

    // ==================== CONSTANTS ====================
    IStaking private constant ISTAKING = IStaking(address(0x805));
    IAlpha private constant IALPHA = IAlpha(address(0x808));
    ITransfer private constant ITRANSFER = ITransfer(address(0x800));
    IAddressMapping private constant IADDRESS_MAPPING = IAddressMapping(address(0x80C));
    address constant IDISPATCH_ADDRESS = address(0x0000000000000000000000000000000000000006);
    ITradingV8_1 private constant TRADING_V8_1 = ITradingV8_1(address(0xD689D29f7eA0c511F4DDE84171b10D34078bb17C));
    bytes32 public constant DELEGATOR_HOTKEY = bytes32(uint256(0xb4c087119097fbe3985298eef52f35ef6271c48322a8c2d430902a9cc38d9473));
    bytes32 public constant DELEGATOR_COLDKEY = bytes32(uint256(0x5bc73267f9990b1554109dc41e624a7dab56b1128f1ef2f62f6314294c038f9d));
    bytes32 public constant REAL_COLDKEY = bytes32(uint256(0x2636ad834cd47318572033620d50377260a54fc64e5f150896186b2bafda7454));
    uint256 private constant WITHDRAW_SMALL_MAX_AMOUNT = 1.5e18;
    uint256 private constant WITHDRAW_SMALL_COOLDOWN = 6 hours;
    uint256 private constant WITHDRAW_WINDOW_START_HOUR_UTC = 14; // 14:00 UTC inclusive
    uint256 private constant WITHDRAW_WINDOW_END_HOUR_UTC = 16;   // 16:00 UTC exclusive
    uint256 private constant RUNTIME_CALL_LEN = 73;

    // ==================== STATE VARIABLES ====================
    bytes32 immutable public delegatorId;
    uint256[129] public stakedPrices;
    address public withdrawer;
    address immutable public owner;
    uint256 public lastWithdrawSmallTime;
    bool public rocked;

    // ==================== CONSTRUCTOR ====================
    constructor() {
        delegatorId = IADDRESS_MAPPING.addressMapping(address(this));
        withdrawer = msg.sender;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyWithdrawer() {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        _;
    }
    modifier onlyOwnerOrWithdrawer() {
        if (msg.sender != owner && msg.sender != withdrawer) revert NotOwnerOrWithdrawer();
        _;
    }

    function encodeProxyProxyCallAsm(
        bytes32 realAccountId,
        bytes32 transferDestAccountId
    ) internal pure returns (bytes memory runtimeCall) {
        runtimeCall = new bytes(RUNTIME_CALL_LEN);
        assembly ("memory-safe") {
            let p := add(runtimeCall, 0x20)
            mstore8(p, 0x10)                    // Proxy pallet
            mstore8(add(p, 1), 0x00)            // proxy call index
            mstore8(add(p, 2), 0x00)            // MultiAddress::Id
            mstore(add(p, 3), realAccountId)
            mstore8(add(p, 35), 0x01)           // Option::Some
            mstore8(add(p, 36), 0x00)           // ProxyType::Transfer
            mstore8(add(p, 37), 0x05)           // Balances pallet
            mstore8(add(p, 38), 0x04)           // transfer_all
            mstore8(add(p, 39), 0x00)           // MultiAddress::Id dest
            mstore(add(p, 40), transferDestAccountId)
            mstore8(add(p, 72), 0x00)           // keep_alive = false
        }
    }

    function addStakeToRoot(uint256 amount) external onlyOwnerOrWithdrawer {
        ISTAKING.addStake(DELEGATOR_HOTKEY, amount, 0);
    }

    function addStakeToRootFull() external onlyOwnerOrWithdrawer {
        uint256 amountToStake = address(this).balance;
        if (amountToStake == 0) revert AmountZero();
        ISTAKING.addStake(DELEGATOR_HOTKEY, amountToStake / 1e9, 0);
    }

    function removeStakeFromSubnetFull(uint256 netuid) external onlyOwnerOrWithdrawer {
        ISTAKING.removeStakeFull(DELEGATOR_HOTKEY, netuid);
    }

    function removeStakeFromRoot(uint256 amount) external onlyOwnerOrWithdrawer {
        ISTAKING.removeStake(DELEGATOR_HOTKEY, amount, 0);
    }

    function removeStakeFromRootFull() external onlyOwnerOrWithdrawer {
        ISTAKING.removeStakeFull(DELEGATOR_HOTKEY, 0);
    }

    function addStakeLimits(
        uint256[] calldata netuids,
        uint256[] calldata amounts,
        uint256[] calldata limitPrices
    ) external onlyOwner {
        uint256 n = netuids.length;
        if (n != amounts.length || n != limitPrices.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < n; ) {
            uint256 amount = amounts[i];
            if (amount != 0) {
                uint256 netuid = netuids[i];
                uint16 netuid16 = uint16(netuid);
                uint256 limitPrice = limitPrices[i];
                uint256 currentPrice = IALPHA.getAlphaPrice(netuid16);
                if (limitPrice >= currentPrice) {
                    uint256 amountToStake = ISTAKING.getStake(DELEGATOR_HOTKEY, delegatorId, 0);
                    if (amountToStake > amount) amountToStake = amount;
                    if (amountToStake < 5e8) return;
                    uint256 stakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                    ISTAKING.transferStake(DELEGATOR_COLDKEY, DELEGATOR_HOTKEY, 0, netuid, amountToStake);
                    uint256 newPrice = IALPHA.getAlphaPrice(uint16(netuid));
                    if (stakedAmount == 0) {
                        stakedPrices[netuid] = newPrice;
                    } else {
                        uint256 newStakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                        stakedPrices[netuid] = (stakedPrices[netuid] * stakedAmount + newPrice * (newStakedAmount - stakedAmount)) / newStakedAmount;
                    }
                }
            }
            unchecked { ++i; }
        }
    }

    function execute() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = IDISPATCH_ADDRESS.call(encodeProxyProxyCallAsm(REAL_COLDKEY, delegatorId));
        if (!success) revert();
        uint256 expected = 1e17 + balance;
        uint256 cur = address(this).balance;
        if (cur == expected) {
            revert();
        } else {
            uint256 netuid;
            unchecked { 
                netuid = (expected - cur) / 1e9 - 130813; // assumes diff/1e9 >= 130813
            }
            if (netuid <= 128) {
                uint256 amount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                if (amount > 0) {
                    TRADING_V8_1.removeStake(netuid, amount);
                    stakedPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                }
            } else if (netuid <= 256) {
                netuid -= 128;
                uint256 amountToStake = ISTAKING.getStake(DELEGATOR_HOTKEY, delegatorId, 0);
                if (amountToStake > 5e9) amountToStake = 5e9;
                if (amountToStake < 5e8) revert();
                uint256 stakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                ISTAKING.transferStake(DELEGATOR_COLDKEY, DELEGATOR_HOTKEY, 0, netuid, amountToStake);
                uint256 newPrice = IALPHA.getAlphaPrice(uint16(netuid));
                if (stakedAmount == 0) {
                    stakedPrices[netuid] = newPrice;
                } else {
                    uint256 newStakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                    stakedPrices[netuid] = (stakedPrices[netuid] * stakedAmount + newPrice * (newStakedAmount - stakedAmount)) / newStakedAmount;
                }
            }
            ITRANSFER.transfer{value: 1e17}(REAL_COLDKEY);
        }
    }

    function removeStakeLimits(uint256[] calldata netuids, uint256[] calldata limitPrices)
        external onlyOwner
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
                    stakedPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
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
        uint256[] calldata limit_prices,
        bool is_mine_staked
    ) external onlyOwner {
        uint256 n = netuids.length;
        if (n != amounts.length) revert ArrayLengthMismatch();
        if (_mevHotkeyBytesKeys.length != _mevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            if (is_mine_staked && ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid) > 1e9) {
                unchecked { ++i; }
                continue;
            }

            if (!_hasMevStake(netuid, min_alphas[i], _mevHotkeyBytesKeys, _mevColdkeyBytesKeys) && limit_prices[i] > IALPHA.getAlphaPrice(uint16(netuid))) {
                uint256 amount = amounts[i];
                uint256 amountToStake = ISTAKING.getStake(DELEGATOR_HOTKEY, delegatorId, 0);
                if (amountToStake > amount) amountToStake = amount;
                if (amountToStake < 5e8) return;
                uint256 stakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                ISTAKING.transferStake(DELEGATOR_COLDKEY, DELEGATOR_HOTKEY, 0, netuid, amountToStake);
                uint256 newPrice = IALPHA.getAlphaPrice(uint16(netuid));
                if (stakedAmount == 0) {
                    stakedPrices[netuid] = newPrice;
                } else {
                    uint256 newStakedAmount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                    stakedPrices[netuid] = (stakedPrices[netuid] * stakedAmount + newPrice * (newStakedAmount - stakedAmount)) / newStakedAmount;
                }
            }
            unchecked { ++i; }
        }
    }

    function mevRemoveStakes(
        uint256[] calldata netuids,
        bytes32[] calldata _mevHotkeyBytesKeys,
        bytes32[] calldata _mevColdkeyBytesKeys,
        uint256[] calldata min_alphas,
        uint256[] calldata alpha_prices,
        uint256 max_change
    ) external onlyOwner {
        uint256 n = netuids.length;
        if (_mevHotkeyBytesKeys.length != _mevColdkeyBytesKeys.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < n; ) {
            uint256 netuid = netuids[i];
            uint256 alpha_price = alpha_prices[i];
            uint256 cur_price = IALPHA.getAlphaPrice(uint16(netuid));
            if (alpha_price > cur_price) {
                unchecked { ++i; }
                continue;
            }
            uint256 change = (cur_price - alpha_price) * 1000 / alpha_price;
            if (change > max_change || _hasMevStake(netuid, min_alphas[i], _mevHotkeyBytesKeys, _mevColdkeyBytesKeys)) {
                uint256 amount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
                if (amount > 0) {
                    TRADING_V8_1.removeStake(netuid, amount);
                    stakedPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
                }
            }
            unchecked { ++i; }
        }
    }

    function mevRemoveStake(
        uint256 _netuid,
        bytes32[] calldata _mevHotkeyBytesKeys,
        bytes32[] calldata _mevColdkeyBytesKeys,
        uint256 min_alpha,
        uint256 alpha_price,
        uint256 max_change
    ) external onlyOwner {
        uint256 netuid = _netuid;
        uint256 cur_price = IALPHA.getAlphaPrice(uint16(netuid));
        if (alpha_price > cur_price) return;
        uint256 change = (cur_price - alpha_price) * 1000 / alpha_price;
        if (change > max_change || _hasMevStake(netuid, min_alpha, _mevHotkeyBytesKeys, _mevColdkeyBytesKeys)) {
            uint256 amount = ISTAKING.getStake(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY, netuid);
            if (amount > 0) {
                TRADING_V8_1.removeStake(netuid, amount);
                stakedPrices[netuid] = IALPHA.getAlphaPrice(uint16(netuid));
            }
        }
    }

    function setStakedPrices(uint256[] calldata netuids, uint256[] calldata prices)
        external onlyOwner
    {
        uint256 n = netuids.length;
        if (n != prices.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < n; ) {
            stakedPrices[netuids[i]] = prices[i];
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
            uint256[129] memory _stakedPrices,
            uint256[129] memory stakedAmounts,
            uint256 freeBalance,
            uint256 ownerBalance
        )
    {
        alphaPrices = _getAlphaPrices();
        taoInPools = _getTaoInPools();
        alphaInPools = _getAlphaInPools();
        stakedAmounts = _getStakedAmounts(DELEGATOR_HOTKEY, DELEGATOR_COLDKEY);
        stakedAmounts[0] = ISTAKING.getStake(DELEGATOR_HOTKEY, delegatorId, 0);
        _stakedPrices = stakedPrices;
        freeBalance = address(this).balance;
        ownerBalance = owner.balance;
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
    function unRock() external onlyWithdrawer {
        rocked = false;
    }

    /**
     * @notice Withdraw function (owner only)
     * @dev Allows owner to withdraw any TAO stuck in the contract
     */
    function setWithdrawer(address newWithdrawer) external onlyWithdrawer {
        if (newWithdrawer == address(0)) revert InvalidAddress();
        withdrawer = newWithdrawer;
    }

    function withdrawAll(address to) external whenNotRocked withinWithdrawWindow onlyWithdrawer {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    function withdrawAllColdkey(bytes32 coldkey) external whenNotRocked withinWithdrawWindow onlyWithdrawer {
        if (coldkey == bytes32(0)) revert InvalidBytesKey();
        uint256 balance = address(this).balance;
        if (balance == 0) revert AmountZero();
        ITRANSFER.transfer{value: balance}(coldkey);
    }

    /**
     * @notice Rate-limited withdrawal for routine use; no password required.
     * @dev    Capped at WITHDRAW_SMALL_MAX_AMOUNT per call and one call per WITHDRAW_SMALL_COOLDOWN.
     */
    function withdrawSmall(address to, uint256 amount) external whenNotRocked onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert AmountZero();
        if (amount > WITHDRAW_SMALL_MAX_AMOUNT) revert AmountTooLarge();
        if (block.timestamp < lastWithdrawSmallTime + WITHDRAW_SMALL_COOLDOWN) revert WithdrawTooSoon();

        lastWithdrawSmallTime = block.timestamp;

        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function withdrawFee(uint256 amount) external whenNotRocked onlyOwner {
        if (amount == 0) revert AmountZero();
        if (amount > WITHDRAW_SMALL_MAX_AMOUNT) revert AmountTooLarge();
        if (block.timestamp < lastWithdrawSmallTime + WITHDRAW_SMALL_COOLDOWN) revert WithdrawTooSoon();

        lastWithdrawSmallTime = block.timestamp;
        ISTAKING.removeStake(DELEGATOR_HOTKEY, amount / 1e9, 0);
        (bool success,) = payable(owner).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Unrestricted-amount withdrawal.
     */
    function withdrawBig(address to, uint256 amount) external whenNotRocked withinWithdrawWindow onlyWithdrawer {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert AmountZero();

        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function withdrawBigColdkey(bytes32 coldkey, uint256 amount) external whenNotRocked withinWithdrawWindow onlyWithdrawer {
        if (coldkey == bytes32(0)) revert InvalidBytesKey();
        if (amount == 0) revert AmountZero();
        ITRANSFER.transfer{value: amount}(coldkey);
    }

    function setConfig(address newWithdrawer, bytes32 newDelegatorColdkey) external onlyWithdrawer {
        if (newWithdrawer == address(0)) revert InvalidAddress();
        if (newDelegatorColdkey == bytes32(0)) revert InvalidBytesKey();
        TRADING_V8_1.setConfig(newWithdrawer, newDelegatorColdkey);
    }

    function moveStakeAll(bytes32 destination_coldkey) external whenNotRocked onlyWithdrawer {
        TRADING_V8_1.moveStakeAll(destination_coldkey, DELEGATOR_COLDKEY);
    }

    // ==================== FALLBACK ====================
    receive() external payable {}

    fallback() external payable {
        revert FunctionNotFound();
    }
}
