// Avito vacancy import: fetches active ads and upserts them into the vacancies table.
//
// Uses external_refs (source='avito', externalType='item') to track which local
// vacancy corresponds to which Avito item_id. Idempotent: re-running updates
// existing rows instead of creating duplicates.

import { storage } from "../storage.js";
import { AvitoClient } from "./avito.js";
import { randomUUID } from "crypto";

// Cities operated by Skin Line
const SKIN_LINE_CITIES = [
  'Чебоксары', 'Йошкар-Ола', 'Казань', 'Воронеж', 'Липецк',
  'Киров', 'Курск', 'Набережные Челны', 'Новочебоксарск', 'Сургут',
];

function detectCity(text: string | undefined): string | null {
  if (!text) return null;
  for (const c of SKIN_LINE_CITIES) {
    if (text.includes(c)) return c;
  }
  return null;
}

// Import all active Avito ads into the vacancies table.
export async function importAvitoVacancies(): Promise<{
  total: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const integ = await storage.getIntegration("avito");
  const client = new AvitoClient((integ ?? null) as any);
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let total = 0;

  // Paginate through all active ads
  for (let page = 1; page <= 10; page++) {
    let resp: Awaited<ReturnType<typeof client.getItems>>;
    try {
      resp = await client.getItems({ status: 'active', page, perPage: 100 });
    } catch (e: any) {
      errors.push(`page ${page}: ${e.message}`);
      break;
    }
    const items = resp?.items ?? [];
    if (items.length === 0) break;
    total += items.length;

    for (const item of items) {
      try {
        // Check if we already have a vacancy linked to this item_id
        const refs = await storage.getExternalRefsByProvider('avito', 'item');
        const existingRef = refs.find((r) => r.externalId === String(item.id));

        const cityFromTitle = detectCity(item.title) || detectCity(item.address);

        if (existingRef) {
          // Update existing vacancy (title, status, link)
          await storage.updateVacancy(existingRef.entityId, {
            title: item.title,
            externalUrl: item.url,
            status: item.status === 'active' ? 'active' : 'closed',
          });
          updated++;
        } else {
          // Create new vacancy
          const v = await storage.createVacancy({
            title: item.title,
            description: `Импортировано с Avito, объявление #${item.id}`,
            city: cityFromTitle ?? 'Не определён',
            salary: '',
            externalUrl: item.url,
            status: 'active',
          });
          // Link it to the Avito item_id via external_refs
          await storage.createExternalRef({
            entityType: 'vacancy',
            entityId: v.id,
            source: 'avito',
            externalId: String(item.id),
            externalType: 'item',
            meta: JSON.stringify({ price: item.price ?? null, category: item.category ?? null }),
          });
          created++;
        }
      } catch (e: any) {
        errors.push(`item ${item.id}: ${e.message}`);
      }
    }

    if (items.length < 100) break;
  }

  return { total, created, updated, errors };
}

// Find a local vacancy ID by Avito item_id. Used in avito-ingest.ts to bind
// a new chat to the real vacancy rather than a stub.
export async function findVacancyByAvitoItemId(itemId: number): Promise<string | null> {
  const refs = await storage.getExternalRefsByProvider('avito', 'item');
  const ref = refs.find((r) => r.externalId === String(itemId));
  return ref?.entityId ?? null;
}
