# robovac analytics: cookieless Matomo tracking

Design for visitor and referral tracking. The Matomo instance is self-hosted at https://analytics.conc.at/, the site ID is 15.

## tl;dr

One client component, `components/Matomo.tsx`, rendered from the root layout. It loads `matomo.js`, runs the tracker in cookieless mode (no consent banner needed), and reports every client-side navigation as a page view. No new dependency.

## Why not @socialgouv/matomo-next

The package covers features we do not need (search tracking, proxying) and adds a dependency for ~40 lines of code. The repo has 6 runtime dependencies, we keep it that way.

## Component

Two parts inside one file:

- Init (first effect run): push `disableCookies`, `setTrackerUrl`, `setSiteId`, `enableLinkTracking`, `trackPageView`, then inject the `matomo.js` script tag. This is the stock snippet plus the cookieless line.
- Route changes: `usePathname()` + `useSearchParams()` drive an effect. On change it pushes `setReferrerUrl` (previous URL), `setCustomUrl`, `setDocumentTitle`, `trackPageView`. The first run is the init path, so the initial view is not counted twice.

`useSearchParams()` requires a `Suspense` boundary, the component brings its own.

## Config

`MATOMO_URL` and `MATOMO_SITE_ID` are constants in the component. The values are public in the page source anyway, and there is one deployment.

## Guard

The component renders nothing unless `NODE_ENV` is `production`. Dev sessions stay out of the stats.

## Verification

`pnpm lint`, `pnpm build`, then load the site and confirm one `matomo.php` request per navigation and a visit in Matomo. No unit tests: the component is glue over `_paq.push`, and the repo has no component test setup.
