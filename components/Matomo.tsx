"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const MATOMO_URL = "https://analytics.conc.at";
const MATOMO_SITE_ID = "15";

declare global {
  interface Window {
    _paq?: unknown[][];
  }
}

function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousUrl = useRef("");

  useEffect(() => {
    const url = window.location.href;
    // oxlint-disable-next-line no-underscore-dangle -- _paq is Matomo's fixed global name
    const _paq = (window._paq = window._paq ?? []);
    if (previousUrl.current === "") {
      // Cookieless mode: no consent banner needed.
      _paq.push(["disableCookies"]);
      _paq.push(["setTrackerUrl", `${MATOMO_URL}/matomo.php`]);
      _paq.push(["setSiteId", MATOMO_SITE_ID]);
      _paq.push(["enableLinkTracking"]);
      _paq.push(["trackPageView"]);
      const script = document.createElement("script");
      script.async = true;
      script.src = `${MATOMO_URL}/matomo.js`;
      document.head.appendChild(script);
    } else {
      _paq.push(["setReferrerUrl", previousUrl.current]);
      _paq.push(["setCustomUrl", url]);
      _paq.push(["setDocumentTitle", document.title]);
      _paq.push(["trackPageView"]);
    }
    previousUrl.current = url;
  }, [pathname, searchParams]);

  return null;
}

// useSearchParams() needs a Suspense boundary, so the tracker brings its own.
export function Matomo() {
  if (process.env.NODE_ENV !== "production") return null;
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
