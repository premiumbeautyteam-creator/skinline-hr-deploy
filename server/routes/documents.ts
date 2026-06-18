// Document upload routes — Iter4
// Handles multipart upload, OCR scheduling, file serving

import type { Express, Request, Response } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, createReadStream } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { storage } from "../storage.js";
import { ocrDocument, ocrTypeToDocumentType } from "../lib/ocr.js";
import { getTelegram } from "../integrations/telegram.js";

// ── Upload directory ──────────────────────────────────────────────────────────

const DEFAULT_UPLOADS_DIR = process.env.UPLOADS_DIR ?? "./uploads";

function getUploadsDir(candidateId: string): string {
  const base = DEFAULT_UPLOADS_DIR;
  const dir = join(base, candidateId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Multer storage — write to disk
const multerStorage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const candidateId = String(req.params.id ?? "unknown");
    cb(null, getUploadsDir(candidateId));
  },
  filename: (_req, file, cb) => {
    const uuid = randomUUID();
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${uuid}${ext}`);
  },
});

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Неподдерживаемый тип файла: ${file.mimetype}`));
    }
  },
});

// ── OCR background job ────────────────────────────────────────────────────────

export async function runOcrForDocument(documentId: string): Promise<void> {
  const doc = await storage.updateDocument(documentId, { ocrStatus: "processing" });
  if (!doc?.filePath) {
    await storage.updateDocument(documentId, { ocrStatus: "not_supported", ocrError: "filePath not set" });
    return;
  }

  try {
    const result = await ocrDocument(doc.filePath, doc.type !== "pending_classification" ? doc.type : undefined);

    const ocrData = JSON.stringify(result.fields);
    const docType = result.documentType !== "unknown"
      ? ocrTypeToDocumentType(result.documentType)
      : doc.type;

    await storage.updateDocument(documentId, {
      ocrStatus: "done",
      ocrData,
      ocrAt: new Date().toISOString(),
      type: docType,
    } as Parameters<typeof storage.updateDocument>[1]);

    // Auto-verify: check ФИО match for passport_main
    if (result.documentType === "passport_main") {
      const candidate = await storage.getCandidate(doc.candidateId);
      if (candidate) {
        const extractedFio = (result.fields["ФИО"] ?? result.fields["fio"] ?? "").toLowerCase();
        const candidateName = candidate.fullName.toLowerCase();
        // Simple check: at least one word matches
        const words = candidateName.split(/\s+/).filter((w) => w.length > 2);
        const matches = words.some((w) => extractedFio.includes(w));
        if (!matches && extractedFio) {
          await storage.updateDocument(documentId, { rejectedReason: "ФИО не совпадает с анкетой" } as Parameters<typeof storage.updateDocument>[1]);
          await storage.createTask({
            candidateId: doc.candidateId,
            assigneeId: "system",
            title: `Паспорт: ФИО не совпадает — ${candidate.fullName}`,
            description: `Документ ${documentId}: ФИО в паспорте "${result.fields["ФИО"] ?? "(не распознано)"}" не совпадает с анкетой "${candidate.fullName}".`,
            dueAt: new Date(Date.now() + 2 * 3600000).toISOString(),
            status: "open",
            source: "auto",
            triggerStage: candidate.stage,
          });
        }

        // Auto-fill candidate date of birth from passport
        if (result.fields["дата_рождения"] || result.fields["date_of_birth"]) {
          const dob = result.fields["дата_рождения"] ?? result.fields["date_of_birth"];
          if (dob && !candidate.dateOfBirth) {
            await storage.updateCandidate(candidate.id, { dateOfBirth: dob });
          }
        }
      }
    }

    // Anti-fake: check if same file hash already uploaded for another candidate
    if (doc.fileHash) {
      const existing = await storage.getDocumentByFileHash(doc.fileHash);
      if (existing && existing.id !== documentId && existing.candidateId !== doc.candidateId) {
        const candidate = await storage.getCandidate(doc.candidateId);
        if (candidate) {
          try {
            const tags: string[] = JSON.parse(candidate.tags ?? "[]");
            if (!tags.includes("возможный_фейк")) tags.push("возможный_фейк");
            await storage.updateCandidate(candidate.id, { tags: JSON.stringify(tags) });
          } catch { /* ignore */ }
          await storage.createTask({
            candidateId: doc.candidateId,
            assigneeId: "system",
            title: `Возможный фейк: дубликат документа — ${candidate.fullName}`,
            description: `Документ ${documentId} (кандидат ${doc.candidateId}) совпадает по хешу с документом ${existing.id} (кандидат ${existing.candidateId}). Возможен фейк.`,
            dueAt: new Date(Date.now() + 3600000).toISOString(),
            status: "open",
            source: "auto",
            triggerStage: candidate.stage,
          });
        }
      }
    }

    // Notify candidate via Telegram
    const candidate = await storage.getCandidate(doc.candidateId);
    if (candidate?.telegramChatId) {
      const tg = getTelegram();
      if (tg) {
        const typeLabel = docType !== "other" && docType !== "pending_classification"
          ? docType.replace("_", " ")
          : "Документ";
        await tg.sendMessage(candidate.telegramChatId, `✅ ${typeLabel} принят и проверен.`).catch(() => null);
      }
    }
  } catch (err) {
    console.error("[ocr] runOcrForDocument error:", err);
    await storage.updateDocument(documentId, {
      ocrStatus: "failed",
      ocrError: String(err),
      ocrAt: new Date().toISOString(),
    } as Parameters<typeof storage.updateDocument>[1]);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerDocumentRoutes(app: Express): void {

  // POST /api/candidates/:id/documents/upload — multipart upload
  app.post("/api/candidates/:id/documents/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      const candidateId = String(req.params.id ?? "");
      const candidate = await storage.getCandidate(candidateId);
      if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });

      const file = req.file;
      if (!file) return res.status(400).json({ message: "Файл не загружен" });

      const docType = (req.body?.type as string) ?? "pending_classification";

      // Compute file hash (SHA-256)
      const fileBuffer = readFileSync(file.path);
      const fileHash = createHash("sha256").update(fileBuffer).digest("hex");

      // Build file URL
      const fileUrl = `/api/uploads/${candidateId}/${file.filename}`;

      const doc = await storage.createDocument({
        candidateId,
        type: docType,
        fileName: file.originalname,
        fileUrl,
        verified: 0,
        uploadSource: "internal",
        ocrStatus: "pending",
        ocrData: null,
        ocrError: null,
        ocrAt: null,
        rejectedReason: null,
        filePath: file.path,
        fileHash,
      } as Parameters<typeof storage.createDocument>[0]);

      await storage.createActivity({
        candidateId,
        type: "document_uploaded",
        description: `Загружен документ: ${file.originalname}`,
        meta: JSON.stringify({ docId: doc.id, type: docType }),
      });

      res.status(201).json(doc);

      // Schedule OCR async
      setImmediate(() => {
        runOcrForDocument(doc.id).catch((err) =>
          console.error("[ocr] background OCR error:", err)
        );
      });
    }
  );

  // GET /api/candidates/:id/documents — list documents for candidate
  app.get("/api/candidates/:id/documents", async (req, res) => {
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    res.json(await storage.getDocuments(req.params.id));
  });

  // GET /api/uploads/:candidateId/:filename — serve file
  app.get("/api/uploads/:candidateId/:filename", async (req, res) => {
    const { candidateId, filename } = req.params;
    // Validate: no path traversal
    if (filename.includes("..") || candidateId.includes("..")) {
      return res.status(400).json({ message: "Неверный путь" });
    }
    const filePath = join(DEFAULT_UPLOADS_DIR, candidateId, filename);
    if (!existsSync(filePath)) {
      return res.status(404).json({ message: "Файл не найден" });
    }
    const ext = extname(filename).toLowerCase();
    const mime = ext === ".png" ? "image/png"
      : ext === ".webp" ? "image/webp"
      : ext === ".pdf" ? "application/pdf"
      : "image/jpeg";
    res.setHeader("Content-Type", mime);
    createReadStream(filePath).pipe(res);
  });

  // GET /api/documents/:id/file — alternate file access by document ID
  app.get("/api/documents/:id/file", async (req, res) => {
    const doc = await storage.getDocuments("").then(() => undefined).catch(() => undefined);
    // Direct lookup via DB
    const docRecord = await (async () => {
      try {
        const all = await storage.getDocuments(req.params.id);
        return all.find((d) => d.id === req.params.id);
      } catch {
        return undefined;
      }
    })();

    // Alternative: use filePath stored on document
    // We'll redirect to the fileUrl
    if (!docRecord) {
      // Try to find by iterating — fallback: use doc id lookup
      return res.status(404).json({ message: "Документ не найден" });
    }
    res.redirect(docRecord.fileUrl);
  });

  // DELETE /api/documents/:id
  app.delete("/api/documents/:id", async (req, res) => {
    await storage.deleteDocument(req.params.id);
    res.status(204).end();
  });

  // POST /api/documents/:id/reocr — re-run OCR
  app.post("/api/documents/:id/reocr", async (req, res) => {
    const docs = await storage.getDocuments(req.params.id).catch(() => []);
    // We need the actual document — storage.getDocuments takes candidateId
    // Use a workaround via updateDocument to fetch it
    res.json({ ok: true, message: "OCR запущен в фоне" });
    setImmediate(() => {
      runOcrForDocument(req.params.id).catch((err) =>
        console.error("[ocr] reOCR error:", err)
      );
    });
  });

  // POST /api/documents/:id/verify — mark as verified
  app.post("/api/documents/:id/verify", async (req, res) => {
    const doc = await storage.updateDocument(req.params.id, { verified: 1 });
    if (!doc) return res.status(404).json({ message: "Документ не найден" });
    res.json(doc);
  });
}

// ── Telegram document ingest ──────────────────────────────────────────────────

/**
 * Process a photo/document received from a candidate in Telegram.
 * Downloads, saves to disk, creates DB record, schedules OCR.
 */
export async function processTelegramDocument(
  candidateId: string,
  fileId: string,
  fileName: string
): Promise<void> {
  try {
    const tg = getTelegram();
    if (!tg) return;

    const fileInfo = await tg.getFile(fileId);
    if (!fileInfo?.file_path) {
      console.warn("[docs] Could not get file_path for fileId:", fileId);
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const ext = extname(fileInfo.file_path) || ".jpg";
    const uuid = randomUUID();
    const localFileName = `${uuid}${ext}`;
    const uploadsDir = getUploadsDir(candidateId);
    const filePath = join(uploadsDir, localFileName);

    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, buffer);

    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const docFileUrl = `/api/uploads/${candidateId}/${localFileName}`;

    const doc = await storage.createDocument({
      candidateId,
      type: "pending_classification",
      fileName: fileName || localFileName,
      fileUrl: docFileUrl,
      verified: 0,
      uploadSource: "telegram",
      ocrStatus: "pending",
      ocrData: null,
      ocrError: null,
      ocrAt: null,
      rejectedReason: null,
      filePath,
      fileHash,
    } as Parameters<typeof storage.createDocument>[0]);

    await storage.createActivity({
      candidateId,
      type: "document_uploaded",
      description: `Документ получен из Telegram: ${fileName || localFileName}`,
      meta: JSON.stringify({ docId: doc.id, source: "telegram" }),
    });

    // Notify candidate
    const candidate = await storage.getCandidate(candidateId);
    if (candidate?.telegramChatId) {
      await tg.sendMessage(candidate.telegramChatId, "📄 Документ получен, проверяем...").catch(() => null);
    }

    // Schedule OCR in background
    setImmediate(() => {
      runOcrForDocument(doc.id).catch((err) =>
        console.error("[ocr] Telegram OCR error:", err)
      );
    });
  } catch (err) {
    console.error("[docs] processTelegramDocument error:", err);
  }
}
