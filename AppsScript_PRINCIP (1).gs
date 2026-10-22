/**
 * PRINCIP — обращения, клиенты, заказы, задачи, запись на замер, замеры (фото в Google Диск).
 * Версия 4: добавлены ЗАДАЧИ и уведомления на почту (см. блок «ЗАДАЧИ И УВЕДОМЛЕНИЯ» внизу).
 * Вставляется в НОВУЮ Google Таблицу: Расширения → Apps Script.
 * Листы создаются сами при первом обращении.
 *
 * Главное правило надёжности: у каждой записи свой номер (id).
 * Повторная отправка той же записи ОБНОВЛЯЕТ её, а не создаёт дубль —
 * поэтому телефон может спокойно отправлять повторно, пока не получит ответ «ок».
 */

/* ВЕРСИЯ СКРИПТА. Приложение сверяет её и подскажет, если скрипт устарел. */
var SCRIPT_REV = 4;

/* КЛЮЧ ДОСТУПА хранится НЕ здесь, а в «Свойствах скрипта»:
 *   слева шестерёнка «Настройки проекта» → внизу «Свойства скрипта» → «Добавить свойство»:
 *   свойство ACCESS_KEY, значение — ваш ключ (8+ знаков, лучше 12+).
 * Поэтому при замене кода ключ не пропадает. Без ключа скрипт ничего не отдаёт и не принимает —
 * персональные данные клиентов защищены, даже если ссылка попала не туда.
 * Запасной вариант (не рекомендуется): вписать ключ в строку ниже. */
var KEY_PLACEHOLDER = 'ЗАМЕНИТЕ-НА-СВОЙ-КЛЮЧ';
var ACCESS_KEY = KEY_PLACEHOLDER;

function getAccessKey_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  if (fromProps) return { key: String(fromProps), source: 'свойства скрипта' };
  if (ACCESS_KEY && ACCESS_KEY !== KEY_PLACEHOLDER) return { key: ACCESS_KEY, source: 'код' };
  return { key: '', source: 'не задан' };
}

/* Возвращает текст ошибки или '' если всё в порядке. Если ключ не задан — доступ закрыт (не открыт!). */
function checkKey_(given) {
  var k = getAccessKey_();
  if (!k.key) return 'ключ доступа не задан: впишите ACCESS_KEY в «Свойства скрипта»';
  if (k.key.length < 8) return 'ключ в скрипте слишком короткий (нужно 8+ знаков)';
  if (String(given || '') !== k.key) return 'нет доступа: неверный ключ';
  return '';
}

/* ДОСТУП К ФОТО.
 *   'link' — фото открываются по ссылке всем, у кого она есть (просто, работает сразу).
 *   'team' — ссылки НЕ открываются всем: фото видят только те, кому вы вручную дали доступ к папке
 *            «PRINCIP — фото заказов» на Google Диске (Поделиться → адреса Google-аккаунтов Алины, Диляры, Саши).
 *            Безопаснее: это фото квартир клиентов. У каждого из команды должен быть свой аккаунт Google.
 * Смена режима: поменять слово ниже и опубликовать новую версию скрипта. */
var PHOTO_ACCESS = 'link';

var ENTITIES = {
  lead: {
    sheet: 'Обращения',
    fields: ['id', 'createdAt', 'name', 'phone', 'source', 'request', 'comment', 'status', 'nextContact', 'clientId'],
    titles: ['ID', 'Создано', 'Имя', 'Телефон', 'Откуда', 'Запрос', 'Комментарий', 'Статус', 'Следующий контакт', 'ID клиента']
  },
  client: {
    sheet: 'Клиенты',
    fields: ['id', 'createdAt', 'name', 'phone', 'address', 'orderType', 'contractNo', 'contractSum', 'stage', 'comment', 'leadId'],
    titles: ['ID', 'Создано', 'Имя', 'Телефон', 'Адрес', 'Тип заказа', '№ договора', 'Сумма договора', 'Этап', 'Комментарий', 'ID обращения']
  },
  order: {
    sheet: 'Заказы',
    fields: ['id', 'createdAt', 'clientId', 'number', 'item', 'title', 'stage', 'stageChangedAt', 'stageBy', 'stageNote', 'stageBeforeClaim',
             'launchDate', 'address', 'contractDate', 'deliveryDate', 'note', 'sum', 'prepay', 'postpay', 'mountIncluded',
             'extras', 'extrasNote', 'claims', 'claimsNote', 'preMeasure', 'preProject', 'preContract', 'shipCheck', 'archived'],
    titles: ['ID', 'Создано', 'ID клиента', '№ заказа (папки)', 'Изделие', 'Название', 'Этап', 'Этап с', 'Этап перевёл', 'Заметка этапа', 'До рекламации',
             'Запуск в цеху', 'Адрес', 'Дата договора', 'Дата сдачи', 'Заметка', 'Сумма', 'Предоплата', 'Постоплата', 'Монтаж в договоре',
             'Допы, ₽', 'Допы: что', 'Рекламации, ₽', 'Рекламации: что', 'Замер сделан', 'Проект согласован', 'Договор и предоплата', 'Проверено при отгрузке', 'В архиве']
  },
  event: {
    sheet: 'История',
    fields: ['id', 'orderId', 'ts', 'by', 'type', 'text'],
    titles: ['ID', 'ID заказа', 'Когда', 'Кто', 'Тип', 'Что произошло']
  },
  photo: {
    sheet: 'Фото',
    fields: ['id', 'orderId', 'category', 'caption', 'fileUrl', 'createdAt', 'by'],
    titles: ['ID', 'ID заказа', 'Категория', 'Подпись', 'Ссылка на файл', 'Создано', 'Кто']
  },
  booking: {
    sheet: 'Записи',
    fields: ['id', 'date', 'time', 'name', 'phone'],
    titles: ['ID', 'Дата', 'Время', 'Имя', 'Телефон']
  },
  task: {
    sheet: 'Задачи',
    fields: ['id', 'createdAt', 'createdBy', 'title', 'description', 'stage', 'stageChangedAt', 'stageBy', 'priority', 'dueDate', 'dueTime',
             'assignees', 'orderId', 'repeat', 'repeatEvery', 'seriesId', 'openedAt', 'closedAt', 'stageNote', 'updatedBy', 'archived', 'notified'],
    titles: ['ID', 'Создана', 'Кто поставил', 'Задача', 'Описание', 'Этап', 'Этап с', 'Этап перевёл', 'Срочность', 'Срок (дата)', 'Срок (время)',
             'Ответственные', 'ID заказа', 'Повтор', 'Повтор: каждые N дней', 'Серия', 'Взята в работу', 'Закрыта', 'Заметка этапа', 'Кто менял', 'В архиве', 'Служебное: уведомления']
  },
  tevent: {
    sheet: 'История задач',
    fields: ['id', 'taskId', 'ts', 'by', 'type', 'text', 'secs', 'from', 'to'],
    titles: ['ID', 'ID задачи', 'Когда', 'Кто', 'Тип', 'Что произошло', 'Секунд (секундомер)', 'С этапа', 'На этап']
  },
  measure: {
    sheet: 'Замеры',
    fields: ['id', 'date', 'clientId', 'name', 'phone', 'address', 'sizes', 'photosUrl', 'photoCount', 'orderId'],
    titles: ['ID', 'Дата', 'ID клиента', 'Имя', 'Телефон', 'Адрес', 'Размеры', 'Папка с фото', 'Кол-во фото', 'ID заказа']
  }
};

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var keyErr = checkKey_(p.key);
    if (keyErr) return json_({ ok: false, error: keyErr });
    if (p.action === 'ping') return json_({ ok: true, time: new Date().toISOString(), rev: SCRIPT_REV, keySource: getAccessKey_().source, mail: mailStatus_() });
    if (p.action === 'list' && ENTITIES[p.entity]) return json_({ ok: true, records: list_(p.entity) });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000); // два телефона одновременно — по очереди, без порчи данных
    var body = JSON.parse(e.postData.contents);
    var keyErr = checkKey_(body.key);
    if (keyErr) return json_({ ok: false, error: keyErr });
    if (body.action === 'testmail') return json_(testMail_(body.name));
    var cfg = ENTITIES[body.entity];
    if (!cfg) return json_({ ok: false, error: 'unknown entity' });

    if (body.action === 'upsert') {
      if (!body.record || !body.record.id) return json_({ ok: false, error: 'no id' });
      upsert_(body.entity, body.record);
      return json_({ ok: true });
    }
    if (body.action === 'delete') {
      var sheet = getSheet_(cfg);
      var row = findRow_(sheet, body.id);
      if (row > 0) sheet.deleteRow(row);
      return json_({ ok: true }); // уже удалено — тоже успех
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function upsert_(entity, rec) {
  var cfg = ENTITIES[entity];
  var sheet = getSheet_(cfg);
  var row = findRow_(sheet, rec.id);

  if ((entity === 'event' || entity === 'tevent') && row > 0) return; // история не правится: повторная отправка ничего не меняет

  if (entity === 'photo') {
    var haveUrl = false;
    if (row > 0) {
      var uc = cfg.fields.indexOf('fileUrl') + 1;
      haveUrl = String(sheet.getRange(row, uc, 1, 1).getValues()[0][0] || '') !== '';
    }
    if (rec.data && !haveUrl) rec.fileUrl = savePhoto_(rec);
    delete rec.data;
    delete rec.name;
    if (haveUrl) delete rec.fileUrl;
  }

  var photos = rec.photos || [];
  delete rec.photos;
  if (entity === 'measure' && photos.length) {
    var already = false;
    if (row > 0) {
      var urlCol = cfg.fields.indexOf('photosUrl') + 1;
      already = String(sheet.getRange(row, urlCol, 1, 1).getValues()[0][0] || '') !== '';
    }
    if (!already) { // повторная отправка — фото второй раз не сохраняем
      var info = savePhotos_(rec, photos);
      rec.photosUrl = info.url;
      rec.photoCount = info.count;
    }
  }

  if (row < 0) {
    sheet.appendRow(cfg.fields.map(function (f) { return rec[f] === undefined ? '' : String(rec[f]); }));
  } else {
    var range = sheet.getRange(row, 1, 1, cfg.fields.length);
    var vals = range.getValues()[0];
    cfg.fields.forEach(function (f, i) {
      if (rec[f] !== undefined) vals[i] = String(rec[f]); // обновляем только присланные поля
    });
    range.setValues([vals]);
  }
}

function savePhotos_(rec, photos) {
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), 'PRINCIP — фото замеров');
  var folder = getOrCreateFolder_(root, (rec.date || '') + ' ' + (rec.name || 'без имени') + ' ' + String(rec.id).slice(-4));
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  for (var i = 0; i < photos.length; i++) {
    var name = photos[i].name || ('фото_' + (i + 1) + '.jpg');
    if (folder.getFilesByName(name).hasNext()) continue;
    var blob = Utilities.newBlob(Utilities.base64Decode(photos[i].data), 'image/jpeg', name);
    folder.createFile(blob);
  }
  return { url: folder.getUrl(), count: photos.length };
}

/* Фото заказа: Диск → «PRINCIP — фото заказов» → «№12 Иванова [abc123]» → категория → файл.
 * Название папки подстраивается под номер заказа и имя клиента; файл с тем же именем второй раз не создаётся. */
function savePhoto_(rec) {
  var order = findRecord_('order', rec.orderId);
  var client = order && order.clientId ? findRecord_('client', order.clientId) : null;
  var label = (order && order.number ? '№' + order.number + ' ' : '') + ((client && client.name) || 'без имени');
  var tag = ' [' + String(rec.orderId).slice(-6) + ']';
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), 'PRINCIP — фото заказов');
  var folder = findFolderByTag_(root, tag);
  if (!folder) folder = root.createFolder(label + tag);
  else if (folder.getName() !== label + tag) folder.setName(label + tag);
  if (PHOTO_ACCESS === 'link') folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var catFolder = getOrCreateFolder_(folder, rec.category || 'Другое');
  var name = rec.name || (rec.id + '.jpg');
  var existing = catFolder.getFilesByName(name);
  var file = existing.hasNext() ? existing.next()
    : catFolder.createFile(Utilities.newBlob(Utilities.base64Decode(rec.data), 'image/jpeg', name));
  return file.getUrl();
}

function findFolderByTag_(root, tag) {
  var it = root.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var n = f.getName();
    if (n.length >= tag.length && n.substr(n.length - tag.length) === tag) return f;
  }
  return null;
}

function findRecord_(entity, id) {
  var cfg = ENTITIES[entity];
  var sheet = getSheet_(cfg);
  var row = findRow_(sheet, id);
  if (row < 0) return null;
  var vals = sheet.getRange(row, 1, 1, cfg.fields.length).getValues()[0];
  var o = {};
  cfg.fields.forEach(function (f, i) { o[f] = vals[i] == null ? '' : String(vals[i]); });
  return o;
}

function list_(entity) {
  var cfg = ENTITIES[entity];
  var sheet = getSheet_(cfg);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var tz = Session.getScriptTimeZone();
  var vals = sheet.getRange(2, 1, last - 1, cfg.fields.length).getValues();
  var out = [];
  vals.forEach(function (r) {
    if (r[0] === '' || r[0] == null) return;
    var o = {};
    cfg.fields.forEach(function (f, i) {
      var v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      o[f] = v == null ? '' : String(v);
    });
    out.push(o);
  });
  return out;
}

function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function getSheet_(cfg) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(cfg.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(cfg.sheet);
    sheet.getRange('A:Z').setNumberFormat('@'); // всё как текст: даты и телефоны не «портятся»
    sheet.setFrozenRows(1);
    sheet.appendRow(cfg.titles);
  } else if (sheet.getLastColumn() < cfg.titles.length) {
    sheet.getRange(1, 1, 1, cfg.titles.length).setValues([cfg.titles]);
  }
  return sheet;
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============ РЕЗЕРВНЫЕ КОПИИ ============
 * 1. Один раз запустите функцию installDailyBackup (кнопка «Выполнить»).
 * 2. Каждую ночь таблица копируется в папку «PRINCIP — резервные копии»,
 *    хранятся последние 30 копий.
 */
function installDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).create();
}

function dailyBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = getOrCreateFolder_(DriveApp.getRootFolder(), 'PRINCIP — резервные копии');
  var name = 'Резерв ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (!folder.getFilesByName(name).hasNext()) {
    DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  }
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  files.slice(30).forEach(function (f) { f.setTrashed(true); });
}


/* =====================================================================
 *                    ЗАДАЧИ И УВЕДОМЛЕНИЯ НА ПОЧТУ
 * =====================================================================
 * Как это работает:
 *  - задачи хранятся на листах «Задачи» и «История задач» (создаются сами);
 *  - на листе «Сотрудники» у каждого записана его почта: туда приходят уведомления;
 *    Gmail на телефоне показывает их как обычные push-уведомления;
 *  - раз в 10 минут функция taskNotifier смотрит задачи и шлёт письма (кроме ночи: с 8:00 до 21:00).
 *
 * Включается один раз: запустите функцию installTaskNotifier (кнопка «Выполнить») и разрешите доступ.
 *
 * Какие письма приходят:
 *  1. «Вам поставили задачу» — сразу (тому, кому поставили; поставившему — нет);
 *  2. «СРОЧНО, ещё не взята в работу» — напоминание в 10:00 и 15:00, пока срочную задачу не взяли в работу;
 *  3. сводка на день в 9:00 — только если есть просроченное, сроки на сегодня или срочное: одним письмом;
 *  4. «Срок через 2 часа» — для задач, где указано время;
 *  5. «Задача выполнена» — тому, кто её поставил, когда другой человек закрыл её.
 */
var TZ = 'Asia/Yekaterinburg';
var NOTIFY_FROM_HOUR = 8;     // раньше этого часа письма не шлём
var NOTIFY_TO_HOUR = 21;      // позже этого — тоже
var DIGEST_HOUR = 9;          // сводка на день
var PEOPLE_SHEET = 'Сотрудники';
var APP_URL = 'https://hivincevaalina917-a11y.github.io/app/';
var SENDER_NAME = 'PRINCIP · задачи';

function installTaskNotifier() {
  getPeople_();                       // создаст лист «Сотрудники», если его нет
  MailApp.getRemainingDailyQuota();   // чтобы Google спросил разрешение на отправку писем
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'taskNotifier') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('taskNotifier').timeBased().everyMinutes(10).create();
}

function getPeople_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PEOPLE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PEOPLE_SHEET);
    sh.getRange('A:C').setNumberFormat('@');
    sh.appendRow(['Имя', 'Почта для уведомлений', 'Присылать? (да / нет)']);
    ['Алина', 'Диляра', 'Саша'].forEach(function (n) { sh.appendRow([n, '', 'да']); });
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 170);
  }
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues().map(function (r) {
    var mail = String(r[1] || '').trim();
    return { name: String(r[0] || '').trim(), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ? mail : '', on: String(r[2] || 'да').trim().toLowerCase() !== 'нет' };
  }).filter(function (p) { return p.name; });
}

/* Что показывает приложение в «Настройке»: включены ли письма и у кого записана почта */
function mailStatus_() {
  var out = { trigger: false, ready: [], missing: [] };
  try { out.trigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'taskNotifier'; }); } catch (e) {}
  try {
    getPeople_().forEach(function (p) { (p.email && p.on ? out.ready : out.missing).push(p.name); });
  } catch (e) { out.error = String(e); }
  return out;
}

function testMail_(name) {
  var p = getPeople_().filter(function (x) { return x.name === name; })[0];
  if (!p) return { ok: false, error: 'на листе «Сотрудники» нет имени «' + name + '»' };
  if (!p.email) return { ok: false, error: 'у «' + name + '» не записана почта (лист «Сотрудники»)' };
  MailApp.sendEmail({ to: p.email, name: SENDER_NAME, subject: 'Проверка уведомлений PRINCIP',
    body: 'Если вы видите это письмо на телефоне как уведомление — всё работает.\n\nПозже сюда будут приходить задачи.' + appLink_() });
  return { ok: true, to: p.email };
}

function appLink_() { return APP_URL ? '\n\nОткрыть приложение: ' + APP_URL : ''; }

/* ---------- чистая логика: что кому слать (отдельно от почты, чтобы проверять) ---------- */
function localParts_(date) {
  var d = Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
  var t = Utilities.formatDate(date, TZ, 'HH:mm');
  return { date: d, min: parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10) };
}
function addDaysStr_(ymd, n) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function fmtDateRu_(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : (s || ''); }
function splitNames_(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
function hasKey_(t, key) { return ('|' + String(t.notified || '') + '|').indexOf('|' + key + '|') >= 0; }
function minOf_(hhmm) { var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? (+m[1]) * 60 + (+m[2]) : -1; }
function dueText_(t) { return t.dueDate ? 'срок ' + fmtDateRu_(t.dueDate) + (t.dueTime ? ' ' + t.dueTime : '') : 'без срока'; }
function taskLine_(t) { return '• ' + (t.priority === 'urgent' ? '[СРОЧНО] ' : '') + t.title + ' (' + dueText_(t) + (t.assignees ? ', ' + t.assignees : '') + ')'; }
function taskBody_(t, intro) {
  return [intro, '', t.title, t.description ? '\n' + t.description : '', '',
    'Срок: ' + (t.dueDate ? fmtDateRu_(t.dueDate) + (t.dueTime ? ' ' + t.dueTime : '') : 'без срока'),
    'Ответственные: ' + (t.assignees || '—'),
    t.updatedBy ? 'Поставил(а)/менял(а): ' + t.updatedBy : ''].filter(function (x) { return x !== undefined; }).join('\n') + appLink_();
}

/* Возвращает {marks:[{taskId,key,mails:[{to,subject,body}]}], digests:[{name,date,mail|null}]} */
function planNotifications_(tasks, people, now, digestSent) {
  var res = { marks: [], digests: [] };
  var lp = localParts_(now);
  if (lp.min < NOTIFY_FROM_HOUR * 60 || lp.min >= NOTIFY_TO_HOUR * 60) return res;
  var byName = {};
  people.forEach(function (p) { if (p.email && p.on) byName[p.name] = p; });
  var tomorrow = addDaysStr_(lp.date, 1);
  var nowMs = now.getTime();
  function mailTo(names, subject, body, except) {
    var out = [];
    names.forEach(function (n) { if (byName[n] && n !== except) out.push({ to: byName[n].email, subject: subject, body: body }); });
    return out;
  }
  tasks.forEach(function (t) {
    if (t.archived === '1' || !t.id) return;
    var asg = splitNames_(t.assignees);
    var created = Date.parse(t.createdAt || '') || 0;
    if (t.stage !== 'Готово') {
      var urgent = t.priority === 'urgent';
      // 1. поставили задачу
      asg.forEach(function (a) {
        var key = 'as:' + a;
        if (hasKey_(t, key)) return;
        var fresh = nowMs - created < 2 * 864e5;      // старые задачи (до установки уведомлений) не рассылаем
        res.marks.push({ taskId: t.id, key: key, mails: fresh ? mailTo([a], (urgent ? '🔴 СРОЧНО · ' : '') + 'Вам задача: ' + t.title, taskBody_(t, urgent ? 'Вам поставили СРОЧНУЮ задачу.' : 'Вам поставили задачу.'), t.updatedBy) : [] });
      });
      // 2. срочная и не взята в работу: 10:00 и 15:00
      if (urgent && t.stage === 'Новая' && nowMs - created > 4 * 36e5) {
        var slots = [[600, '10'], [900, '15']], unsent = [];
        slots.forEach(function (s) { if (lp.min >= s[0] && !hasKey_(t, 'ur:' + lp.date + ':' + s[1])) unsent.push('ur:' + lp.date + ':' + s[1]); });
        if (unsent.length) {
          unsent.forEach(function (k, i) {
            res.marks.push({ taskId: t.id, key: k, mails: i === unsent.length - 1 ? mailTo(asg, '🔴 СРОЧНО, ещё не взята в работу: ' + t.title, taskBody_(t, 'Срочная задача до сих пор не взята в работу.'), '') : [] });
          });
        }
      }
      // 4. за 2 часа до срока (если указано время)
      if (t.dueDate === lp.date && t.dueTime) {
        var dm = minOf_(t.dueTime), hk = 'h2:' + t.dueDate + 'T' + t.dueTime;
        if (dm >= 0 && lp.min >= dm - 120 && lp.min < dm && !hasKey_(t, hk)) {
          res.marks.push({ taskId: t.id, key: hk, mails: mailTo(asg, '⏰ Срок в ' + t.dueTime + ': ' + t.title, taskBody_(t, 'Срок задачи сегодня в ' + t.dueTime + '.'), '') });
        }
      }
    } else {
      // 5. выполнена: сообщаем тому, кто поставил
      var sc = Date.parse(t.stageChangedAt || '') || 0;
      var dk = 'dn:' + (t.stageChangedAt || '');
      if (t.createdBy && t.createdBy !== t.stageBy && sc && nowMs - sc < 2 * 864e5 && !hasKey_(t, dk)) {
        res.marks.push({ taskId: t.id, key: dk, mails: mailTo([t.createdBy], '✓ Готово: ' + t.title, taskBody_(t, 'Задачу выполнил(а) ' + (t.stageBy || '—') + '.'), '') });
      }
    }
  });
  // 3. сводка на день
  if (lp.min >= DIGEST_HOUR * 60) {
    Object.keys(byName).forEach(function (name) {
      if ((digestSent || {})[name] === lp.date) return;
      var mine = tasks.filter(function (t) { return t.archived !== '1' && t.stage !== 'Готово' && splitNames_(t.assignees).indexOf(name) >= 0 && nowMs - (Date.parse(t.createdAt || '') || 0) >= 3 * 36e5; }); // свежие уже пришли отдельным письмом
      var overdue = mine.filter(function (t) { return t.dueDate && t.dueDate < lp.date; });
      var today = mine.filter(function (t) { return t.dueDate === lp.date; });
      var urgentNew = mine.filter(function (t) { return t.priority === 'urgent' && t.stage === 'Новая' && overdue.indexOf(t) < 0 && today.indexOf(t) < 0; });
      var tmr = mine.filter(function (t) { return t.dueDate === tomorrow; });
      var mail = null;
      if (overdue.length || today.length || urgentNew.length) {
        var parts = [];
        if (overdue.length) parts.push('ПРОСРОЧЕНО (' + overdue.length + '):\n' + overdue.map(taskLine_).join('\n'));
        if (today.length) parts.push('СЕГОДНЯ (' + today.length + '):\n' + today.map(taskLine_).join('\n'));
        if (urgentNew.length) parts.push('СРОЧНЫЕ, ещё не начатые (' + urgentNew.length + '):\n' + urgentNew.map(taskLine_).join('\n'));
        if (tmr.length) parts.push('Завтра: ' + tmr.length + ' ' + (tmr.length === 1 ? 'задача' : 'задач(и)'));
        var head = [];
        if (overdue.length) head.push('просрочено ' + overdue.length);
        if (today.length) head.push('на сегодня ' + today.length);
        if (urgentNew.length) head.push('срочных ' + urgentNew.length);
        mail = { to: byName[name].email, subject: 'Задачи на сегодня: ' + head.join(', '), body: 'Доброе утро, ' + name + '.\n\n' + parts.join('\n\n') + appLink_() };
      }
      res.digests.push({ name: name, date: lp.date, mail: mail });
    });
  }
  return res;
}

function taskNotifier() {
  var lock = LockService.getScriptLock();
  var tasks, people;
  lock.waitLock(20000);
  try { tasks = list_('task'); people = getPeople_(); } finally { lock.releaseLock(); }
  var props = PropertiesService.getScriptProperties();
  var digestSent = {};
  try { digestSent = JSON.parse(props.getProperty('DIGEST_SENT') || '{}'); } catch (e) {}
  var plan = planNotifications_(tasks, people, new Date(), digestSent);
  var left = MailApp.getRemainingDailyQuota() - 3;      // небольшой запас
  function send(m) {
    if (left <= 0) return false;
    try { MailApp.sendEmail({ to: m.to, name: SENDER_NAME, subject: m.subject, body: m.body }); left--; return true; }
    catch (e) { console.error('письмо не ушло: ' + e); return false; }
  }
  plan.marks.forEach(function (mk) {
    var okAny = !mk.mails.length, okAll = true;
    mk.mails.forEach(function (m) { if (send(m)) okAny = true; else okAll = false; });
    if (okAny) markNotified_(mk.taskId, [mk.key]);
  });
  var changed = false;
  plan.digests.forEach(function (d) {
    if (d.mail && !send(d.mail)) return;
    digestSent[d.name] = d.date; changed = true;
  });
  if (changed) props.setProperty('DIGEST_SENT', JSON.stringify(digestSent));
}

function markNotified_(taskId, keys) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cfg = ENTITIES.task, sheet = getSheet_(cfg), row = findRow_(sheet, taskId);
    if (row < 0) return;
    var col = cfg.fields.indexOf('notified') + 1;
    var cell = sheet.getRange(row, col, 1, 1);
    var cur = String(cell.getValue() || '').split('|').filter(Boolean);
    keys.forEach(function (k) { if (cur.indexOf(k) < 0) cur.push(k); });
    cell.setValue(cur.slice(-40).join('|'));
  } finally { try { lock.releaseLock(); } catch (e) {} }
}
