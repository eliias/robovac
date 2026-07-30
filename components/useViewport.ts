"use client";

import { useEffect, useState } from "react";

/**
 * The two layout breakpoints. `narrow` (< 1120px) collapses the report's
 * two-column grid; `mobile` (< 720px) switches to mobile mode. The values
 * are the contract from the design handoffs.
 */
export function useViewport(): { narrow: boolean; mobile: boolean } {
  const [v, setV] = useState({ narrow: false, mobile: false });

  useEffect(() => {
    const update = () =>
      setV({ narrow: window.innerWidth < 1120, mobile: window.innerWidth < 720 });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return v;
}
