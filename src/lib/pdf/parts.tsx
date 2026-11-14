import "server-only";

/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is drawn into the PDF and has no alt attribute. */

import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

/*
 * The shared look of LoanDesk's A4 documents (statement, agreement, notices, collateral letters):
 * header with the logo and company details, title with a short accent rule, tinted detail boxes,
 * tables with a purple heading band, and a footer with the verify link, QR code and a brand bar.
 * Colours are the MSI brand colours from the theme (SPEC 11 Branding). Text arrives formatted.
 */
export const pdfColors = {
  primary: "#32207E",
  primaryDark: "#241660",
  tint: "#F3F1FB",
  tintStrong: "#E9E5F8",
  ink: "#0F172A",
  muted: "#475569",
  soft: "#64748B",
  line: "#E2E8F0",
  lineStrong: "#CBD5E1",
  subtle: "#F8FAFC",
  void: "#B91C1C",
} as const;

const c = pdfColors;
export const PAGE_PADDING = 40;

export const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingHorizontal: PAGE_PADDING,
    // Room for the fixed footer on every page, so long content flows to the next page.
    paddingBottom: 104,
    fontSize: 9.5,
    color: c.ink,
    fontFamily: "Helvetica",
    lineHeight: 1.45,
  },
  muted: { color: c.muted },
  strong: { fontFamily: "Helvetica-Bold" },
  section: { marginTop: 16 },
  heading: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: c.ink, marginBottom: 7 },
  label: { fontSize: 8, color: c.muted, marginBottom: 1 },
  value: { fontFamily: "Helvetica-Bold" },
});

const parts = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { flexDirection: "row", alignItems: "center", flexShrink: 1, paddingRight: 16 },
  logo: { width: 48, height: 48, objectFit: "contain" },
  brandRule: { width: 1, alignSelf: "stretch", backgroundColor: c.lineStrong, marginHorizontal: 12 },
  company: { fontSize: 14, fontFamily: "Helvetica-Bold", color: c.primaryDark, marginBottom: 2 },
  contact: { fontSize: 8.5, color: c.muted, lineHeight: 1.4 },
  docMeta: { width: 132, alignItems: "flex-end" },
  number: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    backgroundColor: c.primaryDark,
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  date: { fontSize: 8.5, color: c.muted, marginTop: 5 },
  divider: { height: 1, backgroundColor: c.line, marginTop: 14, marginBottom: 18 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: c.ink, lineHeight: 1.2 },
  accent: { width: 40, height: 3, borderRadius: 2, backgroundColor: c.primary, marginTop: 6 },
  subtitle: { fontSize: 9.5, color: c.muted, marginTop: 6 },
  box: { borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12 },
  boxPlain: { backgroundColor: c.subtle, borderWidth: 1, borderColor: c.line },
  boxTint: { backgroundColor: c.tint },
  columns: { flexDirection: "row" },
  column: { paddingRight: 10 },
  columnRule: { borderLeftWidth: 1, borderColor: c.lineStrong, paddingLeft: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  gridCell: { width: "50%", paddingRight: 12, marginBottom: 7 },
  tableHead: {
    flexDirection: "row",
    backgroundColor: c.primary,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  th: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  row: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: c.line,
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: c.tintStrong,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
  },
  total: { fontFamily: "Helvetica-Bold", color: c.primaryDark },
  chip: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    borderRadius: 8,
    paddingVertical: 1.5,
    paddingHorizontal: 6,
  },
  footer: {
    position: "absolute",
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    bottom: 26,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderColor: c.line,
    paddingTop: 10,
  },
  footerText: { paddingRight: 16 },
  footerStrong: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: c.ink, marginBottom: 2 },
  footerSmall: { fontSize: 7.5, color: c.muted },
  link: { fontSize: 7.5, color: c.primary },
  qr: { width: 58, height: 58 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 7, backgroundColor: c.primary },
});

export function PdfHeader({
  company,
  number,
  date,
}: {
  company: { name: string; lines: string[]; logo: Buffer | null };
  number: string;
  date: string;
}) {
  return (
    <View>
      <View style={parts.header}>
        <View style={parts.brand}>
          {company.logo !== null ? (
            <>
              <Image src={company.logo} style={parts.logo} />
              <View style={parts.brandRule} />
            </>
          ) : null}
          <View style={{ flexShrink: 1 }}>
            <Text style={parts.company}>{company.name}</Text>
            {company.lines
              .filter((line) => line !== "")
              .map((line) => (
                <Text key={line} style={parts.contact}>
                  {line}
                </Text>
              ))}
          </View>
        </View>
        <View style={parts.docMeta}>
          <Text style={parts.number}>{number}</Text>
          <Text style={parts.date}>{date}</Text>
        </View>
      </View>
      <View style={parts.divider} />
    </View>
  );
}

export function PdfTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View>
      <Text style={parts.title}>{title}</Text>
      <View style={parts.accent} />
      {subtitle !== undefined && subtitle !== "" ? <Text style={parts.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function PdfHeading({ children }: { children: ReactNode }) {
  return <Text style={pdfStyles.heading}>{children}</Text>;
}

/*
 * Label / value pairs in a box. Up to three pairs sit side by side with thin rules between them;
 * more wrap in two columns. "tint" is the lavender summary box, "plain" a light grey one.
 */
export function PdfDetails({
  items,
  tone = "plain",
}: {
  items: Array<{ label: string; value: string }>;
  tone?: "plain" | "tint";
}) {
  const inline = items.length <= 3;
  return (
    <View style={[parts.box, tone === "tint" ? parts.boxTint : parts.boxPlain]} wrap={false}>
      <View style={inline ? parts.columns : parts.grid}>
        {items.map((item, index) => (
          <View
            key={`${item.label}-${index}`}
            style={
              inline
                ? [
                    parts.column,
                    { width: `${100 / items.length}%` },
                    ...(index > 0 ? [parts.columnRule] : []),
                  ]
                : parts.gridCell
            }
          >
            <Text style={pdfStyles.label}>{item.label}</Text>
            <Text style={pdfStyles.value}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export type ChipTone = "paid" | "due" | "behind" | "neutral";
export type PdfCell = string | { text: string; tone: ChipTone };

const CHIP: Record<ChipTone, { color: string; backgroundColor: string }> = {
  paid: { color: "#166534", backgroundColor: "#DCFCE7" },
  due: { color: c.primaryDark, backgroundColor: c.tintStrong },
  behind: { color: "#7C2D12", backgroundColor: "#FFEDD5" },
  neutral: { color: "#334155", backgroundColor: "#E2E8F0" },
};

export interface PdfColumn {
  label: string;
  width: string;
  align?: "left" | "right";
}

function CellText({
  value,
  column,
  bold,
}: {
  value: PdfCell;
  column: PdfColumn | undefined;
  bold?: boolean;
}) {
  const box = { width: column?.width, textAlign: column?.align ?? ("left" as const) };
  if (typeof value === "string") {
    return <Text style={[box, ...(bold === true ? [parts.total] : [])]}>{value}</Text>;
  }
  return (
    <View
      style={{
        width: column?.width,
        flexDirection: "row",
        justifyContent: column?.align === "right" ? "flex-end" : "flex-start",
      }}
    >
      <Text style={[parts.chip, CHIP[value.tone]]}>{value.text}</Text>
    </View>
  );
}

export function PdfTable({
  columns,
  rows,
  total,
}: {
  columns: PdfColumn[];
  rows: PdfCell[][];
  total?: string[];
}) {
  return (
    <View>
      <View style={parts.tableHead} fixed>
        {columns.map((column) => (
          <Text
            key={column.label}
            style={[parts.th, { width: column.width, textAlign: column.align ?? "left" }]}
          >
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row, index) => (
        <View key={index} style={parts.row} wrap={false}>
          {row.map((value, column) => (
            <CellText key={column} value={value} column={columns[column]} />
          ))}
        </View>
      ))}
      {total !== undefined ? (
        <View style={parts.totalRow} wrap={false}>
          {total.map((value, column) => (
            <CellText key={column} value={value} column={columns[column]} bold />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* Fixed on every page: who prepared it, how to verify it, the QR code and the brand bar. */
export function PdfFooter({
  preparedBy,
  verifyLabel,
  verifyUrl,
  qrDataUrl,
}: {
  preparedBy: string;
  verifyLabel: string;
  verifyUrl: string;
  qrDataUrl: string;
}) {
  return (
    <View style={parts.footer} fixed>
      <View style={parts.footerText}>
        <Text style={parts.footerStrong}>{preparedBy}</Text>
        <Text style={parts.footerSmall}>{verifyLabel}</Text>
        <Text style={parts.link}>{verifyUrl}</Text>
      </View>
      <Image src={qrDataUrl} style={parts.qr} />
    </View>
  );
}

/* The brand bar along the bottom edge of every page. */
export function PdfBar() {
  return <View style={parts.bar} fixed />;
}
