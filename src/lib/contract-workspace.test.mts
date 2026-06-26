import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function listFiles(root: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }

  if (statSync(root).isDirectory()) {
    walk(root);
  }

  return files.sort();
}

test("contract workspace only keeps the deployed escrow dependency closure", () => {
  assert.deepEqual(listFiles(path.join(repoRoot, "contract/src")), [
    "TempoStreamChannel.sol",
    "TempoStreamChannelEvm.sol",
    "interfaces/IERC3009.sol",
    "interfaces/ITIP20.sol",
    "interfaces/ITempoStreamChannel.sol",
  ]);

  assert.deepEqual(listFiles(path.join(repoRoot, "contract/lib/tempo-std")), [
    "LICENSE-APACHE",
    "LICENSE-MIT",
    "src/StdContracts.sol",
    "src/interfaces/ICreateX.sol",
    "src/interfaces/IMulticall3.sol",
    "src/interfaces/IPermit2.sol",
  ]);
});

test("TempoStreamChannelEvm inherits the shared stream-channel implementation", () => {
  const evmSource = readFileSync(
    path.join(repoRoot, "contract/src/TempoStreamChannelEvm.sol"),
    "utf8",
  );

  assert.match(
    evmSource,
    /import\s+\{\s*TempoStreamChannel\s*\}\s+from\s+"\.\/TempoStreamChannel\.sol";/,
  );
  assert.match(
    evmSource,
    /contract\s+TempoStreamChannelEvm\s+is\s+TempoStreamChannel\s*\{/,
  );
  assert.doesNotMatch(evmSource, /function\s+settle\s*\(/);
  assert.doesNotMatch(evmSource, /function\s+close\s*\(/);
  assert.doesNotMatch(evmSource, /function\s+withdraw\s*\(/);
});
