// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IStaking {
    function getStake(bytes32 hotkey, bytes32 coldkey, uint256 netuid) external view returns (uint256);
}

/**
 * @title Monitor
 * @notice Monitoring contract for staking TAO on Bittensor subnets
 * @dev Uses direct calls to precompile to avoid storage layout issues
 */
contract Monitor {
    address constant ISTAKING_ADDRESS = 0x0000000000000000000000000000000000000805;
    IStaking constant ISTAKING = IStaking(ISTAKING_ADDRESS);

    error LengthMismatch();

    function getStakedAmount(bytes32[] calldata hotkeys, bytes32[] calldata coldkeys)
        external
        view
        returns (uint256[129] memory amount)
    {
        if (hotkeys.length != coldkeys.length) revert LengthMismatch();

        for (uint16 netuid = 1; netuid < 129; netuid++) {
            uint256 sum = 0;
            for (uint256 i = 0; i < hotkeys.length; i++) {
                sum += ISTAKING.getStake(hotkeys[i], coldkeys[i], uint256(netuid));
            }
            amount[netuid] = sum;
        }
    }
}
