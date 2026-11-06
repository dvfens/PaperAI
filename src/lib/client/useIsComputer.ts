"use client";

import { useSyncExternalStore } from "react";

/**
 * A computer: the main pointer is a mouse or trackpad. Phones and tablets (touch first) get the
 * camera start screen; computers get the upload page, because a webcam is no good for scanning
 * paper. Deliberately not based on window width, so narrowing a desktop window never switches
 * to the camera (and never pops up a camera permission prompt).
 */
const QUERY = "(hover: hover) and (pointer: fine)";

function subscribe(onChange: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** true on a computer, false on a phone or tablet, null until known (server render, hydration). */
export function useIsComputer(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => null,
  );
}
