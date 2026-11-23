# X-Mail website inquiry monitor

Read-only IMAP monitor for `andrei@max-cio.ru`. GitHub Actions checks the inbox every five minutes and sends likely website inquiries to the existing Telegram bot.

## Add GitHub Actions secrets

Open **Settings → Secrets and variables → Actions** and add:

- `XMAIL_IMAP_USER` — `andrei@max-cio.ru`
- `XMAIL_IMAP_PASSWORD` — the mailbox password
- `TELEGRAM_BOT_TOKEN` — the token stored in the Google Apps Script project property `TELEGRAM_BOT_TOKEN`

The workflow uses the existing Telegram chat ID `33061519`.

## First launch and test

1. Add the three secrets.
2. Open **Actions → X-Mail website inquiry monitor → Run workflow**.
3. The first run records the current highest IMAP UID as a baseline. Existing messages are intentionally not sent.
4. Send a test message to `andrei@max-cio.ru` with subject `Заявка с сайта`. The next scheduled run should notify Telegram.

## Behaviour

- IMAP: `imap.x-mail.ru:993`, SSL/TLS.
- The mailbox is opened read-only. Messages are not deleted, moved, or marked as read.
- The checkpoint stores only IMAP UIDVALIDITY and the last processed UID, not message content or sender details.
- Website-form subjects and the structured max-cio form fields are treated as strong inquiry signals. Vacancies, newsletters, verification messages, and ordinary correspondence are ignored by rules.
- Full message text is sent to Telegram; long messages are split into multiple messages.
- If Telegram delivery fails, the relevant UID is not advanced and will be retried.

GitHub scheduled workflows are best-effort and may start later than scheduled during high load. This is a lightweight no-server MVP, not guaranteed real-time mail transport.
