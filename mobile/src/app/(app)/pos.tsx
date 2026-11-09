import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/app-header';
import { Banner, Button, Card, Muted, Row } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { naira } from '@/lib/format';
import { useData } from '@/lib/use-data';

type Pack = { id: string; name: string; unitsPerPackage: number; price: number; barcodes: string[] };
type Item = { id: string; name: string; strength?: string; genericName?: string; baseUnit: string; rxOnly: boolean; available: number; barcodes: string[]; packaging: Pack[]; batches: { batchNumber: string; expiryDate: string; days: number }[] };
type Line = { item: Item; pack: Pack; quantity: number };
type Method = 'Cash' | 'Card' | 'Transfer';
type Sale = { id: string; number: string; total: number; vat: number; change?: number; amountPaid: number };

const METHODS: [Method, string, React.ComponentProps<typeof Icon>['name']][] = [['Cash', 'Cash', 'cash'], ['Card', 'POS', 'credit-card-outline'], ['Transfer', 'Transfer', 'bank-transfer']];

/** The till: search or scan, build the basket, take payment. Stock, expiry order and prices are checked by the server. */
export default function PosScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const outletId = session?.user.outletId ?? null;
  const catalog = useData<Item[]>(outletId ? `/api/pos/catalog?outletId=${encodeURIComponent(outletId)}` : null);
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState<Method>('Cash');
  const [tendered, setTendered] = useState('');
  const [rxRef, setRxRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Sale | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const lastScan = useRef({ code: '', at: 0 });

  const items = useMemo(() => catalog.data ?? [], [catalog.data]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items.filter((item) => item.name.toLowerCase().includes(q) || (item.genericName ?? '').toLowerCase().includes(q) || item.barcodes.includes(q)).slice(0, 30);
  }, [items, query]);
  const total = lines.reduce((sum, line) => sum + line.pack.price * line.quantity, 0);
  const needsRx = lines.some((line) => line.item.rxOnly);
  const cashGiven = Number(tendered.replace(/[^\d.]/g, '')) || 0;

  function add(item: Item, pack = item.packaging[0]) {
    if (!pack) return;
    setError('');
    setLines((current) => {
      const index = current.findIndex((line) => line.item.id === item.id && line.pack.id === pack.id);
      if (index >= 0) return current.map((line, i) => (i === index ? { ...line, quantity: line.quantity + 1 } : line));
      return [...current, { item, pack, quantity: 1 }];
    });
    setQuery('');
  }

  function change(index: number, delta: number) {
    setLines((current) => current.flatMap((line, i) => (i !== index ? [line] : line.quantity + delta <= 0 ? [] : [{ ...line, quantity: line.quantity + delta }])));
  }

  function onScan(code: string) {
    const now = Date.now();
    if (code === lastScan.current.code && now - lastScan.current.at < 2500) return;
    lastScan.current = { code, at: now };
    for (const item of items) {
      const pack = item.packaging.find((row) => row.barcodes.includes(code));
      if (pack) return add(item, pack);
      if (item.barcodes.includes(code)) return add(item);
    }
    Alert.alert('Not found', `No product at this outlet has the barcode ${code}.`);
  }

  async function startScan() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return Alert.alert('Camera needed', 'Allow camera access in your phone settings to scan barcodes.');
    }
    setScanning(true);
  }

  async function checkout() {
    if (!outletId || !lines.length) return;
    if (method === 'Cash' && tendered && cashGiven < total) return setError(`Cash given is less than ${naira(total)}.`);
    setBusy(true);
    setError('');
    try {
      const sale = await api<Sale>('/api/sales', {
        method: 'POST',
        body: {
          outletId,
          customerId: null,
          paymentMethod: method,
          ...(method === 'Cash' && tendered ? { amountPaid: cashGiven } : {}),
          ...(rxRef.trim() ? { prescriptionRef: rxRef.trim() } : {}),
          lines: lines.map((line) => ({ productId: line.item.id, packagingId: line.pack.id, quantity: line.quantity })),
        },
      });
      setDone(sale);
      setLines([]);
      setTendered('');
      setRxRef('');
      void catalog.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sale could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (!outletId) {
    return <View style={[styles.center, { backgroundColor: theme.background }]}><Card><Muted>Sales are made at an outlet. Sign in at one of your outlets (Settings → Change pharmacy or location) to use the till.</Muted></Card></View>;
  }

  if (done) {
    return (
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scroll}>
        <Card style={{ alignItems: 'center', gap: Spacing.three }}>
          <View style={[styles.doneIcon, { backgroundColor: theme.successSoft }]}><Icon name="check-bold" size={44} color={theme.success} /></View>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Sale completed</Text>
          <Muted>Receipt {done.number}</Muted>
          <View style={{ alignSelf: 'stretch' }}>
            <Row label="Total (incl. VAT)" value={naira(done.total)} strong />
            <Row label="VAT" value={naira(done.vat)} />
            <Row label="Paid" value={naira(done.amountPaid)} />
            {done.change ? <Row label="Change" value={naira(done.change)} strong /> : null}
          </View>
        </Card>
        <Button label="New sale" onPress={() => setDone(null)} />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.searchRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View style={[styles.search, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <Icon name="magnify" size={22} color={theme.textSecondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search product or type barcode" placeholderTextColor={theme.textSecondary} style={{ flex: 1, color: theme.text, fontSize: 16, minHeight: 44 }} autoCorrect={false} returnKeyType="search" />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Scan barcode" onPress={() => void startScan()} style={[styles.scanButton, { backgroundColor: theme.primary }]}>
          <Icon name="barcode-scan" size={26} color="#FFFFFF" />
        </Pressable>
      </View>

      {query ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
          ListEmptyComponent={<Muted style={{ padding: Spacing.four }}>No product matches “{query}”.</Muted>}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" disabled={item.available <= 0} onPress={() => add(item)} style={[styles.result, { backgroundColor: theme.card, borderColor: theme.border, opacity: item.available <= 0 ? 0.5 : 1 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{item.name}{item.strength ? ` ${item.strength}` : ''}</Text>
                <Muted>{item.available > 0 ? `${item.available} ${item.baseUnit.toLowerCase()}(s) in stock` : 'Out of stock'}{item.rxOnly ? ' · Rx' : ''}{item.batches[0] ? ` · exp ${item.batches[0].expiryDate}` : ''}</Muted>
              </View>
              <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '800' }}>{naira(item.packaging[0]?.price)}</Text>
            </Pressable>
          )}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {catalog.loading ? <ActivityIndicator color={theme.primary} /> : catalog.error ? <Banner tone="danger">{catalog.error}</Banner> : null}
          {!lines.length ? (
            <Card style={{ alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six }}>
              <Icon name="cart-outline" size={48} color={theme.textSecondary} />
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Basket is empty</Text>
              <Muted style={{ textAlign: 'center' }}>Scan a barcode or search for a product to start a sale. {items.length ? `${items.length} products available here.` : ''}</Muted>
            </Card>
          ) : (
            <Card>
              {lines.map((line, index) => (
                <View key={`${line.item.id}-${line.pack.id}`} style={[styles.line, { borderBottomColor: theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{line.item.name}</Text>
                    {line.item.packaging.length > 1 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 4 }}>
                        {line.item.packaging.map((pack) => (
                          <Pressable key={pack.id} onPress={() => setLines((current) => current.map((row, i) => (i === index ? { ...row, pack } : row)))} style={[styles.packChip, { borderColor: pack.id === line.pack.id ? theme.primary : theme.border, backgroundColor: pack.id === line.pack.id ? theme.successSoft : 'transparent' }]}>
                            <Text style={{ color: pack.id === line.pack.id ? theme.primary : theme.textSecondary, fontSize: 12, fontWeight: '700' }}>{pack.name} · {naira(pack.price)}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : <Muted>{line.pack.name} · {naira(line.pack.price)}</Muted>}
                  </View>
                  <View style={styles.qty}>
                    <Pressable accessibilityLabel="Less" onPress={() => change(index, -1)} style={[styles.qtyButton, { borderColor: theme.border }]}><Icon name={line.quantity === 1 ? 'trash-can-outline' : 'minus'} size={18} color={theme.text} /></Pressable>
                    <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', minWidth: 24, textAlign: 'center' }}>{line.quantity}</Text>
                    <Pressable accessibilityLabel="More" onPress={() => change(index, 1)} style={[styles.qtyButton, { borderColor: theme.border }]}><Icon name="plus" size={18} color={theme.text} /></Pressable>
                  </View>
                </View>
              ))}
              <Row label={`Subtotal (${lines.reduce((sum, line) => sum + line.quantity, 0)} items)`} value={naira(total)} strong />
              <Muted>VAT and any discounts are applied when the sale is recorded.</Muted>
            </Card>
          )}

          {lines.length ? (
            <Card>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>Payment</Text>
              <View style={styles.methods}>
                {METHODS.map(([key, label, icon]) => (
                  <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: method === key }} onPress={() => setMethod(key)} style={[styles.method, { borderColor: method === key ? theme.primary : theme.border, backgroundColor: method === key ? theme.successSoft : theme.card }]}>
                    <Icon name={icon} size={24} color={method === key ? theme.primary : theme.textSecondary} />
                    <Text style={{ color: method === key ? theme.primary : theme.text, fontWeight: '700' }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {method === 'Cash' ? <TextInput value={tendered} onChangeText={setTendered} keyboardType="numeric" placeholder="Cash given (optional)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBackground }]} /> : null}
              {method === 'Cash' && cashGiven > total ? <Row label="Change (before VAT)" value={naira(cashGiven - total)} /> : null}
              {needsRx ? <TextInput value={rxRef} onChangeText={setRxRef} placeholder="Prescription reference (Rx item in basket)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBackground }]} /> : null}
              {error ? <Banner tone="danger">{error}</Banner> : null}
              <Button label={`Complete sale · ${naira(total)}`} onPress={() => void checkout()} busy={busy} />
            </Card>
          ) : null}
        </ScrollView>
      )}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          {scanning ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr', 'datamatrix', 'itf14'] }}
              onBarcodeScanned={(result) => onScan(result.data)}
            />
          ) : null}
          <View style={styles.scanFrame} pointerEvents="none"><View style={styles.scanBox} /></View>
          <View style={styles.scanBar}>
            <Text style={{ color: '#FFFFFF', fontSize: 15, flex: 1 }}>{lines.length ? `${lines.reduce((sum, line) => sum + line.quantity, 0)} item(s) · ${naira(total)}` : 'Point the camera at a barcode'}</Text>
            <Pressable accessibilityRole="button" onPress={() => setScanning(false)} style={styles.scanDone}><Text style={{ color: '#0A4D29', fontWeight: '800' }}>Done</Text></Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: Spacing.four, justifyContent: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  searchRow: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three },
  scanButton: { width: 52, borderRadius: Radius.medium, alignItems: 'center', justifyContent: 'center' },
  result: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  packChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  methods: { flexDirection: 'row', gap: Spacing.two },
  method: { flex: 1, alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: Radius.medium, paddingVertical: Spacing.three },
  input: { minHeight: 50, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.four, fontSize: 16 },
  doneIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  scanBox: { width: 260, height: 160, borderWidth: 3, borderColor: '#A3E635', borderRadius: 16 },
  scanBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four, backgroundColor: 'rgba(0,0,0,0.7)' },
  scanDone: { backgroundColor: '#A3E635', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
});
