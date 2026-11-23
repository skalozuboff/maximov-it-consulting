const CONFIG = {
  email: "a.maximoff.spb@gmail.com",
  chatId: "33061519",
  allowedOrigin: "https://max-cio.ru"
};

function doPost(e) {
  try {
    const data = (e && e.parameter && Object.keys(e.parameter).length) ? e.parameter : JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (data.website) return resultPage(true, "ok");
    const company = clean(data.company, 120);
    const contact = clean(data.contact, 160);
    const task = clean(data.task, 3000);
    if (company.length < 2 || contact.length < 3 || task.length < 5) {
      return resultPage(false, "Заполните все поля корректно.");
    }

    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contact.toLowerCase());
    const throttleKey = "last_" + Utilities.base64EncodeWebSafe(digest).slice(0, 32);
    const cache = CacheService.getScriptCache();
    if (cache.get(throttleKey)) return resultPage(false, "Подождите 30 секунд перед следующей отправкой.");
    cache.put(throttleKey, "1", 30);

    const message = [
      "Новая заявка с сайта max-cio.ru",
      "",
      "Компания / отрасль: " + company,
      "Контакт для ответа: " + contact,
      "",
      "Задача:",
      task
    ].join("\n");

    let telegramSent = false;
    let emailSent = false;
    const errors = [];

    try {
      const token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN");
      if (!token) throw new Error("Telegram token is not configured");
      const tgResponse = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ chat_id: CONFIG.chatId, text: message, disable_web_page_preview: true }),
        muteHttpExceptions: true
      });
      const tg = JSON.parse(tgResponse.getContentText());
      if (!tg.ok) throw new Error("Telegram delivery failed");
      telegramSent = true;
    } catch (telegramError) {
      console.error("Telegram delivery error: " + telegramError.message);
      errors.push("telegram");
    }

    try {
      GmailApp.sendEmail(CONFIG.email, "Новая заявка с сайта max-cio.ru", message, {
        name: "max-cio.ru"
      });
      emailSent = true;
    } catch (emailError) {
      console.error("Email delivery error: " + emailError.message);
      errors.push("email");
    }

    if (!telegramSent && !emailSent) throw new Error("Both notification channels failed");
    const confirmation = telegramSent && emailSent
      ? "Заявка отправлена. Спасибо! Я свяжусь с вами по указанному контакту."
      : "Заявка принята, но один из каналов уведомления временно недоступен.";
    return resultPage(true, confirmation);
  } catch (err) {
    console.error(err);
    return resultPage(false, "Не удалось отправить заявку. Попробуйте ещё раз или напишите напрямую на " + CONFIG.email + ".");
  }
}

function clean(value, maxLength) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, maxLength);
}

function resultPage(ok, message) {
  const payload = JSON.stringify({ source: "max-cio-inquiry", ok: ok, message: message });
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    'window.top.postMessage(' + payload + ', "*");' +
    '</script><p>' + message.replace(/[&<>]/g, "") + '</p></body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Run once from the Apps Script editor to authorize Gmail and external requests.
function authorizeServices() {
  GmailApp.getAliases();
  UrlFetchApp.fetch("https://api.telegram.org");
}
