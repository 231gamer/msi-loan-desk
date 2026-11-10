import { cn } from "@/lib/utils";

import { LogoImage } from "./logo-image";

/*
 * The company logo always sits on a white tile, never directly on purple (SPEC 11 Branding).
 * The uploaded logo is shown first, then the logo shipped with the app; the company short name
 * appears only if neither loads.
 */
export function LogoTile({
  logoUrl,
  alt,
  shortName,
  size = "md",
  className,
}: {
  logoUrl: string | null;
  alt: string;
  shortName: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "size-10 rounded-control p-[3px]" : "h-10 w-11";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center bg-surface", box, className)}>
      <LogoImage logoUrl={logoUrl} alt={alt} shortName={shortName} />
    </span>
  );
}
