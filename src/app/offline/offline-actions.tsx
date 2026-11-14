"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { offlineStoreAvailable, readSnapshot } from "@/lib/offline/store";
import { cn } from "@/lib/utils";

/** "Try again", and the offline Field cash link when this phone has a saved list. */
export function OfflineActions() {
  const t = useTranslations("offline");
  const [hasList, setHasList] = useState(false);

  useEffect(() => {
    if (!offlineStoreAvailable()) return;
    readSnapshot()
      .then((snapshot) => setHasList(snapshot !== null))
      .catch(() => setHasList(false));
  }, []);

  return (
    <div className="grid w-full gap-3">
      <Button type="button" onClick={() => window.location.reload()}>
        {t("retry")}
      </Button>
      {hasList ? (
        <>
          <a href="/offline/field" className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}>
            {t("fieldLink")}
          </a>
          <p className="text-xs text-ink-muted">{t("fieldHint")}</p>
        </>
      ) : null}
    </div>
  );
}
