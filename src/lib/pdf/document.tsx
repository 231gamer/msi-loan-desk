import "server-only";

/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is drawn into the PDF and has no alt attribute. */

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

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
  type PdfCell,
} from "./parts";

/*
 * One A4 layout for the M7 documents (SPEC 10.1; FR-14, FR-25): statement of account, demand
 * notice, collateral receipt and collateral release letter. Each carries the company header from
 * settings.company, its number, generation time, the preparer and a QR code to /verify/<token>.
 * The caller passes finished text (amounts and dates already formatted); this file only lays out.
 */
export type Block =
  | { type: "details"; heading?: string; items: Array<{ label: string; value: string }>; boxed?: boolean }
  | {
      type: "table";
      heading?: string;
      columns: Array<{ label: string; width: string; align?: "left" | "right" }>;
      rows: PdfCell[][];
      total?: string[];
    }
  | { type: "text"; heading?: string; text: string; strong?: boolean }
  | { type: "images"; heading?: string; images: Buffer[] }
  | { type: "signatures"; items: Array<{ label: string; name: string }>; dateLine?: string };

export interface DocumentData {
  company: { name: string; contact: string; logo: Buffer | null };
  title: string;
  subtitle?: string;
  number: string;
  generatedAt: string;
  preparedBy: string;
  qrDataUrl: string;
  verifyUrl: string;
  verifyLabel: string;
  voidLabel?: string;
  blocks: Block[];
}

const styles = StyleSheet.create({
  images: { flexDirection: "row", gap: 8 },
  photo: { width: 150, height: 110, objectFit: "cover", borderRadius: 4 },
  signatures: { flexDirection: "row", gap: 18, marginTop: 34 },
  signature: { flex: 1, borderTopWidth: 1, borderColor: pdfColors.ink, paddingTop: 4 },
  stamp: {
    position: "absolute",
    top: 320,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 96,
    fontFamily: "Helvetica-Bold",
    color: pdfColors.void,
    opacity: 0.2,
    transform: "rotate(-20deg)",
  },
});

/* The company contact line ("address · phone · …") as two lines: the address, then the rest. */
function contactLines(contact: string): string[] {
  const parts = contact.split(" · ").filter((part) => part !== "");
  return parts.length <= 1 ? parts : [parts[0] ?? "", parts.slice(1).join("  |  ")];
}

function BlockView({ block }: { block: Block }) {
  const heading =
    "heading" in block && block.heading !== undefined ? <PdfHeading>{block.heading}</PdfHeading> : null;
  switch (block.type) {
    case "details":
      return (
        <View style={pdfStyles.section} wrap={false}>
          {heading}
          <PdfDetails items={block.items} tone={block.boxed === true ? "tint" : "plain"} />
        </View>
      );
    case "table":
      return (
        <View style={pdfStyles.section}>
          {heading}
          <PdfTable columns={block.columns} rows={block.rows} total={block.total} />
        </View>
      );
    case "text":
      return (
        <View style={pdfStyles.section}>
          {heading}
          <Text style={block.strong === true ? pdfStyles.strong : {}}>{block.text}</Text>
        </View>
      );
    case "images":
      return block.images.length === 0 ? null : (
        <View style={pdfStyles.section} wrap={false}>
          {heading}
          <View style={styles.images}>
            {block.images.map((image, index) => (
              <Image key={index} src={image} style={styles.photo} />
            ))}
          </View>
        </View>
      );
    case "signatures":
      return (
        <View wrap={false}>
          <View style={styles.signatures}>
            {block.items.map((item) => (
              <View key={item.label + item.name} style={styles.signature}>
                <Text>{item.label}</Text>
                <Text style={pdfStyles.muted}>{item.name}</Text>
              </View>
            ))}
          </View>
          {block.dateLine !== undefined ? (
            <Text style={[pdfStyles.muted, { marginTop: 8 }]}>{block.dateLine}</Text>
          ) : null}
        </View>
      );
  }
}

function OfficialDocument({ data }: { data: DocumentData }) {
  return (
    <Document title={`${data.title} ${data.number}`} author={data.company.name}>
      <Page size="A4" style={pdfStyles.page}>
        <PdfHeader
          company={{
            name: data.company.name,
            lines: contactLines(data.company.contact),
            logo: data.company.logo,
          }}
          number={data.number}
          date={data.generatedAt}
        />
        <PdfTitle title={data.title} subtitle={data.subtitle} />
        {data.blocks.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
        {data.voidLabel !== undefined ? (
          <Text style={styles.stamp} fixed>
            {data.voidLabel}
          </Text>
        ) : null}
        <PdfFooter
          preparedBy={data.preparedBy}
          verifyLabel={data.verifyLabel}
          verifyUrl={data.verifyUrl}
          qrDataUrl={data.qrDataUrl}
        />
        <PdfBar />
      </Page>
    </Document>
  );
}

export function renderOfficialDocument(data: DocumentData): Promise<Buffer> {
  return renderToBuffer(<OfficialDocument data={data} />);
}
