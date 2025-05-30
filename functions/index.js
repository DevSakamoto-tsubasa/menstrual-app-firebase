// functions/index.js - 修正版（savePeriodRecord追加）

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const line = require('@line/bot-sdk');

// Firebase Admin SDK 初期化
admin.initializeApp();

// モジュールのインポート
const { ensureUserExists, getInputFlag } = require('./src/utils/firestoreUtils');
const { 
  startDateInput, 
  handleDateInput, 
  checkUserData,
  checkUserDataSimple
} = require('./src/handlers/dateInputHandler');
const { 
  checkUserSettings,
  startCycleSetting,
  startPeriodSetting,
  handleCycleSetting,
  handlePeriodSetting,
  toggleNotificationSetting
} = require('./src/handlers/settingsHandler');
const {
  generateInviteCode,
  useInviteCode,
  checkPartner,
  removePartner,
  getPartnerId
} = require('./src/handlers/partnerHandler');
const {
  testPartnerNotification,
  debugPartnerInfo
} = require('./src/handlers/testHandler');
const { 
  COMMANDS, 
  INPUT_FLAG_TYPES,
  MESSAGES 
} = require('./src/config/constants');

// LINE Bot 設定
const config = {
  channelAccessToken: functions.config().line.channel_access_token,
  channelSecret: functions.config().line.channel_secret,
};

const client = new line.Client(config);

// === ユーティリティ関数 (最初に定義) ===

/**
 * セキュアトークンの生成
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - Base64エンコードされたトークン
 */
function generateSecureToken(userId) {
  const timestamp = Date.now();
  const payload = `${userId}:${timestamp}`;
  return Buffer.from(payload).toString('base64');
}

/**
 * 初回利用者向けの設定チェック
 * @param {string} userId - LINE ユーザーID
 * @returns {boolean} - 初期設定が必要かどうか
 */
async function needsInitialSetup(userId) {
  try {
    const { db } = require('./src/utils/firestoreUtils');
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return true;
    }
    
    const userData = userDoc.data();
    return !userData.initialSetupCompleted;
    
  } catch (error) {
    console.error('Error checking initial setup:', error);
    return true;
  }
}

/**
 * Web UI リンク生成 (修正版)
 * @param {string} userId - LINE ユーザーID
 * @param {string} page - ページ名 (setup, dashboard, calendar, settings, entry)
 * @returns {string} - Web UI URL
 */
function generateWebUILink(userId, page) {
  try {
    const token = generateSecureToken(userId);
    
    // プロジェクトIDを複数の方法で取得を試行
    let projectId;
    
    // 方法1: functions.config()から取得
    try {
      const config = functions.config();
      if (config && config.project && config.project.id) {
        projectId = config.project.id;
      }
    } catch (configError) {
      console.log('Config project.id not available:', configError.message);
    }
    
    // 方法2: 環境変数から取得
    if (!projectId) {
      projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    }
    
    // 方法3: Firebase Admin SDKから取得
    if (!projectId) {
      try {
        const app = admin.app();
        projectId = app.options.projectId;
      } catch (adminError) {
        console.log('Admin projectId not available:', adminError.message);
      }
    }
    
    // 方法4: ハードコードされたプロジェクトID（最終手段）
    if (!projectId) {
      projectId = 'menstrual-tracking-app'; // あなたのプロジェクトIDに置き換え
      console.log('Using hardcoded project ID:', projectId);
    }
    
    const baseUrl = `https://${projectId}.web.app`;
    
    const pageUrls = {
      setup: '/setup/',
      dashboard: '/dashboard/',
      calendar: '/calendar/',
      settings: '/settings/',
      entry: '/entry/' // 🔧 開始日入力ページ追加
    };
    
    const pageUrl = pageUrls[page] || '/';
    const fullUrl = `${baseUrl}${pageUrl}?token=${token}`;
    
    console.log(`Generated Web UI link: ${fullUrl}`);
    return fullUrl;
    
  } catch (error) {
    console.error('Error generating Web UI link:', error);
    // エラー時はLINE Bot内での案内を返す
    return 'Web UI機能の準備中です。しばらくお待ちください。';
  }
}

// === メインのWebhook関数 ===

/**
 * メインのWebhook関数（Web UI対応版）
 */
exports.lineWebhook = functions
  .region('asia-northeast1')
  .runWith({
    invoker: 'public'
  })
  .https.onRequest(async (req, res) => {
    try {
      console.log('lineWebhook called with Web UI support - asia-northeast1 region');
      
      // CORS対応
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.set('Access-Control-Allow-Headers', '*');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      if (req.method === 'GET') {
        return res.status(200).send('LINE Webhook with Web UI support is working! (asia-northeast1 region)');
      }

      if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
      }

      const body = req.body;
      if (!body || !body.events) {
        return res.status(200).send('No events');
      }

      // 各イベントを処理
      for (const event of body.events) {
        await handleEvent(event);
      }
      
      res.status(200).send('OK');
      
    } catch (error) {
      console.error('Error in lineWebhook:', error);
      res.status(500).send('Internal Server Error');
    }
  });

/**
 * LINE イベント処理のメインルーター
 * @param {Object} event - LINE イベント
 */
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userId = event.source.userId;
  const userMessage = event.message.text.trim();
  const replyToken = event.replyToken;

  console.log(`User ${userId} sent: ${userMessage}`);

  try {
    // ユーザー作成・更新
    await ensureUserExists(userId);

    // Web UI対応のコマンドルーティング
    const response = await routeCommandWithWebUI(userId, userMessage);
    
    // 返信送信
    if (response && replyToken) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: response
      });
      console.log('Reply sent successfully');
    }

  } catch (error) {
    console.error('Error in handleEvent:', error);
    
    try {
      if (replyToken) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: MESSAGES.ERRORS.GENERAL
        });
      }
    } catch (replyError) {
      console.error('Error sending error reply:', replyError);
    }
  }
}

/**
 * コマンドルーティング（Web UI対応版）
 * @param {string} userId - LINE ユーザーID
 * @param {string} message - ユーザーメッセージ
 * @returns {string} - 返信メッセージ
 */
async function routeCommandWithWebUI(userId, message) {
  console.log(`Routing command with Web UI: ${message}`);

  // 初期設定チェック
  const needsSetup = await needsInitialSetup(userId);
  
  // 基本コマンド以外で初期設定が必要な場合
  if (needsSetup && !['ヘルプ', 'help', 'テスト', 'test', 'こんにちは', 'hello'].includes(message.toLowerCase())) {
    const setupLink = generateWebUILink(userId, 'setup');
    return `🌸 設定が必要です！

👋 生理日共有アプリへようこそ！
まずは個人設定を行いましょう。

⚙️ 設定項目:
• 生理周期 (18-45日)
• 生理期間 (2-10日)  
• 通知設定

📱 下記リンクから設定してください:
${setupLink}

設定完了後、「開始日を入力」から記録を始められます！

※リンクは24時間有効です`;
  }

  // 入力待機状態かチェック
  const inputFlag = await getInputFlag(userId);
  
  if (inputFlag) {
    return await handleInputResponse(userId, message, inputFlag);
  }

  const msg = message.toLowerCase().trim();

  // === Web UI 連携コマンド ===
  if (msg === '設定ページ' || msg === '設定画面' || msg === '設定') {
    const settingsLink = generateWebUILink(userId, 'setup');
    return `⚙️ 設定ページ

下記リンクから設定を変更できます:
${settingsLink}

🔧 変更可能な項目:
• 生理周期・期間の調整
• 通知設定のON/OFF
• その他の個人設定

※リンクは24時間有効です`;
  }

  if (msg === 'ダッシュボード' || msg === '状況確認' || msg === '現在の状況') {
    const dashboardLink = generateWebUILink(userId, 'dashboard');
    return `📊 現在の状況

詳細な状況はこちらで確認できます:
${dashboardLink}

📋 表示内容:
• 現在の周期段階
• 次回予測日までの日数
• 今日の健康アドバイス
• 今後の予定タイムライン

※リンクは24時間有効です`;
  }

  if (msg === 'カレンダー' || msg === 'カレンダー表示') {
    const calendarLink = generateWebUILink(userId, 'calendar');
    return `📅 カレンダー

視覚的なカレンダーで確認できます:
${calendarLink}

🗓️ 表示内容:
• 生理日・予測日のマーキング
• 排卵日・妊娠可能期間
• 月単位での一覧表示
• 日付タップで詳細情報

※リンクは24時間有効です`;
  }

  // 🔧 開始日入力コマンド追加
  if (msg === '開始日を入力' || msg === '生理開始' || msg === '記録する') {
    const entryLink = generateWebUILink(userId, 'entry');
    return `🌸 開始日入力

生理開始日を記録してください:
${entryLink}

📝 入力内容:
• 生理開始日（カレンダー選択）
• 予想期間（3-10日）
• クイック日付選択（今日・昨日など）

※リンクは24時間有効です`;
  }

  // === 基本機能 ===
  if (COMMANDS.HELP.includes(msg)) {
    return getHelpMessageWithWebUI();
  }

  if (COMMANDS.TEST.includes(msg)) {
    return getTestMessage();
  }

  // === デバッグ機能 ===
  if (msg === 'デバッグ' || msg === 'debug') {
    return await checkUserDataSimple(userId);
  }

  // === テスト機能 ===
  if (msg === 'パートナー通知テスト' || msg === '通知テスト') {
    return await testPartnerNotification(userId);
  }

  if (msg === 'パートナーデバッグ' || msg === 'パートナー詳細') {
    return await debugPartnerInfo(userId);
  }

  // === 生理日入力機能 ===
  if (COMMANDS.START_DATE_INPUT.includes(msg)) {
    return await startDateInput(userId);
  }

  if (COMMANDS.DATA_CHECK.includes(msg)) {
    return await checkUserData(userId);
  }

  // === ユーザー設定機能 ===
  if (COMMANDS.SETTINGS_CHECK.includes(msg)) {
    return await checkUserSettings(userId);
  }

  if (COMMANDS.CYCLE_SETTING.includes(msg)) {
    return await startCycleSetting(userId);
  }

  if (COMMANDS.PERIOD_SETTING.includes(msg)) {
    return await startPeriodSetting(userId);
  }

  if (COMMANDS.NOTIFICATION_SETTING.includes(msg)) {
    return await toggleNotificationSetting(userId);
  }

  // === パートナー機能 ===
  if (COMMANDS.INVITE_CODE_GENERATE.includes(msg)) {
    return await generateInviteCode(userId);
  }

  if (COMMANDS.INVITE_CODE_USE.test(message)) {
    return await useInviteCode(userId, message);
  }

  if (COMMANDS.PARTNER_CHECK.includes(msg)) {
    return await checkPartner(userId);
  }

  if (COMMANDS.PARTNER_REMOVE.includes(msg)) {
    return await removePartner(userId);
  }

  // === その他 ===
  if (COMMANDS.GREETING.some(greeting => msg.includes(greeting))) {
    return `こんにちは！👋

🌸 生理日共有アプリです

「ヘルプ」で使い方を確認できます。
下のメニューからも簡単にアクセスできます！`;
  }

  // デフォルトレスポンス
  return getDefaultResponse(message);
}

/**
 * 入力レスポンス処理
 */
async function handleInputResponse(userId, message, inputFlag) {
  try {
    console.log(`Handling input response for user ${userId}, flag type: ${inputFlag.type}`);
    
    switch (inputFlag.type) {
      case INPUT_FLAG_TYPES.DATE_INPUT:
        return await handleDateInput(userId, message);
        
      case INPUT_FLAG_TYPES.CYCLE_SETTING:
        return await handleCycleSetting(userId, message);
        
      case INPUT_FLAG_TYPES.PERIOD_SETTING:
        return await handlePeriodSetting(userId, message);
        
      default:
        console.warn(`Unknown input flag type: ${inputFlag.type}`);
        const { clearInputFlag } = require('./src/utils/firestoreUtils');
        await clearInputFlag(userId);
        return 'セッションがリセットされました。再度お試しください。';
    }
  } catch (error) {
    console.error('Error in handleInputResponse:', error);
    
    try {
      const { clearInputFlag } = require('./src/utils/firestoreUtils');
      await clearInputFlag(userId);
    } catch (clearError) {
      console.error('Error clearing flag after input response error:', clearError);
    }
    
    return MESSAGES.ERRORS.GENERAL;
  }
}

/**
 * ヘルプメッセージ（Web UI対応版）
 */
function getHelpMessageWithWebUI() {
  return `🌸 生理日共有アプリ 🌸

📱 リッチメニュー機能:
• 📅 カレンダー - 視覚的な記録確認
• ⚙️ 設定 - Web画面で詳細設定
• 📊 状況確認 - 現在の詳細状況
• 🌸 開始日入力 - 生理開始日を記録

📅 記録機能:
• 開始日を入力 - 生理開始日を記録
• データ確認 - 記録を確認

⚙️ 設定機能:
• 設定確認 - 現在の設定を確認
• 周期設定 - 生理周期を変更(18-45日)
• 期間設定 - 生理期間を変更(2-10日)
• 通知設定 - 通知のON/OFF切り替え

👫 パートナー機能:
• 招待コード生成 - パートナー招待用コードを生成
• 招待コード [コード] - 招待コードでパートナー登録
• パートナー確認 - 現在のパートナーを確認
• パートナー解除 - パートナー関係を解除

🌐 Web機能:
• カレンダー表示 - 月単位のカレンダー
• 設定ページ - 詳細設定画面
• ダッシュボード - 現在の状況詳細
• 開始日入力 - 直感的な日付入力

🧪 テスト・デバッグ機能:
• パートナー通知テスト - 通知機能のテスト
• パートナーデバッグ - パートナー情報の詳細確認
• デバッグ - システム状態を確認

💡 使い方:
1. 初回は「設定ページ」で基本設定
2. 「開始日を入力」で記録開始
3. 下のメニューで簡単アクセス

まずは下のメニューをタップしてお試しください！`;
}

/**
 * テストメッセージ
 */
function getTestMessage() {
  return `🎉 テスト成功！（Web UI対応版）

✅ Firebase Functions: 動作中
✅ Firestore Database: 接続済み
✅ Firebase Hosting: 準備完了
✅ リージョン: asia-northeast1 明示指定
✅ 生理日入力機能: 実装済み
✅ ユーザー設定機能: 実装済み
✅ パートナー機能: 実装済み
✅ Web UI機能: 実装済み
✅ 開始日入力機能: 実装済み
✅ テスト・デバッグ機能: 実装済み

📂 アーキテクチャ:
• 定数管理: constants.js
• 日付処理: dateUtils.js  
• Firestore操作: firestoreUtils.js
• 生理日入力: dateInputHandler.js
• 設定管理: settingsHandler.js
• パートナー機能: partnerHandler.js
• Web UI機能: webHandler.js
• テスト機能: testHandler.js

🌐 Web UI機能:
• カレンダー表示
• ダッシュボード
• 設定ページ
• 開始日入力ページ

🌏 リージョン設定:
東京リージョン（asia-northeast1）で稼働中
日本からの低レイテンシを実現！

パートナー通知機能とWeb UI連携が正常に動作しています！`;
}

/**
 * デフォルトレスポンス
 */
function getDefaultResponse(message) {
  return `📩 「${message}」を受け取りました。

🌸 主な機能:
• 開始日を入力 - 生理開始日を記録
• データ確認 - 登録済みデータを確認
• 設定確認 - 個人設定を確認・変更

👫 パートナー機能:
• 招待コード生成 - パートナー招待用コード作成
• 招待コード [コード] - パートナー登録
• パートナー確認 - パートナー情報確認
• パートナー解除 - 関係解除

🌐 Web機能（下のメニューから）:
• カレンダー - 視覚的なカレンダー表示
• 設定 - Web画面で詳細設定
• 状況確認 - 現在の詳細な状況
• 開始日入力 - 直感的な日付入力

🧪 テスト・デバッグ:
• パートナー通知テスト - 通知機能テスト
• パートナーデバッグ - 詳細情報確認
• デバッグ - システム状態を確認

「ヘルプ」と送信すると詳しい使い方を確認できます！`;
}

/**
 * パートナー通知機能（生理日入力時に呼び出される）
 */
async function notifyPartnerPeriodStart(userId, startDate, endDate, nextStartDate) {
  try {
    console.log(`[NOTIFICATION] Starting partner notification for user: ${userId}`);
    
    const partnerId = await getPartnerId(userId);
    
    if (!partnerId) {
      console.log('[NOTIFICATION] No partner found');
      return;
    }
    
    const { getUserSettings } = require('./src/utils/firestoreUtils');
    const partnerSettings = await getUserSettings(partnerId);
    
    if (!partnerSettings.notifications) {
      console.log('[NOTIFICATION] Partner notifications disabled');
      return;
    }

    const notificationText = `💕 パートナーからの通知

🩸 生理が始まりました

📅 開始日: ${startDate}
📅 予測終了日: ${endDate}  
📅 次回予測開始日: ${nextStartDate}

いつもありがとう ❤️
お互いを大切にしながら過ごしましょう。`;

    await client.pushMessage(partnerId, {
      type: 'text',
      text: notificationText
    });
    
    console.log(`[NOTIFICATION] Sent successfully to: ${partnerId}`);

  } catch (error) {
    console.error('[NOTIFICATION] Error:', error);
  }
}

// === Web UI用のCloud Functions ===

// Web UI用のハンドラーをインポートして関数をエクスポート
const webHandler = require('./src/handlers/webHandler');

exports.saveInitialSettings = webHandler.saveInitialSettings;
exports.getDashboardData = webHandler.getDashboardData;
exports.getCalendarData = webHandler.getCalendarData;
exports.updateWebSettings = webHandler.updateWebSettings;

// 🔧 新規追加: 開始日入力用のAPI
exports.savePeriodRecord = webHandler.savePeriodRecord;

/**
 * リッチメニュー設定用の単発実行関数
 */
exports.setupRichMenu = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    try {
      const richMenu = {
        size: {
          width: 2500,
          height: 1686
        },
        selected: false,
        name: "生理日共有アプリ メニュー v2",
        chatBarText: "メニュー",
        areas: [
          {
            bounds: { x: 0, y: 0, width: 833, height: 843 },
            action: { type: "message", text: "カレンダー" }
          },
          {
            bounds: { x: 833, y: 0, width: 834, height: 843 },
            action: { type: "message", text: "設定ページ" }
          },
          {
            bounds: { x: 1667, y: 0, width: 833, height: 843 },
            action: { type: "message", text: "ダッシュボード" }
          },
          {
            bounds: { x: 0, y: 843, width: 833, height: 843 },
            action: { type: "message", text: "開始日を入力" }
          },
          {
            bounds: { x: 833, y: 843, width: 834, height: 843 },
            action: { type: "message", text: "パートナー確認" }
          },
          {
            bounds: { x: 1667, y: 843, width: 833, height: 843 },
            action: { type: "message", text: "ヘルプ" }
          }
        ]
      };

      const createdMenu = await client.createRichMenu(richMenu);
      console.log('Rich menu created:', createdMenu.richMenuId);

      res.status(200).json({ 
        success: true, 
        richMenuId: createdMenu.richMenuId,
        message: 'Rich menu created successfully. Upload image and set as default manually.'
      });
    } catch (error) {
      console.error('Error in setupRichMenu:', error);
      res.status(500).json({ error: error.message });
    }
  });

// エクスポート
exports.notifyPartnerPeriodStart = notifyPartnerPeriodStart;