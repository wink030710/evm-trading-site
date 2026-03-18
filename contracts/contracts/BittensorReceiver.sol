// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OApp, Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";

/// @title BittensorReceiver
/// @notice LayerZero OApp deployed on Bittensor EVM only. Receives data from BSC (or any configured peer) and saves it on-chain.
contract BittensorReceiver is OApp {
    struct ReceivedMessage {
        uint32 srcEid;
        bytes32 sender;
        bytes payload;
        uint256 blockNumber;
        uint256 index;
    }

    /// @notice All received messages, appended in order.
    ReceivedMessage[] public messages;

    /// @notice Number of messages received per source chain.
    mapping(uint32 srcEid => uint256) public countBySourceEid;

    event MessageReceived(uint256 indexed index, uint32 srcEid, bytes32 sender, uint256 blockNumber);

    constructor(address _endpoint, address _owner) OApp(_endpoint, _owner) {}

    /// @notice Receive path: persist payload and metadata on-chain.
    function _lzReceive(
        Origin calldata _origin,
        bytes32,
        bytes calldata _message,
        address,
        bytes calldata
    ) internal override {
        uint256 index = messages.length;
        messages.push(
            ReceivedMessage({
                srcEid: _origin.srcEid,
                sender: _origin.sender,
                payload: _message,
                blockNumber: block.number,
                index: index
            })
        );
        countBySourceEid[_origin.srcEid] += 1;
        emit MessageReceived(index, _origin.srcEid, _origin.sender, block.number);
    }

    /// @notice Total number of received messages.
    function messageCount() external view returns (uint256) {
        return messages.length;
    }

    /// @notice Get a message by index.
    function getMessage(uint256 _index) external view returns (ReceivedMessage memory) {
        require(_index < messages.length, "BittensorReceiver: index out of bounds");
        return messages[_index];
    }
}
