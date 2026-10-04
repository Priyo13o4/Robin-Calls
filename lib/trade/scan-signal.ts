"use client";

/** Same-browser notice that a scan finished, so an open trade page can show it without a reload. No server cost. */
const CHANNEL = "robincalls:scans";

export function announceScan(address: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.postMessage({ address: address.toLowerCase() });
  ch.close();
}

export function onScanAnnounced(address: string, cb: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const want = address.toLowerCase();
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<{ address?: string }>) => { if (e.data?.address === want) cb(); };
  return () => ch.close();
}
