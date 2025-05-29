// src/handlers/dateInputHandler.js - エラー完全修正版

const admin = require('firebase-admin');
const { 
  parseNaturalDate, 
  validateDate, 
  formatDate, 
  getInputConfirmationText,
  calculatePredictedDates 
} = require('../utils/dateUtils');
const { 
  getUserSettings, 
  saveRecord, 
  setInputFlag,
  clearInputFlag,
  db
} = require('../utils/firestoreUtils');
const { 
  INPUT_FLAG_TYPES, 
  MESSAGES, 
  COMMANDS,
  COLLECTIONS,
  RECORD_STATUS
} = require('../config/constants');

/**
 * 生理日入力プロセスを開始
 */
async function startDateInput(userId) {
  try {
    console.log(`Starting date input for user: ${userId}`);
    
    await setInputFlag(userId, {
      type: INPUT_FLAG_TYPES.DATE_INPUT,
      status: 'waiting_date'
    });

    return MESSAGES.PROMPTS.DATE_INPUT;

  } catch (error) {
    console.error('Error in startDateInput:', error);
    return MESSAGES.ERRORS.GENERAL;
  }
}

/**
 * 日付入力を処理（完全修正版）
 */
async function handleDateInput(userId, dateInput) {
  try {
    console.log(`[DATE_INPUT] Processing date input for user ${userId}: ${dateInput}`);
    
    if (COMMANDS.CANCEL.includes(dateInput.toLowerCase().trim())) {
      await clearInputFlag(userId);
      return 'キャンセルしました。';
    }

    const parsedDate = parseNaturalDate(dateInput);
    
    if (!parsedDate) {
      return `${MESSAGES.ERRORS.DATE_PARSE}

🗓️ 以下の形式で再度入力してください:
• 今日、昨日、一昨日
• 3日前、1週間前
• 今週の火曜日、先週の金曜日
• 12/25、2024-12-25

または「キャンセル」で中止できます。`;
    }

    const validation = validateDate(parsedDate);
    if (!validation.isValid) {
      switch (validation.error) {
        case 'FUTURE_DATE':
          return MESSAGES.ERRORS.FUTURE_DATE;
        case 'OLD_DATE':
          return MESSAGES.ERRORS.OLD_DATE;
        default:
          return MESSAGES.ERRORS.DATE_PARSE;
      }
    }

    const userSettings = await getUserSettings(userId);
    const { endDate, nextStartDate } = calculatePredictedDates(parsedDate, userSettings);

    const recordData = {
      startDate: admin.firestore.Timestamp.fromDate(parsedDate),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      nextPredictedStart: admin.firestore.Timestamp.fromDate(nextStartDate),
      inputMethod: 'natural',
      originalInput: dateInput
    };

    const recordId = await saveRecord(userId, recordData);
    console.log(`[DATE_INPUT] Record saved with ID: ${recordId}`);

    await clearInputFlag(userId);

    const inputConfirmation = getInputConfirmationText(dateInput, formatDate(parsedDate));
    
    // 日付をフォーマット（変数名修正）
    const startDateStr = formatDate(parsedDate);
    const endDateStr = formatDate(endDate);
    const nextStartDateStr = formatDate(nextStartDate);
    
    // パートナー通知を送信
    console.log(`[DATE_INPUT] Attempting to send partner notification...`);
    console.log(`[DATE_INPUT] Dates: Start=${startDateStr}, End=${endDateStr}, Next=${nextStartDateStr}`);
    
    try {
      await sendPartnerNotification(userId, startDateStr, endDateStr, nextStartDateStr);
      console.log(`[DATE_INPUT] Partner notification completed successfully`);
    } catch (notificationError) {
      console.error(`[DATE_INPUT] Partner notification failed:`, notificationError);
      console.error(`[DATE_INPUT] Error stack:`, notificationError.stack);
    }

    return `${MESSAGES.SUCCESS.RECORD_SAVED}

${inputConfirmation}

📅 開始日: ${startDateStr}
📅 予測終了日: ${endDateStr}
📅 次回予測開始日: ${nextStartDateStr}

「データ確認」で記録を確認できます。`;

  } catch (error) {
    console.error('[DATE_INPUT] Error in handleDateInput:', error);
    
    try {
      await clearInputFlag(userId);
    } catch (clearError) {
      console.error('Error clearing flag after date input error:', clearError);
    }
    
    return 'データの登録中にエラーが発生しました。再度お試しください。';
  }
}

/**
 * パートナー通知を送信
 */
async function sendPartnerNotification(userId, startDate, endDate, nextStartDate) {
  try {
    console.log(`[PARTNER_NOTIFY] === Starting notification process ===`);
    console.log(`[PARTNER_NOTIFY] User: ${userId}`);
    console.log(`[PARTNER_NOTIFY] Dates: ${startDate}, ${endDate}, ${nextStartDate}`);
    
    // パートナーIDを取得
    const { getPartnerId } = require('./partnerHandler');
    const partnerId = await getPartnerId(userId);
    
    if (!partnerId) {
      console.log(`[PARTNER_NOTIFY] No partner found - notification skipped`);
      return;
    }
    
    console.log(`[PARTNER_NOTIFY] Partner found: ${partnerId}`);
    
    // パートナーの通知設定を確認
    const partnerSettings = await getUserSettings(partnerId);
    console.log(`[PARTNER_NOTIFY] Partner settings:`, partnerSettings);
    
    if (!partnerSettings.notifications) {
      console.log(`[PARTNER_NOTIFY] Partner notifications disabled - skipped`);
      return;
    }
    
    console.log(`[PARTNER_NOTIFY] Partner notifications enabled - proceeding`);

    // LINE Bot クライアントを作成
    const line = require('@line/bot-sdk');
    const functions = require('firebase-functions');
    
    const config = {
      channelAccessToken: functions.config().line.channel_access_token,
      channelSecret: functions.config().line.channel_secret,
    };
    
    console.log(`[PARTNER_NOTIFY] LINE client config ready`);
    
    const client = new line.Client(config);

    // 通知メッセージを作成
    const notificationText = `💕 パートナーからの通知

🩸 生理が始まりました

📅 開始日: ${startDate}
📅 予測終了日: ${endDate}  
📅 次回予測開始日: ${nextStartDate}

いつもありがとう ❤️
お互いを大切にしながら過ごしましょう。`;

    console.log(`[PARTNER_NOTIFY] Sending push message to: ${partnerId}`);

    // プッシュメッセージとして送信
    await client.pushMessage(partnerId, {
      type: 'text',
      text: notificationText
    });
    
    console.log(`[PARTNER_NOTIFY] === Push message sent successfully ===`);

  } catch (error) {
    console.error(`[PARTNER_NOTIFY] === ERROR in sendPartnerNotification ===`);
    console.error(`[PARTNER_NOTIFY] Error:`, error);
    console.error(`[PARTNER_NOTIFY] Stack:`, error.stack);
    throw error;
  }
}

/**
 * ユーザーの生理記録データを確認
 */
async function checkUserData(userId) {
  try {
    console.log(`Checking data for user: ${userId}`);
    
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log('User document does not exist');
      return `⚠️ ユーザー情報が見つかりません。

まず「テスト」と送信してユーザー登録を完了してください。`;
    }
    
    console.log('User document exists, getting records...');
    
    const recordsRef = db.collection(COLLECTIONS.USERS)
      .doc(userId)
      .collection(COLLECTIONS.RECORDS);
    
    console.log('Executing records query...');
    const snapshot = await recordsRef
      .orderBy('createdAt', 'desc')
      .limit(3)
      .get();
    
    console.log(`Found ${snapshot.size} records`);

    if (snapshot.empty) {
      return `📊 データ確認

まだ生理日の記録がありません。

「開始日を入力」と送信して最初の記録を作成してください。`;
    }

    let result = `📊 登録データ（最新${snapshot.size}件）\n\n`;
    
    snapshot.forEach((doc, index) => {
      try {
        const data = doc.data();
        console.log(`Processing record ${index}:`, data);
        
        let startDate = '日付不明';
        let endDate = '日付不明';
        
        if (data.startDate) {
          if (data.startDate.toDate) {
            startDate = data.startDate.toDate().toLocaleDateString('ja-JP');
          } else if (data.startDate._seconds) {
            startDate = new Date(data.startDate._seconds * 1000).toLocaleDateString('ja-JP');
          }
        }
        
        if (data.endDate) {
          if (data.endDate.toDate) {
            endDate = data.endDate.toDate().toLocaleDateString('ja-JP');
          } else if (data.endDate._seconds) {
            endDate = new Date(data.endDate._seconds * 1000).toLocaleDateString('ja-JP');
          }
        }
        
        result += `${index + 1}. 開始日: ${startDate}\n`;
        result += `   予測終了日: ${endDate}\n`;
        
        if (data.originalInput) {
          result += `   入力: ${data.originalInput}\n`;
        }
        
        result += '\n';
      } catch (recordError) {
        console.error(`Error processing record ${index}:`, recordError);
        result += `${index + 1}. 記録の処理でエラーが発生しました\n\n`;
      }
    });

    result += '新しい記録を追加するには「開始日を入力」と送信してください。';
    
    console.log('Data check completed successfully');
    return result;

  } catch (error) {
    console.error('Error in checkUserData:', error);
    return `❌ データ確認でエラーが発生しました: ${error.message}`;
  }
}

/**
 * デバッグ用：簡単なデータ確認
 */
async function checkUserDataSimple(userId) {
  try {
    console.log(`Simple data check for user: ${userId}`);
    
    const recordsRef = db.collection(COLLECTIONS.USERS)
      .doc(userId)
      .collection(COLLECTIONS.RECORDS);
    
    const snapshot = await recordsRef.get();
    
    return `📊 簡易データ確認

ユーザーID: ${userId}
レコード数: ${snapshot.size}件
コレクション: ${COLLECTIONS.USERS}/${userId}/${COLLECTIONS.RECORDS}`;

  } catch (error) {
    console.error('Error in checkUserDataSimple:', error);
    return `デバッグエラー: ${error.message}`;
  }
}

module.exports = {
  startDateInput,
  handleDateInput,
  checkUserData,
  checkUserDataSimple,
  sendPartnerNotification
};