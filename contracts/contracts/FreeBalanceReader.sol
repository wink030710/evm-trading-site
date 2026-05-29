// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title FreeBalanceReader
/// @notice Reads System.Account.data.free for a Substrate account via the
///         storage-query precompile at 0x...806.
///
/// Storage key layout for System.Account (a Blake2_128Concat map):
///   twox128("System") ++ twox128("Account") ++ blake2_128(accountId) ++ accountId
///
/// The 32-byte twox128 prefix is constant and hardcoded below. The per-account
/// suffix (blake2_128(accountId) ++ accountId) is 48 bytes and is passed in,
/// because Blake2-128 is not generally available as a cheap EVM op. Compute it
/// off-chain (see the companion Python/JS) and pass the 48-byte blob.
contract FreeBalanceReader {
    address constant STORAGE_QUERY = 0x0000000000000000000000000000000000000807;

    // twox128("System") ++ twox128("Account")
    bytes constant PREFIX =
        hex"26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9";

    /// @param keySuffix  blake2_128(accountId) ++ accountId  (16 + 32 = 48 bytes)
    /// @return free      the free balance (u128) as a uint256
    function freeBalance(bytes calldata keySuffix) external view returns (uint256 free) {
        require(keySuffix.length == 48, "suffix must be 48 bytes");

        // Full storage key = PREFIX ++ keySuffix
        bytes memory key = bytes.concat(PREFIX, keySuffix);

        // Call the precompile with the raw key as calldata.
        (bool ok, bytes memory ret) = STORAGE_QUERY.staticcall(key);
        require(ok, "storage query reverted");

        // Empty return => account doesn't exist => balance 0.
        if (ret.length == 0) {
            return 0;
        }

        // AccountInfo SCALE layout (all little-endian):
        //   nonce(u32) consumers(u32) providers(u32) sufficients(u32)  -> 16 bytes
        //   data.free(u128)                                            -> offset 16
        require(ret.length >= 32, "unexpected AccountInfo length");
        free = _decodeU128LE(ret, 16);
    }

    /// @dev Decode a little-endian u128 starting at `offset` in `data`.
    function _decodeU128LE(bytes memory data, uint256 offset)
        internal
        pure
        returns (uint256 value)
    {
        for (uint256 i = 0; i < 16; i++) {
            value |= uint256(uint8(data[offset + i])) << (8 * i);
        }
    }

    /// @notice Returns the full raw SCALE bytes if you want to decode off-chain.
    function rawAccountInfo(bytes calldata keySuffix)
        external
        view
        returns (bytes memory)
    {
        require(keySuffix.length == 48, "suffix must be 48 bytes");
        bytes memory key = bytes.concat(PREFIX, keySuffix);
        (bool ok, bytes memory ret) = STORAGE_QUERY.staticcall(key);
        require(ok, "storage query reverted");
        return ret;
    }
}
