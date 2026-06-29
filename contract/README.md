# Contract Workspace Provenance

This workspace keeps the Solidity files required to build the payment-demo
session escrow. The retained Tempo-derived files are pinned here as plain files
because this repository is a payment-demo application, not the upstream Tempo
contract repository.

## Upstream Pins

| Source | Upstream repository | Upstream ref | Upstream path | Local path |
| --- | --- | --- | --- | --- |
| Tempo reference contracts | `tempoxyz/tempo` | `943c4314234bb6b3b9eff02a1c8a41414660b1fa` | `tips/ref-impls/src` | `contract/src` subset |
| Tempo Standard Library | `tempoxyz/tempo-std` | `91dfcf70289b07ec6409f289917c6d4c9ce7e73e` | repository root | `contract/lib/tempo-std` subset |

The `tempo-std` ref above is the submodule gitlink recorded at
`tips/ref-impls/lib/tempo-std` in
`tempoxyz/tempo@943c4314234bb6b3b9eff02a1c8a41414660b1fa`.

## Source Classification

### Retained Tempo Reference Sources

The following files match
`tempoxyz/tempo@943c4314234bb6b3b9eff02a1c8a41414660b1fa:tips/ref-impls/src`
byte-for-byte:

| Local path | Classification |
| --- | --- |
| `src/interfaces/ITIP20.sol` | Vendored unmodified |
| `src/interfaces/ITempoStreamChannel.sol` | Derived Tempo reference interface |

The base stream-channel implementation and interface are retained as local
derived sources:

| Local path | Classification | Notes |
| --- | --- | --- |
| `src/interfaces/ITempoStreamChannel.sol` | Derived Tempo reference interface | Aligns `topUp` and nonce errors with the EVM session contract surface used by the demo. |
| `src/TempoStreamChannel.sol` | Derived Tempo reference implementation | Omits the upstream TIP-20-only token validation in `open(...)`, uses the EVM session voucher domain, and retains finalized channel records. |

### First-Party Payment Demo Sources

| Local path | Classification | Notes |
| --- | --- | --- |
| `src/TempoStreamChannelEvm.sol` | First-party extension | Inherits `TempoStreamChannel` and adds Permit2 and EIP-3009 relayer funding entry points. |
| `src/interfaces/IERC3009.sol` | First-party support interface | Minimal `receiveWithAuthorization` interface used by `TempoStreamChannelEvm.sol`. |
| `foundry.toml` | First-party workspace config | Local Foundry configuration for this repository. |

## Vendored Libraries

| Local path | Source | License files |
| --- | --- | --- |
| `lib/tempo-std` | Pruned subset of `tempoxyz/tempo-std@91dfcf70289b07ec6409f289917c6d4c9ce7e73e` | `lib/tempo-std/LICENSE-MIT`, `lib/tempo-std/LICENSE-APACHE` |
| `lib/forge-std` | Foundry Standard Library vendored dependency | `lib/forge-std/LICENSE-MIT`, `lib/forge-std/LICENSE-APACHE` |
| `lib/solady` | Solady vendored dependency | `lib/solady/LICENSE.txt` |

The retained `tempo-std` subset is limited to `StdContracts.sol`,
`IPermit2.sol`, and the `ICreateX` / `IMulticall3` interfaces imported by
`StdContracts.sol`.

`contract/cache` and `contract/out` are Foundry generated artifacts and are not
the source of truth for provenance.

## Verification Notes

The retained Tempo reference interface files can be verified from a local clone
of `tempoxyz/tempo` by comparing Git blob hashes:

```bash
git -C <path-to-tempo-clone> rev-parse \
  943c4314234bb6b3b9eff02a1c8a41414660b1fa:tips/ref-impls/src/interfaces/ITIP20.sol
git hash-object contract/src/interfaces/ITIP20.sol
```

For `src/interfaces/ITempoStreamChannel.sol` and `src/TempoStreamChannel.sol`,
compare against the same upstream ref while accounting for the documented local
EVM session changes.

For `tempo-std`, compare each retained source file under `contract/lib/tempo-std`
against `tempoxyz/tempo-std@91dfcf70289b07ec6409f289917c6d4c9ce7e73e`.
