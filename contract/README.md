# Contract Workspace Provenance

This workspace vendors Tempo reference contracts and supporting Foundry
dependencies as plain files. The vendored sources are intentionally pinned here
because this repository is a payment-demo application, not the upstream Tempo
contract repository.

## Upstream Pins

| Source | Upstream repository | Upstream ref | Upstream path | Local path |
| --- | --- | --- | --- | --- |
| Tempo reference contracts | `tempoxyz/tempo` | `943c4314234bb6b3b9eff02a1c8a41414660b1fa` | `tips/ref-impls/src` | `contract/src` |
| Tempo Standard Library | `tempoxyz/tempo-std` | `91dfcf70289b07ec6409f289917c6d4c9ce7e73e` | repository root | `contract/lib/tempo-std` |

The `tempo-std` ref above is the submodule gitlink recorded at
`tips/ref-impls/lib/tempo-std` in
`tempoxyz/tempo@943c4314234bb6b3b9eff02a1c8a41414660b1fa`.

## Source Classification

### Vendored Unmodified from Tempo

The following files match
`tempoxyz/tempo@943c4314234bb6b3b9eff02a1c8a41414660b1fa:tips/ref-impls/src`
byte-for-byte:

| Local path | Classification |
| --- | --- |
| `src/AccountKeychain.sol` | Vendored unmodified |
| `src/FeeAMM.sol` | Vendored unmodified |
| `src/FeeManager.sol` | Vendored unmodified |
| `src/Nonce.sol` | Vendored unmodified |
| `src/StablecoinDEX.sol` | Vendored unmodified |
| `src/TIP20.sol` | Vendored unmodified |
| `src/TIP20Factory.sol` | Vendored unmodified |
| `src/TIP403Registry.sol` | Vendored unmodified |
| `src/TempoUtilities.sol` | Vendored unmodified |
| `src/ValidatorConfig.sol` | Vendored unmodified |
| `src/ValidatorConfigV2.sol` | Vendored unmodified |
| `src/abstracts/TIP20RolesAuth.sol` | Vendored unmodified |
| `src/interfaces/IAccountKeychain.sol` | Vendored unmodified |
| `src/interfaces/IERC20.sol` | Vendored unmodified |
| `src/interfaces/IFeeAMM.sol` | Vendored unmodified |
| `src/interfaces/IFeeManager.sol` | Vendored unmodified |
| `src/interfaces/INonce.sol` | Vendored unmodified |
| `src/interfaces/IStablecoinDEX.sol` | Vendored unmodified |
| `src/interfaces/ITIP20.sol` | Vendored unmodified |
| `src/interfaces/ITIP20Factory.sol` | Vendored unmodified |
| `src/interfaces/ITIP20RolesAuth.sol` | Vendored unmodified |
| `src/interfaces/ITIP403Registry.sol` | Vendored unmodified |
| `src/interfaces/ITempoStreamChannel.sol` | Vendored unmodified |
| `src/interfaces/IValidatorConfig.sol` | Vendored unmodified |
| `src/interfaces/IValidatorConfigV2.sol` | Vendored unmodified |

### Vendored with Local Changes

| Local path | Upstream path | Local changes |
| --- | --- | --- |
| `src/TempoStreamChannel.sol` | `tips/ref-impls/src/TempoStreamChannel.sol` | Removes the `TempoUtilities` import and the `TempoUtilities.isTIP20(token)` check in `open(...)`, so the demo escrow can accept ERC-20-like payment tokens that are not Tempo TIP-20 precompile tokens. |

### First-Party Payment Demo Sources

| Local path | Classification | Notes |
| --- | --- | --- |
| `src/TempoStreamChannelEvm.sol` | First-party extension | Extends the Tempo stream-channel semantics with Permit2 and EIP-3009 relayer funding entry points. |
| `src/interfaces/IERC3009.sol` | First-party support interface | Minimal `receiveWithAuthorization` interface used by `TempoStreamChannelEvm.sol`. |
| `foundry.toml` | First-party workspace config | Local Foundry configuration for this repository. |

## Vendored Libraries

| Local path | Source | License files |
| --- | --- | --- |
| `lib/tempo-std` | `tempoxyz/tempo-std@91dfcf70289b07ec6409f289917c6d4c9ce7e73e` | `lib/tempo-std/LICENSE-MIT`, `lib/tempo-std/LICENSE-APACHE` |
| `lib/forge-std` | Foundry Standard Library vendored dependency | `lib/forge-std/LICENSE-MIT`, `lib/forge-std/LICENSE-APACHE` |
| `lib/solady` | Solady vendored dependency | `lib/solady/LICENSE.txt` |

`contract/cache` and `contract/out` are Foundry generated artifacts and are not
the source of truth for provenance.

## Verification Notes

The source classification above was verified from a local clone of
`tempoxyz/tempo` by comparing Git blob hashes:

```bash
git -C <path-to-tempo-clone> rev-parse \
  943c4314234bb6b3b9eff02a1c8a41414660b1fa:tips/ref-impls/src/TIP20.sol
git hash-object contract/src/TIP20.sol
```

For `tempo-std`, the 35 tracked files under `contract/lib/tempo-std` match
`tempoxyz/tempo-std@91dfcf70289b07ec6409f289917c6d4c9ce7e73e` exactly.
