// src/handlers/cycleInfoHandler.js - 生理情報・排卵日表示ハンドラー

const { getUserSettings, getUserRecords, db } = require('../utils/firestoreUtils');
const { 
  formatDate, 
  formatDateJapanese,
  calculateOvulationDate,
  getCurrentCyclePhase,
  getDaysUntilNextPeriod,
  generatePeriodDetails
} = require('../utils/dateUtils');
const { COLLECTIONS } = require('../config/constants');

/**
 * 生理情報の詳細を表示
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function showPeriodInfo(userId) {
  try {
    console.log(`Showing period info for user: ${userId}`);
    
    // 最新の記録を取得
    const records = await getUserRecords(userId, 1);
    if (records.length === 0) {
      return `📊 生理情報

まだ生理日の記録がありません。

「開始日を入力」と送信して最初の記録を作成してください。`;
    }
    
    // ユーザー設定を取得
    const settings = await getUserSettings(userId);
    
    // 最新記録の詳細情報を生成
    const latestRecord = records[0];
    const details = generatePeriodDetails(latestRecord, settings);
    
    if (!details) {
      return '生理情報の処理中にエラーが発生しました。';
    }
    
    // 情報表示テキストを構築
    let message = `📊 最新の生理情報\n\n`;
    
    // 基本情報
    message += `🩸 生理期間:\n`;
    message += `• 開始日: ${formatDateJapanese(details.startDate)}\n`;
    message += `• 終了日: ${formatDateJapanese(details.endDate)}\n`;
    message += `• 実際の日数: ${details.actualDays}日\n`;
    message += `• 予測日数: ${details.predictedDays}日\n\n`;
    
    // 精度評価
    const accuracyEmoji = details.accuracy === 'high' ? '🎯' : '📈';
    const accuracyText = details.accuracy === 'high' ? '高精度' : '標準精度';
    message += `${accuracyEmoji} 予測精度: ${accuracyText}\n\n`;
    
    // 現在の状態
    if (details.cyclePhase) {
      message += `${details.cyclePhase.emoji} 現在の状態: ${details.cyclePhase.description}\n`;
      message += `• 生理開始から: ${details.cyclePhase.daysSinceStart}日目\n\n`;
    }
    
    // 次回予測
    if (details.nextPeriodInfo) {
      if (details.nextPeriodInfo.isOverdue) {
        message += `⏰ 次回生理: 予定日を${Math.abs(details.nextPeriodInfo.daysUntil)}日超過\n`;
        message += `• 予定日: ${formatDateJapanese(details.nextPeriodInfo.nextPeriodDate)}\n\n`;
      } else {
        message += `📅 次回生理予定: あと${details.nextPeriodInfo.daysUntil}日\n`;
        message += `• 予定日: ${formatDateJapanese(details.nextPeriodInfo.nextPeriodDate)}\n\n`;
      }
    }
    
    message += `💡 その他の機能:\n`;
    message += `• 「排卵日」で排卵日情報を確認\n`;
    message += `• 「今の状態」で詳細な周期段階を確認\n`;
    message += `• 「設定確認」で周期設定を変更`;
    
    return message;

  } catch (error) {
    console.error('Error in showPeriodInfo:', error);
    return 'エラーが発生しました。再度お試しください。';
  }
}

/**
 * 排卵日情報を表示
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function showOvulationInfo(userId) {
  try {
    console.log(`Showing ovulation info for user: ${userId}`);
    
    // 最新の記録を取得
    const records = await getUserRecords(userId, 1);
    if (records.length === 0) {
      return `🥚 排卵日情報

まだ生理日の記録がありません。

「開始日を入力」と送信して最初の記録を作成してください。`;
    }
    
    // ユーザー設定を取得
    const settings = await getUserSettings(userId);
    
    // 最新記録から排卵日を計算
    const latestRecord = records[0];
    const startDate = latestRecord.startDate.toDate ? latestRecord.startDate.toDate() : new Date(latestRecord.startDate);
    
    const ovulationInfo = calculateOvulationDate(startDate, settings.cycle);
    
    if (!ovulationInfo) {
      return 'エラーが発生しました。再度お試しください。';
    }
    
    const today = new Date();
    
    let message = `🥚 排卵日・妊娠可能期間\n\n`;
    
    // 排卵日情報
    message += `🌸 排卵予定日: ${formatDateJapanese(ovulationInfo.ovulationDate)}\n`;
    
    // 今日との関係
    const daysToOvulation = Math.ceil((ovulationInfo.ovulationDate - today) / (1000 * 60 * 60 * 24));
    if (daysToOvulation > 0) {
      message += `• あと${daysToOvulation}日後\n\n`;
    } else if (daysToOvulation === 0) {
      message += `• 本日が排卵予定日です！\n\n`;
    } else {
      message += `• ${Math.abs(daysToOvulation)}日前に終了\n\n`;
    }
    
    // 妊娠可能期間
    message += `💕 妊娠可能期間（推定）:\n`;
    message += `• 開始: ${formatDateJapanese(ovulationInfo.fertileStart)}\n`;
    message += `• 終了: ${formatDateJapanese(ovulationInfo.fertileEnd)}\n`;
    
    // 期間中かどうか判定
    if (today >= ovulationInfo.fertileStart && today <= ovulationInfo.fertileEnd) {
      message += `• 🌟 現在、妊娠可能期間中です\n\n`;
    } else if (today < ovulationInfo.fertileStart) {
      const daysToFertile = Math.ceil((ovulationInfo.fertileStart - today) / (1000 * 60 * 60 * 24));
      message += `• 妊娠可能期間まであと${daysToFertile}日\n\n`;
    } else {
      message += `• 妊娠可能期間は終了しています\n\n`;
    }
    
    // 次回生理予定
    message += `📅 次回生理予定: ${formatDateJapanese(ovulationInfo.nextPeriodDate)}\n\n`;
    
    // 注意事項
    message += `⚠️ 注意事項:\n`;
    message += `• これらの日付は推定値です\n`;
    message += `• 個人差があることを考慮してください\n`;
    message += `• 正確な情報は医師に相談を\n\n`;
    
    message += `💡 「生理情報」で詳細な生理記録を確認できます`;
    
    return message;

  } catch (error) {
    console.error('Error in showOvulationInfo:', error);
    return 'エラーが発生しました。再度お試しください。';
  }
}

/**
 * 現在の周期状態を表示
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function showCurrentStatus(userId) {
  try {
    console.log(`Showing current status for user: ${userId}`);
    
    // 最新の記録を取得
    const records = await getUserRecords(userId, 1);
    if (records.length === 0) {
      return `📊 現在の状態

まだ生理日の記録がありません。

「開始日を入力」と送信して最初の記録を作成してください。`;
    }
    
    // ユーザー設定を取得
    const settings = await getUserSettings(userId);
    
    // 最新記録から現在の状態を判定
    const latestRecord = records[0];
    const startDate = latestRecord.startDate.toDate ? latestRecord.startDate.toDate() : new Date(latestRecord.startDate);
    
    const cyclePhase = getCurrentCyclePhase(startDate, settings.period, settings.cycle);
    const nextPeriodInfo = getDaysUntilNextPeriod(startDate, settings.cycle);
    
    if (!cyclePhase || !nextPeriodInfo) {
      return 'エラーが発生しました。再度お試しください。';
    }
    
    let message = `${cyclePhase.emoji} 現在の状態\n\n`;
    
    // 現在のフェーズ
    message += `🌸 周期段階: ${cyclePhase.description}\n`;
    message += `• 生理開始から: ${cyclePhase.daysSinceStart}日目\n`;
    message += `• この段階: ${cyclePhase.daysInPhase}日目\n\n`;
    
    // フェーズ別の詳細情報
    switch (cyclePhase.phase) {
      case 'menstrual':
        message += `🩸 生理中です\n`;
        message += `• 予定終了まで: あと${settings.period - cyclePhase.daysSinceStart}日\n`;
        message += `• 体調管理: 十分な休息を取りましょう\n\n`;
        break;
        
      case 'follicular':
        message += `🌱 卵胞期です\n`;
        message += `• エネルギーが高まる時期\n`;
        message += `• 新しいことを始めるのに良い時期\n\n`;
        break;
        
      case 'ovulation':
        message += `🥚 排卵期です\n`;
        message += `• 最も妊娠しやすい時期\n`;
        message += `• 体温がやや上昇する時期\n\n`;
        break;
        
      case 'luteal':
        message += `🌸 黄体期です\n`;
        message += `• PMSの症状が現れる可能性\n`;
        message += `• リラックスを心がけましょう\n\n`;
        break;
        
      case 'overdue':
        message += `⏰ 生理予定日を超過しています\n`;
        message += `• ${Math.abs(nextPeriodInfo.daysUntil)}日遅れています\n`;
        message += `• 体調に変化がないか確認しましょう\n\n`;
        break;
    }
    
    // 次回予測
    if (!nextPeriodInfo.isOverdue) {
      message += `📅 次回生理まで: あと${nextPeriodInfo.daysUntil}日\n`;
      message += `• 予定日: ${formatDateJapanese(nextPeriodInfo.nextPeriodDate)}\n\n`;
    }
    
    // アドバイス
    message += `💡 今日のアドバイス:\n`;
    
    if (cyclePhase.phase === 'menstrual') {
      message += `• 鉄分を意識した食事を\n`;
      message += `• 温かい飲み物でリラックス\n`;
    } else if (cyclePhase.phase === 'follicular') {
      message += `• 運動を始めるのに最適な時期\n`;
      message += `• 新しい挑戦をしてみましょう\n`;
    } else if (cyclePhase.phase === 'ovulation') {
      message += `• 水分補給を忘れずに\n`;
      message += `• 基礎体温の変化に注意\n`;
    } else if (cyclePhase.phase === 'luteal') {
      message += `• カルシウムとマグネシウムを摂取\n`;
      message += `• ストレスを溜めないように\n`;
    }
    
    message += `\n💭 「排卵日」「生理情報」で詳細を確認できます`;
    
    return message;

  } catch (error) {
    console.error('Error in showCurrentStatus:', error);
    return 'エラーが発生しました。再度お試しください。';
  }
}

/**
 * 生理記録の履歴を表示（詳細版）
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function showDetailedHistory(userId) {
  try {
    console.log(`Showing detailed history for user: ${userId}`);
    
    // 直近3件の記録を取得
    const records = await getUserRecords(userId, 3);
    if (records.length === 0) {
      return `📚 生理記録履歴

まだ生理日の記録がありません。

「開始日を入力」と送信して最初の記録を作成してください。`;
    }
    
    const settings = await getUserSettings(userId);
    let message = `📚 生理記録履歴（最新${records.length}件）\n\n`;
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const details = generatePeriodDetails(record, settings);
      
      if (details) {
        message += `${i === 0 ? '🆕' : '📝'} 記録 ${i + 1}:\n`;
        message += `• 期間: ${formatDate(details.startDate)} ～ ${formatDate(details.endDate)}\n`;
        message += `• 日数: ${details.actualDays}日（予測: ${details.predictedDays}日）\n`;
        
        if (i < records.length - 1) {
          // 前回からの周期を計算
          const prevRecord = records[i + 1];
          const prevStartDate = prevRecord.startDate.toDate ? prevRecord.startDate.toDate() : new Date(prevRecord.startDate);
          const cycleDays = Math.floor((details.startDate - prevStartDate) / (1000 * 60 * 60 * 24));
          message += `• 前回からの周期: ${cycleDays}日\n`;
        }
        
        message += `\n`;
      }
    }
    
    // 統計情報（簡易版）
    if (records.length >= 2) {
      message += `📊 統計情報:\n`;
      
      // 平均周期計算
      let totalCycleDays = 0;
      let cycleCount = 0;
      
      for (let i = 0; i < records.length - 1; i++) {
        const currentStart = records[i].startDate.toDate ? records[i].startDate.toDate() : new Date(records[i].startDate);
        const prevStart = records[i + 1].startDate.toDate ? records[i + 1].startDate.toDate() : new Date(records[i + 1].startDate);
        const cycleDays = Math.floor((currentStart - prevStart) / (1000 * 60 * 60 * 24));
        
        if (cycleDays >= 21 && cycleDays <= 40) {
          totalCycleDays += cycleDays;
          cycleCount++;
        }
      }
      
      if (cycleCount > 0) {
        const avgCycle = Math.round(totalCycleDays / cycleCount);
        message += `• 平均周期: ${avgCycle}日\n`;
        message += `• 設定周期: ${settings.cycle}日\n`;
        
        const cycleDiff = Math.abs(avgCycle - settings.cycle);
        if (cycleDiff <= 2) {
          message += `• 🎯 周期設定は正確です\n`;
        } else {
          message += `• 📈 周期設定の見直しを検討してください\n`;
        }
      }
    }
    
    message += `\n💡 「設定確認」で周期・期間の調整ができます`;
    
    return message;

  } catch (error) {
    console.error('Error in showDetailedHistory:', error);
    return 'エラーが発生しました。再度お試しください。';
  }
}

module.exports = {
  showPeriodInfo,
  showOvulationInfo,
  showCurrentStatus,
  showDetailedHistory
};