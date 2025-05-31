// src/utils/dateUtils.js - 日付処理ユーティリティ（排卵日計算機能追加版・期間計算修正済み）

const { LIMITS } = require('../config/constants');

/**
 * 自然言語の日付入力を Date オブジェクトに変換
 * @param {string} userInput - ユーザーの入力文字列
 * @returns {Date|null} - 解析された日付、解析できない場合は null
 */
function parseNaturalDate(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    return null;
  }

  const today = new Date();
  const input = userInput.toLowerCase().trim();
  
  try {
    // キャンセル
    if (input === 'キャンセル' || input === 'cancel') {
      return 'cancel';
    }
    
    // 今日
    if (input === '今日' || input === 'today') {
      return new Date(today);
    }
    
    // 昨日
    if (input === '昨日' || input === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return yesterday;
    }
    
    // 一昨日
    if (input === '一昨日' || input === 'おととい') {
      const dayBeforeYesterday = new Date(today);
      dayBeforeYesterday.setDate(today.getDate() - 2);
      return dayBeforeYesterday;
    }
    
    // 明日
    if (input === '明日' || input === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow;
    }
    
    // X日前のパターン
    const daysAgoMatch = input.match(/(\d+)日前/);
    if (daysAgoMatch) {
      const daysAgo = parseInt(daysAgoMatch[1]);
      if (daysAgo >= 1 && daysAgo <= LIMITS.DATE_HISTORY.MAX_DAYS_AGO) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() - daysAgo);
        return targetDate;
      }
    }
    
    // X日後のパターン
    const daysLaterMatch = input.match(/(\d+)日後/);
    if (daysLaterMatch) {
      const daysLater = parseInt(daysLaterMatch[1]);
      if (daysLater >= 1 && daysLater <= 365) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysLater);
        return targetDate;
      }
    }
    
    // X週間前のパターン
    const weeksAgoMatch = input.match(/(\d+)週間前/);
    if (weeksAgoMatch) {
      const weeksAgo = parseInt(weeksAgoMatch[1]);
      if (weeksAgo >= 1 && weeksAgo <= 52) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() - (weeksAgo * 7));
        return targetDate;
      }
    }
    
    // 先週の曜日（例：先週の火曜日）
    const lastWeekMatch = input.match(/先週の?(月|火|水|木|金|土|日)曜?日?/);
    if (lastWeekMatch) {
      const dayName = lastWeekMatch[1];
      const targetDayOfWeek = getDayOfWeekNumber(dayName);
      if (targetDayOfWeek !== -1) {
        const currentDayOfWeek = today.getDay();
        const daysBack = 7 + (currentDayOfWeek - targetDayOfWeek);
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() - daysBack);
        return targetDate;
      }
    }
    
    // 今週の曜日（例：今週の火曜日）
    const thisWeekMatch = input.match(/今週の?(月|火|水|木|金|土|日)曜?日?/);
    if (thisWeekMatch) {
      const dayName = thisWeekMatch[1];
      const targetDayOfWeek = getDayOfWeekNumber(dayName);
      if (targetDayOfWeek !== -1) {
        const currentDayOfWeek = today.getDay();
        const daysDiff = targetDayOfWeek - currentDayOfWeek;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysDiff);
        return targetDate;
      }
    }
    
    // MM/DD形式（今年）
    const mmddMatch = input.match(/(\d{1,2})\/(\d{1,2})/);
    if (mmddMatch) {
      const month = parseInt(mmddMatch[1]);
      const day = parseInt(mmddMatch[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const targetDate = new Date(today.getFullYear(), month - 1, day);
        // 妥当な日付かチェック
        if (targetDate.getMonth() === month - 1 && targetDate.getDate() === day) {
          return targetDate;
        }
      }
    }
    
    // YYYY-MM-DD形式
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const date = new Date(input + 'T00:00:00');
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing natural date:', error);
    return null;
  }
}

/**
 * 曜日名から数値に変換（日曜日=0）
 * @param {string} dayName - 曜日名（月、火、水...）
 * @returns {number} - 曜日の数値、無効な場合は -1
 */
function getDayOfWeekNumber(dayName) {
  const days = {
    '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6
  };
  return days[dayName] !== undefined ? days[dayName] : -1;
}

/**
 * 日付の妥当性をチェック
 * @param {Date} date - チェックする日付
 * @returns {Object} - {isValid: boolean, error: string|null}
 */
function validateDate(date) {
  if (!date || isNaN(date.getTime())) {
    return { isValid: false, error: 'INVALID_DATE' };
  }

  const today = new Date();
  
  // 未来日チェック
  if (date > today) {
    return { isValid: false, error: 'FUTURE_DATE' };
  }
  
  // 過去すぎる日付チェック
  const maxDaysAgo = new Date();
  maxDaysAgo.setDate(today.getDate() - LIMITS.DATE_HISTORY.MAX_DAYS_AGO);
  if (date < maxDaysAgo) {
    return { isValid: false, error: 'OLD_DATE' };
  }
  
  return { isValid: true, error: null };
}

/**
 * 日付を YYYY-MM-DD 形式でフォーマット
 * @param {Date} date - フォーマットする日付
 * @returns {string} - フォーマットされた日付文字列
 */
function formatDate(date) {
  if (!date || isNaN(date.getTime())) {
    return '日付不明';
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 日付を日本語形式でフォーマット
 * @param {Date} date - フォーマットする日付
 * @returns {string} - 日本語形式の日付文字列
 */
function formatDateJapanese(date) {
  if (!date || isNaN(date.getTime())) {
    return '日付不明';
  }
  
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * 入力確認テキストを生成
 * @param {string} userInput - ユーザーの元入力
 * @param {string} formattedDate - フォーマット済み日付
 * @returns {string} - 確認テキスト
 */
function getInputConfirmationText(userInput, formattedDate) {
  const input = userInput.toLowerCase().trim();
  
  if (input === '今日') return `「今日」→ ${formattedDate}で登録しました`;
  if (input === '昨日') return `「昨日」→ ${formattedDate}で登録しました`;
  if (input === '一昨日' || input === 'おととい') return `「一昨日」→ ${formattedDate}で登録しました`;
  
  const daysAgoMatch = input.match(/(\d+)日前/);
  if (daysAgoMatch) return `「${daysAgoMatch[1]}日前」→ ${formattedDate}で登録しました`;
  
  const weekDayMatch = input.match(/(先週|今週)の?(月|火|水|木|金|土|日)曜?日?/);
  if (weekDayMatch) return `「${weekDayMatch[0]}」→ ${formattedDate}で登録しました`;
  
  if (/\d{1,2}\/\d{1,2}/.test(input)) return `「${userInput}」→ ${formattedDate}で登録しました`;
  
  return `${formattedDate}で登録しました`;
}

/**
 * 🔧 修正版：予測日を計算（期間計算修正済み）
 * @param {Date} startDate - 開始日
 * @param {Object} settings - ユーザー設定 {cycle, period}
 * @returns {Object} - {endDate, nextStartDate}
 */
function calculatePredictedDates(startDate, settings) {
  if (!startDate || !settings) {
    throw new Error('Invalid parameters for date calculation');
  }
  
  // 🔧 重要修正：開始日を1日目として計算
  // 修正前： startDate + period日 = 期間+1日になってしまう
  // 修正後： startDate + (period-1)日 = 正しい期間
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + settings.period - 1);
  
  const nextStartDate = new Date(startDate);
  nextStartDate.setDate(startDate.getDate() + settings.cycle);
  
  console.log('🔧 calculatePredictedDates修正版:');
  console.log(`  開始日: ${startDate.toISOString().split('T')[0]} (1日目)`);
  console.log(`  期間: ${settings.period}日間`);
  console.log(`  終了日: ${endDate.toISOString().split('T')[0]} (${settings.period}日目)`);
  console.log(`  次回開始日: ${nextStartDate.toISOString().split('T')[0]}`);
  
  return {
    endDate,
    nextStartDate
  };
}

// ========== 🌸 新機能: 排卵日・周期情報計算 🌸 ==========

/**
 * 排卵日を計算
 * @param {Date} lastPeriodStart - 最終生理開始日
 * @param {number} cycle - 生理周期（日）
 * @returns {Object} - 排卵日情報
 */
function calculateOvulationDate(lastPeriodStart, cycle) {
  if (!lastPeriodStart || !cycle) {
    return null;
  }

  try {
    // 次回生理予定日を計算
    const nextPeriodDate = new Date(lastPeriodStart);
    nextPeriodDate.setDate(lastPeriodStart.getDate() + cycle);
    
    // 排卵日は次回生理の14日前
    const ovulationDate = new Date(nextPeriodDate);
    ovulationDate.setDate(nextPeriodDate.getDate() - 14);
    
    // 妊娠しやすい期間（排卵日前後5日間）
    const fertileStart = new Date(ovulationDate);
    fertileStart.setDate(ovulationDate.getDate() - 5);
    
    const fertileEnd = new Date(ovulationDate);
    fertileEnd.setDate(ovulationDate.getDate() + 1);
    
    return {
      ovulationDate,
      fertileStart,
      fertileEnd,
      nextPeriodDate
    };
  } catch (error) {
    console.error('Error calculating ovulation date:', error);
    return null;
  }
}

/**
 * 🔧 修正版：現在の周期段階を判定（期間判定修正済み）
 * @param {Date} lastPeriodStart - 最終生理開始日
 * @param {number} period - 生理期間（日）
 * @param {number} cycle - 生理周期（日）
 * @returns {Object} - 周期段階情報
 */
function getCurrentCyclePhase(lastPeriodStart, period, cycle) {
  if (!lastPeriodStart || !period || !cycle) {
    return null;
  }

  try {
    const today = new Date();
    const daysSinceStart = Math.floor((today - lastPeriodStart) / (1000 * 60 * 60 * 24));
    
    let phase, description, emoji;
    
    console.log('🔧 getCurrentCyclePhase修正版:');
    console.log(`  最終生理開始日: ${lastPeriodStart.toISOString().split('T')[0]}`);
    console.log(`  今日: ${today.toISOString().split('T')[0]}`);
    console.log(`  開始日からの日数: ${daysSinceStart}日目 (0=開始日)`);
    console.log(`  生理期間: ${period}日間`);
    
    if (daysSinceStart < 0) {
      phase = 'unknown';
      description = '不明';
      emoji = '❓';
    } else if (daysSinceStart < period) {
      // 🔧 修正：開始日を0日目として計算するため、period未満で生理中
      const currentDay = daysSinceStart + 1; // 表示用は1日目から
      phase = 'menstrual';
      description = `生理中 (${currentDay}日目)`;
      emoji = '🩸';
      console.log(`  → 生理中: ${currentDay}/${period}日目`);
    } else if (daysSinceStart < 13) {
      phase = 'follicular';
      description = '卵胞期';
      emoji = '🌱';
    } else if (daysSinceStart >= 13 && daysSinceStart <= 16) {
      phase = 'ovulation';
      description = '排卵期';
      emoji = '🥚';
    } else if (daysSinceStart < cycle) {
      phase = 'luteal';
      description = '黄体期';
      emoji = '🌸';
    } else {
      // 次の周期に入っている可能性
      phase = 'overdue';
      description = '生理予定日超過';
      emoji = '⏰';
    }
    
    return {
      phase,
      description,
      emoji,
      daysSinceStart,
      daysInPhase: daysSinceStart + 1
    };
  } catch (error) {
    console.error('Error calculating cycle phase:', error);
    return null;
  }
}

/**
 * 次回生理までの日数を計算
 * @param {Date} lastPeriodStart - 最終生理開始日
 * @param {number} cycle - 生理周期（日）
 * @returns {Object} - 次回生理情報
 */
function getDaysUntilNextPeriod(lastPeriodStart, cycle) {
  if (!lastPeriodStart || !cycle) {
    return null;
  }

  try {
    const today = new Date();
    const nextPeriodDate = new Date(lastPeriodStart);
    nextPeriodDate.setDate(lastPeriodStart.getDate() + cycle);
    
    const daysUntil = Math.ceil((nextPeriodDate - today) / (1000 * 60 * 60 * 24));
    
    return {
      nextPeriodDate,
      daysUntil,
      isOverdue: daysUntil < 0
    };
  } catch (error) {
    console.error('Error calculating days until next period:', error);
    return null;
  }
}

/**
 * 🔧 修正版：生理記録の詳細情報を生成（期間計算修正済み）
 * @param {Object} record - 生理記録データ
 * @param {Object} settings - ユーザー設定
 * @returns {Object} - 詳細情報
 */
function generatePeriodDetails(record, settings) {
  if (!record || !settings) {
    return null;
  }

  try {
    const startDate = record.startDate.toDate ? record.startDate.toDate() : new Date(record.startDate);
    const endDate = record.endDate ? 
      (record.endDate.toDate ? record.endDate.toDate() : new Date(record.endDate)) : 
      null;
    
    // 🔧 重要修正：実際の日数を正しく計算（開始日を1日目として）
    let actualDays = settings.period; // デフォルト値
    if (endDate) {
      actualDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    }
    
    console.log('🔧 generatePeriodDetails修正版:');
    console.log(`  開始日: ${startDate.toISOString().split('T')[0]}`);
    console.log(`  終了日: ${endDate ? endDate.toISOString().split('T')[0] : 'null'}`);
    console.log(`  実際の日数: ${actualDays}日間`);
    console.log(`  予想日数: ${settings.period}日間`);
    
    // 排卵日計算
    const ovulationInfo = calculateOvulationDate(startDate, settings.cycle);
    
    // 現在の周期段階
    const cyclePhase = getCurrentCyclePhase(startDate, settings.period, settings.cycle);
    
    // 次回予測日までの日数
    const nextPeriodInfo = getDaysUntilNextPeriod(startDate, settings.cycle);
    
    return {
      startDate,
      endDate,
      actualDays,
      predictedDays: settings.period,
      ovulationInfo,
      cyclePhase,
      nextPeriodInfo,
      accuracy: Math.abs(actualDays - settings.period) <= 1 ? 'high' : 'medium'
    };
  } catch (error) {
    console.error('Error generating period details:', error);
    return null;
  }
}

module.exports = {
  parseNaturalDate,
  getDayOfWeekNumber,
  validateDate,
  formatDate,
  formatDateJapanese,
  getInputConfirmationText,
  calculatePredictedDates,
  
  // 新機能: 排卵日・周期情報
  calculateOvulationDate,
  getCurrentCyclePhase,
  getDaysUntilNextPeriod,
  generatePeriodDetails
};