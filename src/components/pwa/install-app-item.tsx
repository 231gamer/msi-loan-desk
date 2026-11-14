"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { promptInstall, useInstallState } from "./install";

/*
 * More menu item (phones and tablets): installs LoanDesk as an app. Android Chrome opens its own
 * install dialog; elsewhere (iPhone, or a browser that has not offered it yet) the steps are shown.
 * Hidden once the app runs installed.
 */
export function InstallAppItem() {
  const t = useTranslations("install");
  const state = useInstallState();
  const [showSteps, setShowSteps] = useState(false);
  if (state === "installed") return null;

  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-expanded={state === "prompt" ? undefined : showSteps}
        aria-controls={state === "prompt" ? undefined : "install-steps"}
        onClick={() => {
          if (state === "prompt") void promptInstall();
          else setShowSteps((open) => !open);
        }}
        className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-sm font-semibold text-ink hover:bg-page"
      >
        <Download aria-hidden="true" className="size-5" />
        {t("button")}
      </button>
      {showSteps && state !== "prompt" ? (
        <ol
          id="install-steps"
          className="mx-3 mb-2 grid list-decimal gap-1 rounded-control bg-subtle py-3 pr-3 pl-8 text-sm text-ink"
        >
          {(state === "ios" ? ["ios1", "ios2", "ios3"] : ["android1", "android2"]).map((step) => (
            <li key={step}>{t(`steps.${step}` as "steps.ios1")}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
