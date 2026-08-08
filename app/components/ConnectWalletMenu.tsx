"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useBtcWallet } from "@/lib/client/BtcWalletProvider";
import { useAuth } from "@/lib/client/AuthProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { EvmConnectPicker } from "@/app/components/EvmConnectPicker";
import { SuiConnectPicker } from "@/app/components/SuiConnectPicker";
import { BtcConnectPicker } from "@/app/components/BtcConnectPicker";

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// If Phantom hasn't resolved connect() by this point, it isn't going to —
// this fires either because the extension's own approval window opened
// somewhere off-screen/behind the browser (common on remote-desktop/LAN dev
// setups), or the injected provider genuinely never responded. Surfacing a
// concrete message here beats leaving the button silently stuck on
// "Connecting…" forever, which is exactly the bug this was built to fix.
const SOLANA_CONNECT_TIMEOUT_MS = 12_000;

/**
 * Unified "Connect Wallet" entry point — a centered popup, grouped by chain
 * family: Solana lists whatever real Wallet Standard wallets are actually
 * installed (never a fabricated/static list — see app/providers.tsx's
 * `wallets={[]}` comment for why this is empty until a real extension
 * registers itself) and, once connected, offers the "Sign in with Solana"
 * step (`lib/client/AuthProvider.tsx`) right there instead of that being a
 * separate button buried on the swap page only (moved here 2026-07-21).
 * Ethereum offers the one injected-provider connect this app supports
 * (`lib/client/EvmWalletProvider.tsx`). Sui uses the exact same
 * `SuiConnectPicker`/`SuiWalletButton` pair already wired into
 * `NftBuyModalSui.tsx` — real gap found and fixed 2026-08-03: this menu
 * previously showed a static "Sui wallet support isn't built yet" note even
 * though the picker component already existed and worked fine elsewhere in
 * the app, meaning Sui connect simply didn't work from the header at all
 * (desktop or mobile) despite the underlying wallet integration being real
 * (Slush's web-wallet flow, notably, needs no browser extension at all —
 * see SuiWalletProvider.tsx's comment — so this also happened to be the one
 * chain with a genuinely mobile-compatible connect path sitting unused).
 *
 * Rendered via a portal straight to `document.body` (2026-07-21) rather
 * than as a `fixed` div inside AppHeader's own DOM position — `fixed`
 * positioning is only relative to the viewport if no ancestor establishes
 * its own containing block (a `transform`/`filter`/`backdrop-filter` on any
 * parent breaks that), and this app's header already uses
 * `backdrop-blur`. A portal sidesteps the whole class of "modal renders
 * off-center because of some ancestor's CSS" bug instead of trying to prove
 * no current or future ancestor will ever trigger it.
 *
 * open/setOpen come from a shared context (lib/client/ConnectWalletModalProvider.tsx,
 * instantiated once at the true app root) rather than local state — 2026-08-06
 * real user request: the swap page's own "Connect wallet" button needed to
 * open this EXACT same modal, not a lookalike second flow, and this
 * component itself remounts per-page (AppHeader isn't in the root layout),
 * so local state alone couldn't be shared with a button on the same page.
 */
export function ConnectWalletMenu() {
  const { open, setOpen } = useConnectWalletModal();
  const [solanaError, setSolanaError] = useState<string | null>(null);
  const [solanaConnectingName, setSolanaConnectingName] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const solana = useWallet();
  const evm = useEvmWallet();
  const auth = useAuth();
  const suiAccount = useCurrentAccount();
  const { mutate: disconnectSui } = useDisconnectWallet();
  const btc = useBtcWallet();

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true));
  }, []);

  // Counts each real connect click, rather than a ref flag gated on
  // `solana.wallet` changing reference — real bug found live 2026-08-07:
  // `@solana/wallet-adapter-react`'s own `select()` persists the chosen
  // wallet name to localStorage and no-ops entirely
  // (`if (walletName === nextWalletName) return`) whenever the requested
  // name is ALREADY the stored selection — which it will be on a second
  // click after a hung/failed first attempt (never disconnected, so
  // localStorage never clears), or after a page reload that restores the
  // same stored name. When that happens `solana.wallet` never changes
  // reference, so the old ref-gated effect (deps: `[solana.wallet,
  // solana]`) never re-ran connect() or started the timeout — the button
  // was stuck on "Connecting…" forever with no recovery short of clearing
  // site storage. A plain counter always changes on every click, so the
  // effect below always re-fires regardless of whether the underlying
  // wallet selection itself actually changed.
  const [connectAttempt, setConnectAttempt] = useState(0);
  const handledAttemptRef = useRef(0);
  useEffect(() => {
    if (connectAttempt === 0 || connectAttempt === handledAttemptRef.current || !solana.wallet) return;
    handledAttemptRef.current = connectAttempt;

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      setSolanaConnectingName(null);
      setSolanaError(
        `${solana.wallet?.adapter.name} didn't respond. Check for an approval popup that may have opened ` +
          "behind your browser window, or that your browser isn't blocking extension popups, then try again.",
      );
    }, SOLANA_CONNECT_TIMEOUT_MS);

    solana
      .connect()
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        setSolanaError((err as Error).message || "Failed to connect.");
      })
      .finally(() => {
        settled = true;
        clearTimeout(timeout);
        setSolanaConnectingName(null);
      });
  }, [connectAttempt, solana.wallet, solana]);

  function connectSolanaWallet(name: WalletName) {
    setSolanaError(null);
    setSolanaConnectingName(name);
    solana.select(name);
    setConnectAttempt((n) => n + 1);
  }

  const solanaPubkeyStr = solana.publicKey?.toBase58() ?? null;
  const isSignedIn = auth.checked && solanaPubkeyStr !== null && auth.sessionPubkey === solanaPubkeyStr;
  const anyConnected = Boolean(solana.publicKey) || Boolean(evm.address) || Boolean(suiAccount) || Boolean(btc.address);

  const modal = open ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-1 overflow-y-auto rounded-2xl border border-hairline bg-surface p-4 shadow-xl"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Connect a wallet</h2>
          <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        <ChainSection title="Solana">
          {solanaPubkeyStr ? (
            <div className="flex flex-col gap-1.5">
              <ConnectedRow label={shorten(solanaPubkeyStr)} onDisconnect={() => solana.disconnect()} />
              {!isSignedIn && (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => auth.signIn()}
                    disabled={auth.signingIn}
                    className="rounded-xl bg-accent px-2 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:brightness-110 disabled:opacity-60"
                  >
                    {auth.signingIn ? "Signing…" : "Sign in with Solana"}
                  </button>
                  <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
                    One free signature to prove wallet ownership — required for swaps and NFT purchases.
                  </p>
                  {auth.error && <p className="px-1 text-[11px] text-danger">{auth.error}</p>}
                </div>
              )}
            </div>
          ) : solana.wallets.length > 0 ? (
            <div className="flex flex-col gap-1">
              {solana.wallets.map((w) => (
                <WalletRow
                  key={w.adapter.name}
                  name={w.adapter.name}
                  iconUrl={w.adapter.icon}
                  busy={solanaConnectingName === w.adapter.name}
                  onClick={() => connectSolanaWallet(w.adapter.name)}
                />
              ))}
              {solanaError && <p className="px-2 pt-1 text-[11px] leading-relaxed text-danger">{solanaError}</p>}
            </div>
          ) : (
            // Real gap this covers (not a new wallet-connection mechanism —
            // just honest copy, WalletConnect/deep-linking is intentionally
            // out of scope for now): on mobile web there is usually no
            // injected extension to detect at all, and the old copy here
            // ("install Phantom or Solflare") reads like a dead end on a
            // phone rather than explaining the actual real path — opening
            // this site from inside the wallet app's own built-in browser.
            <EmptyNote text="No Solana wallet detected. On desktop, install Phantom or Solflare. On mobile, open this site from inside the Phantom or Solflare app's own browser — connecting to a mobile browser directly isn't supported yet." />
          )}
        </ChainSection>

        <ChainSection title="Ethereum">
          {evm.address ? (
            <div className="flex flex-col gap-1.5">
              <ConnectedRow label={shorten(evm.address)} onDisconnect={evm.disconnect} />
              {evm.address === auth.evmVerifiedAddress ? (
                <p className="px-1 text-[11px] text-success">Signed in with this Ethereum address.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => auth.signInEvm(evm.address!)}
                    disabled={auth.signingInEvm}
                    className="rounded-xl bg-accent px-2 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:brightness-110 disabled:opacity-60"
                  >
                    {auth.signingInEvm ? "Signing…" : "Sign in with Ethereum"}
                  </button>
                  <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
                    {solanaPubkeyStr
                      ? "One free signature to prove wallet ownership and link it to your account."
                      : "One free signature to sign in — works fully on its own, no Solana wallet needed."}
                  </p>
                  {auth.evmError && <p className="px-1 text-[11px] text-danger">{auth.evmError}</p>}
                </div>
              )}
            </div>
          ) : (
            <EvmConnectPicker />
          )}
        </ChainSection>

        <ChainSection title="Sui">
          {suiAccount ? (
            <ConnectedRow label={shorten(suiAccount.address)} onDisconnect={() => disconnectSui()} />
          ) : (
            <SuiConnectPicker />
          )}
        </ChainSection>

        {/* Bitcoin (2026-08-08) — connect-only, same as Sui: no separate
            sign-in step, purely a payment rail for the ChangeNOW-powered
            BTC→SUI/EVM/Solana NFT-purchase flow. */}
        <ChainSection title="Bitcoin" last>
          {btc.address ? (
            <ConnectedRow label={shorten(btc.address)} onDisconnect={btc.disconnect} />
          ) : (
            <BtcConnectPicker />
          )}
        </ChainSection>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="num shrink-0 rounded-full bg-accent px-3 py-2 text-sm font-semibold text-accent-ink shadow-sm transition-all hover:brightness-110 sm:px-4"
      >
        {/* Shortened below `sm` — "Wallets connected" alone was wide enough
            to crowd the header on a narrow phone alongside the nav links. */}
        <span className="hidden sm:inline">{anyConnected ? "Wallets connected" : "Connect Wallet"}</span>
        <span className="sm:hidden">{anyConnected ? "Connected" : "Connect"}</span>
      </button>
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}

function ChainSection({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-3 border-b border-hairline pb-3"}>
      <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      {children}
    </div>
  );
}

function WalletRow({ name, iconUrl, busy, onClick }: { name: string; iconUrl?: string; busy?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover disabled:opacity-60"
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- wallet adapter icons are small data: URIs, not worth next/image's overhead
        <img src={iconUrl} alt="" className="h-5 w-5 shrink-0 rounded" />
      ) : (
        <span className="h-5 w-5 shrink-0 rounded bg-surface-hover" />
      )}
      <span className="truncate">{busy ? "Connecting…" : name}</span>
    </button>
  );
}

function ConnectedRow({ label, onDisconnect }: { label: string; onDisconnect: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface-hover px-2 py-1.5">
      <span className="num text-sm text-ink">{label}</span>
      <button onClick={onDisconnect} className="text-[11px] font-medium text-ink-faint hover:text-danger">
        Disconnect
      </button>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="px-2 py-1 text-xs leading-relaxed text-ink-faint">{text}</p>;
}
