"use client";

import { useEffect, useState } from "react";

/**
 * E1: on plain http:// or in a sandboxed frame, navigator.clipboard rejects
 * silently. Detect it up front, not when the click fails. Without clipboard
 * access every copy affordance becomes "select all", which selects the
 * block so the reader copies it themselves.
 */
export function useClipboard(): { canCopy: boolean } {
  const [canCopy, setCanCopy] = useState(true);
  useEffect(() => {
    setCanCopy(
      typeof navigator !== "undefined" &&
        Boolean(navigator.clipboard) &&
        typeof window !== "undefined" &&
        window.isSecureContext === true,
    );
  }, []);
  return { canCopy };
}

export function selectContents(el: Element | null): void {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
