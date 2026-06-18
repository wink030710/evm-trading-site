// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

address constant ISUBTENSOR_BALANCE_TRANSFER_ADDRESS = 0x0000000000000000000000000000000000000800;
address constant IADDRESS_MAPPING_ADDRESS = 0x000000000000000000000000000000000000080C;
address constant IDISPATCH_ADDRESS = 0x0000000000000000000000000000000000000006;

interface IAddressMapping {
    function addressMapping(address who) external view returns (bytes32);
}

interface ISubtensorBalanceTransfer {
    function transfer(bytes32 data) external payable;
}


contract TransferStake {
    IAddressMapping private constant IADDRESS_MAPPING = IAddressMapping(IADDRESS_MAPPING_ADDRESS);
    ISubtensorBalanceTransfer private constant ISUBTENSOR_BALANCE_TRANSFER = ISubtensorBalanceTransfer(ISUBTENSOR_BALANCE_TRANSFER_ADDRESS);
    bytes32 public constant DELEGATOR_HOTKEY = bytes32(uint256(0xb4c087119097fbe3985298eef52f35ef6271c48322a8c2d430902a9cc38d9473));
    bytes32 public constant DELEGATOR_COLDKEY = bytes32(uint256(0x5bc73267f9990b1554109dc41e624a7dab56b1128f1ef2f62f6314294c038f9d));

    bytes32 public constant REAL_COLDKEY = bytes32(uint256(0x2636ad834cd47318572033620d50377260a54fc64e5f150896186b2bafda7454));
    uint256 private constant RUNTIME_CALL_LEN = 73;
    
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

    function encodeTransferStake(
        bytes32 destinationColdkey,
        bytes32 hotkey,
        uint16 originNetuid,
        uint16 destinationNetuid,
        uint64 alphaAmount
    ) internal pure returns (bytes memory out) {
        out = new bytes(78);
        assembly ("memory-safe") {
            let p := add(out, 0x20)

            mstore8(p, 7)
            mstore8(add(p, 1), 86)

            mstore(add(p, 2), destinationColdkey)
            mstore(add(p, 34), hotkey)

            mstore8(add(p, 66), originNetuid)
            mstore8(add(p, 67), shr(8, originNetuid))

            mstore8(add(p, 68), destinationNetuid)
            mstore8(add(p, 69), shr(8, destinationNetuid))

            let a := alphaAmount
            mstore8(add(p, 70), a)
            mstore8(add(p, 71), shr(8, a))
            mstore8(add(p, 72), shr(16, a))
            mstore8(add(p, 73), shr(24, a))
            mstore8(add(p, 74), shr(32, a))
            mstore8(add(p, 75), shr(40, a))
            mstore8(add(p, 76), shr(48, a))
            mstore8(add(p, 77), shr(56, a))
        }
    }

    function execute() external onlyOwner{
        (bool success, ) = IDISPATCH_ADDRESS.call(encodeTransferStake(DELEGATOR_COLDKEY, DELEGATOR_HOTKEY, 0, 64, 1e8));
        if (!success) revert();
    }

    function transfer() external payable {
        ISUBTENSOR_BALANCE_TRANSFER.transfer{value: address(this).balance}(REAL_COLDKEY);
    }

    function transfer_asm() external payable {
        ISUBTENSOR_BALANCE_TRANSFER.transfer{value: address(this).balance}(REAL_COLDKEY);
    }
}