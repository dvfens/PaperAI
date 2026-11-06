import "server-only";
import { t } from "@/lib/i18n";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { Box, FieldType, FormField, MappingConfidence } from "@/lib/types";
import type { OcrLine, OcrPage, OcrWord } from "./ocr";
import type { AcroFieldInfo } from "./pdfForm";

/**
 * FormMappingService — decides *where* each answer is written on the page.
 *  - Fillable PDFs: the AcroForm widget rectangle (exact).
 *  - Scans / flat PDFs: anchored to the OCR geometry of the field's printed label, falling back to
 *    the model's own estimate. Every field carries a mappingConfidence so uncertain placements are
 *    highlighted for the person to check.
 */

export type Placement = "acro" | "right_of_label" | "below_label" | "in_box" | "unknown";

export interface FieldDraft extends Omit<FormField, "box" | "mappingConfidence"> {
  anchorLineId: string | null;
  placement: Placement;
  page: number;
  estimate: { x: number; y: number; w: number; h: number } | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const LEADER = /^[_.…\-–—]{3,}$/;

function clampBox(b: Box): Box {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  return { page: b.page, x, y, w: Math.max(0.02, Math.min(1 - x, b.w)), h: Math.max(0.008, Math.min(1 - y, b.h)) };
}

function normWord(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Where on the label's line the printed label ends and the blank (underscores/dots) begins. */
function analyseLine(line: OcrLine, label: string) {
  const labelWords = new Set(label.split(/\s+/).map(normWord).filter(Boolean));
  let labelEnd = line.box.x;
  let leaderStart: number | null = null;
  let leaderEnd: number | null = null;
  for (const w of line.words) {
    const isLeader = LEADER.test(w.text.trim()) || /_{3,}/.test(w.text);
    if (isLeader) {
      leaderStart ??= w.box.x;
      leaderEnd = w.box.x + w.box.w;
      continue;
    }
    if (leaderStart === null && (labelWords.has(normWord(w.text)) || /[:：]$/.test(w.text))) {
      labelEnd = Math.max(labelEnd, w.box.x + w.box.w);
    }
  }
  return { labelEnd, leaderStart, leaderEnd };
}

export function resolvePlacement(
  draft: FieldDraft,
  linesById: Map<string, OcrLine>,
  acroByName: Map<string, AcroFieldInfo>,
): { box: Box | undefined; confidence: MappingConfidence } {
  if (draft.acroName) {
    const acro = acroByName.get(draft.acroName);
    if (acro?.box) return { box: acro.box, confidence: "high" };
  }
  const line = draft.anchorLineId ? linesById.get(draft.anchorLineId) : undefined;
  const est = draft.estimate;
  if (line && draft.placement === "right_of_label") {
    const { labelEnd, leaderStart, leaderEnd } = analyseLine(line, draft.label);
    const x = (leaderStart ?? labelEnd + 0.01) + 0.004;
    const right = leaderEnd ?? (est ? est.x + est.w : Math.min(0.95, x + 0.45));
    return {
      box: clampBox({ page: line.page, x, y: line.box.y - line.box.h * 0.35, w: right - x, h: line.box.h * 1.5 }),
      confidence: leaderStart !== null ? "high" : "medium",
    };
  }
  if (line && draft.placement === "below_label") {
    return {
      box: clampBox({
        page: line.page,
        x: line.box.x,
        y: line.box.y + line.box.h * 1.15,
        w: est?.w ?? Math.max(line.box.w, 0.4),
        h: est?.h ?? line.box.h * 1.6,
      }),
      confidence: "medium",
    };
  }
  if (est) {
    return { box: clampBox({ page: draft.page, ...est }), confidence: line ? "medium" : "low" };
  }
  return { box: undefined, confidence: "low" };
}

export function finaliseFields(drafts: FieldDraft[], ocr: OcrPage[] | null, acro: AcroFieldInfo[]): FormField[] {
  const linesById = new Map((ocr ?? []).flatMap((p) => p.lines).map((l) => [l.id, l]));
  const acroByName = new Map(acro.map((a) => [a.name, a]));
  const seen = new Set<string>();
  return drafts.map((d, i) => {
    const { box, confidence } = resolvePlacement(d, linesById, acroByName);
    let id = d.id.replace(/[^a-z0-9_]/gi, "_").toLowerCase() || `field_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    const { anchorLineId: _a, placement: _p, page: _pg, estimate: _e, ...rest } = d;
    const acroName = d.acroName && acroByName.has(d.acroName) ? d.acroName : undefined;
    // Printed tick-box choices on a scan: tick the chosen option instead of writing over the options.
    const anchor = d.anchorLineId ? linesById.get(d.anchorLineId) : undefined;
    // Fillable PDF radio buttons: each option's own button, matched to the options by name.
    const acroOptions = acroName ? acroByName.get(acroName)?.optionBoxes : undefined;
    const optionBoxes =
      rest.type === "choice" && rest.options?.length
        ? acroOptions
          ? matchOptionBoxes(rest.options, acroOptions)
          : !acroName && anchor
            ? optionBoxesFromWords(anchor.words, rest.options, anchor.page)
            : undefined
        : undefined;
    return {
      ...rest,
      id,
      acroName,
      box,
      optionBoxes: optionBoxes && Object.keys(optionBoxes).length === rest.options!.length ? optionBoxes : undefined,
      mappingConfidence: confidence,
      aiFillable: rest.type !== "signature" && rest.type !== "photo",
    };
  });
}

/** Locate "[ ] Option" marks on a line: the tick goes on the bracket just before each option word. */
/** Re-key option boxes to the field's own option names (case and spacing ignored); all or nothing. */
export function matchOptionBoxes(options: string[], boxes: Record<string, Box>): Record<string, Box> | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const byName = new Map(Object.entries(boxes).map(([k, b]) => [norm(k), b]));
  const out: Record<string, Box> = {};
  for (const o of options) {
    const b = byName.get(norm(o));
    if (!b) return undefined;
    out[o] = b;
  }
  return out;
}

export function optionBoxesFromWords(words: OcrWord[], options: string[], page: number): Record<string, Box> {
  const out: Record<string, Box> = {};
  const clean = (s: string) => s.replace(/[\][|()☐□▢❏]/g, "").toLowerCase();
  for (const opt of options) {
    const idx = words.findIndex((w) => clean(w.text) === opt.toLowerCase());
    if (idx < 0) continue;
    const mark = words
      .slice(Math.max(0, idx - 2), idx + 1)
      .reverse()
      .find((w) => /[[☐□▢❏]/.test(w.text));
    if (!mark) continue; // no printed box next to this option — not a tick-box choice
    const h = words[idx].box.h;
    out[opt] = clampBox({ page, x: mark.box.x, y: words[idx].box.y, w: Math.max(h, 0.012), h });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Basic mode (no Claude): deterministic field detection.
// ---------------------------------------------------------------------------------------------

const TYPE_HINTS: [RegExp, FieldType][] = [
  [/signature|sign here|हस्ताक्षर|दस्तख/i, "signature"],
  [/photo|फ़ोटो|फोटो/i, "photo"],
  [/e-?mail|ईमेल/i, "email"],
  [/mobile|phone|contact no|telephone|मोबाइल|फ़ोन|फोन/i, "phone"],
  [/date|d\.o\.b|dob|birth|तारीख|तिथि|जन्म/i, "date"],
  [/address|पता/i, "multiline"],
  [/\bage\b|pin ?code|pincode|आयु|उम्र/i, "number"],
];

function inferType(label: string): FieldType {
  for (const [re, type] of TYPE_HINTS) if (re.test(label)) return type;
  return "text";
}

function slug(label: string, i: number) {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return s || `field_${i + 1}`;
}

function basicField(label: string, type: FieldType, lang: LanguageCode, i: number, extra: Partial<FormField> = {}): FormField {
  const options = extra.options?.join(", ");
  const question =
    type === "choice" && options
      ? lang === "hi"
        ? `“${label}” में क्या चुनूँ? ${options}।`
        : `For “${label}”, which one should I choose: ${options}?`
      : type === "checkbox"
      ? lang === "hi"
        ? `क्या “${label}” पर निशान लगाना है? हाँ या नहीं कहिए।`
        : `Should I tick “${label}”? Please say yes or no.`
      : lang === "hi"
        ? `“${label}” में क्या लिखूँ?`
        : `What should I write for “${label}”?`;
  return {
    id: slug(label, i),
    label,
    labelLocalized: label,
    type,
    required: false,
    question,
    sensitive: /aadhaar|aadhar|pan\b|account|ifsc|आधार|खाता/i.test(label),
    confirm: type === "date" || type === "phone" || type === "email" || type === "number",
    aiFillable: type !== "signature" && type !== "photo",
    mappingConfidence: "medium",
    format: formatFromLabel(label),
    ...extra,
  };
}

/** Formatting rules printed inside labels, e.g. "Full name (in BLOCK LETTERS)" or "Date (DD/MM/YYYY)". */
function formatFromLabel(label: string): string | undefined {
  const rules: string[] = [];
  if (/block letters|capital letters|in capitals/i.test(label)) rules.push("BLOCK LETTERS");
  const date = label.match(/\b(DD[/-]MM[/-]YYYY|MM[/-]DD[/-]YYYY|YYYY-MM-DD)\b/i);
  if (date) rules.push(date[1].toUpperCase());
  return rules.length ? rules.join(", ") : undefined;
}

/** Fillable PDF without Claude: one question per AcroForm field, using its tooltip as the label. */
export function fieldsFromAcro(acro: AcroFieldInfo[], lang: LanguageCode): FormField[] {
  const out: FormField[] = [];
  acro.forEach((a, i) => {
    const label = a.tooltip ?? a.name.replace(/[_\-.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const type: FieldType =
      a.type === "checkbox"
        ? "checkbox"
        : a.type === "signature"
          ? "signature"
          : a.type === "dropdown" || a.type === "radio" || a.type === "optionlist"
            ? "choice"
            : a.multiline
              ? "multiline"
              : inferType(label);
    out.push(
      basicField(label, type, lang, i, {
        id: slug(a.name, i),
        acroName: a.name,
        box: a.box ?? undefined,
        optionBoxes: a.optionBoxes,
        required: a.required,
        options: a.options.length ? a.options : undefined,
        mappingConfidence: "high",
      }),
    );
  });
  return dedupeIds(out);
}

/** Tick box printed at the start of a segment; OCR often reads "[ ]" as "[ 1", "[l]" or "[]". */
const LEADING_BOX = /^(?:[☐□▢❏]|\[\s*[1lI|]?\s*\]?)\s*(.{3,})$/;
const BOX_MARK = /[☐□▢❏]|\[\s*[1lI|]?\s*\]?/g; // global: for split/replace
const BOX_TEST = /[☐□▢❏]|\[\s*[1lI|]?\s*\]?/; // non-global: safe for repeated .test()
const SKIP = /office use|^section\b|^instructions?\b|^\d+\.\s|^form\s+[a-z]{2,}-?\d/i;
/** Horizontal gap (fraction of page width) that separates two printed items on one OCR line. */
const SEGMENT_GAP = 0.06;

function unionBox(words: OcrWord[], page: number): Box {
  const x0 = Math.min(...words.map((w) => w.box.x));
  const y0 = Math.min(...words.map((w) => w.box.y));
  const x1 = Math.max(...words.map((w) => w.box.x + w.box.w));
  const y1 = Math.max(...words.map((w) => w.box.y + w.box.h));
  return { page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Tesseract drops "____" blanks and joins items across wide gaps; split lines back at those gaps. */
function segmentsOf(line: OcrLine): { text: string; words: OcrWord[]; box: Box }[] {
  const groups: OcrWord[][] = [];
  for (const w of line.words) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (!last || !prev || w.box.x - (prev.box.x + prev.box.w) > SEGMENT_GAP) groups.push([w]);
    else last.push(w);
  }
  return groups.map((ws) => ({ text: ws.map((w) => w.text).join(" ").trim(), words: ws, box: unionBox(ws, line.page) }));
}

function parseOptions(text: string): string[] {
  const paren = /^\((.+)\)$/.exec(text.trim());
  const src = paren ? paren[1] : text;
  const parts = paren || src.includes("/") ? src.split("/") : src.split(BOX_MARK);
  return parts.map((p) => p.replace(BOX_MARK, "").replace(/[\]\[|]/g, "").trim()).filter((p) => p.length >= 2);
}

/** Scanned page without Claude: find "Label: ____" blanks, tick boxes and printed choices. */
export function fieldsFromOcr(ocr: OcrPage[], lang: LanguageCode): FormField[] {
  const out: FormField[] = [];
  for (const page of ocr) {
    for (const line of page.lines) {
      if (/office use/i.test(line.text)) continue;
      const segs = segmentsOf(line);
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const text = seg.text;
        if (!text || SKIP.test(text)) continue;
        const nextX = segs[i + 1]?.box.x ?? 0.95;
        const h = seg.box.h;

        // "[ ] I am a senior citizen …" — a single tick box
        const cb = LEADING_BOX.exec(text);
        if (cb && !text.includes(":")) {
          const label = cb[1].replace(/\s+/g, " ").trim();
          const first = seg.words[0].box;
          out.push(
            basicField(label, "checkbox", lang, out.length, {
              box: clampBox({ page: line.page, x: first.x, y: first.y, w: Math.max(h, first.w * 0.6), h }),
              mappingConfidence: "low",
            }),
          );
          continue;
        }

        const colon = text.search(/[:：]/);
        if (colon < 2 || colon > 70) continue;
        const rawLabel = text.slice(0, colon);
        const rest = text.slice(colon + 1).trim();
        const required = rawLabel.includes("*");
        const label = rawLabel.replace(/\*/g, "").replace(/\s+/g, " ").trim();
        if (label.split(" ").length > 8) continue;

        // Printed options on the same segment ("[ ]Male [ ]Female") or the next one ("(English / Hindi)")
        const inlineOptions = rest && BOX_TEST.test(rest) ? parseOptions(rest) : [];
        const nextText = segs[i + 1]?.text ?? "";
        const followingOptions = !rest && /^\(.+\/.+\)$/.test(nextText) ? parseOptions(nextText) : [];
        const labelEnd = (() => {
          const labelWords = seg.words.filter((w) => !BOX_TEST.test(w.text) && rawLabel.includes(w.text.replace(/[:：]$/, "")));
            return labelWords.length ? Math.max(...labelWords.map((w) => w.box.x + w.box.w)) : seg.box.x + seg.box.w;
        })();

        if (inlineOptions.length >= 2) {
          const optionBoxes = optionBoxesFromWords(seg.words, inlineOptions, line.page);
          out.push(
            basicField(label, "choice", lang, out.length, {
              required,
              options: inlineOptions,
              optionBoxes,
              box: clampBox({ page: line.page, x: labelEnd + 0.01, y: seg.box.y - h * 0.35, w: nextX - labelEnd - 0.02, h: h * 1.5 }),
              mappingConfidence: "low",
            }),
          );
          continue;
        }

        const type: FieldType = followingOptions.length >= 2 ? "choice" : inferType(label);
        const tall = type === "multiline" ? 3.2 : 1.5;
        out.push(
          basicField(label, type, lang, out.length, {
            required,
            options: followingOptions.length >= 2 ? followingOptions : undefined,
            box: clampBox({
              page: line.page,
              x: labelEnd + 0.01,
              y: seg.box.y - h * 0.35,
              w: Math.max(0.08, nextX - labelEnd - 0.02),
              h: h * tall,
            }),
            mappingConfidence: rest ? "low" : "medium",
          }),
        );
      }
    }
  }
  return dedupeIds(out);
}

function dedupeIds(fields: FormField[]): FormField[] {
  const seen = new Map<string, number>();
  return fields.map((f) => {
    const n = seen.get(f.id) ?? 0;
    seen.set(f.id, n + 1);
    return n ? { ...f, id: `${f.id}_${n + 1}` } : f;
  });
}

export function basicSummary(lang: LanguageCode, fieldCount: number): { title: string; summary: string; explanation: string[] } {
  if (lang === "hi") {
    return {
      title: "फ़ॉर्म",
      summary: `इस कागज़ में मुझे ${fieldCount} खाने मिले जिन्हें भरना है।`,
      explanation: [
        `मुझे ${fieldCount} खाने मिले।`,
        "मैं हर खाने का नाम पढ़कर आपसे पूछूँगा कि उसमें क्या लिखना है।",
        t(lang, "basicMode"),
      ],
    };
  }
  return {
    title: "Form",
    summary: `I found ${fieldCount} places to fill in on this document.`,
    explanation: [
      `I found ${fieldCount} places to fill in.`,
      "I will read out each field name and ask what to write.",
      t(lang, "basicMode"),
    ],
  };
}
