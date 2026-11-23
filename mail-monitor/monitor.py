#!/usr/bin/env python3
"""Read-only X-Mail IMAP monitor for max-cio.ru website inquiries."""
from __future__ import annotations

import email
import email.policy
import imaplib
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import timezone
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

IMAP_HOST = os.getenv("IMAP_HOST", "imap.x-mail.ru")
IMAP_PORT = int(os.getenv("IMAP_PORT", "993"))
IMAP_USER = os.environ["IMAP_USER"]
IMAP_PASSWORD = os.environ["IMAP_PASSWORD"]
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "33061519")
TIMEZONE = os.getenv("TIMEZONE", "Europe/Moscow")
STATE_FILE = Path(os.getenv("STATE_PATH", "mail-monitor/state.json"))


class HTMLText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self.hidden += 1
        elif tag in ("br", "p", "div", "li", "tr"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self.hidden:
            self.hidden -= 1
        elif tag in ("p", "div", "li", "tr"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def decoded(value):
    try:
        return str(make_header(decode_header(value or "")))
    except Exception:
        return value or ""


def part_text(part):
    payload = part.get_payload(decode=True)
    if payload is None:
        raw = part.get_payload()
        return raw if isinstance(raw, str) else ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def body_text(msg):
    plain, html_parts = [], []
    for part in (msg.walk() if msg.is_multipart() else [msg]):
        if part.get_content_maintype() == "multipart" or part.get_content_disposition() == "attachment":
            continue
        kind = part.get_content_type().lower()
        if kind == "text/plain":
            value = part_text(part).strip()
            if value:
                plain.append(value)
        elif kind == "text/html":
            parser = HTMLText()
            try:
                parser.feed(part_text(part))
                value = "".join(parser.parts).strip()
            except Exception:
                value = re.sub(r"<[^>]+>", " ", part_text(part))
            if value:
                html_parts.append(value)
    value = "\n\n".join(plain or html_parts).replace("\r", "")
    value = re.sub(r"[\t\u00a0 ]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def date_text(value):
    if not value:
        return "дата не указана"
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ZoneInfo(TIMEZONE)).strftime("%d.%m.%Y %H:%M %Z")
    except Exception:
        return value


def is_inquiry(subject, sender, body):
    s, b, sender = subject.casefold(), body.casefold(), sender.casefold()
    if sender == IMAP_USER.casefold():
        return False
    excluded = ("вакансия", "резюме", "отклик на вакансию", "hh.ru", "headhunter",
                "newsletter", "рассылка", "unsubscribe", "код подтверждения",
                "verification code", "password reset")
    if any(x in s for x in excluded):
        return False
    if "formsubmit" in sender or "formsubmit" in s:
        if any(x in s + " " + b for x in ("activate", "activation", "verify", "подтверд", "активир")):
            return False
    if any(x in s for x in ("новая заявка с сайта", "заявка с сайта",
                            "обращение с сайта", "форма обратной связи",
                            "new website inquiry", "new form submission")):
        return True
    markers = ("компания / отрасль:", "контакт для ответа:", "задача:")
    if sum(x in b for x in markers) >= 2 and (
        "max-cio.ru" in b or "заявк" in s or "обращен" in s
    ):
        return True
    signals = ("запрос консультации", "хочу обсудить", "нужен аудит",
               "интересует аудит", "заявка на консультацию", "обращение с сайта")
    return bool(sender and "@" in sender and any(x in s + "\n" + b for x in signals))


def send_telegram(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    chunks = []
    while text:
        cut = min(3800, len(text))
        if len(text) > cut:
            boundary = text.rfind("\n", 0, cut)
            if boundary > 1000:
                cut = boundary
        chunks.append(text[:cut])
        text = text[cut:]
    for index, chunk in enumerate(chunks, 1):
        if len(chunks) > 1:
            chunk = f"[{index}/{len(chunks)}]\n" + chunk
        data = json.dumps({"chat_id": CHAT_ID, "text": chunk,
                           "disable_web_page_preview": True}).encode()
        req = urllib.request.Request(url, data=data,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                result = json.loads(response.read().decode())
            if not result.get("ok"):
                raise RuntimeError(f"Telegram API error: {result}")
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Telegram HTTP {exc.code}: {exc.read().decode(errors='replace')}") from exc


def load_state():
    if not STATE_FILE.exists():
        return {"uidvalidity": None, "last_uid": None}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(STATE_FILE)


def main():
    state = load_state()
    mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT,
                             ssl_context=ssl.create_default_context(), timeout=25)
    try:
        mail.login(IMAP_USER, IMAP_PASSWORD)
        status, _ = mail.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("Не удалось открыть INBOX по IMAP")

        _, validity_data = mail.response("UIDVALIDITY")
        match = re.search(rb"\d+", validity_data[0]) if validity_data and validity_data[0] else None
        validity = int(match.group()) if match else None

        status, result = mail.uid("search", None, "ALL")
        if status != "OK":
            raise RuntimeError("IMAP UID SEARCH завершился ошибкой")
        uids = [int(x) for x in (result[0] or b"").split()]
        latest = max(uids, default=0)

        if state.get("uidvalidity") is None or state.get("last_uid") is None:
            save_state({"uidvalidity": validity, "last_uid": latest})
            print(f"Базовая точка сохранена: UID {latest}; старые письма не отправляются.")
            return
        if validity is not None and state.get("uidvalidity") != validity:
            save_state({"uidvalidity": validity, "last_uid": latest})
            print("UIDVALIDITY изменился; базовая точка пересоздана.")
            return

        last_uid = int(state.get("last_uid", 0))
        new_uids = [uid for uid in uids if uid > last_uid]
        if not new_uids:
            print("Новых писем нет.")
            return

        for uid in new_uids:
            status, data = mail.uid("fetch", str(uid), "(RFC822)")
            raw = next((item[1] for item in (data or [])
                        if isinstance(item, tuple) and isinstance(item[1], bytes)), None)
            if status != "OK" or raw is None:
                raise RuntimeError(f"Не удалось прочитать письмо UID {uid}")

            msg = email.message_from_bytes(raw, policy=email.policy.default)
            subject = decoded(msg.get("Subject")) or "(без темы)"
            from_header = decoded(msg.get("From"))
            sender_name, sender_email = parseaddr(from_header)
            body = body_text(msg)

            if is_inquiry(subject, sender_email, body):
                text = (
                    "НОВАЯ ЗАЯВКА / ОБРАЩЕНИЕ С MAX-CIO.RU\n\n"
                    f"Дата: {date_text(msg.get('Date'))}\n"
                    f"Отправитель: {sender_name or 'не указано'} <{sender_email or from_header}>\n"
                    f"Тема: {subject}\n\nПолный текст письма:\n"
                    f"{body or '[текст письма отсутствует]'}\n\n"
                    "Открыть почту: https://mail.x-mail.ru/"
                )
                # Advance the UID only after successful delivery.
                send_telegram(text)
                print(f"Заявка UID {uid} отправлена в Telegram.")
            else:
                print(f"UID {uid}: не похоже на заявку, пропускаю.")

            state = {"uidvalidity": validity, "last_uid": uid}
            save_state(state)

        print(f"Обработано новых писем: {len(new_uids)}; последний UID: {state['last_uid']}.")
    finally:
        try:
            mail.logout()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ОШИБКА: {exc}", file=sys.stderr)
        raise SystemExit(1)
