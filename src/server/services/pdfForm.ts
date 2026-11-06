import "server-only";
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFString,
  PDFTextField,
  type PDFField,
} from "pdf-lib";
import type { Box } from "@/lib/types";
import { HttpError } from "@/server/http";

export type AcroFieldType = "text" | "checkbox" | "dropdown" | "radio" | "optionlist" | "signature" | "other";

export interface AcroFieldInfo {
  name: string;
  tooltip: string | null;
  type: AcroFieldType;
  options: string[];
  required: boolean;
  multiline: boolean;
  maxLength: number | null;
  box: Box | null;
  /** Radio groups: where each option's button sits (keyed by the option as getOptions() returns it). */
  optionBoxes?: Record<string, Box>;
}

export interface PdfInspection {
  pageCount: number;
  pageSizes: { width: number; height: number }[];
  fields: AcroFieldInfo[];
}

function fieldType(f: PDFField): AcroFieldType {
  if (f instanceof PDFTextField) return "text";
  if (f instanceof PDFCheckBox) return "checkbox";
  if (f instanceof PDFDropdown) return "dropdown";
  if (f instanceof PDFRadioGroup) return "radio";
  if (f instanceof PDFOptionList) return "optionlist";
  if (f instanceof PDFSignature) return "signature";
  return "other";
}

function tooltipOf(f: PDFField): string | null {
  const tu = f.acroField.dict.lookup(PDFName.of("TU"));
  if (tu instanceof PDFString || tu instanceof PDFHexString) return tu.decodeText().trim() || null;
  return null;
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new HttpError(400, "unreadable_pdf", "This PDF could not be opened (it may be password protected).");
  }
}

/** Reads AcroForm fields (if any) and where their widgets sit on each page. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const pageSizes = pages.map((p) => p.getSize());

  // Map each widget dictionary to the page whose /Annots array contains it.
  const widgetPage = new Map<PDFDict, number>();
  pages.forEach((page, idx) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookup(i);
      if (dict instanceof PDFDict) widgetPage.set(dict, idx);
    }
  });

  let fields: PDFField[] = [];
  try {
    fields = doc.getForm().getFields();
  } catch {
    fields = [];
  }

  const boxOf = (widget: ReturnType<PDFField["acroField"]["getWidgets"]>[number] | undefined): Box | null => {
    if (!widget) return null;
    const pageIdx = widgetPage.get(widget.dict) ?? 0;
    const { width, height } = pageSizes[pageIdx] ?? pageSizes[0];
    const r = widget.getRectangle();
    return { page: pageIdx, x: r.x / width, y: 1 - (r.y + r.height) / height, w: r.width / width, h: r.height / height };
  };

  const out: AcroFieldInfo[] = fields.map((f) => {
    const type = fieldType(f);
    const widgets = f.acroField.getWidgets();
    const box = boxOf(widgets[0]);
    let options: string[] = [];
    if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) options = f.getOptions();
    // A radio group has one widget per option, in the same order pdf-lib lists the options.
    let optionBoxes: Record<string, Box> | undefined;
    if (f instanceof PDFRadioGroup && widgets.length > 1 && widgets.length === options.length) {
      optionBoxes = {};
      widgets.forEach((w, i) => {
        const b = boxOf(w);
        if (b) optionBoxes![options[i]] = b;
      });
    }
    return {
      name: f.getName(),
      tooltip: tooltipOf(f),
      type,
      options,
      required: f.isRequired(),
      multiline: f instanceof PDFTextField ? f.isMultiline() : false,
      maxLength: f instanceof PDFTextField ? (f.getMaxLength() ?? null) : null,
      box,
      optionBoxes,
    };
  });

  return { pageCount: pages.length, pageSizes, fields: out.filter((f) => f.type !== "other") };
}
