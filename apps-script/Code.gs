const CONFIG = {
  email: "andrei@max-cio.ru",
  chatId: "33061519",
  allowedOrigin: "https://max-cio.ru"
};

function doPost(e) {
  const data = (e && e.parameter && Object.keys(e.parameter).length)
    ? e.parameter
    : JSON.parse((e && e.postData && e.postData.contents) || "{}");
  const nonce = clean(data.nonce, 80);

  try {
    if (data.website) return resultPage(true, "ok", nonce);
    const company = clean(data.company, 120);
    const contact = clean(data.contact, 160);
    const task = clean(data.task, 3000);
    if (company.length < 2 || contact.length < 3 || task.length < 5) {
      return resultPage(false, "Заполните все поля корректно.", nonce);
    }

    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contact.toLowerCase());
    const throttleKey = "last_" + Utilities.base64EncodeWebSafe(digest).slice(0, 32);
    const cache = CacheService.getScriptCache();
    if (cache.get(throttleKey)) return resultPage(false, "Подождите 30 секунд перед следующей отправкой.", nonce);
    cache.put(throttleKey, "1", 30);

    const message = [
      "Новая заявка с сайта max-cio.ru", "",
      "Компания / отрасль: " + company,
      "Контакт для ответа: " + contact, "", "Задача:",
      task
    ].join("\n");

    let telegramSent = false, emailSent = false;
    try {
      const token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN");
      if (!token) throw new Error("Telegram token is not configured");
      const response = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "post", contentType: "application/json",
        payload: JSON.stringify({chat_id:CONFIG.chatId,text:message,disable_web_page_preview:true}),
        muteHttpExceptions: true
      });
      if (!JSON.parse(response.getContentText()).ok) throw new Error("Telegram delivery failed");
      telegramSent = true;
    } catch (err) { console.error("Telegram delivery error: " + err.message); }

    try {
      GmailApp.sendEmail(CONFIG.email, "Новая заявка с сайта max-cio.ru", message, {name:"max-cio.ru"});
      emailSent = true;
    } catch (err) { console.error("Email delivery error: " + err.message); }

    if (!telegramSent && !emailSent) throw new Error("Both notification channels failed");
    const confirmation = telegramSent && emailSent
      ? "Заявка отправлена. Спасибо! Я свяжусь с вами по указанному контакту."
      : "Заявка принята, но один из каналов уведомления временно недоступен.";
    return resultPage(true, confirmation, nonce);
  } catch (err) {
    console.error(err);
    return resultPage(false, "Не удалось отправить заявку. Попробуйте ещё раз или напишите напрямую на " + CONFIG.email + ".", nonce);
  }
}

function clean(value, maxLength) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, maxLength);
}

function resultPage(ok, message, nonce) {
  const payload = JSON.stringify({source:"max-cio-inquiry",ok:ok,message:message,nonce:nonce || ""});
  const safeMessage = String(message).replace(/[&<>]/g, "");
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    'window.top.postMessage(' + payload + ', "*");' +
    '</script><p>' + safeMessage + '</p></body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function authorizeServices() {
  GmailApp.getAliases();
  UrlFetchApp.fetch("https://api.telegram.org");
}
