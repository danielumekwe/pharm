// Renders EAN-13 / UPC-A barcodes as SVG for shelf and pack labels. Code 128 values are shown as text.

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Module pattern (1 = bar) for a 13-digit EAN; UPC-A is EAN-13 with a leading zero. */
export function ean13Modules(code: string) {
  const digits = code.length === 12 ? `0${code}` : code;
  if (!/^\d{13}$/.test(digits)) return null;
  const parity = PARITY[Number(digits[0])];
  let bits = "101";
  for (let index = 1; index <= 6; index += 1) bits += (parity[index - 1] === "L" ? L : G)[Number(digits[index])];
  bits += "01010";
  for (let index = 7; index <= 12; index += 1) bits += R[Number(digits[index])];
  return `${bits}101`;
}

export function BarcodeSvg({ code, height = 48 }: { code: string; height?: number }) {
  const modules = ean13Modules(code);
  if (!modules) return <span className="font-mono text-sm">{code}</span>;
  const width = modules.length + 18;
  return (
    <svg viewBox={`0 0 ${width} ${height + 12}`} className="h-16 w-auto bg-white" role="img" aria-label={`Barcode ${code}`}>
      {[...modules].map((bit, index) => (bit === "1" ? <rect key={index} x={index + 9} y={2} width={1} height={height} fill="#000" /> : null))}
      <text x={width / 2} y={height + 11} textAnchor="middle" fontFamily="monospace" fontSize={9} fill="#000">
        {code}
      </text>
    </svg>
  );
}
