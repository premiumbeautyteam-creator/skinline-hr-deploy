// OCR service — Iter4
// Uses GPT-4o vision via OpenRouter to classify and extract fields from document images.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { chatCompletion } from "./ai.js";

export type DocumentType =
  | "passport_main"
  | "passport_propiska"
  | "snils"
  | "inn"
  | "medbook"
  | "diploma"
  | "certificate"
  | "unknown";

export interface OcrResult {
  documentType: DocumentType;
  fields: Record<string, string>;
  confidence: number;
  rawText?: string;
}

const MODEL_VISION = "openai/gpt-4o";

const SYSTEM_OCR = `Ты OCR/классификатор документов РФ. Определи тип документа и извлеки ключевые поля в JSON.
Поддерживаемые типы:
- passport_main: ФИО, серия, номер, дата_рождения, кем_выдан, дата_выдачи, место_рождения
- passport_propiska: адрес, дата_регистрации
- snils: номер, ФИО
- inn: номер, ФИО
- medbook: номер, ФИО, дата_выдачи
- diploma: учреждение, специальность, год, ФИО
- certificate: название, учреждение, год, ФИО

Если документ не распознан, не является документом РФ, или изображение нечёткое — верни type='unknown'.
Ответ строго в JSON без обёрток.`;

/**
 * OCR a document image file using GPT-4o vision.
 * @param filePath Absolute path to the image file (jpg/png/webp)
 * @param hintedType Optional hint for document type
 */
export async function ocrDocument(
  filePath: string,
  hintedType?: string
): Promise<OcrResult> {
  const fallback: OcrResult = {
    documentType: "unknown",
    fields: {},
    confidence: 0,
  };

  try {
    const ext = extname(filePath).toLowerCase();
    const supportedExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    if (!supportedExts.includes(ext)) {
      return { ...fallback, documentType: "unknown" };
    }

    const imageBuffer = readFileSync(filePath);
    const base64 = imageBuffer.toString("base64");
    const mimeType =
      ext === ".png" ? "image/png"
      : ext === ".webp" ? "image/webp"
      : ext === ".gif" ? "image/gif"
      : "image/jpeg";

    const userContent = [
      {
        type: "text" as const,
        text: `Распознай документ. Подсказка типа: ${hintedType ?? "не указан"}.
Ответ строго JSON: {"documentType": "...", "fields": {...}, "confidence": 0.0-1.0, "rawText": "..."}`,
      },
      {
        type: "image_url" as const,
        image_url: {
          url: `data:${mimeType};base64,${base64}`,
          detail: "high" as const,
        },
      },
    ];

    // chatCompletion doesn't support image_url content type directly —
    // we need to call with raw messages that include the image.
    // We use chatCompletion with a special content structure.
    const raw = await chatCompletion({
      model: MODEL_VISION,
      messages: [
        { role: "system", content: SYSTEM_OCR },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: "user", content: userContent as any },
      ],
      maxTokens: 1024,
      temperature: 0.0,
      jsonMode: true,
      purpose: "ocr",
    });

    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw) as OcrResult;
      const validTypes: DocumentType[] = [
        "passport_main", "passport_propiska", "snils", "inn",
        "medbook", "diploma", "certificate", "unknown",
      ];
      const documentType = validTypes.includes(parsed.documentType as DocumentType)
        ? (parsed.documentType as DocumentType)
        : "unknown";

      return {
        documentType,
        fields: parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {},
        confidence: typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5,
        rawText: parsed.rawText ?? undefined,
      };
    } catch (parseErr) {
      console.error("[ocr] JSON parse error:", parseErr, raw.slice(0, 200));
      return fallback;
    }
  } catch (err) {
    console.error("[ocr] ocrDocument error:", err);
    return fallback;
  }
}

/** Map OCR document type to the documents table 'type' column */
export function ocrTypeToDocumentType(ocrType: DocumentType): string {
  switch (ocrType) {
    case "passport_main":
    case "passport_propiska":
      return "passport";
    case "snils":
      return "snils";
    case "inn":
      return "inn";
    case "medbook":
      return "medical_book";
    case "diploma":
      return "diploma";
    case "certificate":
      return "certificate";
    default:
      return "other";
  }
}
