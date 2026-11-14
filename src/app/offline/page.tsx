import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { OfflineActions } from "./offline-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offline");
  return { title: t("title") };
}

/*
 * /offline (SPEC addendum B): what the service worker shows when a page cannot load without signal.
 * Static: it holds no data, so it can be cached on the phone.
 */
export default async function OfflinePage() {
  const t = await getTranslations("offline");
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-16 sm:items-center">
      <div className="grid w-full max-w-sm justify-items-center gap-4 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-subtle text-primary">
          <WifiOff aria-hidden="true" className="size-7" />
        </span>
        <h1 className="text-xl font-bold text-ink">{t("title")}</h1>
        <p className="text-sm leading-6 text-ink-muted">{t("body")}</p>
        <OfflineActions />
      </div>
    </main>
  );
}
