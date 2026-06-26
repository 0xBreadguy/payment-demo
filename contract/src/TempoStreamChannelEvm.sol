// SPDX-License-Identifier: MIT
// Payment-demo extension of TempoStreamChannel with Permit2 and EIP-3009 relayer funding.
pragma solidity ^0.8.20;

import { ITIP20 } from "./interfaces/ITIP20.sol";
import { IERC3009 } from "./interfaces/IERC3009.sol";
import { ITempoStreamChannel } from "./interfaces/ITempoStreamChannel.sol";
import { ECDSA } from "solady/utils/ECDSA.sol";
import { EIP712 } from "solady/utils/EIP712.sol";
import { IPermit2, ISignatureTransfer } from "../lib/tempo-std/src/interfaces/IPermit2.sol";
import { StdContracts } from "../lib/tempo-std/src/StdContracts.sol";

/**
 * @title TempoStreamChannelEvm
 * @notice Unidirectional payment channel escrow with gasless funding support.
 * @dev Extends the base TempoStreamChannel with Permit2 and EIP-3009 funding flows.
 *      Users can fund channels via ERC-20 approvals, Permit2 signatures, or
 *      receiveWithAuthorization-compatible tokens such as USDC.
 */
contract TempoStreamChannelEvm is ITempoStreamChannel, EIP712 {

    // --- Constants ---

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(bytes32 channelId,uint128 cumulativeAmount)");

    uint64 public constant CLOSE_GRACE_PERIOD = 15 minutes;

    bytes32 public constant OPEN_CHANNEL_WITNESS_TYPEHASH =
        keccak256("OpenChannelWitness(address payee,bytes32 salt,address authorizedSigner)");

    string internal constant OPEN_CHANNEL_WITNESS_TYPE_STRING =
        "OpenChannelWitness witness)"
        "OpenChannelWitness(address payee,bytes32 salt,address authorizedSigner)"
        "TokenPermissions(address token,uint256 amount)";

    bytes32 public constant TOP_UP_WITNESS_TYPEHASH =
        keccak256("TopUpWitness(bytes32 channelId)");

    string internal constant TOP_UP_WITNESS_TYPE_STRING =
        "TopUpWitness witness)"
        "TokenPermissions(address token,uint256 amount)"
        "TopUpWitness(bytes32 channelId)";

    // --- State ---

    mapping(bytes32 => Channel) public channels;

    // --- EIP-712 Domain ---

    function _domainNameAndVersion()
        internal
        pure
        override
        returns (string memory name, string memory version)
    {
        name = "Tempo Stream Channel";
        version = "1";
    }

    // --- External Functions ---

    /**
     * @notice Open a new payment channel with escrowed funds (legacy approve flow).
     */
    function open(
        address payee,
        address token,
        uint128 deposit,
        bytes32 salt,
        address authorizedSigner
    )
        external
        override
        returns (bytes32 channelId)
    {
        if (payee == address(0)) {
            revert InvalidPayee();
        }
        if (deposit == 0) {
            revert ZeroDeposit();
        }

        channelId = computeChannelId(msg.sender, payee, token, salt, authorizedSigner);

        if (channels[channelId].payer != address(0) || channels[channelId].finalized) {
            revert ChannelAlreadyExists();
        }

        channels[channelId] = Channel({
            payer: msg.sender,
            payee: payee,
            token: token,
            authorizedSigner: authorizedSigner,
            deposit: deposit,
            settled: 0,
            closeRequestedAt: 0,
            finalized: false
        });

        bool success = ITIP20(token).transferFrom(msg.sender, address(this), deposit);
        if (!success) {
            revert TransferFailed();
        }

        emit ChannelOpened(channelId, msg.sender, payee, token, authorizedSigner, salt, deposit);
    }

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

        bytes32 witness = keccak256(
            abi.encode(OPEN_CHANNEL_WITNESS_TYPEHASH, payee, salt, authorizedSigner)
        );

        StdContracts.PERMIT2.permitWitnessTransferFrom(
            ISignatureTransfer.PermitTransferFrom({
                permitted: ISignatureTransfer.TokenPermissions({
                    token: token,
                    amount: deposit
                }),
                nonce: nonce,
                deadline: deadline
            }),
            ISignatureTransfer.SignatureTransferDetails({
                to: address(this),
                requestedAmount: deposit
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

        IERC3009(token).receiveWithAuthorization(
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
     * @notice Settle funds using a signed voucher.
     */
    function settle(
        bytes32 channelId,
        uint128 cumulativeAmount,
        bytes calldata signature
    )
        external
        override
    {
        Channel storage channel = channels[channelId];

        if (channel.finalized) {
            revert ChannelFinalized();
        }
        if (channel.payer == address(0)) {
            revert ChannelNotFound();
        }
        if (msg.sender != channel.payee) {
            revert NotPayee();
        }
        if (cumulativeAmount > channel.deposit) {
            revert AmountExceedsDeposit();
        }
        if (cumulativeAmount <= channel.settled) {
            revert AmountNotIncreasing();
        }

        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, cumulativeAmount));
        bytes32 digest = _hashTypedData(structHash);
        address signer = ECDSA.recoverCalldata(digest, signature);

        address expectedSigner =
            channel.authorizedSigner != address(0) ? channel.authorizedSigner : channel.payer;

        if (signer != expectedSigner) {
            revert InvalidSignature();
        }

        uint128 delta = cumulativeAmount - channel.settled;
        channel.settled = cumulativeAmount;

        bool success = ITIP20(channel.token).transfer(channel.payee, delta);
        if (!success) {
            revert TransferFailed();
        }

        emit Settled(
            channelId, channel.payer, channel.payee, cumulativeAmount, delta, channel.settled
        );
    }

    /**
     * @notice Add more funds to a channel (legacy approve flow).
     */
    function topUp(bytes32 channelId, uint256 additionalDeposit) external override {
        Channel storage channel = channels[channelId];

        if (channel.finalized) {
            revert ChannelFinalized();
        }
        if (channel.payer == address(0)) {
            revert ChannelNotFound();
        }
        if (msg.sender != channel.payer) {
            revert NotPayer();
        }

        if (additionalDeposit == 0) {
            revert ZeroDeposit();
        }

        if (additionalDeposit > type(uint128).max - channel.deposit) {
            revert DepositOverflow();
        }
        channel.deposit += uint128(additionalDeposit);

        bool success =
            ITIP20(channel.token).transferFrom(msg.sender, address(this), additionalDeposit);
        if (!success) {
            revert TransferFailed();
        }

        if (channel.closeRequestedAt != 0) {
            channel.closeRequestedAt = 0;
            emit CloseRequestCancelled(channelId, channel.payer, channel.payee);
        }

        emit TopUp(channelId, channel.payer, channel.payee, additionalDeposit, channel.deposit);
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

        StdContracts.PERMIT2.permitWitnessTransferFrom(
            ISignatureTransfer.PermitTransferFrom({
                permitted: ISignatureTransfer.TokenPermissions({
                    token: channel.token,
                    amount: additionalDeposit
                }),
                nonce: nonce,
                deadline: deadline
            }),
            ISignatureTransfer.SignatureTransferDetails({
                to: address(this),
                requestedAmount: additionalDeposit
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

        IERC3009(channel.token).receiveWithAuthorization(
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

    /**
     * @notice Request early channel closure.
     */
    function requestClose(bytes32 channelId) external override {
        Channel storage channel = channels[channelId];

        if (channel.finalized) {
            revert ChannelFinalized();
        }
        if (channel.payer == address(0)) {
            revert ChannelNotFound();
        }
        if (msg.sender != channel.payer) {
            revert NotPayer();
        }

        if (channel.closeRequestedAt == 0) {
            channel.closeRequestedAt = uint64(block.timestamp);
            emit CloseRequested(
                channelId, channel.payer, channel.payee, block.timestamp + CLOSE_GRACE_PERIOD
            );
        }
    }

    /**
     * @notice Close a channel immediately (server only).
     */
    function close(
        bytes32 channelId,
        uint128 cumulativeAmount,
        bytes calldata signature
    )
        external
        override
    {
        Channel storage channel = channels[channelId];

        if (channel.finalized) {
            revert ChannelFinalized();
        }
        if (channel.payer == address(0)) {
            revert ChannelNotFound();
        }
        if (msg.sender != channel.payee) {
            revert NotPayee();
        }

        address token = channel.token;
        address payer = channel.payer;
        address payee = channel.payee;
        uint128 deposit = channel.deposit;

        uint128 settledAmount = channel.settled;
        uint128 delta = 0;

        if (cumulativeAmount > settledAmount) {
            if (cumulativeAmount > channel.deposit) {
                revert AmountExceedsDeposit();
            }

            bytes32 structHash =
                keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, cumulativeAmount));
            bytes32 digest = _hashTypedData(structHash);
            address signer = ECDSA.recoverCalldata(digest, signature);

            address expectedSigner =
                channel.authorizedSigner != address(0) ? channel.authorizedSigner : channel.payer;

            if (signer != expectedSigner) {
                revert InvalidSignature();
            }

            delta = cumulativeAmount - settledAmount;
            settledAmount = cumulativeAmount;
        }

        uint128 refund = deposit - settledAmount;
        _clearAndFinalize(channelId);

        if (delta > 0) {
            bool success = ITIP20(token).transfer(payee, delta);
            if (!success) {
                revert TransferFailed();
            }
        }

        if (refund > 0) {
            bool success = ITIP20(token).transfer(payer, refund);
            if (!success) {
                revert TransferFailed();
            }
        }

        emit ChannelClosed(channelId, payer, payee, settledAmount, refund);
    }

    /**
     * @notice Withdraw remaining funds after close grace period.
     */
    function withdraw(bytes32 channelId) external override {
        Channel storage channel = channels[channelId];

        if (channel.finalized) {
            revert ChannelFinalized();
        }
        if (channel.payer == address(0)) {
            revert ChannelNotFound();
        }
        if (msg.sender != channel.payer) {
            revert NotPayer();
        }

        address token = channel.token;
        address payer = channel.payer;
        address payee = channel.payee;
        uint128 deposit = channel.deposit;
        uint128 settledAmount = channel.settled;

        bool closeGracePassed = channel.closeRequestedAt != 0
            && block.timestamp >= channel.closeRequestedAt + CLOSE_GRACE_PERIOD;

        if (!closeGracePassed) {
            revert CloseNotReady();
        }

        uint128 refund = deposit - settledAmount;
        _clearAndFinalize(channelId);

        if (refund > 0) {
            bool success = ITIP20(token).transfer(payer, refund);
            if (!success) {
                revert TransferFailed();
            }
        }

        emit ChannelExpired(channelId, payer, payee);
        emit ChannelClosed(channelId, payer, payee, settledAmount, refund);
    }

    // --- View Functions ---

    function getChannel(bytes32 channelId) external view override returns (Channel memory) {
        return channels[channelId];
    }

    function computeChannelId(
        address payer,
        address payee,
        address token,
        bytes32 salt,
        address authorizedSigner
    )
        public
        view
        override
        returns (bytes32)
    {
        return keccak256(
            abi.encode(payer, payee, token, salt, authorizedSigner, address(this), block.chainid)
        );
    }

    function domainSeparator() external view override returns (bytes32) {
        return _domainSeparator();
    }

    function getVoucherDigest(
        bytes32 channelId,
        uint128 cumulativeAmount
    )
        external
        view
        override
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, cumulativeAmount));
        return _hashTypedData(structHash);
    }

    function getChannelsBatch(bytes32[] calldata channelIds)
        external
        view
        override
        returns (Channel[] memory channelStates)
    {
        uint256 length = channelIds.length;
        channelStates = new Channel[](length);

        for (uint256 i = 0; i < length; ++i) {
            channelStates[i] = channels[channelIds[i]];
        }
    }

    // --- Internal Functions ---

    function _clearAndFinalize(bytes32 channelId) internal {
        delete channels[channelId];
        channels[channelId].finalized = true;
    }

}
