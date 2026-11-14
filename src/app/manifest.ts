import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

/*
 * Web app manifest (SPEC addendum B): lets Chrome on Android install LoanDesk as an app (home-screen
 * icon, full screen, MSI colours). The same file is what a Trusted Web Activity APK builds from.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("app");
  return {
    id: "/",
    name: t("title"),
    short_name: t("title"),
    description: t("description"),
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1f5f9",
    theme_color: "#241660",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
