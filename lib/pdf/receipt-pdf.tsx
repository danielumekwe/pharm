import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { Receipt } from "@/lib/erp/pos";

const styles = StyleSheet.create({
  page: { padding: 14, fontSize: 8, fontFamily: "Helvetica", color: "#111827" },
  center: { textAlign: "center" },
  brand: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "center" },
  muted: { color: "#4b5563" },
  rule: { borderBottomWidth: 0.6, borderBottomColor: "#9ca3af", borderStyle: "dashed", marginVertical: 5 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 1.5 },
  bold: { fontFamily: "Helvetica-Bold" },
  total: { fontSize: 10, fontFamily: "Helvetica-Bold" },
});

const ngn = (value: number) => `NGN ${value.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ReceiptDocument({ receipt }: { receipt: Receipt }) {
  const { sale, outlet, business } = receipt;
  const lineHeight = 30 + sale.lines.length * 22 + receipt.tenders.length * 10;
  return (
    <Document title={`Receipt ${sale.number}`} author={business.name}>
      {/* 80 mm thermal-roll width; height grows with the basket. */}
      <Page size={[226, 330 + lineHeight]} style={styles.page}>
        <Text style={styles.brand}>{business.name}</Text>
        <Text style={[styles.center, styles.muted]}>{outlet.name}</Text>
        {outlet.address ? <Text style={[styles.center, styles.muted]}>{outlet.address}</Text> : null}
        {outlet.phone ? <Text style={[styles.center, styles.muted]}>Tel {outlet.phone}</Text> : null}
        {outlet.pcnLicense ? <Text style={[styles.center, styles.muted]}>PCN {outlet.pcnLicense}</Text> : null}
        <View style={styles.rule} />
        <View style={styles.row}><Text>Receipt</Text><Text style={styles.bold}>{sale.number}</Text></View>
        <View style={styles.row}><Text>Date</Text><Text>{new Date(sale.date).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}</Text></View>
        <View style={styles.row}><Text>Cashier</Text><Text>{sale.cashier}</Text></View>
        <View style={styles.row}><Text>Customer</Text><Text>{sale.customerName}</Text></View>
        {sale.walkIn?.phone ? <View style={styles.row}><Text>Phone</Text><Text>{sale.walkIn.phone}</Text></View> : null}
        {sale.prescriptionRef ? <View style={styles.row}><Text>Prescription</Text><Text>{sale.prescriptionRef}</Text></View> : null}
        {receipt.copy > 1 ? <Text style={[styles.center, styles.bold]}>REPRINT — COPY {receipt.copy}</Text> : null}
        <View style={styles.rule} />
        {sale.lines.map((line, index) => (
          <View key={`${line.productId}-${index}`} style={{ marginBottom: 3 }}>
            <Text style={styles.bold}>{line.productName}</Text>
            <View style={styles.row}>
              <Text>
                {line.packQuantity ?? line.quantity} {line.packagingName ?? "unit"} × {ngn(line.packPrice ?? line.unitPrice)}
              </Text>
              <Text>{ngn((line.packPrice ?? line.unitPrice) * (line.packQuantity ?? line.quantity))}</Text>
            </View>
            {line.discount ? <View style={styles.row}><Text style={styles.muted}>  Discount</Text><Text style={styles.muted}>-{ngn(line.discount)}</Text></View> : null}
            {line.batchNumbers.length ? <Text style={styles.muted}>  Batch {line.batchNumbers.join(", ")}</Text> : null}
          </View>
        ))}
        <View style={styles.rule} />
        <View style={styles.row}><Text>Subtotal</Text><Text>{ngn(sale.subtotal)}</Text></View>
        {sale.discount ? <View style={styles.row}><Text>Discount{sale.globalDiscount ? ` (incl. basket ${sale.globalDiscount.type === "percent" ? `${sale.globalDiscount.value}%` : ngn(sale.globalDiscount.value)})` : ""}</Text><Text>-{ngn(sale.discount)}</Text></View> : null}
        <View style={styles.row}><Text>VAT {receipt.vatRate}%</Text><Text>{ngn(sale.vat)}</Text></View>
        <View style={styles.row}><Text style={styles.total}>TOTAL</Text><Text style={styles.total}>{ngn(sale.total)}</Text></View>
        <View style={styles.rule} />
        {receipt.tenders.map((tender, index) => (
          <View key={index} style={styles.row}><Text>{tender.method === "Card" ? "POS terminal" : tender.method === "Account" ? "On account" : tender.method}</Text><Text>{ngn(tender.amount)}</Text></View>
        ))}
        {sale.tendered ? <View style={styles.row}><Text>Cash tendered</Text><Text>{ngn(sale.tendered)}</Text></View> : null}
        {sale.change ? <View style={styles.row}><Text style={styles.bold}>Change</Text><Text style={styles.bold}>{ngn(sale.change)}</Text></View> : null}
        {sale.status === "Voided" ? <Text style={[styles.center, styles.bold, { marginTop: 4 }]}>VOIDED{sale.voidReason ? ` — ${sale.voidReason}` : ""}</Text> : null}
        {receipt.returns.map((row) => (
          <Text key={row.number} style={styles.muted}>Returned {row.number}: -{ngn(row.total)}</Text>
        ))}
        <View style={styles.rule} />
        <Text style={[styles.center, styles.muted]}>Thank you. Please check your medicines before leaving.</Text>
        <Text style={[styles.center, styles.muted]}>Returns accepted within 30 days with this receipt.</Text>
      </Page>
    </Document>
  );
}

export async function receiptPdf(receipt: Receipt) {
  return renderToBuffer(<ReceiptDocument receipt={receipt} />);
}
