// src/handlers/settingsHandler.js - 設定管理ハンドラー

const { 
  getUserSettings, 
  updateUserSetting,
  setInputFlag,
  clearInputFlag 
} = require('../utils/firestoreUtils');
const { 
  INPUT_FLAG_TYPES, 
  LIMITS,
  MESSAGES,
  COMMANDS 
} = require('../config/constants');

/**
 * ユーザー設定を確認
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function checkUserSettings(userId) {
  try {
    console.log(`Checking settings for user: ${userId}`);
    
    const settings = await getUserSettings(userId);
    
    return `⚙️ 現在の設定

📊 生理周期: ${settings.cycle}日
📊 生理期間: ${settings.period}日
🔔 通知設定: ${settings.notifications ? 'ON' : 'OFF'}

💡 設定変更方法:
• 周期設定 - 生理周期を変更(${LIMITS.CYCLE.MIN}-${LIMITS.CYCLE.MAX}日)
• 期間設定 - 生理期間を変更(${LIMITS.PERIOD.MIN}-${LIMITS.PERIOD.MAX}日)
• 通知設定 - 通知のON/OFF切り替え

変更したい項目のコマンドを送信してください。`;

  } catch (error) {
    console.error('Error in checkUserSettings:', error);
    return '設定の取得中にエラーが発生しました。';
  }
}

/**
 * 周期設定プロセスを開始
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function startCycleSetting(userId) {
  try {
    console.log(`Starting cycle setting for user: ${userId}`);
    
    await setInputFlag(userId, {
      type: INPUT_FLAG_TYPES.CYCLE_SETTING,
      status: 'waiting_input',
      settingType: 'cycle',
      min: LIMITS.CYCLE.MIN,
      max: LIMITS.CYCLE.MAX
    });

    return MESSAGES.PROMPTS.CYCLE_INPUT;

  } catch (error) {
    console.error('Error in startCycleSetting:', error);
    return MESSAGES.ERRORS.GENERAL;
  }
}

/**
 * 期間設定プロセスを開始
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function startPeriodSetting(userId) {
  try {
    console.log(`Starting period setting for user: ${userId}`);
    
    await setInputFlag(userId, {
      type: INPUT_FLAG_TYPES.PERIOD_SETTING,
      status: 'waiting_input',
      settingType: 'period',
      min: LIMITS.PERIOD.MIN,
      max: LIMITS.PERIOD.MAX
    });

    return MESSAGES.PROMPTS.PERIOD_INPUT;

  } catch (error) {
    console.error('Error in startPeriodSetting:', error);
    return MESSAGES.ERRORS.GENERAL;
  }
}

/**
 * 周期設定の入力を処理
 * @param {string} userId - LINE ユーザーID
 * @param {string} input - ユーザーの入力
 * @returns {string} - 返信メッセージ
 */
async function handleCycleSetting(userId, input) {
  try {
    console.log(`Processing cycle setting for user ${userId}: ${input}`);
    
    // キャンセル処理
    if (COMMANDS.CANCEL.includes(input.toLowerCase().trim())) {
      await clearInputFlag(userId);
      return 'キャンセルしました。';
    }

    const cycle = parseInt(input.trim());
    
    // バリデーション
    if (isNaN(cycle) || cycle < LIMITS.CYCLE.MIN || cycle > LIMITS.CYCLE.MAX) {
      return `${MESSAGES.ERRORS.INVALID_CYCLE}

${LIMITS.CYCLE.MIN}日〜${LIMITS.CYCLE.MAX}日の範囲で数字を入力してください。
例: 28

または「キャンセル」で設定を中止できます。`;
    }

    // 設定を更新
    await updateUserSetting(userId, 'cycle', cycle);
    
    // フラグをクリア
    await clearInputFlag(userId);

    return `${MESSAGES.SUCCESS.CYCLE_UPDATED}

生理周期を${cycle}日に設定しました。
これで予測日の計算がより正確になります。

「設定確認」で変更を確認できます。`;

  } catch (error) {
    console.error('Error in handleCycleSetting:', error);
    
    // エラー時はフラグをクリア
    try {
      await clearInputFlag(userId);
    } catch (clearError) {
      console.error('Error clearing flag after cycle setting error:', clearError);
    }
    
    return 'エラーが発生しました。再度お試しください。';
  }
}

/**
 * 期間設定の入力を処理
 * @param {string} userId - LINE ユーザーID
 * @param {string} input - ユーザーの入力
 * @returns {string} - 返信メッセージ
 */
async function handlePeriodSetting(userId, input) {
  try {
    console.log(`Processing period setting for user ${userId}: ${input}`);
    
    // キャンセル処理
    if (COMMANDS.CANCEL.includes(input.toLowerCase().trim())) {
      await clearInputFlag(userId);
      return 'キャンセルしました。';
    }

    const period = parseInt(input.trim());
    
    // バリデーション
    if (isNaN(period) || period < LIMITS.PERIOD.MIN || period > LIMITS.PERIOD.MAX) {
      return `${MESSAGES.ERRORS.INVALID_PERIOD}

${LIMITS.PERIOD.MIN}日〜${LIMITS.PERIOD.MAX}日の範囲で数字を入力してください。
例: 5

または「キャンセル」で設定を中止できます。`;
    }

    // 設定を更新
    await updateUserSetting(userId, 'period', period);
    
    // フラグをクリア
    await clearInputFlag(userId);

    return `${MESSAGES.SUCCESS.PERIOD_UPDATED}

生理期間を${period}日に設定しました。
これで終了予測日がより正確になります。

「設定確認」で変更を確認できます。`;

  } catch (error) {
    console.error('Error in handlePeriodSetting:', error);
    
    // エラー時はフラグをクリア
    try {
      await clearInputFlag(userId);
    } catch (clearError) {
      console.error('Error clearing flag after period setting error:', clearError);
    }
    
    return 'エラーが発生しました。再度お試しください。';
  }
}

/**
 * 通知設定を切り替え
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function toggleNotificationSetting(userId) {
  try {
    console.log(`Toggling notification setting for user: ${userId}`);
    
    const settings = await getUserSettings(userId);
    const newNotificationStatus = !settings.notifications;
    
    await updateUserSetting(userId, 'notifications', newNotificationStatus);

    const successMessage = newNotificationStatus ? 
      MESSAGES.SUCCESS.NOTIFICATION_ON : 
      MESSAGES.SUCCESS.NOTIFICATION_OFF;

    return `${successMessage}

${newNotificationStatus ? 
  '今後、予測日の通知やパートナーからの通知を受け取ります。' : 
  '通知を停止しました。必要に応じて再度ONにできます。'}

「設定確認」で変更を確認できます。`;

  } catch (error) {
    console.error('Error in toggleNotificationSetting:', error);
    return 'エラーが発生しました。再度お試しください。';
  }
}

/**
 * 設定の一括更新（将来の拡張用）
 * @param {string} userId - LINE ユーザーID
 * @param {Object} newSettings - 新しい設定
 * @returns {boolean} - 成功/失敗
 */
async function updateMultipleSettings(userId, newSettings) {
  try {
    console.log(`Updating multiple settings for user ${userId}:`, newSettings);
    
    const updates = [];
    
    if (newSettings.cycle !== undefined) {
      if (newSettings.cycle < LIMITS.CYCLE.MIN || newSettings.cycle > LIMITS.CYCLE.MAX) {
        throw new Error(`Invalid cycle: ${newSettings.cycle}`);
      }
      updates.push(['cycle', newSettings.cycle]);
    }
    
    if (newSettings.period !== undefined) {
      if (newSettings.period < LIMITS.PERIOD.MIN || newSettings.period > LIMITS.PERIOD.MAX) {
        throw new Error(`Invalid period: ${newSettings.period}`);
      }
      updates.push(['period', newSettings.period]);
    }
    
    if (newSettings.notifications !== undefined) {
      updates.push(['notifications', newSettings.notifications]);
    }
    
    // 各設定を更新
    for (const [key, value] of updates) {
      await updateUserSetting(userId, key, value);
    }
    
    console.log(`Updated ${updates.length} settings for user ${userId}`);
    return true;

  } catch (error) {
    console.error('Error in updateMultipleSettings:', error);
    return false;
  }
}

/**
 * 設定のバリデーション
 * @param {Object} settings - 設定オブジェクト
 * @returns {Object} - {isValid: boolean, errors: Array}
 */
function validateSettings(settings) {
  const errors = [];
  
  if (settings.cycle !== undefined) {
    if (typeof settings.cycle !== 'number' || 
        settings.cycle < LIMITS.CYCLE.MIN || 
        settings.cycle > LIMITS.CYCLE.MAX) {
      errors.push(`生理周期は${LIMITS.CYCLE.MIN}-${LIMITS.CYCLE.MAX}日の範囲で設定してください`);
    }
  }
  
  if (settings.period !== undefined) {
    if (typeof settings.period !== 'number' || 
        settings.period < LIMITS.PERIOD.MIN || 
        settings.period > LIMITS.PERIOD.MAX) {
      errors.push(`生理期間は${LIMITS.PERIOD.MIN}-${LIMITS.PERIOD.MAX}日の範囲で設定してください`);
    }
  }
  
  if (settings.notifications !== undefined) {
    if (typeof settings.notifications !== 'boolean') {
      errors.push('通知設定は true または false で設定してください');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

module.exports = {
  checkUserSettings,
  startCycleSetting,
  startPeriodSetting,
  handleCycleSetting,
  handlePeriodSetting,
  toggleNotificationSetting,
  updateMultipleSettings,
  validateSettings
};