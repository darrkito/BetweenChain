import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Dev server is also opened from other devices on the LAN (e.g.
  // http://192.168.100.200:3000) — without this, Next blocks the HMR
  // websocket for any non-localhost origin ("Blocked cross-origin request to
  // Next.js dev resource /_next/webpack-hmr", confirmed live 2026-07-20).
  allowedDevOrigins: ["192.168.100.200"],
};

export default nextConfig;
