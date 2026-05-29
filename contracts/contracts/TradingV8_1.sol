// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IStaking {
    function transferStake(
        bytes32 destination_coldkey,
        bytes32 hotkey,
        uint256 origin_netuid,
        uint256 destination_netuid,
        uint256 amount
    ) external;
    function getStake(bytes32 hotkey, bytes32 coldkey, uint256 netuid) external view returns (uint256);
}

/**
 * @title TradingV8_1
 * @notice Trading contract for staking TAO on Bittensor subnets
 * @dev Uses direct calls to precompile to avoid storage layout issues
 */
contract TradingV8_1 is ReentrancyGuard {
    address private constant ISTAKING_ADDRESS = 0x0000000000000000000000000000000000000805;
    IStaking private constant ISTAKING = IStaking(ISTAKING_ADDRESS);
    bytes32 public constant DELEGATOR_BYTES_KEY = bytes32(uint256(0xb4c087119097fbe3985298eef52f35ef6271c48322a8c2d430902a9cc38d9473));

    address public withdrawer;
    bytes32 private DELEGATOR_COLDKEY;
    address public owner;

    constructor() {
        withdrawer = msg.sender;
        owner = msg.sender;
    }

    error NotWithdrawerOrOwner();
    error NotWithdrawer();
    error InvalidAddress();
    error AmountZero();
    error TransferFailed();
    error NotOwner();

    function removeStake(
        uint256 netuid,
        uint256 amount
    ) external nonReentrant {
        if (msg.sender != withdrawer && msg.sender != owner) revert NotWithdrawerOrOwner();
        ISTAKING.transferStake(DELEGATOR_COLDKEY, DELEGATOR_BYTES_KEY, netuid, 0, amount);
    }

    function moveStakeAll(bytes32 destination_coldkey, bytes32 origin_coldkey) external nonReentrant {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        for (uint256 netuid = 1; netuid < 129; ) {
            uint256 amount = ISTAKING.getStake(DELEGATOR_BYTES_KEY, origin_coldkey, netuid);
            if (amount > 0) {
                ISTAKING.transferStake(destination_coldkey, DELEGATOR_BYTES_KEY, netuid, netuid, amount);
            }
            unchecked {
                ++netuid;
            }
        }
    }

    function setConfig(
        address newWithdrawer,
        bytes32 newDelegatorColdkey
    ) external nonReentrant {
        if (msg.sender != withdrawer) revert NotWithdrawer();
        if (newWithdrawer == address(0)) revert InvalidAddress();
        withdrawer = newWithdrawer;
        DELEGATOR_COLDKEY = newDelegatorColdkey;
    }

    function withdrawAll() external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        uint256 balance = address(this).balance;
        if (balance == 0) revert AmountZero();

        (bool success,) = payable(withdrawer).call{value: balance}("");
        if (!success) revert TransferFailed();
    }
}
