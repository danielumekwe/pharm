// AI Document Scanner: provider adapters. Server only: provider credentials never leave the server.
//
// A page is read in three stages, each behind its own interface so a provider can be swapped without
// touching the rest of the feature:
//   OcrProvider            – printed text on the page
//   HandwritingProvider    – handwritten text on the page
//   InterpretationProvider – turns the page (and any text already read) into structured records
// A DocumentReader runs the stages for one page. Multimodal AI models (the Anthropic adapter) do all three in
// one pass. A separate OCR engine can be composed with an interpreter with composeReader().
//
// Configuration (environment variables, server-side only):
//   DOCUMENT_AI_PROVIDER   "anthropic" to enable the scanner. Unset: the scanner is not configured and
//                          no page is sent anywhere.
//   ANTHROPIC_API_KEY      API key for the Anthropic provider.
//   DOCUMENT_AI_MODEL      Model id (default claude-opus-5-5).
//   DOCUMENT_AI_EFFORT     low | medium | high (default high: handwriting benefits from more careful reading).
//   DOCUMENT_AI_FALLBACKS  "off" to disable the provider's server-side fallback when a request is declined.
// Each pharmacy's Super Administrator must also approve sending its documents to the provider (Settings).

import Anthropic from "@anthropic-ai/sdk";

import { CATEGORY_KINDS, CATEGORY_LABELS, extractionSchema, KIND_FIELDS, type ScanCategory } from "@/lib/scanner/fields";

export type PageInput = {
  image: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  category: ScanCategory;
  /** Extra context for the reader: options chosen by the user (e.g. what quantities mean). */
  guidance?: string;
  pageNumber: number;
  pageCount: number;
};

export type RawRecord = { kind: string; fields: Record<string, unknown>; region?: unknown };
export type PageExtraction = {
  page: { type: string; readable: boolean; notes: string; transcription: string };
  records: RawRecord[];
  provider: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export type TextReading = { text: string; lines?: { text: string; box?: { x: number; y: number; width: number; height: number } }[] };

export interface OcrProvider {
  id: string;
  recognisePrinted(input: PageInput): Promise<TextReading>;
}
export interface HandwritingProvider {
  id: string;
  recogniseHandwriting(input: PageInput): Promise<TextReading>;
}
export interface InterpretationProvider {
  id: string;
  interpret(input: PageInput, readings: TextReading[]): Promise<PageExtraction>;
}
export interface DocumentReader {
  id: string;
  model: string;
  readPage(input: PageInput): Promise<PageExtraction>;
}

/** Failure reading a page. Retryable failures (rate limits, outages, timeouts) are tried again later. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Separate OCR / handwriting engines followed by an interpreter. */
export function composeReader(parts: { ocr?: OcrProvider; handwriting?: HandwritingProvider; interpreter: InterpretationProvider; model: string }): DocumentReader {
  return {
    id: [parts.ocr?.id, parts.handwriting?.id, parts.interpreter.id].filter(Boolean).join("+"),
    model: parts.model,
    async readPage(input) {
      const readings: TextReading[] = [];
      if (parts.ocr) readings.push(await parts.ocr.recognisePrinted(input));
      if (parts.handwriting) readings.push(await parts.handwriting.recogniseHandwriting(input));
      return parts.interpreter.interpret(input, readings);
    },
  };
}

// ---------------------------------------------------------------- Anthropic (multimodal: OCR + handwriting + interpretation)

const SYSTEM_PROMPT = `You digitise paper records from Nigerian community pharmacies: handwritten stock books, sales registers, receipts, daily sales summaries, expense books and supplier invoices. People will proofread everything you return before anything is saved, so accuracy and honesty about uncertainty matter more than completeness.

How to read:
- Read both printed and handwritten text. Medicine names may be misspelt or abbreviated; return the name as written (corrected only for obvious letter-shape ambiguity), never substitute a different medicine.
- Never invent a value. If a field is not on the page, or you cannot read it, return an empty value with confidence "not_detected". Do not calculate a missing value from other values (no quantity × price, no totals), and do not carry a value down from the previous line unless the page shows a ditto mark (″, "do", ") for that entry.
- Confidence: "high" only when the characters are clear; "medium" when legible but one character could be another; "low" when you are partly guessing. Use "low" for any number where a digit is unclear.
- "read" is the exact characters on the page for that field (including abbreviations, currency marks and ditto marks); "value" is the normalised value.
- Numbers: value is plain digits with an optional decimal point (no commas, no ₦/N, no "k"). Money is in naira. "1,500" → "1500". If "k" is written for thousands, only expand it when unambiguous, and use confidence "medium" or lower.
- Dates: value as YYYY-MM-DD when the date is unambiguous. Nigerian records write day/month/year (03/04/2025 = 3 April 2025). If the year or order is unclear, return the date exactly as written with confidence "low". A month/year expiry such as "12/27" means December 2027: return "2027-12" style only if certain, otherwise as written.
- Abbreviations: Tab = Tablet, Cap = Capsule, Susp = Suspension, Inj = Injection, Syr = Syrup. Expand a dosage form only when the abbreviation clearly means that form in context; if unsure, return it as written with confidence "low" and explain in notes.
- Keep apart: brand/product name vs generic (active ingredient) name; quantity vs price; purchase/cost price vs selling price (only label a price as purchase or selling when the column heading or context says so — otherwise put it where the heading indicates and lower the confidence); transaction date vs expiry or manufacturing date; an individual sale vs a daily total.
- One record per line item (one stock line, one sale line, one expense, one supplier). For a receipt with several items, return one sale record per item, each repeating the receipt's date, receipt number, payment method and customer. A day's total written without the individual items is a "daily_sales" record — never split it into made-up product sales.
- Ignore crossed-out entries, but mention them in notes. Skip column headings and page totals (but a daily total is a record in a sales register).
- region: the part of the page the record occupies as fractions of the page (x, y from the top-left; width, height). Approximate is fine.
- Fields that do not apply to a record's kind: empty value, confidence "not_detected".`;

function categoryInstructions(category: ScanCategory) {
  const kinds = CATEGORY_KINDS[category];
  const lines = kinds.map((kind) => `- ${kind}: ${KIND_FIELDS[kind].map((field) => `${field.key} (${field.label}${field.hint ? `; ${field.hint}` : ""})`).join(", ")}`);
  return `The user says these pages are: ${CATEGORY_LABELS[category]}.\nRecord kinds and their fields:\n${lines.join("\n")}`;
}

function anthropicReader(): DocumentReader {
  const model = process.env.DOCUMENT_AI_MODEL?.trim() || "claude-opus-5-5";
  const configuredEffort = process.env.DOCUMENT_AI_EFFORT?.trim();
  const effort = configuredEffort === "low" || configuredEffort === "medium" || configuredEffort === "high" ? configuredEffort : "high";
  // Retries are handled by the page queue (with back-off), so one page never holds a request open for long.
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 240_000 });
  const fallbacks = process.env.DOCUMENT_AI_FALLBACKS !== "off";
  return {
    id: "anthropic",
    model,
    async readPage(input) {
      let response;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          output_config: { effort, format: { type: "json_schema", schema: extractionSchema(input.category) } },
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: input.mimeType, data: Buffer.from(input.image).toString("base64") } },
                {
                  type: "text",
                  text: `${categoryInstructions(input.category)}${input.guidance ? `\n${input.guidance}` : ""}\nThis is page ${input.pageNumber} of ${input.pageCount}. Extract every record on this page.`,
                },
              ],
            },
          ],
        });
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new ProviderError("The AI provider rejected the server's credentials. An administrator must check ANTHROPIC_API_KEY.", false);
        if (error instanceof Anthropic.BadRequestError) throw new ProviderError(`The AI provider could not accept this page (${error.message.slice(0, 200)}).`, false);
        if (error instanceof Anthropic.RateLimitError) throw new ProviderError("The AI provider is busy (rate limit). The page will be tried again.", true);
        if (error instanceof Anthropic.APIConnectionError) throw new ProviderError("Could not reach the AI provider. The page will be tried again.", true);
        if (error instanceof Anthropic.APIError) throw new ProviderError(`The AI provider failed (${error.status ?? "error"}). The page will be tried again.`, error.status === undefined || error.status >= 500 || error.status === 408 || error.status === 409);
        throw new ProviderError("Reading the page failed unexpectedly. The page will be tried again.", true);
      }
      if (response.stop_reason === "refusal") throw new ProviderError("The AI provider declined to read this page. Enter its records by hand.", false);
      if (response.stop_reason === "max_tokens") throw new ProviderError("The page has more entries than can be read in one pass. Crop it into two images and add them again.", false);
      const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      let parsed: { page?: PageExtraction["page"]; records?: RawRecord[] };
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ProviderError("The AI provider returned an unreadable answer. The page will be tried again.", true);
      }
      return {
        page: {
          type: String(parsed.page?.type ?? "other"),
          readable: parsed.page?.readable !== false,
          notes: String(parsed.page?.notes ?? "").slice(0, 2000),
          transcription: String(parsed.page?.transcription ?? "").slice(0, 20000),
        },
        records: Array.isArray(parsed.records) ? parsed.records.slice(0, 500) : [],
        provider: "anthropic",
        model: response.model ?? model,
        usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
      };
    },
  };
}

// ---------------------------------------------------------------- registry

const READERS: Record<string, () => DocumentReader> = {
  anthropic: anthropicReader,
};

/** Provider configured for this deployment, or why none is. */
export function providerStatus(): { configured: boolean; provider: string | null; model: string | null; problem?: string } {
  const name = process.env.DOCUMENT_AI_PROVIDER?.trim().toLowerCase();
  if (!name) return { configured: false, provider: null, model: null, problem: "No AI provider is configured on the server (DOCUMENT_AI_PROVIDER)." };
  if (!READERS[name]) return { configured: false, provider: name, model: null, problem: `Unknown AI provider "${name}".` };
  if (name === "anthropic" && !process.env.ANTHROPIC_API_KEY?.trim()) return { configured: false, provider: name, model: null, problem: "ANTHROPIC_API_KEY is not set on the server." };
  return { configured: true, provider: name, model: process.env.DOCUMENT_AI_MODEL?.trim() || "claude-opus-5-5" };
}

export function documentReader(): DocumentReader {
  const status = providerStatus();
  if (!status.configured || !status.provider) throw new ProviderError(status.problem ?? "No AI provider is configured.", false);
  return READERS[status.provider]();
}
