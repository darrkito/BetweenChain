"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import type { GameMeta } from "@/lib/content/games";

function reportPlay(slug: string) {
  fetch(`/api/games/${encodeURIComponent(slug)}/play`, { method: "POST" }).catch(() => {
    // Best-effort — a failed play-count increment shouldn't block or error
    // out the actual play experience.
  });
}

// Embedded iframe player, with a mandatory honest fallback for any game
// whose own host blocks framing (2026-08-07 — see lib/content/games.ts's
// `embeddable` doc comment for why this is a real, hand-verified flag, not
// runtime-detected: a blocked iframe doesn't reliably fire a JS error).
export function GamePlayer({ game }: { game: GameMeta }) {
  const [playing, setPlaying] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    track("game_view", { slug: game.slug });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per real mount, not on every game.slug identity change within the same mount
  }, []);

  function startPlaying() {
    track("game_play_click", { slug: game.slug });
    reportPlay(game.slug);
    setPlaying(true);
  }

  function reload() {
    setIframeKey((k) => k + 1);
  }

  function enterFullscreen() {
    containerRef.current?.requestFullscreen?.().catch(() => {
      // Fullscreen can be denied (no user gesture, browser policy) — the
      // player is still fully usable at normal size either way.
    });
  }

  if (!game.embeddable) {
    return (
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border border-hairline bg-surface-hover p-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- external, game-team-hosted cover image */}
        <img src={game.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        <div className="relative flex flex-col items-center gap-3">
          <p className="text-sm text-ink-muted">This game opens in a new tab.</p>
          <a
            href={game.playUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              track("game_external_launch", { slug: game.slug });
              reportPlay(game.slug);
            }}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Play {game.name} ↗
          </a>
        </div>
      </div>
    );
  }

  if (!playing) {
    return (
      <button
        onClick={startPlaying}
        className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-surface-hover"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- external, game-team-hosted cover image */}
        <img
          src={game.coverImage}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-ink/20 transition-colors group-hover:bg-ink/30" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-ink shadow-xl transition-transform group-hover:scale-110">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      <div className="flex items-center justify-between rounded-t-2xl border border-b-0 border-hairline bg-surface px-3 py-2">
        <span className="truncate text-sm font-medium text-ink">{game.name}</span>
        <div className="flex items-center gap-1">
          <button onClick={reload} aria-label="Reload" className="rounded-lg px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink">
            ↻ Reload
          </button>
          <button
            onClick={enterFullscreen}
            aria-label="Fullscreen"
            className="rounded-lg px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            ⛶ Fullscreen
          </button>
          <a
            href={game.playUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            Open in new tab ↗
          </a>
          <button onClick={() => setPlaying(false)} aria-label="Exit" className="rounded-lg px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink">
            ✕ Exit
          </button>
        </div>
      </div>
      <iframe
        key={iframeKey}
        src={game.playUrl}
        title={game.name}
        className="aspect-video w-full rounded-b-2xl border border-hairline bg-black"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
        allow="fullscreen; gamepad"
        referrerPolicy="no-referrer"
        onLoad={() => track("game_iframe_loaded", { slug: game.slug })}
      />
    </div>
  );
}
