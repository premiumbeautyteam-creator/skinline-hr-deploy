#!/usr/bin/env python3
"""
Avito CPL Monitor — ежедневный дайджест по ставкам и CPL для Skin Line
Запуск: python3 avito_cpl_monitor.py [--period N]

Отправляет Telegram-отчёт:
 • Общий CPL за период
 • CPL по услугам (лазер / RF / массаж / проч.)
 • Объявления с CPL > 300₽ — кандидаты на снижение ставки
 • Объявления с CPL < 150₽ и контактами > 5 — кандидаты на повышение
 • Аванс и баланс кошелька
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
from typing import Optional

# ── Конфиг ──────────────────────────────────────────────────────────────────
CLIENT_ID      = os.getenv("AVITO_CLIENT_ID",     "A6H-_AXGmdHvB67T0vbB")
CLIENT_SECRET  = os.getenv("AVITO_CLIENT_SECRET", "fJ4hnFKtpNYne6zjZ0D6RFsJ37pomNOW8aJFKFjo")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN",  "")
TELEGRAM_CHAT  = os.getenv("TELEGRAM_CHAT_ID",    "5836672698")
BASE_URL       = "https://api.avito.ru"

CPL_HIGH   = 300   # ₽ — выше = проблема
CPL_LOW    = 150   # ₽ — ниже = потенциал для роста ставки
MIN_CONTACTS = 3   # минимум контактов для включения в анализ

# Группировка объявлений по ключевым словам
GROUPS = {
    "Лазер": ["лазер", "эпиляция", "laser"],
    "RF-лифтинг": ["rf-лифтинг", "rf лифтинг", "rf", "лифтинг"],
    "ЛПГ/Эндосфера": ["лпг", "эндосфера", "lpg"],
    "Криополиз": ["криополиз", "крио"],
    "Массаж": ["массаж"],
    "Другое": [],
}

# ── API ──────────────────────────────────────────────────────────────────────

def http_json(url: str, method: str = "GET", headers: dict = None,
              data: bytes = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:200]}")


def get_token() -> str:
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }).encode()
    resp = http_json(BASE_URL + "/token", "POST", data=data,
                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    token = resp.get("access_token", "")
    if not token:
        raise RuntimeError(f"Токен не получен: {resp}")
    return token


def get_user_id(token: str) -> int:
    info = http_json(BASE_URL + "/core/v1/accounts/self",
                     headers={"Authorization": f"Bearer {token}"})
    uid = info.get("id")
    if not uid:
        raise RuntimeError(f"user_id не найден: {info}")
    return uid


def get_balance(token: str, user_id: int) -> dict:
    try:
        return http_json(BASE_URL + f"/core/v1/accounts/{user_id}/balance",
                         headers={"Authorization": f"Bearer {token}"})
    except Exception:
        return {}


def get_all_items(token: str, user_id: int) -> list[dict]:
    items = []
    page = 1
    while True:
        resp = http_json(
            BASE_URL + f"/core/v1/accounts/{user_id}/items?status=active&per_page=100&page={page}",
            headers={"Authorization": f"Bearer {token}"}
        )
        batch = resp.get("resources", [])
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.3)
    return items


def get_stats(token: str, user_id: int, item_ids: list[int],
              date_from: str, date_to: str) -> dict:
    results = {}
    for i in range(0, len(item_ids), 200):
        batch = item_ids[i:i+200]
        try:
            resp = http_json(
                BASE_URL + f"/stats/v1/accounts/{user_id}/items",
                "POST",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                data=json.dumps({
                    "dateFrom": date_from, "dateTo": date_to,
                    "fields": ["uniqViews", "uniqContacts", "spent"],
                    "itemIds": batch, "periodGrouping": "summary",
                }).encode()
            )
            for rec in resp.get("result", {}).get("items", []):
                s = rec.get("stats", [{}])[0] if rec.get("stats") else {}
                results[rec["itemId"]] = {
                    "views":    s.get("uniqViews", 0),
                    "contacts": s.get("uniqContacts", 0),
                    "spent":    s.get("spent", 0) / 100,
                }
        except Exception as e:
            print(f"  ! stats batch {i}: {e}", file=sys.stderr)
        time.sleep(0.4)
    return results

# ── Классификация ─────────────────────────────────────────────────────────────

def classify(title: str) -> str:
    t = title.lower()
    for group, keywords in GROUPS.items():
        if keywords and any(kw in t for kw in keywords):
            return group
    return "Другое"

# ── Telegram ─────────────────────────────────────────────────────────────────

def send_telegram(text: str):
    if not TELEGRAM_TOKEN:
        print("  ! TELEGRAM_BOT_TOKEN не задан, сообщение не отправлено")
        print(text)
        return
    url  = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    data = json.dumps({"chat_id": TELEGRAM_CHAT, "text": text,
                       "parse_mode": "HTML"}).encode()
    try:
        http_json(url, "POST",
                  headers={"Content-Type": "application/json"}, data=data)
        print("  ✓ Telegram отправлен")
    except Exception as e:
        print(f"  ! Telegram: {e}")
        print(text)

# ── Отчёт ─────────────────────────────────────────────────────────────────────

def build_report(period_days: int) -> str:
    token   = get_token()
    user_id = get_user_id(token)

    date_to   = datetime.now().strftime("%Y-%m-%d")
    date_from = (datetime.now() - timedelta(days=period_days)).strftime("%Y-%m-%d")

    items = get_all_items(token, user_id)
    if not items:
        return "⚠️ Активных объявлений не найдено"

    item_ids = [it["id"] for it in items]
    stats    = get_stats(token, user_id, item_ids, date_from, date_to)

    # Группировка
    group_data: dict[str, dict] = {g: {"contacts": 0, "spent": 0.0, "ads": 0}
                                    for g in GROUPS}
    high_cpl: list[tuple] = []   # (cpl, title, city, contacts, spent)
    low_cpl:  list[tuple] = []

    total_contacts = 0
    total_spent    = 0.0

    for it in items:
        iid   = it["id"]
        s     = stats.get(iid, {"contacts": 0, "spent": 0.0, "views": 0})
        title = it.get("title", "")
        city  = (it.get("location_name") or "").split(",")[0]
        group = classify(title)

        total_contacts += s["contacts"]
        total_spent    += s["spent"]

        g = group_data[group]
        g["contacts"] += s["contacts"]
        g["spent"]    += s["spent"]
        g["ads"]      += 1

        if s["contacts"] >= MIN_CONTACTS:
            cpl = s["spent"] / s["contacts"]
            if cpl > CPL_HIGH:
                high_cpl.append((cpl, title[:35], city, s["contacts"], s["spent"]))
            elif cpl < CPL_LOW:
                low_cpl.append((cpl, title[:35], city, s["contacts"], s["spent"]))

    cpl_avg = total_spent / total_contacts if total_contacts else 0

    # Баланс
    balance  = get_balance(token, user_id)
    wallet   = balance.get("balance", 0) / 100 if balance else 0
    advance  = balance.get("advance", 0) / 100 if balance else 0

    # ── Формируем сообщение ────────────────────────────────────────────────
    target_ok = "✅" if cpl_avg <= CPL_HIGH else "⚠️"
    lines = [
        f"📊 <b>Авито Skin Line — дайджест ({date_from} — {date_to})</b>",
        f"",
        f"💰 Расход: <b>{total_spent:.0f}₽</b> | Контактов: <b>{total_contacts}</b>",
        f"{target_ok} CPL средний: <b>{cpl_avg:.0f}₽</b> (цель ≤{CPL_HIGH}₽)",
        f"🏦 Кошелёк: {wallet:.0f}₽ | Аванс CPA: {advance:.0f}₽",
        f"",
        f"📁 <b>По услугам:</b>",
    ]

    for group, g in group_data.items():
        if g["ads"] == 0:
            continue
        gcpl = g["spent"] / g["contacts"] if g["contacts"] else 0
        flag = "🔴" if gcpl > CPL_HIGH and g["contacts"] >= MIN_CONTACTS else (
               "🟡" if gcpl > CPL_HIGH * 0.8 and g["contacts"] >= MIN_CONTACTS else "🟢")
        lines.append(f"  {flag} {group}: {g['contacts']} конт., {g['spent']:.0f}₽, CPL {gcpl:.0f}₽")

    if high_cpl:
        lines += ["", f"🔴 <b>CPL > {CPL_HIGH}₽ — кандидаты на снижение ставки:</b>"]
        for cpl, title, city, contacts, spent in sorted(high_cpl, reverse=True)[:8]:
            lines.append(f"  • {title} ({city}): {contacts} конт., CPL {cpl:.0f}₽")

    if low_cpl:
        lines += ["", f"🟢 <b>CPL < {CPL_LOW}₽ — потенциал роста ставки:</b>"]
        for cpl, title, city, contacts, spent in sorted(low_cpl)[:5]:
            lines.append(f"  • {title} ({city}): {contacts} конт., CPL {cpl:.0f}₽")

    if advance < 3000:
        lines += ["", f"🚨 <b>АВАНС CPA НИЗКИЙ: {advance:.0f}₽! Пополни до 5000₽+</b>"]
    elif advance < 5000:
        lines += ["", f"⚠️ Аванс CPA: {advance:.0f}₽ — скоро пополнять"]

    lines.append(f"\n⏱ {datetime.now().strftime('%d.%m.%Y %H:%M')}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--period", type=int, default=7,
                        help="Период анализа в днях (default: 7)")
    parser.add_argument("--no-telegram", action="store_true",
                        help="Только вывод в консоль, без Telegram")
    args = parser.parse_args()

    print(f"Авито CPL Monitor | период: {args.period} дн.")
    report = build_report(args.period)

    print("\n" + report)

    if not args.no_telegram:
        send_telegram(report)


if __name__ == "__main__":
    main()
