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

    bytes32 public constant OPEN_CHANNEL_WITNESS_TYPEHASH =
        keccak256("OpenChannelWitness(address payee,bytes32 salt,address authorizedSigner)");

    string internal constant OPEN_CHANNEL_WITNESS_TYPE_STRING = "OpenChannelWitness witness)"
        "OpenChannelWitness(address payee,bytes32 salt,address authorizedSigner)"
        "TokenPermissions(address token,uint256 amount)";

    bytes32 public constant TOP_UP_WITNESS_TYPEHASH = keccak256("TopUpWitness(bytes32 channelId)");

    string internal constant TOP_UP_WITNESS_TYPE_STRING = "TopUpWitness witness)"
        "TokenPermissions(address token,uint256 amount)" "TopUpWitness(bytes32 channelId)";

    // --- External Functions ---

    /**
     * @notice Open a new payment channel using Permit2 witness signature transfer.
     * @dev The payer must have previously approved the Permit2 contract for the token.
     *      Any relayer may submit this transaction on behalf of the payer.
     *      The Permit2 signature includes a witness hash over (payee, salt, authorizedSigner)
     *      to prevent the signature from being used with different channel parameters.
     * @param payer Address that funds the channel (signs Permit2 off-chain)
     * @param payee Address authorized to withdraw (server)
     * @param token TIP-20 token address
     * @param deposit Amount to deposit
     * @param salt Random salt for channel ID generation
     * @param authorizedSigner Address authorized to sign vouchers (0 = use payer)
     * @param nonce Permit2 nonce (must be unused for the payer)
     * @param deadline Permit2 signature deadline (block.timestamp must be <= deadline)
     * @param permit2Signature Permit2 PermitWitnessTransferFrom EIP-712 signature from payer
     * @return channelId The unique channel identifier
     */
    function openWithPermit2(
        address payer,
        address payee,
        address token,
        uint128 deposit,
        bytes32 salt,
        address authorizedSigner,
        uint256 nonce,
        uint256 deadline,
        bytes calldata permit2Signature
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

        channelId = computeChannelId(payer, payee, token, salt, authorizedSigner);

        if (channels[channelId].payer != address(0) || channels[channelId].finalized) {
            revert ChannelAlreadyExists();
        }

        channels[channelId] = Channel({
            payer: payer,
            payee: payee,
            token: token,
            authorizedSigner: authorizedSigner,
            deposit: deposit,
            settled: 0,
            closeRequestedAt: 0,
            finalized: false
        });

        bytes32 witness =
            keccak256(abi.encode(OPEN_CHANNEL_WITNESS_TYPEHASH, payee, salt, authorizedSigner));

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
                payer,
                witness,
                OPEN_CHANNEL_WITNESS_TYPE_STRING,
                permit2Signature
            );

        emit ChannelOpened(channelId, payer, payee, token, authorizedSigner, salt, deposit);
    }

    /**
     * @notice Open a new payment channel using EIP-3009 receiveWithAuthorization.
     * @dev `payer` signs the authorization and any relayer may submit the transaction.
     *      The EIP-3009 nonce is derived as keccak256(payee, salt, authorizedSigner),
     *      binding the signature to these channel parameters and preventing misuse.
     *      The payer MUST use the same nonce derivation when signing the authorization.
     */
    function openWithReceiveAuthorization(
        address payer,
        address payee,
        address token,
        uint128 deposit,
        bytes32 salt,
        address authorizedSigner,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata authorizationSignature
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

        channelId = computeChannelId(payer, payee, token, salt, authorizedSigner);

        if (channels[channelId].payer != address(0) || channels[channelId].finalized) {
            revert ChannelAlreadyExists();
        }

        channels[channelId] = Channel({
            payer: payer,
            payee: payee,
            token: token,
            authorizedSigner: authorizedSigner,
            deposit: deposit,
            settled: 0,
            closeRequestedAt: 0,
            finalized: false
        });

        bytes32 nonce = keccak256(abi.encode(payee, salt, authorizedSigner));

        IERC3009(token)
            .receiveWithAuthorization(
                payer,
                address(this),
                deposit,
                validAfter,
                validBefore,
                nonce,
                authorizationSignature
            );

        emit ChannelOpened(channelId, payer, payee, token, authorizedSigner, salt, deposit);
    }

    /**
     * @notice Add more funds to a channel using Permit2 witness signature transfer.
     * @dev The payer signs a Permit2 witness signature off-chain, any relayer may submit.
     *      The witness binds the signature to this specific channelId.
     * @param channelId The channel to top up
     * @param additionalDeposit Amount to add
     * @param nonce Permit2 nonce (must be unused for the payer)
     * @param deadline Permit2 signature deadline
     * @param permit2Signature Permit2 PermitWitnessTransferFrom EIP-712 signature from payer
     */
    function topUpWithPermit2(
        bytes32 channelId,
        uint256 additionalDeposit,
        uint256 nonce,
        uint256 deadline,
        bytes calldata permit2Signature
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

        if (additionalDeposit == 0) {
            revert ZeroDeposit();
        }

        if (additionalDeposit > type(uint128).max - channel.deposit) {
            revert DepositOverflow();
        }
        channel.deposit += uint128(additionalDeposit);

        bytes32 witness = keccak256(abi.encode(TOP_UP_WITNESS_TYPEHASH, channelId));

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
                channel.payer,
                witness,
                TOP_UP_WITNESS_TYPE_STRING,
                permit2Signature
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
     *      The EIP-3009 nonce is derived as keccak256(channelId, topUpNonceSalt),
     *      binding the signature to this specific channel. The topUpNonceSalt allows
     *      multiple top-ups to the same channel (each needs a unique EIP-3009 nonce).
     */
    function topUpWithReceiveAuthorization(
        bytes32 channelId,
        uint256 additionalDeposit,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 topUpNonceSalt,
        bytes calldata authorizationSignature
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
        if (additionalDeposit == 0) {
            revert ZeroDeposit();
        }

        if (additionalDeposit > type(uint128).max - channel.deposit) {
            revert DepositOverflow();
        }
        channel.deposit += uint128(additionalDeposit);

        bytes32 nonce = keccak256(abi.encode(channelId, topUpNonceSalt));

        IERC3009(channel.token)
            .receiveWithAuthorization(
                channel.payer,
                address(this),
                additionalDeposit,
                validAfter,
                validBefore,
                nonce,
                authorizationSignature
            );

        if (channel.closeRequestedAt != 0) {
            channel.closeRequestedAt = 0;
            emit CloseRequestCancelled(channelId, channel.payer, channel.payee);
        }

        emit TopUp(channelId, channel.payer, channel.payee, additionalDeposit, channel.deposit);
    }

}
