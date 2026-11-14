import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { auditChanges } from "@/lib/audit-diff";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatDateTime, parseBusinessDate } from "@/lib/format";
import { customerName } from "@/lib/customers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import messages from "../../../../messages/en.json";
import { LinkPending, SubmitButton } from "@/components/ui/pending";

/*
 * /audit (manager, CEO, admin): read-only view of the immutable audit log (FR-26, SPEC 9 and 11).
 * Filters narrow what is shown; nothing on this page can hide, change or delete an entry.
 */
const PAGE_SIZE = 25;
const ENTITY_TYPES = [
  "loan",
  "customer",
  "payment",
  "expense",
  "collateral",
  "recovery_case",
  "approval_request",
  "journal",
  "day_close",
  "issued_document",
  "loan_product",
  "payee",
  "setting",
  "branch",
  "profile",
  "app_environment",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "loan_product.updated" -> "Loan product updated", for an action or type with no label yet. */
function humanize(key: string): string {
  const text = key.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where a record type has its own page. */
const RECORD_HREF: Partial<Record<string, (id: string) => string>> = {
  loan: (id) => `/loans/${id}`,
  customer: (id) => `/customers/${id}`,
  payment: (id) => `/receipts/${id}`,
};

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Readable names (loan number, receipt number, customer name...) for the records on this page,
 * keyed "type:id". Records the reader cannot see, or types without a number, are left out.
 */
async function recordNames(
  supabase: ServerClient,
  rows: readonly { entity_type: string; entity_id: string | null }[],
  labels: { approval: (type: string) => string; document: (kind: string) => string },
): Promise<Map<string, string>> {
  const ids = (type: string) => [
    ...new Set(
      rows
        .filter((row) => row.entity_type === type && row.entity_id !== null && UUID.test(row.entity_id))
        .map((row) => row.entity_id as string),
    ),
  ];
  const lookups = [
    { type: "loan", ids: ids("loan") },
    { type: "customer", ids: ids("customer") },
    { type: "payment", ids: ids("payment") },
    { type: "expense", ids: ids("expense") },
    { type: "collateral", ids: ids("collateral") },
    { type: "recovery_case", ids: ids("recovery_case") },
    { type: "journal", ids: ids("journal") },
    { type: "loan_product", ids: ids("loan_product") },
    { type: "payee", ids: ids("payee") },
    { type: "approval_request", ids: ids("approval_request") },
    { type: "issued_document", ids: ids("issued_document") },
  ].filter((lookup) => lookup.ids.length > 0);

  const read = async (type: string, list: string[]): Promise<[string, string][]> => {
    switch (type) {
      case "loan": {
        const { data } = await supabase.from("loans").select("id, loan_no").in("id", list);
        return (data ?? []).map((row) => [row.id, row.loan_no]);
      }
      case "customer": {
        const { data } = await supabase
          .from("customers")
          .select("id, type, first_name, last_name, business_name")
          .in("id", list);
        return (data ?? []).map((row) => [row.id, customerName(row)]);
      }
      case "payment": {
        const { data } = await supabase.from("payments").select("id, receipt_no").in("id", list);
        return (data ?? []).map((row) => [row.id, row.receipt_no]);
      }
      case "expense": {
        const { data } = await supabase.from("expenses").select("id, expense_no").in("id", list);
        return (data ?? []).map((row) => [row.id, row.expense_no]);
      }
      case "collateral": {
        const { data } = await supabase.from("collaterals").select("id, code").in("id", list);
        return (data ?? []).map((row) => [row.id, row.code]);
      }
      case "recovery_case": {
        const { data } = await supabase.from("recovery_cases").select("id, case_no").in("id", list);
        return (data ?? []).map((row) => [row.id, row.case_no]);
      }
      case "journal": {
        const { data } = await supabase.from("journals").select("id, journal_no").in("id", list);
        return (data ?? []).map((row) => [row.id, row.journal_no]);
      }
      case "loan_product": {
        const { data } = await supabase.from("loan_products").select("id, name").in("id", list);
        return (data ?? []).map((row) => [row.id, row.name]);
      }
      case "payee": {
        const { data } = await supabase.from("payees").select("id, name").in("id", list);
        return (data ?? []).map((row) => [row.id, row.name]);
      }
      case "approval_request": {
        const { data } = await supabase.from("approval_requests").select("id, type").in("id", list);
        return (data ?? []).map((row) => [row.id, labels.approval(row.type)]);
      }
      case "issued_document": {
        const { data } = await supabase.from("issued_documents").select("id, kind").in("id", list);
        return (data ?? []).map((row) => [row.id, labels.document(row.kind)]);
      }
      default:
        return [];
    }
  };

  const results = await Promise.all(
    lookups.map(async (lookup) =>
      (await read(lookup.type, lookup.ids)).map(([id, name]) => [`${lookup.type}:${id}`, name] as const),
    ),
  );
  return new Map(results.flat().filter(([, name]) => name !== null && name !== ""));
}

type Params = Awaited<PageProps<"/audit">["searchParams"]>;

function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

function validDate(value: string): string {
  if (value === "") return "";
  try {
    parseBusinessDate(value);
    return value;
  } catch {
    return "";
  }
}

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const t = await getTranslations("audit");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <AuditContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AuditContent({ searchParams }: { searchParams: PageProps<"/audit">["searchParams"] }) {
  const staff = await requirePageAccess("/audit");
  const [t, tRoles, tApprovals, tVerify, params] = await Promise.all([
    getTranslations("audit"),
    getTranslations("roles"),
    getTranslations("approvals"),
    getTranslations("verify"),
    searchParams,
  ]);

  const filters = {
    user: /^[0-9a-f-]{36}$/.test(single(params.user)) ? single(params.user) : "",
    entity: (ENTITY_TYPES as readonly string[]).includes(single(params.entity)) ? single(params.entity) : "",
    from: validDate(single(params.from)),
    to: validDate(single(params.to)),
  };
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_log")
    .select("id, at, action, entity_type, entity_id, actor_id, actor_role, before, after", { count: "exact" })
    .order("chain_no", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (filters.user !== "") query = query.eq("actor_id", filters.user);
  if (filters.entity !== "") query = query.eq("entity_type", filters.entity);
  // Business dates are in Africa/Monrovia (UTC+0), so a day runs from 00:00Z to 24:00Z.
  if (filters.from !== "") query = query.gte("at", `${filters.from}T00:00:00Z`);
  if (filters.to !== "") query = query.lt("at", `${filters.to}T24:00:00Z`);

  const [{ data: rows, count, error }, { data: people, error: peopleError }, { data: branches }] =
    await Promise.all([
      query,
      supabase.from("profiles").select("id, full_name").order("full_name"),
      supabase.from("branches").select("id, code"),
    ]);
  if (error !== null || peopleError !== null) throw new Error("Could not read the audit log");

  const names = new Map(people.map((person) => [person.id, person.full_name]));
  const branchCodes = new Map((branches ?? []).map((branch) => [branch.id, branch.code]));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const records = await recordNames(supabase, rows, {
    approval: (type) =>
      type in messages.approvals.types
        ? tApprovals(`types.${type as keyof typeof messages.approvals.types}`)
        : humanize(type),
    document: (kind) =>
      kind in messages.verify.kinds
        ? tVerify(`kinds.${kind as keyof typeof messages.verify.kinds}`)
        : humanize(kind),
  });

  // Message keys cannot contain dots (next-intl nests on them), so "setting.updated" is "setting_updated".
  const actionLabel = (action: string) => {
    const key = action.replace(/\./g, "_");
    return key in messages.audit.actions
      ? t(`actions.${key as keyof typeof messages.audit.actions}`)
      : humanize(action);
  };
  const typeLabel = (type: string) =>
    type in messages.audit.entities
      ? t(`entities.${type as keyof typeof messages.audit.entities}`)
      : humanize(type);
  /** "Loan LN-BR2-00011", "Setting clock.override_at"; an id with no readable name is shortened. */
  const recordName = (type: string, id: string | null): string | null => {
    if (id === null) return null;
    const name =
      type === "profile"
        ? names.get(id)
        : type === "branch"
          ? branchCodes.get(id)
          : records.get(`${type}:${id}`);
    if (name !== undefined) return name;
    if (type === "document_sequence") return null;
    return UUID.test(id) ? `#${id.slice(0, 8)}` : id;
  };
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== "") search.set(key, value);
    if (target > 1) search.set("page", String(target));
    const text = search.toString();
    return text === "" ? "/audit" : `/audit?${text}`;
  };

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <p className="max-w-[70ch] text-sm leading-6 text-ink-muted">{t("intro")}</p>

        <form
          method="get"
          action="/audit"
          aria-label={t("filters.label")}
          className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1.5fr_1fr_1fr_auto] lg:items-end"
        >
          <Field id="audit-user" label={t("filters.user")}>
            <select id="audit-user" name="user" defaultValue={filters.user} className={inputClass}>
              <option value="">{t("filters.anyUser")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="audit-entity" label={t("filters.entity")}>
            <select id="audit-entity" name="entity" defaultValue={filters.entity} className={inputClass}>
              <option value="">{t("filters.anyEntity")}</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`entities.${type}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="audit-from" label={t("filters.from")}>
            <input
              id="audit-from"
              name="from"
              type="date"
              defaultValue={filters.from}
              className={inputClass}
            />
          </Field>
          <Field id="audit-to" label={t("filters.to")}>
            <input id="audit-to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton className={buttonVariants({ variant: "primary" })}>
              {t("filters.apply")}
            </SubmitButton>
            <Link href="/audit" className={cn(buttonVariants({ variant: "ghost" }), "hover:text-ink")}>
              <LinkPending />
              {t("filters.clear")}
            </Link>
          </div>
        </form>

        <section
          aria-labelledby="audit-results"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <h2
            id="audit-results"
            className="px-4 pt-4 text-sm font-semibold text-ink-muted"
            aria-live="polite"
          >
            {t("count", { count: total })}
          </h2>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("empty")}</p>
          ) : (
            <ol className="mt-2 divide-y divide-page">
              {rows.map((row) => {
                const changes = auditChanges(row.before, row.after);
                const who = row.actor_id === null ? t("system") : (names.get(row.actor_id) ?? row.actor_id);
                const name = recordName(row.entity_type, row.entity_id);
                const href =
                  row.entity_id !== null && records.has(`${row.entity_type}:${row.entity_id}`)
                    ? RECORD_HREF[row.entity_type]?.(row.entity_id)
                    : undefined;
                return (
                  <li key={row.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
                    <p className="tabular text-sm text-ink-muted">{formatDateTime(row.at)}</p>
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        <span className="font-semibold">{actionLabel(row.action)}</span>
                        <span className="text-ink-muted">
                          {" "}
                          · {typeLabel(row.entity_type)}
                          {name === null ? "" : ": "}
                        </span>
                        {name === null ? null : href === undefined ? (
                          <span className="text-ink-muted">{name}</span>
                        ) : (
                          <Link href={href} className="font-medium">
                            {name}
                          </Link>
                        )}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {who}
                        {row.actor_role !== null ? ` · ${tRoles(row.actor_role)}` : ""}
                      </p>
                      <details className="mt-1.5">
                        <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-control text-xs font-semibold text-primary">
                          {t("showChanges")}
                        </summary>
                        {changes.length === 0 ? (
                          <p className="mt-2 text-xs text-ink-muted">{t("noChanges")}</p>
                        ) : (
                          <ScrollRegion
                            label={t("changesOf", { action: actionLabel(row.action) })}
                            className="mt-2"
                          >
                            <table className="w-full min-w-[420px] border-collapse text-xs">
                              <thead className="bg-subtle text-left text-ink-muted">
                                <tr>
                                  <th scope="col" className="px-2 py-1.5 font-semibold">
                                    {t("field")}
                                  </th>
                                  <th scope="col" className="px-2 py-1.5 font-semibold">
                                    {t("before")}
                                  </th>
                                  <th scope="col" className="px-2 py-1.5 font-semibold">
                                    {t("after")}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map((change) => (
                                  <tr key={change.field} className="border-t border-page align-top">
                                    <td className="px-2 py-1.5 font-medium text-ink">{change.field}</td>
                                    <td className="px-2 py-1.5 break-all text-ink-muted">
                                      {change.before === "" ? t("none") : change.before}
                                    </td>
                                    <td className="px-2 py-1.5 break-all text-ink">
                                      {change.after === "" ? t("none") : change.after}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </ScrollRegion>
                        )}
                      </details>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {pages > 1 ? (
            <nav
              aria-label={t("page", { page, pages })}
              className="flex items-center justify-between gap-2 border-t border-page px-4 py-3"
            >
              <p className="text-sm text-ink-muted">{t("page", { page, pages })}</p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
                  >
                    <LinkPending />
                    {t("previous")}
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
                  >
                    <LinkPending />
                    {t("next")}
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
      </div>
    </>
  );
}
