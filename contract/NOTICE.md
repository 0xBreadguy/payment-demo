# Third-Party Notices for `contract/`

This contract workspace includes code vendored from Tempo projects and other
Solidity libraries.

## Tempo Reference Contracts

Files under `contract/src` are partially derived from:

- Repository: `https://github.com/tempoxyz/tempo`
- Ref: `943c4314234bb6b3b9eff02a1c8a41414660b1fa`
- Upstream path: `tips/ref-impls/src`
- License: MIT OR Apache-2.0

The full upstream license texts are included in:

- `contract/LICENSE-MIT`
- `contract/LICENSE-APACHE`

Only the payment-demo escrow dependency subset is retained locally. The
provenance table in `contract/README.md` identifies the exact retained files.

## Tempo Standard Library

`contract/lib/tempo-std` is vendored from:

- Repository: `https://github.com/tempoxyz/tempo-std`
- Ref: `91dfcf70289b07ec6409f289917c6d4c9ce7e73e`
- License: MIT OR Apache-2.0

The directory includes its upstream license texts:

- `contract/lib/tempo-std/LICENSE-MIT`
- `contract/lib/tempo-std/LICENSE-APACHE`

## Other Vendored Dependencies

`contract/lib/forge-std` is the Foundry Standard Library vendored dependency and
includes its own license files:

- `contract/lib/forge-std/LICENSE-MIT`
- `contract/lib/forge-std/LICENSE-APACHE`

`contract/lib/solady` is the Solady vendored dependency and includes its own
license file:

- `contract/lib/solady/LICENSE.txt`
