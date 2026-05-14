import assert from "node:assert/strict";
import test from "node:test";
import { Challenge } from "mppx";

const browserClientModuleUrl = new URL(
  "./mpp-gasless-browser-client.ts",
  import.meta.url,
).href;
const permit20ModuleUrl = new URL("./mpp-permit20.ts", import.meta.url).href;

test("parses permit20 gasless MPP charge challenges", async () => {
  const { parseMppGaslessChallenge } =
    (await import(browserClientModuleUrl)) as typeof import("./mpp-gasless-browser-client");
  const { permit20ChargeMethod } =
    (await import(permit20ModuleUrl)) as typeof import("./mpp-permit20");

  const challenge = Challenge.fromMethod(permit20ChargeMethod, {
    id: "challenge-id",
    realm: "localhost:3000",
    request: {
      amount: "1.5",
      chainId: 6343,
      currency: "0x2222222222222222222222222222222222222222",
      decimals: 18,
      recipient: "0x3333333333333333333333333333333333333333",
      spender: "0x1111111111111111111111111111111111111111",
      tokenName: "USDm",
      tokenVersion: "1",
    },
  });

  const parsed = parseMppGaslessChallenge(
    new Response(null, {
      status: 402,
      headers: {
        "WWW-Authenticate": Challenge.serialize(challenge),
      },
    }),
  );

  assert.equal(parsed.method, "permit20");
  assert.equal(parsed.intent, "charge");
  assert.equal(parsed.request.amount, "1500000000000000000");
  assert.deepEqual(parsed.request.methodDetails, {
    chainId: 6343,
    spender: "0x1111111111111111111111111111111111111111",
    tokenName: "USDm",
    tokenVersion: "1",
  });
});
