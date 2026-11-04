import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { InventoryReport, ReportColumn } from "@/lib/erp/inventory-reports";

const GREEN = "#15803d";
const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, fontFamily: "Helvetica", color: "#1a2b22" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#a3e635", paddingBottom: 8, marginBottom: 10 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: GREEN },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2 },
  muted: { color: "#5a6a63" },
  table: { borderWidth: 0.5, borderColor: "#cfdad4" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e3ebe6" },
  head: { backgroundColor: GREEN, color: "#ffffff", fontFamily: "Helvetica-Bold" },
  cell: { paddingVertical: 4, paddingHorizontal: 5, flexGrow: 1, flexBasis: 0 },
  wide: { flexGrow: 2.2 },
  right: { textAlign: "right" },
  totals: { backgroundColor: "#f0fdf4", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", color: "#73827b", fontSize: 7.5 },
});

function format(value: string | number | undefined, type: ReportColumn["type"]) {
  if (value === undefined || value === "") return "";
  if (type === "money") return `NGN ${Math.round(Number(value)).toLocaleString("en-NG")}`;
  if (type === "number") return Number(value).toLocaleString("en-NG");
  if (type === "percent") return `${Number(value).toFixed(1)}%`;
  if (type === "date") return new Date(String(value)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return String(value);
}

function ReportDocument({ report }: { report: InventoryReport }) {
  const isWide = (column: ReportColumn) => column.key === "product" || column.key === "source";
  const numeric = (column: ReportColumn) => column.type !== "text" && column.type !== "date";
  return (
    <Document title={report.title} author={report.businessName}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>{report.businessName}</Text>
            <Text style={styles.title}>{report.title}</Text>
            <Text style={styles.muted}>{report.description}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text>{report.scopeLabel}</Text>
            <Text style={styles.muted}>{report.filtersLabel}</Text>
            <Text style={styles.muted}>Generated {new Date(report.generatedAt).toLocaleString("en-GB")} by {report.generatedBy}</Text>
          </View>
        </View>
        <View style={styles.table}>
          <View style={[styles.row, styles.head]} fixed>
            {report.columns.map((column) => (
              <Text key={column.key} style={[styles.cell, isWide(column) ? styles.wide : {}, numeric(column) ? styles.right : {}]}>{column.header}</Text>
            ))}
          </View>
          {report.rows.length === 0 ? (
            <View style={styles.row}><Text style={styles.cell}>No records match this report.</Text></View>
          ) : (
            report.rows.map((row, index) => (
              <View key={index} style={styles.row} wrap={false}>
                {report.columns.map((column) => (
                  <Text key={column.key} style={[styles.cell, isWide(column) ? styles.wide : {}, numeric(column) ? styles.right : {}]}>{format(row[column.key], column.type)}</Text>
                ))}
              </View>
            ))
          )}
          {Object.keys(report.totals).length && report.rows.length ? (
            <View style={[styles.row, styles.totals]}>
              {report.columns.map((column, index) => (
                <Text key={column.key} style={[styles.cell, isWide(column) ? styles.wide : {}, numeric(column) ? styles.right : {}]}>
                  {index === 0 ? `Total (${report.rows.length})` : format(report.totals[column.key], column.type)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
        <View style={styles.footer} fixed>
          <Text>Batch-level inventory records · {report.businessName}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function inventoryReportPdf(report: InventoryReport) {
  return renderToBuffer(<ReportDocument report={report} />);
}
