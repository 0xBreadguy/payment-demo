import assert from "node:assert/strict";
import test from "node:test";

const {
  megaethTestnet,
  megaethTxUrl,
} = (await import(new URL("./chain.ts", import.meta.url).href)) as typeof import("./chain");

test("uses Blockscout as the MegaETH testnet explorer", () => {
  assert.equal(
    megaethTestnet.blockExplorers.default.url,
    "https://megaeth-testnet-v2.blockscout.com",
  );
});

test("builds Blockscout transaction URLs", () => {
  assert.equal(
    megaethTxUrl("0x7d71109c98a212470c0531d1abffa7a64efac485c8bd4a9063dad140e47ec7f0"),
    "https://megaeth-testnet-v2.blockscout.com/tx/0x7d71109c98a212470c0531d1abffa7a64efac485c8bd4a9063dad140e47ec7f0",
  );
});
