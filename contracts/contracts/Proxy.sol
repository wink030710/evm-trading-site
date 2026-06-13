// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

uint8 constant PROXY_PALLET = 16;
uint8 constant PROXY_CALL_PROXY = 0;
uint8 constant BALANCES_PALLET = 5;
uint8 constant TRANSFER_ALL_CALL_INDEX = 4;
uint8 constant PROXY_TYPE_TRANSFER = 0;

address constant ISUBTENSOR_BALANCE_TRANSFER_ADDRESS = 0x0000000000000000000000000000000000000800;
address constant IADDRESS_MAPPING_ADDRESS = 0x000000000000000000000000000000000000080C;
address constant IDISPATCH_ADDRESS = 0x0000000000000000000000000000000000000006;

interface ISubtensorBalanceTransfer {
    function transfer(bytes32 data) external payable;
}

interface IAddressMapping {
    function addressMapping(address who) external view returns (bytes32);
}

contract Proxy is ReentrancyGuard {

    ISubtensorBalanceTransfer private constant ISUBTENSOR_BALANCE_TRANSFER = ISubtensorBalanceTransfer(ISUBTENSOR_BALANCE_TRANSFER_ADDRESS);
    IAddressMapping private constant IADDRESS_MAPPING = IAddressMapping(IADDRESS_MAPPING_ADDRESS);
    bytes32 public constant REAL_COLDKEY = bytes32(uint256(0x2636ad834cd47318572033620d50377260a54fc64e5f150896186b2bafda7454));
    uint256 private constant RUNTIME_CALL_LEN = 73;
    
    uint256 public uid0;
    uint256 public uid1;
    bytes32 immutable public delegatorId;
    address immutable public owner;
    
    constructor() {
        delegatorId = IADDRESS_MAPPING.addressMapping(address(this));
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert();
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

    function execute() external onlyOwner{
        uint256 balance = address(this).balance;
        
        (bool success, ) = IDISPATCH_ADDRESS.call(encodeProxyProxyCallAsm(REAL_COLDKEY, delegatorId));
        if (!success) revert();
        uint256 expected = 1e17 + balance;
        uint256 cur = address(this).balance;
        if (cur == expected) {
            revert();
        } else {
            uint256 num;
            unchecked { 
                num = (expected - cur) / 1e9 - 150615; // assumes diff/1e9 >= 150615
                uid0 = num & 127; // num % 128
                uid1 = num >> 7; // num / 128
            }
            ISUBTENSOR_BALANCE_TRANSFER.transfer{value: 1e17}(REAL_COLDKEY);
        }
    }

    function transfer() external payable {
        ISUBTENSOR_BALANCE_TRANSFER.transfer{value: address(this).balance}(REAL_COLDKEY);
    }
}