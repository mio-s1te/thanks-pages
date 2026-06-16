/****************************************************
 * 購入者LINE管理GAS 完成版
 * （スタート講座・養成講座 両対応）
 *
 * できること：
 * 1. LINE友だち追加時に表示名・LINEユーザーID・登録日時を保存
 * 2. Stripe購入完了時に、メールアドレス・購入商品・Stripe決済IDを自動保存
 * 3. サンクスページで表示した「合言葉＋購入コード」をLINEで送ってもらう
 * 4. Stripe購入情報とLINEユーザーIDを同じ行で紐づける
 * 5. メール手入力登録も残しておく
 * 6. 管理者から指定ユーザーへメッセージ送信も可能
 *
 * 【商品別スプシシート振り分け】
 *   スタート講座   → シート名「スタート講座購入者」
 *   養成講座       → シート名「アフィリエイター養成講座購入者」
 *
 * 【スプレッドシートID】
 *   14DQw6Zn2w3GbwtcEN8q3-95Inf7im61ENsZZNvZh7c0
 ****************************************************/


/****************************************************
 * 必ず変更するところ
 ****************************************************/

// LINE Developersのチャネルアクセストークン
const CHANNEL_ACCESS_TOKEN = 'PBb3adzhZJ7MzX0lpZbpGYI0u74nLleZbd/FpFiIMwO0GmbPWKGE1NPc1YFBhLrzqKkOlbDtDWz+8BTm5VIDCLchfULxZVltUcMwYYJfsKLiljGak76Mprq+zKr84pALa0d2rIn7Ckz16RDYsVOCwAdB04t89/1O/w1cDnyilFU=';

// 管理送信用の秘密キー（Netlify・Stripeからのリクエスト認証にも使う）
const ADMIN_SECRET = 'mio_line_special_2026';

// ============================================================
// 商品設定（講座が増えたらここに追加するだけ）
// ============================================================
const PRODUCTS = {
  // キー = 合言葉（LINEから送られてくる文字列）
  '1時間化スタート': {
    sheetName:   'スタート講座購入者',
    productName: 'AI副業1日1時間化スタート講座',
    keyword:     '1時間化スタート',
  },
  '本気でプロアフィリエイター': {
    sheetName:   'アフィリエイター養成講座購入者',
    productName: 'プロAIアフィリエイター養成講座',
    keyword:     '本気でプロアフィリエイター',
  },
  // 将来の講座を追加するときはここに追記するだけ：
  // '新講座の合言葉': {
  //   sheetName:   '新講座購入者',
  //   productName: '新講座の商品名',
  //   keyword:     '新講座の合言葉',
  // },
};

// mainsite の Netlify URL（purchase_code 照合に使う）
const NETLIFY_API_BASE = PropertiesService.getScriptProperties().getProperty('NETLIFY_API_BASE')
  || 'https://mio-mainsite.netlify.app';


/****************************************************
 * 列番号設定（スプレッドシートの列構成に対応）
 ****************************************************/
const COL_REGISTERED_AT    = 1;  // A: 登録日時
const COL_DISPLAY_NAME     = 2;  // B: LINE表示名
const COL_LINE_USER_ID     = 3;  // C: LINEユーザーID
const COL_EMAIL            = 4;  // D: メールアドレス
const COL_PRODUCT_NAME     = 5;  // E: 購入商品
const COL_STRIPE_PAYMENT_ID = 6; // F: Stripe決済ID
const COL_BONUS_STATUS     = 7;  // G: 特典送付状況
const COL_KEYWORD          = 8;  // H: キーワード（合言葉）
const COL_STATUS           = 9;  // I: ステータス
const COL_LAST_MESSAGE_AT  = 10; // J: 最終メッセージ日時
const COL_MEMO             = 11; // K: メモ
const COL_WAITING          = 12; // L: 入力待ち
const COL_CONSENT_AT       = 13; // M: 同意日時


/****************************************************
 * 自動返信文
 ****************************************************/
const FOLLOW_TEXT = `ご登録ありがとうございます！

購入者確認を行います。
サンクスページに表示されている内容を、このLINEにそのまま送ってください。

例）
1時間化スタート
購入コード：start_xxxxxxxxxxxxxxxx

または

本気でプロアフィリエイター
購入コード：start_xxxxxxxxxxxxxxxx`;

const ASK_EMAIL_TEXT = `購入時に使ったメールアドレスを、このトークにそのまま入力してください。

例）
sample@gmail.com`;

const EMAIL_SAVED_TEXT = `メールアドレスを登録しました。
ありがとうございます！`;

const EMAIL_ERROR_TEXT = `メールアドレスの形式が正しくないかもしれません。

半角英数字で、もう一度入力してください。

例）
sample@gmail.com`;

const LINK_SUCCESS_TEXT = `確認できました！

購入者LINEとして登録しました。
このあと、講座本編・特典の受け取り案内をご確認ください。`;

const LINK_NEED_CODE_TEXT = `合言葉を確認しました。

購入コードも一緒に送ってください。

例）
1時間化スタート
購入コード：start_xxxxxxxxxxxxxxxx`;

const LINK_NOT_FOUND_TEXT = `送っていただいた購入コードを確認しましたが、購入情報がまだ見つかりませんでした。

数分後にもう一度送ってみてください。
それでも確認できない場合は、購入時のメールアドレスも送ってください。`;


/****************************************************
 * Webhook入口
 ****************************************************/
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // LINE webhookから来た場合
    if (body.events) {
      handleLineWebhook(body);
      return jsonResponse({ status: 'ok', type: 'line_webhook' });
    }

    // Stripe購入情報を保存する場合（mainsite stripe-webhook.js から呼ばれる）
    if (body.action === 'stripePurchase') {
      const result = saveStripePurchase(body);
      return jsonResponse(result);
    }

    // 外部から管理送信する場合
    if (body.action === 'sendMessage') {
      const result = adminSendMessage(body);
      return jsonResponse(result);
    }

    // メール登録ボタンを再送する場合
    if (body.action === 'sendEmailRegisterButton') {
      const result = adminSendEmailRegisterButton(body);
      return jsonResponse(result);
    }

    return jsonResponse({ status: 'ignored' });

  } catch (error) {
    console.error(error);
    return jsonResponse({ status: 'error', message: error.message });
  }
}


/****************************************************
 * LINE Webhook処理
 ****************************************************/
function handleLineWebhook(body) {
  const events = body.events || [];

  events.forEach(event => {
    const userId = event.source && event.source.userId;
    if (!userId) return;

    // 友だち追加時
    if (event.type === 'follow') {
      // どのシートにもユーザー登録（最初はシート未確定なので全シートチェック）
      registerLineUserToAllSheets(userId);
      pushTextMessage(userId, FOLLOW_TEXT);
      return;
    }

    // ブロック・友だち解除
    if (event.type === 'unfollow') {
      markUserUnfollowedInAllSheets(userId);
      return;
    }

    // テキストメッセージ受信時
    if (event.type === 'message' && event.message && event.message.type === 'text') {
      const text = event.message.text.trim();

      updateLastMessageTimeInAllSheets(userId);

      // ── 合言葉が含まれているか判定 ──────────────────────
      const matchedProduct = detectProduct(text);

      if (matchedProduct) {
        // 合言葉あり → 購入コードを照合して紐づけ
        const purchaseCode = extractPurchaseCode(text);

        if (!purchaseCode) {
          // 合言葉はあるが購入コードがない
          pushTextMessage(userId, LINK_NEED_CODE_TEXT);
          return;
        }

        // Netlify API で purchase_code を照合
        const purchaseData = verifyPurchaseCode(purchaseCode);

        if (!purchaseData || !purchaseData.found) {
          pushTextMessage(userId, LINK_NOT_FOUND_TEXT);
          return;
        }

        // スプシに記録（商品に対応するシートへ）
        const sheet  = getSheetByProductName(matchedProduct.sheetName);
        const alreadyLinked = linkLineUserToRow_byCode(userId, purchaseCode, purchaseData, sheet);

        if (alreadyLinked) {
          pushTextMessage(userId, '✅ 購入確認済みです。\n\n既に登録済みです。講座URLは以前お送りしたメッセージをご確認ください。');
        } else {
          pushTextMessage(userId, LINK_SUCCESS_TEXT);
        }
        return;
      }

      // ── メール登録ボタンを押したとき ──────────────────────
      if (text === 'メールアドレスを登録する') {
        setWaitingEmailInAllSheets(userId, true);
        saveConsentAtInAllSheets(userId);
        pushTextMessage(userId, ASK_EMAIL_TEXT);
        return;
      }

      // ── メール入力待ち状態か確認 ──────────────────────────
      if (isWaitingEmailInAnySheet(userId)) {
        if (isEmail(text)) {
          saveEmailInAllSheets(userId, text);
          setWaitingEmailInAllSheets(userId, false);
          pushTextMessage(userId, EMAIL_SAVED_TEXT);
        } else {
          pushTextMessage(userId, EMAIL_ERROR_TEXT);
        }
        return;
      }

      // ── メールアドレスっぽいものが送られてきた ────────────
      if (isEmail(text)) {
        const linked = linkLineUserByEmailInAllSheets(userId, text);
        if (linked) {
          pushTextMessage(userId, `購入情報とメールアドレスを確認できました！\n購入者LINEとして登録しました。`);
        } else {
          pushTextMessage(userId,
            `メールアドレスを確認しました。\n\nただし購入情報との自動紐づけができませんでした。\n\nサンクスページの内容をそのまま送ってください。\n\n例）\n1時間化スタート\n購入コード：start_xxxxxxxxxxxxxxxx`
          );
        }
        return;
      }

      // ── その他のメッセージ ────────────────────────────────
      pushTextMessage(userId,
        `購入者確認のため、サンクスページの内容をそのまま送ってください。\n\n例）\n1時間化スタート\n購入コード：start_xxxxxxxxxxxxxxxx`
      );
    }
  });
}


/****************************************************
 * 合言葉でどの商品か判定する
 * 戻り値: PRODUCTS の値オブジェクト or null
 ****************************************************/
function detectProduct(text) {
  for (const keyword of Object.keys(PRODUCTS)) {
    if (text.includes(keyword)) {
      return PRODUCTS[keyword];
    }
  }
  return null;
}


/****************************************************
 * テキストから purchase_code（start_xxx）を抜き出す
 ****************************************************/
function extractPurchaseCode(text) {
  const match = String(text).match(/(start_[a-zA-Z0-9]+)/);
  return match ? match[1] : '';
}


/****************************************************
 * Netlify API: purchase_code 照合
 * POST /api/affiliate-api/purchase/verify-code
 ****************************************************/
function verifyPurchaseCode(purchaseCode) {
  try {
    const res = UrlFetchApp.fetch(NETLIFY_API_BASE + '/api/affiliate-api/purchase/verify-code', {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify({ purchase_code: purchaseCode }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
    console.error('[verifyPurchaseCode] status:', res.getResponseCode());
    return null;
  } catch (err) {
    console.error('[verifyPurchaseCode] error:', err.message);
    return null;
  }
}


/****************************************************
 * purchase_code でスプシの行を探してLINE情報を紐づける
 * 戻り値: true = 既に紐づけ済み / false = 新規紐づけ
 ****************************************************/
function linkLineUserToRow_byCode(userId, purchaseCode, purchaseData, sheet) {
  const profile     = getLineProfile(userId);
  const displayName = profile.displayName || '';
  const now         = new Date();
  const lastRow     = sheet.getLastRow();

  if (lastRow >= 2) {
    // H列（キーワード）で purchase_code を検索
    const hCol = sheet.getRange(2, COL_KEYWORD, lastRow - 1, 1).getValues();
    const cCol = sheet.getRange(2, COL_LINE_USER_ID, lastRow - 1, 1).getValues();

    for (let i = 0; i < hCol.length; i++) {
      if (hCol[i][0] === purchaseCode) {
        // 既に同じLINEユーザーが紐づけ済み
        if (cCol[i][0] === userId) return true;
        // 別LINEユーザー or 未紐づけ → 更新
        const rowNum = i + 2;
        sheet.getRange(rowNum, COL_DISPLAY_NAME).setValue(displayName);
        sheet.getRange(rowNum, COL_LINE_USER_ID).setValue(userId);
        sheet.getRange(rowNum, COL_STATUS).setValue('購入済み・LINE連携済み');
        sheet.getRange(rowNum, COL_LAST_MESSAGE_AT).setValue(now);
        if (!sheet.getRange(rowNum, COL_REGISTERED_AT).getValue()) {
          sheet.getRange(rowNum, COL_REGISTERED_AT).setValue(now);
        }
        return false;
      }
    }
  }

  // purchase_code がシートにない → 新規行追加
  sheet.appendRow([
    now,                                              // A: 登録日時
    displayName,                                      // B: LINE表示名
    userId,                                           // C: LINEユーザーID
    purchaseData.buyer_email        || '',            // D: メールアドレス
    purchaseData.product_name       || '',            // E: 購入商品
    purchaseData.stripe_session_id  || purchaseData.purchase_id || '', // F: Stripe決済ID
    '',                                               // G: 特典送付状況
    purchaseCode,                                     // H: キーワード（purchase_code）
    '購入済み・LINE連携済み',                          // I: ステータス
    now,                                              // J: 最終メッセージ日時
    '',                                               // K: メモ
    '',                                               // L: 入力待ち
    '',                                               // M: 同意日時
  ]);
  return false;
}


/****************************************************
 * Stripe購入情報を保存
 * mainsite の stripe-webhook.js からPOSTされる
 *
 * POSTするJSON例：
 * {
 *   "action": "stripePurchase",
 *   "secret": "mio_line_special_2026",
 *   "email": "buyer@example.com",
 *   "productName": "AI副業1日1時間化スタート講座",
 *   "stripePaymentId": "cs_live_xxxxx",
 *   "purchaseCode": "start_xxxxxxxxxxxxxxxx"
 * }
 ****************************************************/
function saveStripePurchase(body) {
  if (body.secret !== ADMIN_SECRET) {
    return { status: 'error', message: '認証キーが違います' };
  }

  const email           = String(body.email           || '').trim().toLowerCase();
  const productName     = String(body.productName     || '').trim();
  const stripePaymentId = String(body.stripePaymentId || '').trim();
  const purchaseCode    = String(body.purchaseCode    || '').trim();

  if (!email)           return { status: 'error', message: 'メールアドレスがありません' };
  if (!stripePaymentId) return { status: 'error', message: 'Stripe決済IDがありません' };

  // 商品名からシートを特定
  const sheet = getSheetByProductNameStr(productName);
  const now   = new Date();

  // Stripe決済IDで既存行を探す
  let row = findRowBy(sheet, COL_STRIPE_PAYMENT_ID, stripePaymentId);
  // なければメールで探す
  if (!row) row = findRowBy(sheet, COL_EMAIL, email);
  // purchase_code でも探す
  if (!row && purchaseCode) row = findRowBy(sheet, COL_KEYWORD, purchaseCode);

  if (row) {
    // 既存行を更新
    sheet.getRange(row, COL_EMAIL).setValue(email);
    sheet.getRange(row, COL_PRODUCT_NAME).setValue(productName);
    sheet.getRange(row, COL_STRIPE_PAYMENT_ID).setValue(stripePaymentId);
    if (purchaseCode) sheet.getRange(row, COL_KEYWORD).setValue(purchaseCode);
    sheet.getRange(row, COL_STATUS).setValue('購入済み・LINE未連携');
    sheet.getRange(row, COL_LAST_MESSAGE_AT).setValue(now);
    if (!sheet.getRange(row, COL_REGISTERED_AT).getValue()) {
      sheet.getRange(row, COL_REGISTERED_AT).setValue(now);
    }
    return { status: 'ok', message: '既存行を更新しました', row };
  }

  // 新規行を2行目に追加
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, 13).setValues([[
    now,              // A: 登録日時
    '',               // B: LINE表示名
    '',               // C: LINEユーザーID
    email,            // D: メールアドレス
    productName,      // E: 購入商品
    stripePaymentId,  // F: Stripe決済ID
    '未送付',         // G: 特典送付状況
    purchaseCode,     // H: キーワード（purchase_code）
    '購入済み・LINE未連携', // I: ステータス
    now,              // J: 最終メッセージ日時
    '',               // K: メモ
    '',               // L: 入力待ち
    '',               // M: 同意日時
  ]]);

  return { status: 'ok', message: '購入情報を新規登録しました', row: 2 };
}


/****************************************************
 * 商品名（文字列）からシートを取得
 * どの商品にも一致しない場合はデフォルトシートを使用
 ****************************************************/
function getSheetByProductNameStr(productName) {
  for (const config of Object.values(PRODUCTS)) {
    if (productName.includes(config.productName) || productName === config.sheetName) {
      return getSheetByProductName(config.sheetName);
    }
  }
  // 一致しない場合は最初のシートを返す
  return getSheetByProductName(Object.values(PRODUCTS)[0].sheetName);
}


/****************************************************
 * シート名からシートを取得（なければ作成）
 ****************************************************/
function getSheetByProductName(sheetName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  setupHeaderIfNeeded(sheet);
  return sheet;
}


/****************************************************
 * ヘッダー作成・補正
 ****************************************************/
function setupHeaderIfNeeded(sheet) {
  const headers = [
    '登録日時', 'LINE表示名', 'LINEユーザーID', 'メールアドレス',
    '購入商品', 'Stripe決済ID', '特典送付状況', 'キーワード',
    'ステータス', '最終メッセージ日時', 'メモ', '入力待ち', '同意日時',
  ];
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (firstRow.some((v, i) => !v && headers[i])) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}


/****************************************************
 * LINE登録者を全シートに記録（友だち追加時）
 * どの講座の購入者か不明なので全シートをチェックする
 ****************************************************/
function registerLineUserToAllSheets(userId) {
  const profile     = getLineProfile(userId);
  const displayName = profile.displayName || '';
  const now         = new Date();

  for (const config of Object.values(PRODUCTS)) {
    const sheet = getSheetByProductName(config.sheetName);
    const row   = findRowBy(sheet, COL_LINE_USER_ID, userId);

    if (row) {
      // 既存行のステータスと表示名を更新
      sheet.getRange(row, COL_STATUS).setValue('登録済み');
      sheet.getRange(row, COL_LAST_MESSAGE_AT).setValue(now);
      if (displayName) sheet.getRange(row, COL_DISPLAY_NAME).setValue(displayName);
    }
    // 新規行は追加しない（友達追加だけでは講座が不明なため）
    // → 合言葉送信時 or Stripe購入時に追加される
  }
}


/****************************************************
 * 全シートでブロック記録
 ****************************************************/
function markUserUnfollowedInAllSheets(userId) {
  for (const config of Object.values(PRODUCTS)) {
    const sheet = getSheetByProductName(config.sheetName);
    const row   = findRowBy(sheet, COL_LINE_USER_ID, userId);
    if (row) {
      sheet.getRange(row, COL_STATUS).setValue('ブロックまたは友だち解除');
      sheet.getRange(row, COL_LAST_MESSAGE_AT).setValue(new Date());
    }
  }
}


/****************************************************
 * 全シートで最終メッセージ日時を更新
 ****************************************************/
function updateLastMessageTimeInAllSheets(userId) {
  for (const config of Object.values(PRODUCTS)) {
    const sheet = getSheetByProductName(config.sheetName);
    const row   = findRowBy(sheet, COL_LINE_USER_ID, userId);
    if (row) sheet.getRange(row, COL_LAST_MESSAGE_AT).setValue(new Date());
  }
}


/****************************************************
 * 全シートでメール入力待ち状態を設定
 ****************************************************/
function setWaitingEmailInAllSheets(userId, isWaiting) {
  for (const config of Object.values(PRODUCTS)) {
    const sheet = getSheetByProductName(config.sheetName);
    const row   = findRowBy(sheet, COL_LINE_USER_ID, userId);
    if (row) sheet.getRange(row, COL_WAITING).setValue(isWaiting ? 'メール入力待ち' : '');
  }
}


/****************************************************
 * いずれかのシートでメール入力待ち状態か確認
 ****************************************************/
function isWaitingEmailInAnySheet(userId) {
  for (const config of Object.values(PRODUCTS)) {
    const sheet = getSheetByProductName(config.sheetName);
    const row   = findRowBy(sheet, COL_LINE_USER_ID, userId);
    if (row && sheet.getRange(row, COL_WAITING).getValue() === 'メール入力待ち') return true;
  }
  return false;
}


/****************************************************
 * 全シートで同意日時を保存
 ****************************************************/
function saveConsentAtInAllSheets(userId) {
  for (const config of Object.values(PRODUCTS)) {
    const sheet = getSheetByProductName(config.sheetName);
    const row   = findRowBy(sheet, COL_LINE_USER_ID, userId);
    if (row) sheet.getRange(row, COL_CONSENT_AT).setValue(new Date());
  }
}


/****************************************************
 * 全シートにメールアドレスを保存
 ****************************************************/
function saveEmailInAllSheets(userId, email) {
  const now = new Date();
  for (const config of Object.values(PRODUCTS)) {
    const sheet = getSheetByProductName(config.sheetName);
    const row   = findRowBy(sheet, COL_LINE_USER_ID, userId);
    if (row) {
      sheet.getRange(row, COL_EMAIL).setValue(email);
      sheet.getRange(row, COL_STATUS).setValue('メール登録済み');
      sheet.getRange(row, COL_LAST_MESSAGE_AT).setValue(now);
    }
  }
}


/****************************************************
 * 全シートでメールアドレスからLINE紐づけを試みる
 ****************************************************/
function linkLineUserByEmailInAllSheets(userId, email) {
  const profile     = getLineProfile(userId);
  const displayName = profile.displayName || '';
  const now         = new Date();
  const target      = email.trim().toLowerCase();
  let linked        = false;

  for (const config of Object.values(PRODUCTS)) {
    const sheet   = getSheetByProductName(config.sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;

    const emailCol = sheet.getRange(2, COL_EMAIL, lastRow - 1, 1).getValues();
    for (let i = 0; i < emailCol.length; i++) {
      if (String(emailCol[i][0]).trim().toLowerCase() === target) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, COL_DISPLAY_NAME).setValue(displayName);
        sheet.getRange(rowNum, COL_LINE_USER_ID).setValue(userId);
        sheet.getRange(rowNum, COL_STATUS).setValue('購入済み・LINE連携済み');
        sheet.getRange(rowNum, COL_LAST_MESSAGE_AT).setValue(now);
        linked = true;
      }
    }
  }
  return linked;
}


/****************************************************
 * 指定シートの指定列から値で行番号を返す
 ****************************************************/
function findRowBy(sheet, colNum, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const col    = sheet.getRange(2, colNum, lastRow - 1, 1).getValues();
  const target = String(value).trim().toLowerCase();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toLowerCase() === target) return i + 2;
  }
  return null;
}


/****************************************************
 * LINEプロフィール取得
 ****************************************************/
function getLineProfile(userId) {
  try {
    const res = UrlFetchApp.fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      method:  'get',
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
  } catch (err) {
    console.error('[getLineProfile] error:', err.message);
  }
  return {};
}


/****************************************************
 * テキストメッセージ送信（Push）
 ****************************************************/
function pushTextMessage(userId, text) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method:      'post',
      contentType: 'application/json',
      headers:     { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
      payload:     JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.error('[pushTextMessage] error:', err.message);
  }
}


/****************************************************
 * メール登録ボタンを送る（Quick Reply）
 ****************************************************/
function pushEmailRegisterButton(userId) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method:      'post',
      contentType: 'application/json',
      headers:     { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
      payload: JSON.stringify({
        to: userId,
        messages: [{
          type: 'text',
          text: 'メールアドレス登録が必要な場合は、下のボタンから登録してください。',
          quickReply: {
            items: [{
              type:   'action',
              action: { type: 'message', label: 'メールを登録する', text: 'メールアドレスを登録する' },
            }],
          },
        }],
      }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.error('[pushEmailRegisterButton] error:', err.message);
  }
}


/****************************************************
 * 管理者用：指定した人にメッセージを送る
 ****************************************************/
function adminSendMessage(body) {
  if (body.secret !== ADMIN_SECRET) return { status: 'error', message: '認証キーが違います' };

  const message = body.message;
  if (!message) return { status: 'error', message: 'messageが空です' };

  let lineUserId = body.lineUserId || '';
  if (!lineUserId && body.email) lineUserId = findLineUserIdByEmailInAllSheets(body.email);
  if (!lineUserId) return { status: 'error', message: '送信先が見つかりません' };

  pushTextMessage(lineUserId, message);
  return { status: 'ok', message: '送信しました', lineUserId };
}


/****************************************************
 * 管理用：メール登録ボタンを再送する
 ****************************************************/
function adminSendEmailRegisterButton(body) {
  if (body.secret !== ADMIN_SECRET) return { status: 'error', message: '認証キーが違います' };

  let lineUserId = body.lineUserId || '';
  if (!lineUserId && body.email) lineUserId = findLineUserIdByEmailInAllSheets(body.email);
  if (!lineUserId) return { status: 'error', message: '送信先が見つかりません' };

  pushEmailRegisterButton(lineUserId);
  return { status: 'ok', message: 'メール登録ボタンを送信しました', lineUserId };
}


/****************************************************
 * 全シートからメールアドレスでLINEユーザーIDを探す
 ****************************************************/
function findLineUserIdByEmailInAllSheets(email) {
  const target = String(email).trim().toLowerCase();
  for (const config of Object.values(PRODUCTS)) {
    const sheet   = getSheetByProductName(config.sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    const emailCol = sheet.getRange(2, COL_EMAIL, lastRow - 1, 1).getValues();
    const idCol    = sheet.getRange(2, COL_LINE_USER_ID, lastRow - 1, 1).getValues();
    for (let i = 0; i < emailCol.length; i++) {
      if (String(emailCol[i][0]).trim().toLowerCase() === target && idCol[i][0]) {
        return idCol[i][0];
      }
    }
  }
  return '';
}


/****************************************************
 * メール形式チェック
 ****************************************************/
function isEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}


/****************************************************
 * JSON返却
 ****************************************************/
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/****************************************************
 * GET: 死活確認
 ****************************************************/
function doGet() {
  return jsonResponse({ status: 'ok', message: 'line-bot GAS is running', version: '2.0' });
}


/****************************************************
 * 手動テスト：Stripe購入情報を仮登録
 ****************************************************/
function testSaveStripePurchase() {
  const result = saveStripePurchase({
    action:          'stripePurchase',
    secret:          ADMIN_SECRET,
    email:           'sample@gmail.com',
    productName:     'AI副業1日1時間化スタート講座',
    stripePaymentId: 'cs_test_sample_12345',
    purchaseCode:    'start_TestABCDEFGH1234',
  });
  console.log(JSON.stringify(result));
}


/****************************************************
 * 手動テスト：LINEユーザーID指定でテスト送信
 ****************************************************/
function testSendByLineUserId() {
  pushTextMessage('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'これはテスト送信です。');
}


/****************************************************
 * 手動テスト：メールアドレス指定でテスト送信
 ****************************************************/
function testSendByEmail() {
  const lineUserId = findLineUserIdByEmailInAllSheets('sample@gmail.com');
  if (!lineUserId) { console.log('該当するLINEユーザーが見つかりません'); return; }
  pushTextMessage(lineUserId, 'メールアドレス指定のテスト送信です。');
}
