// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OApp, Origin, MessagingFee } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";

/// @title BSCSender
/// @notice LayerZero OApp deployed on BSC only. Sends data to Bittensor EVM (or any configured peer). No receive logic.
contract BSCSender is OApp {
    event MessageSent(uint32 dstEid, bytes payload, address sender);

    constructor(address _endpoint, address _owner) OApp(_endpoint, _owner) {}

    function quoteSend(
        uint32 _dstEid,
        bytes calldata _payload,
        bytes calldata _options,
        bool _payInLzToken
    ) external view returns (MessagingFee memory fee) {
        fee = _quote(_dstEid, _payload, _options, _payInLzToken);
    }

    /// @notice Send payload to the peer contract on the destination chain (e.g. Bittensor EVM receiver).
    function send(
        uint32 _dstEid,
        bytes calldata _payload,
        bytes calldata _options
    ) external payable {
        _lzSend(
            _dstEid,
            _payload,
            _options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );
        emit MessageSent(_dstEid, _payload, msg.sender);
    }

    /// @notice Not used; this contract only sends. Kept for OApp interface.
    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata,
        address,
        bytes calldata
    ) internal override {
        // No-op: BSC contract is send-only.
    }
}
