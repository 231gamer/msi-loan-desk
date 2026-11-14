import "server-only";

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import {
  PdfDetails,
  PdfBar,
  PdfFooter,
  PdfHeader,
  PdfHeading,
  PdfTable,
  PdfTitle,
  pdfColors,
  pdfStyles,
} from "./parts";

/*
 * Loan agreement, A4 (SPEC 10.1; FR-25): company header, number, generation time, preparer, QR code
 * to /verify/<token>, parties, amount, interest, term, due date, penalty terms in plain language
 * (placeholder legal text from settings.templates), collateral, guarantors and signature blocks.
 * All amounts arrive already formatted; this file only lays them out.
 */
export type AgreementLabels = Record<
  | "title"
  | "loanLine"
  | "parties"
  | "lender"
  | "borrower"
  | "borrowerId"
  | "borrowerPhone"
  | "borrowerAddress"
  | "branch"
  | "loan"
  | "principal"
  | "interest"
  | "total"
  | "term"
  | "dueDate"
  | "product"
  | "purpose"
  | "terms"
  | "schedule"
  | "scheduleNote"
  | "installmentNo"
  | "installmentDue"
  | "installmentAmount"
  | "collateral"
  | "item"
  | "description"
  | "identifier"
  | "value"
  | "guarantors"
  | "none"
  | "signBorrower"
  | "signGuarantor"
  | "signCompany"
  | "dateLine"
  | "preparedBy"
  | "verify",
  string
>;

export interface AgreementData {
  company: { name: string; address: string; phone: string; email: string; logo: Buffer | null };
  number: string;
  generatedAt: string;
  preparedBy: string;
  qrDataUrl: string;
  verifyUrl: string;
  loan: {
    loanNo: string;
    product: string;
    branch: string;
    officer: string;
    principal: string;
    interest: string;
    total: string;
    rate: string;
    term: string;
    dueDate: string;
    purpose: string;
  };
  borrower: { name: string; code: string; id: string; phone: string; address: string };
  terms: string;
  /** Installment loans: the repayment schedule (dates empty until the loan is paid out). */
  schedule: Array<{ no: string; dueDate: string; amount: string }> | null;
  collateral: Array<{ code: string; description: string; identifier: string; value: string }>;
  guarantors: Array<{ name: string; relationship: string; phone: string; id: string }>;
  labels: AgreementLabels;
}

const styles = StyleSheet.create({
  note: {
    fontSize: 8.5,
    color: pdfColors.muted,
    marginTop: 6,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderColor: pdfColors.primary,
  },
  clause: { flexDirection: "row", marginBottom: 6 },
  clauseNo: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: pdfColors.tintStrong,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  clauseNoText: { color: pdfColors.primaryDark, fontFamily: "Helvetica-Bold", fontSize: 8, lineHeight: 1 },
  clauseText: { flex: 1 },
  signatures: { flexDirection: "row", gap: 18, marginTop: 34 },
  signature: { flex: 1, borderTopWidth: 1, borderColor: pdfColors.ink, paddingTop: 4 },
});

/*
 * The terms come from settings.templates as numbered lines ("1. Repayment. The borrower …"). Each
 * becomes a clause with its number in a circle and its first sentence fragment in bold.
 */
function Terms({ text }: { text: string }) {
  return (
    <View>
      {text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line, index) => {
          const match = /^(\d+)\.\s+([^.]{1,40}\.)\s*([\s\S]*)$/.exec(line);
          if (match === null) {
            return (
              <Text key={index} style={{ marginBottom: 6 }}>
                {line}
              </Text>
            );
          }
          return (
            <View key={index} style={styles.clause} wrap={false}>
              <View style={styles.clauseNo}>
                <Text style={styles.clauseNoText}>{match[1]}</Text>
              </View>
              <Text style={styles.clauseText}>
                <Text style={pdfStyles.strong}>{match[2]} </Text>
                {match[3]}
              </Text>
            </View>
          );
        })}
    </View>
  );
}

function Agreement({ data }: { data: AgreementData }) {
  const l = data.labels;
  const contact = [data.company.phone, data.company.email]
    .filter((part) => part !== "")
    .join(" · ")
    .split(" · ")
    .join("  |  ");
  return (
    <Document title={`${l.title} ${data.number}`} author={data.company.name} subject={data.loan.loanNo}>
      <Page size="A4" style={pdfStyles.page}>
        <PdfHeader
          company={{
            name: data.company.name,
            lines: [data.company.address, contact],
            logo: data.company.logo,
          }}
          number={data.number}
          date={data.generatedAt}
        />
        <PdfTitle title={l.title} subtitle={l.loanLine} />

        <View style={pdfStyles.section}>
          <PdfHeading>{l.parties}</PdfHeading>
          <PdfDetails
            items={[
              { label: l.lender, value: data.company.name },
              { label: l.borrower, value: `${data.borrower.name} (${data.borrower.code})` },
              { label: l.borrowerId, value: data.borrower.id },
              { label: l.borrowerPhone, value: data.borrower.phone },
              { label: l.borrowerAddress, value: data.borrower.address },
              { label: l.branch, value: `${data.loan.branch} · ${data.loan.officer}` },
            ]}
          />
        </View>

        <View style={pdfStyles.section}>
          <PdfHeading>{l.loan}</PdfHeading>
          <PdfDetails
            tone="tint"
            items={[
              { label: l.principal, value: data.loan.principal },
              { label: l.interest, value: `${data.loan.interest} (${data.loan.rate})` },
              { label: l.total, value: data.loan.total },
              { label: l.term, value: data.loan.term },
              { label: l.dueDate, value: data.loan.dueDate },
              { label: l.product, value: data.loan.product },
              ...(data.loan.purpose !== "" ? [{ label: l.purpose, value: data.loan.purpose }] : []),
            ]}
          />
        </View>

        {data.schedule === null ? null : (
          <View style={pdfStyles.section}>
            <View minPresenceAhead={90}>
              <PdfHeading>{l.schedule}</PdfHeading>
            </View>
            <PdfTable
              columns={[
                { label: l.installmentNo, width: "22%" },
                { label: l.installmentDue, width: "48%" },
                { label: l.installmentAmount, width: "30%", align: "right" },
              ]}
              rows={data.schedule.map((line) => [line.no, line.dueDate, line.amount])}
              total={[l.total, "", data.loan.total]}
            />
            <Text style={styles.note}>{l.scheduleNote}</Text>
          </View>
        )}

        <View style={pdfStyles.section}>
          <PdfHeading>{l.terms}</PdfHeading>
          <Terms text={data.terms} />
        </View>

        <View style={pdfStyles.section}>
          <PdfHeading>{l.collateral}</PdfHeading>
          {data.collateral.length === 0 ? (
            <Text style={pdfStyles.muted}>{l.none}</Text>
          ) : (
            <PdfTable
              columns={[
                { label: l.item, width: "18%" },
                { label: l.description, width: "42%" },
                { label: l.identifier, width: "22%" },
                { label: l.value, width: "18%", align: "right" },
              ]}
              rows={data.collateral.map((item) => [item.code, item.description, item.identifier, item.value])}
            />
          )}
        </View>

        <View style={pdfStyles.section}>
          <PdfHeading>{l.guarantors}</PdfHeading>
          {data.guarantors.length === 0 ? (
            <Text style={pdfStyles.muted}>{l.none}</Text>
          ) : (
            data.guarantors.map((guarantor) => (
              <Text key={`${guarantor.name}-${guarantor.phone}`}>
                {[guarantor.name, guarantor.relationship, guarantor.phone, guarantor.id]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </Text>
            ))
          )}
        </View>

        <View wrap={false}>
          <View style={styles.signatures}>
            <View style={styles.signature}>
              <Text>{l.signBorrower}</Text>
              <Text style={pdfStyles.muted}>{data.borrower.name}</Text>
            </View>
            {data.guarantors.map((guarantor) => (
              <View key={`sign-${guarantor.name}`} style={styles.signature}>
                <Text>{l.signGuarantor}</Text>
                <Text style={pdfStyles.muted}>{guarantor.name}</Text>
              </View>
            ))}
            <View style={styles.signature}>
              <Text>{l.signCompany}</Text>
              <Text style={pdfStyles.muted}>{data.company.name}</Text>
            </View>
          </View>
          <Text style={[pdfStyles.muted, { marginTop: 8 }]}>{l.dateLine}</Text>
        </View>

        <PdfFooter
          preparedBy={l.preparedBy}
          verifyLabel={l.verify}
          verifyUrl={data.verifyUrl}
          qrDataUrl={data.qrDataUrl}
        />
        <PdfBar />
      </Page>
    </Document>
  );
}

export function renderLoanAgreement(data: AgreementData): Promise<Buffer> {
  return renderToBuffer(<Agreement data={data} />);
}
