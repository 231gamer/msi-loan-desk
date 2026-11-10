"use client";

import Image from "next/image";
import { useCallback, useState } from "react";

/*
 * Logo shipped with the app (SPEC 11 Branding: public/brand/msi-logo.png). Used when the logo in
 * Storage (settings.company.logo_path) is missing or fails to load, so a fresh install or an empty
 * branding bucket never shows a broken image. An uploaded logo still wins whenever it loads.
 */
export const BUNDLED_LOGO_SRC = "/brand/msi-logo-480.png";

export function LogoImage({
  logoUrl,
  alt,
  shortName,
}: {
  logoUrl: string | null;
  alt: string;
  shortName: string;
}) {
  // Sources to try in order; the short name shows once every source has failed.
  const sources =
    logoUrl !== null && logoUrl !== BUNDLED_LOGO_SRC ? [logoUrl, BUNDLED_LOGO_SRC] : [BUNDLED_LOGO_SRC];
  const [index, setIndex] = useState(0);
  const src = sources[index];
  const next = useCallback(() => setIndex((i) => i + 1), []);
  // An image that failed before hydration never fires onError; catch it when the element mounts.
  const checkLoaded = useCallback(
    (img: HTMLImageElement | null) => {
      if (img !== null && img.complete && img.naturalWidth === 0) next();
    },
    [next],
  );

  if (src === undefined) return <span className="text-xs font-extrabold text-primary">{shortName}</span>;

  return (
    <Image
      key={src}
      src={src}
      alt={alt}
      width={44}
      height={40}
      unoptimized
      className="size-full object-contain"
      ref={checkLoaded}
      onError={next}
    />
  );
}
