import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { InvoiceView } from "@/lib/billing/service";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#15803d" },
  muted: { color: "#4b5563" },
  h2: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#4b5563", textTransform: "uppercase", marginBottom: 4 },
  block: { marginBottom: 18 },
  table: { borderTopWidth: 1, borderTopColor: "#d1d5db", marginTop: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 0.6, borderBottomColor: "#e5e7eb" },
  bold: { fontFamily: "Helvetica-Bold" },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, fontSize: 12, fontFamily: "Helvetica-Bold" },
  paid: { marginTop: 18, padding: 8, backgroundColor: "#dcfce7", color: "#166534", fontFamily: "Helvetica-Bold", textAlign: "center" },
});

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function InvoiceDocument({ invoice }: { invoice: InvoiceView }) {
  const bill = invoice.billTo;
  return (
    <Document title={`Invoice ${invoice.number}`} author="Web365 Nigeria">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Web365 Nigeria</Text>
            <Text style={styles.muted}>Pharmacy ERP subscription</Text>
          </View>
          <View>
            <Text style={styles.bold}>Invoice {invoice.number}</Text>
            <Text style={styles.muted}>Issued {day(invoice.issuedAt)}</Text>
            <Text style={styles.muted}>Payment reference {invoice.reference}</Text>
          </View>
        </View>
        <View style={styles.block}>
          <Text style={styles.h2}>Billed to</Text>
          <Text style={styles.bold}>{bill.name}</Text>
          {bill.address ? <Text>{bill.address}</Text> : null}
          {bill.state ? <Text>{bill.state}, {bill.country}</Text> : null}
          {bill.business_email ? <Text>{bill.business_email}</Text> : null}
          {bill.business_phone ? <Text>{bill.business_phone}</Text> : null}
        </View>
        <View style={styles.table}>
          <View style={styles.row}>
            <Text>{invoice.planName} plan, {invoice.billingCycle === "MONTHLY" ? "monthly" : "annual"} ({day(invoice.periodStart)} to {day(invoice.periodEnd)})</Text>
            <Text>{money(invoice.currency, invoice.subtotal)}</Text>
          </View>
          {invoice.credit > 0 ? (
            <View style={styles.row}><Text>Credit for unused time on the previous plan</Text><Text>- {money(invoice.currency, invoice.credit)}</Text></View>
          ) : null}
          <View style={styles.total}><Text>Total paid</Text><Text>{money(invoice.currency, invoice.total)}</Text></View>
        </View>
        <Text style={styles.paid}>{invoice.status === "PAID" ? "PAID — thank you" : invoice.status}</Text>
      </Page>
    </Document>
  );
}

export async function invoicePdf(invoice: InvoiceView) {
  return renderToBuffer(<InvoiceDocument invoice={invoice} />);
}
