// SPDX-License-Identifier: MIT
// Payment-demo support interface for EIP-3009 receiveWithAuthorization funding.
pragma solidity ^0.8.20;

/// @title IERC3009
/// @notice Minimal EIP-3009 interface for Circle-style gasless transfers.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    )
        external;
}
