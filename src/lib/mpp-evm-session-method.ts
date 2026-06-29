import { Method, z } from "mppx";

export const EVM_SESSION_METHOD_NAME = "evm";
export const EVM_SESSION_INTENT = "session";

export const evmSessionMethod = Method.from({
  intent: EVM_SESSION_INTENT,
  name: EVM_SESSION_METHOD_NAME,
  schema: {
    credential: {
      payload: z.any(),
    },
    request: z.pipe(
      z.object({
        amount: z.amount(),
        chainId: z.optional(z.number()),
        currency: z.address(),
        escrowContract: z.optional(z.address()),
        methodDetails: z.optional(
          z.object({
            chainId: z.number(),
            credentialTypes: z.array(z.string()),
            escrowContract: z.address(),
            feePayer: z.boolean(),
            permit2Contract: z.optional(z.address()),
          }),
        ),
        recipient: z.address(),
        suggestedDeposit: z.optional(z.amount()),
        unitType: z.optional(z.string()),
      }),
      z.transform(({ chainId, escrowContract, methodDetails, ...rest }) => {
        const resolvedMethodDetails =
          methodDetails ??
          (chainId !== undefined && escrowContract
            ? {
                chainId,
                credentialTypes: [] as string[],
                escrowContract,
                feePayer: false,
              }
            : undefined);

        return {
          ...rest,
          ...(resolvedMethodDetails
            ? { methodDetails: resolvedMethodDetails }
            : {}),
        };
      }),
    ),
  },
});
