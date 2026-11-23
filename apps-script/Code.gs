const CONFIG = {
  email: "a.maximoff.spb@gmail.com",
  chatId: "33061519",
  allowedOrigin: "https://max-cio.ru"
};

function doPost(e) {
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || "{}");
    if (data.website) return resultPage(true, "ok");
    const company = clean(data.company, 120);
    const contact = clean(data.contact, 160);
    const task = clean(data.task, 3000);
    if (company.length < 2 || contact.length < 3 || task.length < 5) {
      return resultPage(false, "Заполните все поля корректно.");
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return resultPage(false, "Попробуйте отправить заявку чуть позже.");
    try {
      const props = PropertiesService.getScriptProperties();
      const now = Date.now();
      const last = Number(props.getProperty("lastSubmission") || 0);
      if (now - last < 30000) return resultPage(false, "Подождите 30 секунд перед следующей отправкой.");
      props.setProperty("lastSubmission", String(now));
    } finally {
      lock.releaseLock();
    }

    const message = [
      "Новая заявка с сайта max-cio.ru",
      "",
      "Компания / отрасль: " + company,
      "Контакт для ответа: " + contact,
      "",
      "Задача:",
      task
    ].join("\n");

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

    GmailApp.sendEmail(CONFIG.email, "Новая заявка с сайта max-cio.ru", message, {
      name: "max-cio.ru"
    });

    return resultPage(true, "Заявка отправлена. Спасибо! Я свяжусь с вами по указанному контакту.");
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
