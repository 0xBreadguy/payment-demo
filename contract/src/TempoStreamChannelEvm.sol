// SPDX-License-Identifier: MIT
// Payment-demo extension of TempoStreamChannel with Permit2 and EIP-3009 relayer funding.
pragma solidity ^0.8.20;

import { StdContracts } from "../lib/tempo-std/src/StdContracts.sol";
import { ISignatureTransfer } from "../lib/tempo-std/src/interfaces/IPermit2.sol";
import { TempoStreamChannel } from "./TempoStreamChannel.sol";
import { IERC3009 } from "./interfaces/IERC3009.sol";

/**
 * @title TempoStreamChannelEvm
 * @notice Unidirectional payment channel escrow with gasless funding support.
 * @dev Extends TempoStreamChannel with Permit2 and EIP-3009 funding flows.
 *      Users can fund channels via ERC-20 approvals, Permit2 signatures, or
 *      receiveWithAuthorization-compatible tokens such as USDC.
 */
contract TempoStreamChannelEvm is TempoStreamChannel {

    // --- Constants ---

    bytes32 public constant CHANNEL_OPEN_WITNESS_TYPEHASH =
        keccak256("ChannelOpenWitness(address payee,bytes32 salt,address authorizedSigner)");

    string internal constant CHANNEL_OPEN_WITNESS_TYPE_STRING = "ChannelOpenWitness witness)"
        "ChannelOpenWitness(address payee,bytes32 salt,address authorizedSigner)"
        "TokenPermissions(address token,uint256 amount)";

    bytes32 public constant CHANNEL_TOP_UP_WITNESS_TYPEHASH =
        keccak256("ChannelTopUpWitness(bytes32 channelId)");

    string internal constant CHANNEL_TOP_UP_WITNESS_TYPE_STRING =
        "ChannelTopUpWitness witness)"
        "ChannelTopUpWitness(bytes32 channelId)"
        "TokenPermissions(address token,uint256 amount)";

    // --- External Functions ---

    /**
     * @notice Open a new payment channel using Permit2 witness signature transfer.
     * @dev The payer must have previously approved the Permit2 contract for the token.
     *      Any relayer may submit this transaction on behalf of the payer.
     *      The Permit2 signature includes a witness hash over (payee, salt, authorizedSigner)
     *      to prevent the signature from being used with different channel parameters.
     * @param payee Address authorized to withdraw (server)
     * @param token TIP-20 token address
     * @param deposit Amount to deposit
     * @param salt Random salt for channel ID generation
     * @param authorizedSigner Address authorized to sign vouchers (0 = use payer)
     * @param from Address that funds the channel (signs Permit2 off-chain)
     * @param nonce Permit2 nonce (must be unused for the payer)
     * @param deadline Permit2 signature deadline (block.timestamp must be <= deadline)
     * @param signature Permit2 PermitWitnessTransferFrom EIP-712 signature from payer
     * @return channelId The unique channel identifier
     */
    function openWithPermit2(
        address payee,
        address token,
        uint128 deposit,
        bytes32 salt,
        address authorizedSigner,
        address from,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    )
        external
        returns (bytes32 channelId)
    {
        if (payee == address(0)) {
            revert InvalidPayee();
        }
        if (deposit == 0) {
            revert ZeroDeposit();
        }

        channelId = computeChannelId(from, payee, token, salt, authorizedSigner);

        if (channels[channelId].payer != address(0) || channels[channelId].finalized) {
            revert ChannelAlreadyExists();
        }

        channels[channelId] = Channel({
            payer: from,
            payee: payee,
            token: token,
            authorizedSigner: authorizedSigner,
            deposit: deposit,
            settled: 0,
            closeRequestedAt: 0,
            finalized: false
        });

        bytes32 witness =
            keccak256(abi.encode(CHANNEL_OPEN_WITNESS_TYPEHASH, payee, salt, authorizedSigner));

        StdContracts.PERMIT2
            .permitWitnessTransferFrom(
                ISignatureTransfer.PermitTransferFrom({
                    permitted: ISignatureTransfer.TokenPermissions({
                        token: token, amount: deposit
                    }),
                    nonce: nonce,
                    deadline: deadline
                }),
                ISignatureTransfer.SignatureTransferDetails({
                    to: address(this), requestedAmount: deposit
                }),
                from,
                witness,
                CHANNEL_OPEN_WITNESS_TYPE_STRING,
                signature
            );

        emit ChannelOpened(channelId, from, payee, token, authorizedSigner, salt, deposit);
    }

    /**
     * @notice Open a new payment channel using EIP-3009 receiveWithAuthorization.
     * @dev `from` signs the authorization and any relayer may submit the transaction.
     *      The EIP-3009 nonce must equal
     *      keccak256(abi.encode(from, payee, token, salt, authorizedSigner)).
     */
    function openWithAuthorization(
        address payee,
        address token,
        uint128 deposit,
        bytes32 salt,
        address authorizedSigner,
        address from,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    )
        external
        returns (bytes32 channelId)
    {
        if (payee == address(0)) {
            revert InvalidPayee();
        }
        if (deposit == 0) {
            revert ZeroDeposit();
        }

        bytes32 expectedNonce = keccak256(abi.encode(from, payee, token, salt, authorizedSigner));
        if (nonce != expectedNonce) {
            revert NonceMismatch();
        }

        channelId = computeChannelId(from, payee, token, salt, authorizedSigner);

        if (channels[channelId].payer != address(0) || channels[channelId].finalized) {
            revert ChannelAlreadyExists();
        }

        channels[channelId] = Channel({
            payer: from,
            payee: payee,
            token: token,
            authorizedSigner: authorizedSigner,
            deposit: deposit,
            settled: 0,
            closeRequestedAt: 0,
            finalized: false
        });

        IERC3009(token)
            .receiveWithAuthorization(
                from,
                address(this),
                deposit,
                validAfter,
                validBefore,
                nonce,
                signature
            );

        emit ChannelOpened(channelId, from, payee, token, authorizedSigner, salt, deposit);
    }

    /**
     * @notice Add more funds to a channel using Permit2 witness signature transfer.
     * @dev The payer signs a Permit2 witness signature off-chain, any relayer may submit.
     *      The witness binds the signature to this specific channelId.
     * @param channelId The channel to top up
     * @param additionalDeposit Amount to add
     * @param from Address that funds the top-up (signs Permit2 off-chain)
     * @param nonce Permit2 nonce (must be unused for the payer)
     * @param deadline Permit2 signature deadline
     * @param signature Permit2 PermitWitnessTransferFrom EIP-712 signature from payer
     */
    function topUpWithPermit2(
        bytes32 channelId,
        uint128 additionalDeposit,
        address from,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    )
        external
    {
        Channel storage channel = channels[channelId];

        if (channel.finalized) {
            revert ChannelFinalized();
        }
        if (channel.payer == address(0)) {
            revert ChannelNotFound();
        }
        if (from != channel.payer) {
            revert NotPayer();
        }

        if (additionalDeposit == 0) {
            revert ZeroDeposit();
        }

        if (additionalDeposit > type(uint128).max - channel.deposit) {
            revert DepositOverflow();
        }
        channel.deposit += additionalDeposit;

        bytes32 witness = keccak256(abi.encode(CHANNEL_TOP_UP_WITNESS_TYPEHASH, channelId));

        StdContracts.PERMIT2
            .permitWitnessTransferFrom(
                ISignatureTransfer.PermitTransferFrom({
                    permitted: ISignatureTransfer.TokenPermissions({
                        token: channel.token, amount: additionalDeposit
                    }),
                    nonce: nonce,
                    deadline: deadline
                }),
                ISignatureTransfer.SignatureTransferDetails({
                    to: address(this), requestedAmount: additionalDeposit
                }),
                from,
                witness,
                CHANNEL_TOP_UP_WITNESS_TYPE_STRING,
                signature
            );

        if (channel.closeRequestedAt != 0) {
            channel.closeRequestedAt = 0;
            emit CloseRequestCancelled(channelId, channel.payer, channel.payee);
        }

        emit TopUp(channelId, channel.payer, channel.payee, additionalDeposit, channel.deposit);
    }

    /**
     * @notice Add more funds using EIP-3009 receiveWithAuthorization.
     * @dev Channel payer signs the authorization and any relayer may submit it.
     *      The EIP-3009 nonce must equal
     *      keccak256(abi.encode(channelId, additionalDeposit, from, topUpSalt)).
     */
    function topUpWithAuthorization(
        bytes32 channelId,
        uint128 additionalDeposit,
        address from,
        bytes32 topUpSalt,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    )
        external
    {
        Channel storage channel = channels[channelId];

        if (channel.finalized) {
            revert ChannelFinalized();
        }
        if (channel.payer == address(0)) {
            revert ChannelNotFound();
        }
        if (from != channel.payer) {
            revert NotPayer();
        }
        if (additionalDeposit == 0) {
            revert ZeroDeposit();
        }

        if (additionalDeposit > type(uint128).max - channel.deposit) {
            revert DepositOverflow();
        }
        bytes32 expectedNonce =
            keccak256(abi.encode(channelId, additionalDeposit, from, topUpSalt));
        if (nonce != expectedNonce) {
            revert NonceMismatch();
        }

        channel.deposit += additionalDeposit;

        IERC3009(channel.token)
            .receiveWithAuthorization(
                from,
                address(this),
                additionalDeposit,
                validAfter,
                validBefore,
                nonce,
                signature
            );

        if (channel.closeRequestedAt != 0) {
            channel.closeRequestedAt = 0;
            emit CloseRequestCancelled(channelId, channel.payer, channel.payee);
        }

        emit TopUp(channelId, channel.payer, channel.payee, additionalDeposit, channel.deposit);
    }

}
