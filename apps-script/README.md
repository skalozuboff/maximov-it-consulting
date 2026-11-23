# max-cio.ru — free inquiry receiver (Google Apps Script)

This replaces FormSubmit without a paid backend. The script sends each valid inquiry to Gmail and Telegram.

## Configure
1. Create a standalone Google Apps Script project at https://script.google.com/
2. Paste `Code.gs` into the editor.
3. In Project Settings → Script Properties add:
   - `TELEGRAM_BOT_TOKEN` = token from BotFather (secret; never commit it)
4. The chat ID is already configured in Code.gs: `33061519`.
5. Run `authorizeServices` once in the editor and approve Gmail + external request permissions.
6. Deploy → New deployment → Web app:
   - Execute as: Me
   - Who has access: Anyone
7. Copy the Web app URL ending in `/exec`. Do not paste it into public source until deployment is tested.

## Test
Send a POST with JSON fields `company`, `contact`, `task` to the web app URL. The form integration uses a hidden iframe and postMessage response. Confirm delivery in both Gmail and Telegram before switching the production form.

The script uses a simple 30-second global throttle. Google Apps Script quotas and availability apply; this is not a guaranteed SLA.
