import { MppDemo } from "@/components/MppDemo";
import { MppGaslessDemo } from "@/components/MppGaslessDemo";
import { MppSessionDemo } from "@/components/MppSessionDemo";
import { Permit2Panel } from "@/components/Permit2Panel";
import { UsdmPanel } from "@/components/UsdmPanel";
import { WalletPanel } from "@/components/WalletPanel";
import { X402Demo } from "@/components/X402Demo";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">
          MegaETH Testnet
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          Payment Demo Sandbox
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-white/60">
          Connect a wallet, mint test USDm, then compare x402, MPP one-time
          charge, MPP gasless charge, and MPP pay-as-you-go session payments
          against protected endpoints.
        </p>
      </header>

      <section>
        <WalletPanel />
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <UsdmPanel />
        <Permit2Panel />
        <div className="md:col-span-2">
          <X402Demo />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6">
        <MppDemo />
        <MppGaslessDemo />
      </section>

      <section className="grid grid-cols-1 gap-6">
        <MppSessionDemo />
      </section>
    </main>
  );
}
