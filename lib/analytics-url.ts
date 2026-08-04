/**
 * What the analytics tracker is allowed to see.
 *
 * Two parts of a report URL are private. The hash of `/report#<fragment>`
 * holds the whole encoded snapshot, table names included. The path of
 * `/r/<id>` holds a capability token: anyone who reads it opens the report.
 * An analytics database keeps its rows longer than the 30 day link store, so
 * neither may leave the browser. Origin, path and query stay.
 */
export function analyticsUrl(href: string): string {
  const url = new URL(href);
  url.hash = "";
  if (url.pathname === "/r" || url.pathname.startsWith("/r/")) url.pathname = "/r";
  return url.toString();
}
