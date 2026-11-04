import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { SalesOverview } from "@/lib/erp/sales-overview";

const GREEN = "#15803d";
const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, fontFamily: "Helvetica", color: "#1a2b22" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#a3e635", paddingBottom: 8, marginBottom: 12 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: GREEN },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2 },
  muted: { color: "#5a6a63" },
  section: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 5, color: GREEN },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tile: { width: "23.5%", borderWidth: 0.5, borderColor: "#cfdad4", borderRadius: 4, padding: 6 },
  tileValue: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e3ebe6" },
  head: { backgroundColor: GREEN, color: "#ffffff", fontFamily: "Helvetica-Bold" },
  cell: { paddingVertical: 4, paddingHorizontal: 5, flexGrow: 1, flexBasis: 0, textAlign: "right" },
  first: { flexGrow: 2.2, textAlign: "left" },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", color: "#73827b", fontSize: 7.5 },
});

const naira = (value: number) => `NGN ${Math.round(value).toLocaleString("en-NG")}`;

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <View>
      <View style={[styles.row, styles.head]}>{headers.map((header, index) => <Text key={header} style={[styles.cell, index === 0 ? styles.first : {}]}>{header}</Text>)}</View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row} wrap={false}>
          {row.map((value, index) => <Text key={index} style={[styles.cell, index === 0 ? styles.first : {}]}>{String(value)}</Text>)}
        </View>
      ))}
    </View>
  );
}

function OverviewDocument({ overview }: { overview: SalesOverview }) {
  const { meta, totals: t } = overview;
  const tiles: [string, string][] = [
    ["Gross sales (excl. VAT)", naira(t.gross)],
    ["Discounts", naira(t.discounts)],
    ["Returns & refunds (excl. VAT)", `${naira(t.returns)} · ${t.returnsCount}`],
    ["Net sales", naira(t.net)],
    ["Completed transactions", t.transactions.toLocaleString()],
    ["Cash (net of refunds)", naira(t.payments.netCash)],
    ["Bank transfer (net)", naira(t.payments.netTransfer)],
    ["POS terminal (net)", naira(t.payments.netPos)],
    ["On account (credit/HMO)", naira(t.payments.onAccount)],
    ["Output VAT (net of returns)", naira(t.vat)],
    ["Voided (excluded)", `${t.voided} · ${naira(t.voidedValue)}`],
    ["Average basket (incl. VAT)", naira(t.avgBasket)],
  ];
  return (
    <Document title={`Sales overview ${meta.from} – ${meta.to}`} author={meta.businessName}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>{meta.businessName}</Text>
            <Text style={styles.title}>Daily sales overview</Text>
            <Text style={styles.muted}>{meta.from === meta.to ? meta.from : `${meta.from} to ${meta.to}`} · {meta.scopeLabel}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.muted}>Generated {new Date(meta.generatedAt).toLocaleString("en-GB")}</Text>
            <Text style={styles.muted}>by {meta.generatedBy}</Text>
          </View>
        </View>
        <View style={styles.grid}>
          {tiles.map(([label, value]) => (
            <View key={label} style={styles.tile}>
              <Text style={styles.muted}>{label}</Text>
              <Text style={styles.tileValue}>{value}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.muted, { marginTop: 6 }]}>Net sales = gross − discounts − returns (all excluding VAT). Voided and cancelled invoices are excluded. Dates in West Africa Time.</Text>
        <Text style={styles.section}>Sales by outlet</Text>
        <Table
          headers={["Outlet", "Transactions", "Gross", "Discounts", "Returns", "Net sales", "Cash", "Transfer", "POS", "Voided"]}
          rows={overview.byOutlet.map((row) => [row.name, row.transactions, naira(row.gross), naira(row.discounts), naira(row.returns), naira(row.net), naira(row.payments.netCash), naira(row.payments.netTransfer), naira(row.payments.netPos), row.voided])}
        />
        <Text style={styles.section}>Sales by cashier</Text>
        <Table
          headers={["Cashier", "Outlet", "Transactions", "Gross", "Discounts", "Returns", "Net sales", "Avg basket", "Voids"]}
          rows={overview.byCashier.map((row) => [row.cashier, row.outlets, row.transactions, naira(row.gross), naira(row.discounts), naira(row.returns), naira(row.net), naira(row.avgBasket), row.voided])}
        />
        <View style={styles.footer} fixed>
          <Text>Figures computed from the sales database · {meta.businessName}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function salesOverviewPdf(overview: SalesOverview) {
  return renderToBuffer(<OverviewDocument overview={overview} />);
}
