import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { termLinkStyle } from "@/components/ui";
import { termHref } from "@/lib/terms";

export function TermLink({
  slug,
  children,
  style,
}: {
  slug: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Link href={termHref(slug)} className="term-link" style={{ ...termLinkStyle, ...style }}>
      {children}
    </Link>
  );
}
