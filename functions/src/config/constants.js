// src/config/constants.js - アプリケーション定数（生理情報機能追加版）

// Firestore コレクション名
const COLLECTIONS = {
  USERS: 'users',
  RECORDS: 'records',
  PARTNERS: 'partners',
  INVITE_CODES: 'inviteCodes',
  TEMP: 'temp'
};

// ドキュメント名
const DOCUMENTS = {
  INPUT_FLAG: 'input_flag'
};

// デフォルト設定値
const DEFAULT_SETTINGS = {
  CYCLE: 28,      // デフォルト生理周期（日）
  PERIOD: 5,      // デフォルト生理期間（日）
  NOTIFICATIONS: true,
  TIMEZONE: 'Asia/Tokyo'
};

// 設定の制限値
const LIMITS = {
  CYCLE: {
    MIN: 21,
    MAX: 35
  },
  PERIOD: {
    MIN: 3,
    MAX: 7
  },
  DATE_HISTORY: {
    MAX_DAYS_AGO: 365  // 1年前まで
  }
};

// 入力フラグのタイプ
const INPUT_FLAG_TYPES = {
  DATE_INPUT: 'date_input',
  CYCLE_SETTING: 'cycle_setting',
  PERIOD_SETTING: 'period_setting'
};

// レコードのステータス
const RECORD_STATUS = {
  ACTIVE: 'active',
  MODIFIED: 'modified', 
  DELETED: 'deleted'
};

// メッセージテンプレート
const MESSAGES = {
  ERRORS: {
    GENERAL: 'エラーが発生しました。しばらく経ってから再度お試しください。',
    DATE_PARSE: '日付を認識できませんでした。',
    FUTURE_DATE: '⚠️ 未来の日付は登録できません。',
    OLD_DATE: '⚠️ 1年以上前の日付は登録できません。',
    INVALID_CYCLE: '❌ 生理周期は21日〜35日の範囲で入力してください。',
    INVALID_PERIOD: '❌ 生理期間は3日〜7日の範囲で入力してください。'
  },
  SUCCESS: {
    RECORD_SAVED: '🩸 登録完了しました！',
    CYCLE_UPDATED: '✅ 生理周期を変更しました！',
    PERIOD_UPDATED: '✅ 生理期間を変更しました！',
    NOTIFICATION_ON: '🔔 通知設定をONに変更しました！',
    NOTIFICATION_OFF: '🔔 通知設定をOFFに変更しました！'
  },
  PROMPTS: {
    DATE_INPUT: `📅 生理開始日を入力してください

🗓️ 入力例:
• 今日、昨日、一昨日
• 3日前、1週間前
• 今週の火曜日、先週の金曜日
• 12/25、2024-12-25

どの形式でも大丈夫です！`,
    CYCLE_INPUT: `📊 生理周期の設定

現在の周期を変更します。
21日〜35日の範囲で入力してください。

例: 28, 30, 32

数字のみを入力してください。`,
    PERIOD_INPUT: `📊 生理期間の設定

現在の期間を変更します。
3日〜7日の範囲で入力してください。

例: 4, 5, 6

数字のみを入力してください。`
  }
};

// コマンド定義
const COMMANDS = {
  // 基本コマンド
  HELP: ['ヘルプ', 'help'],
  TEST: ['テスト', 'test'],
  
  // 生理日入力
  START_DATE_INPUT: ['開始日を入力', '生理開始日'],
  DATA_CHECK: ['データ確認'],
  
  // 🌸 新機能: 生理情報・排卵日関連
  PERIOD_INFO: ['生理情報', '生理記録', '記録詳細'],
  OVULATION_INFO: ['排卵日', '排卵日情報', '妊娠可能期間'],
  CURRENT_STATUS: ['今の状態', '現在の状態', '周期状態'],
  DETAILED_HISTORY: ['詳細履歴', '記録履歴', '履歴詳細'],
  
  // パートナー機能
  INVITE_CODE_GENERATE: ['招待コード生成'],
  INVITE_CODE_USE: /招待コード\s*[A-Z0-9]{6}/i,
  PARTNER_CHECK: ['パートナー確認'],
  PARTNER_REMOVE: ['パートナー解除'],
  
  // 設定管理
  SETTINGS_CHECK: ['設定確認'],
  CYCLE_SETTING: ['周期設定'],
  PERIOD_SETTING: ['期間設定'],
  NOTIFICATION_SETTING: ['通知設定'],
  
  // その他
  CANCEL: ['キャンセル', 'cancel'],
  GREETING: ['こんにちは', 'hello']
};

module.exports = {
  COLLECTIONS,
  DOCUMENTS,
  DEFAULT_SETTINGS,
  LIMITS,
  INPUT_FLAG_TYPES,
  RECORD_STATUS,
  MESSAGES,
  COMMANDS
};