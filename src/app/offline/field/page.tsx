import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { OfflineFieldApp } from "./offline-field-app";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offline.field");
  return { title: t("title") };
}

/*
 * /offline/field (loan officer, SPEC addendum B): Field cash without signal. A static shell: the list
 * and the queued payments come from this phone's own storage, never from the server, so the page can
 * be cached and opened offline. Payments are sent by the service worker when signal returns.
 */
export default async function OfflineFieldPage() {
  const t = await getTranslations("offline.field");
  return (
    <div className="min-h-dvh bg-page">
      <header className="bg-primary px-4 pt-5 pb-4 text-white">
        <h1 className="mx-auto w-full max-w-xl truncate text-[22px] font-bold">{t("title")}</h1>
      </header>
      <main className="mx-auto grid w-full max-w-xl grid-cols-1 gap-4 p-4">
        <OfflineFieldApp />
      </main>
    </div>
  );
}
