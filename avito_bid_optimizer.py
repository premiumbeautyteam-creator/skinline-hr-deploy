#!/usr/bin/env python3
"""
Avito Bid Optimizer — снижение ставок лазерной эпиляции для Skin Line
Запуск: python3 avito_bid_optimizer.py [--dry-run] [--action ACTION]

Actions:
  laser_reduce   — снизить ставки лазерных объявлений (~47%)
  kriopoliz_off  — снять с публикации объявления Криополиза
  stats          — показать статистику по всем активным объявлениям
  list_laser     — показать только лазерные объявления
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta

# ── Конфиг ──────────────────────────────────────────────────────────────────
CLIENT_ID     = os.getenv("AVITO_CLIENT_ID",     "A6H-_AXGmdHvB67T0vbB")
CLIENT_SECRET = os.getenv("AVITO_CLIENT_SECRET", "fJ4hnFKtpNYne6zjZ0D6RFsJ37pomNOW8aJFKFjo")
BASE_URL      = "https://api.avito.ru"

# Целевые ставки лазера по городам (₽/контакт)
LASER_TARGET_BIDS = {
    "набережные челны": 25,
    "челны":            25,
    "сургут":           23,
    "default":          25,   # для прочих городов
}

# Ставки RF-лифтинга и массажа — не трогаем
SKIP_SERVICES = ["rf-лифтинг", "rf лифтинг", "лпг", "эндосфера", "массаж", "чистка", "обертыван"]

# Ключевые слова для идентификации лазерных объявлений
LASER_KEYWORDS = ["лазер", "эпиляция", "laser", "epil"]

# Ключевые слова Криополиза
KRIOPOLIZ_KEYWORDS = ["криополиз", "cryo", "криолиполиз"]

# Максимальный CPL (₽) — выше этого = кандидат на снижение ставки
CPL_ALERT_THRESHOLD = 300

# ── API helper ───────────────────────────────────────────────────────────────

def api_get(path: str, token: str, params: dict = None) -> dict:
    url = BASE_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"HTTP {e.code} on GET {path}: {body[:300]}")


def api_post(path: str, token: str, data: dict) -> dict:
    url = BASE_URL + path
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"HTTP {e.code} on POST {path}: {body[:300]}")


def api_put(path: str, token: str, data: dict) -> dict:
    url = BASE_URL + path
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="PUT"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"HTTP {e.code} on PUT {path}: {body[:300]}")

# ── Авторизация ──────────────────────────────────────────────────────────────

def get_token() -> str:
    print("  Получаю OAuth токен…")
    data = urllib.parse.urlencode({
        "grant_type":    "client_credentials",
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }).encode()
    req = urllib.request.Request(
        BASE_URL + "/token", data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    token = resp.get("access_token", "")
    if not token:
        raise RuntimeError(f"Токен не получен: {resp}")
    print(f"  ✓ Токен: {token[:20]}…")
    return token


def get_user_id(token: str) -> int:
    print("  Получаю user_id…")
    info = api_get("/core/v1/accounts/self", token)
    uid = info.get("id")
    if not uid:
        raise RuntimeError(f"user_id не найден: {info}")
    print(f"  ✓ user_id = {uid} ({info.get('name', '')})")
    return uid

# ── Объявления ───────────────────────────────────────────────────────────────

def get_all_items(token: str, user_id: int) -> list[dict]:
    """Загружает все активные объявления постранично."""
    items = []
    page = 1
    per_page = 100
    print("  Загружаю объявления…", end="", flush=True)
    while True:
        resp = api_get(f"/core/v1/accounts/{user_id}/items", token, {
            "status": "active",
            "per_page": per_page,
            "page": page,
        })
        batch = resp.get("resources", [])
        items.extend(batch)
        print(f" {len(items)}", end="", flush=True)
        if len(batch) < per_page:
            break
        page += 1
        time.sleep(0.3)
    print(f"\n  ✓ Итого активных: {len(items)}")
    return items


def get_items_stats(token: str, user_id: int, item_ids: list[int], date_from: str, date_to: str) -> dict:
    """Получает статистику (показы, контакты, расходы) по списку объявлений."""
    if not item_ids:
        return {}
    # Разбиваем на пачки по 200 (лимит API)
    results = {}
    for i in range(0, len(item_ids), 200):
        batch = item_ids[i:i+200]
        try:
            resp = api_post(f"/stats/v1/accounts/{user_id}/items", token, {
                "dateFrom": date_from,
                "dateTo":   date_to,
                "fields":   ["uniqViews", "uniqContacts", "spent"],
                "itemIds":  batch,
                "periodGrouping": "summary",
            })
            for rec in resp.get("result", {}).get("items", []):
                iid = rec["itemId"]
                stats = rec.get("stats", [{}])[0] if rec.get("stats") else {}
                results[iid] = {
                    "views":    stats.get("uniqViews", 0),
                    "contacts": stats.get("uniqContacts", 0),
                    "spent":    stats.get("spent", 0) / 100,  # копейки → рубли
                }
        except Exception as e:
            print(f"  ! Ошибка stats batch {i}: {e}")
        time.sleep(0.3)
    return results

# ── Классификация ─────────────────────────────────────────────────────────────

def is_laser(item: dict) -> bool:
    title = (item.get("title") or "").lower()
    return any(kw in title for kw in LASER_KEYWORDS)


def is_kriopoliz(item: dict) -> bool:
    title = (item.get("title") or "").lower()
    return any(kw in title for kw in KRIOPOLIZ_KEYWORDS)


def city_from_item(item: dict) -> str:
    return (item.get("location_name") or item.get("address", {}).get("city", "") or "").lower()


def target_bid_for(item: dict) -> int:
    city = city_from_item(item)
    for key, bid in LASER_TARGET_BIDS.items():
        if key in city:
            return bid
    return LASER_TARGET_BIDS["default"]

# ── Управление ставками ───────────────────────────────────────────────────────

def get_item_vas(token: str, user_id: int, item_id: int) -> dict:
    """Получает текущие VAS/CPA параметры объявления."""
    try:
        return api_get(f"/core/v1/accounts/{user_id}/items/{item_id}/vas", token)
    except Exception:
        return {}


def set_cpa_bid(token: str, user_id: int, item_id: int, bid_rub: int, dry_run: bool) -> bool:
    """Устанавливает CPA-ставку (₽/контакт) для объявления."""
    endpoint = f"/avito-ads/v1/accounts/{user_id}/items/{item_id}/contacts_price"
    payload  = {"value": bid_rub * 100}  # копейки
    if dry_run:
        print(f"    [DRY-RUN] PUT {endpoint} → {bid_rub}₽")
        return True
    try:
        result = api_put(endpoint, token, payload)
        return result.get("result") != "error"
    except Exception as e:
        # Пробуем второй вариант endpoint
        try:
            endpoint2 = f"/core/v1/accounts/{user_id}/items/{item_id}/cpa"
            result2 = api_put(endpoint2, token, {"bid": bid_rub * 100})
            return True
        except Exception as e2:
            print(f"    ✗ Ошибка bid update: {e2}")
            return False


def unpublish_item(token: str, user_id: int, item_id: int, dry_run: bool) -> bool:
    """Снимает объявление с публикации."""
    endpoint = f"/core/v1/accounts/{user_id}/items/{item_id}/status"
    payload  = {"status": "inactive"}
    if dry_run:
        print(f"    [DRY-RUN] PUT {endpoint} → inactive")
        return True
    try:
        api_put(endpoint, token, payload)
        return True
    except Exception as e:
        print(f"    ✗ Ошибка unpublish: {e}")
        return False

# ── Действия ─────────────────────────────────────────────────────────────────

def action_stats(token: str, user_id: int):
    """Печатает сводную статистику за последние 30 дней."""
    items = get_all_items(token, user_id)
    date_to   = datetime.now().strftime("%Y-%m-%d")
    date_from = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

    item_ids = [it["id"] for it in items]
    stats = get_items_stats(token, user_id, item_ids, date_from, date_to)

    total_contacts = sum(s["contacts"] for s in stats.values())
    total_spent    = sum(s["spent"] for s in stats.values())
    cpl_overall    = total_spent / total_contacts if total_contacts else 0

    print(f"\n{'='*70}")
    print(f"СТАТИСТИКА ЗА {date_from} — {date_to}")
    print(f"{'='*70}")
    print(f"Активных объявлений : {len(items)}")
    print(f"Контактов итого     : {total_contacts}")
    print(f"Расход итого        : {total_spent:.0f}₽")
    print(f"CPL средний         : {cpl_overall:.0f}₽")
    print()

    # Группируем по сервису
    service_data: dict[str, dict] = {}
    for it in items:
        title = it.get("title", "Без названия")
        key = title[:50]
        s = stats.get(it["id"], {"contacts": 0, "spent": 0, "views": 0})
        if key not in service_data:
            service_data[key] = {"contacts": 0, "spent": 0, "views": 0, "ads": 0}
        service_data[key]["contacts"] += s["contacts"]
        service_data[key]["spent"]    += s["spent"]
        service_data[key]["views"]    += s["views"]
        service_data[key]["ads"]      += 1

    # Сортируем по расходу
    rows = sorted(service_data.items(), key=lambda x: x[1]["spent"], reverse=True)
    print(f"{'Объявление':<50} {'Контакты':>9} {'Расход₽':>9} {'CPL₽':>7}")
    print("-" * 78)
    for title, d in rows[:30]:
        cpl = d["spent"] / d["contacts"] if d["contacts"] else 0
        flag = "⚠️ " if cpl > CPL_ALERT_THRESHOLD and d["contacts"] > 0 else "   "
        print(f"{flag}{title:<48} {d['contacts']:>9} {d['spent']:>9.0f} {cpl:>7.0f}")


def action_list_laser(token: str, user_id: int):
    """Показывает лазерные объявления с текущими ставками и статистикой."""
    items = get_all_items(token, user_id)
    laser_items = [it for it in items if is_laser(it)]
    print(f"\nЛазерных объявлений: {len(laser_items)} из {len(items)} активных\n")

    date_to   = datetime.now().strftime("%Y-%m-%d")
    date_from = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    stats = get_items_stats(token, user_id, [it["id"] for it in laser_items], date_from, date_to)

    print(f"{'ID':>12}  {'Город':<20}  {'Название':<40}  {'Конт':>5}  {'CPL₽':>6}  {'Цель₽':>6}")
    print("-" * 100)
    for it in sorted(laser_items, key=lambda x: city_from_item(x)):
        s = stats.get(it["id"], {"contacts": 0, "spent": 0})
        cpl     = s["spent"] / s["contacts"] if s["contacts"] else 0
        city    = city_from_item(it)[:20]
        title   = it.get("title", "")[:40]
        target  = target_bid_for(it)
        flag    = "⚠️ " if cpl > CPL_ALERT_THRESHOLD and s["contacts"] > 0 else "   "
        print(f"{flag}{it['id']:>12}  {city:<20}  {title:<40}  {s['contacts']:>5}  {cpl:>6.0f}  {target:>6}")


def action_laser_reduce(token: str, user_id: int, dry_run: bool):
    """Снижает ставки лазерных объявлений до целевых значений."""
    items = get_all_items(token, user_id)
    laser_items = [it for it in items if is_laser(it)]
    print(f"\n{'='*70}")
    print(f"СНИЖЕНИЕ СТАВОК ЛАЗЕРА — {'DRY RUN' if dry_run else 'РЕАЛЬНОЕ ВЫПОЛНЕНИЕ'}")
    print(f"{'='*70}")
    print(f"Лазерных объявлений: {len(laser_items)}")

    ok_count  = 0
    err_count = 0
    for it in laser_items:
        item_id = it["id"]
        city    = city_from_item(it)
        title   = it.get("title", "")[:50]
        target  = target_bid_for(it)
        print(f"\n  [{item_id}] {city} — {title}")
        print(f"    Целевая ставка: {target}₽/контакт")

        success = set_cpa_bid(token, user_id, item_id, target, dry_run)
        if success:
            ok_count += 1
            if not dry_run:
                print(f"    ✓ Ставка обновлена → {target}₽")
        else:
            err_count += 1
        time.sleep(0.2)

    print(f"\n{'='*70}")
    print(f"Обновлено: {ok_count}  |  Ошибок: {err_count}")
    if dry_run:
        print("Это был DRY RUN — реальных изменений не было.")
        print("Запустите без --dry-run для применения.")


def action_kriopoliz_off(token: str, user_id: int, dry_run: bool):
    """Снимает Криополиз с публикации."""
    items = get_all_items(token, user_id)
    krio_items = [it for it in items if is_kriopoliz(it)]
    print(f"\n{'='*70}")
    print(f"ОТКЛЮЧЕНИЕ КРИОПОЛИЗА — {'DRY RUN' if dry_run else 'РЕАЛЬНОЕ ВЫПОЛНЕНИЕ'}")
    print(f"{'='*70}")
    print(f"Найдено объявлений Криополиза: {len(krio_items)}")

    for it in krio_items:
        item_id = it["id"]
        city    = city_from_item(it)
        title   = it.get("title", "")[:60]
        print(f"\n  [{item_id}] {city} — {title}")

        success = unpublish_item(token, user_id, item_id, dry_run)
        if success:
            if not dry_run:
                print(f"    ✓ Снято с публикации")
        time.sleep(0.2)

    if not krio_items:
        print("  Объявления Криополиза не найдены среди активных.")
    elif dry_run:
        print("\nDRY RUN — реальных изменений не было.")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Avito Bid Optimizer для Skin Line")
    parser.add_argument("--dry-run",  action="store_true", help="Показать план без реальных изменений")
    parser.add_argument("--action",   default="stats",
                        choices=["stats", "list_laser", "laser_reduce", "kriopoliz_off"],
                        help="Что делать (default: stats)")
    args = parser.parse_args()

    print(f"\n{'='*70}")
    print(f"Avito Bid Optimizer — Skin Line")
    print(f"Время: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Действие: {args.action}  |  DRY-RUN: {args.dry_run}")
    print(f"{'='*70}\n")

    token   = get_token()
    user_id = get_user_id(token)

    if args.action == "stats":
        action_stats(token, user_id)
    elif args.action == "list_laser":
        action_list_laser(token, user_id)
    elif args.action == "laser_reduce":
        action_laser_reduce(token, user_id, dry_run=args.dry_run)
    elif args.action == "kriopoliz_off":
        action_kriopoliz_off(token, user_id, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
