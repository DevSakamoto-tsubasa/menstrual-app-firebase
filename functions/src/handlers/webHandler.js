// functions/src/handlers/webHandler.js - 完全版（シンタックスエラー解決済み）

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getUserSettings, getUserRecords, userExists, updateUserSetting, ensureUserExists } = require('../utils/firestoreUtils');
const { getCurrentCyclePhase, calculateOvulationDate, getDaysUntilNextPeriod } = require('../utils/dateUtils');

// 🌍 タイムゾーン対応版: 日付処理関数集（バックエンド用）
const TimezoneFixes = {
    /**
     * 日付文字列を日本時間の Date オブジェクトに安全に変換
     * @param {string} dateString - YYYY-MM-DD 形式の日付文字列
     * @returns {Date} - 日本時間の Date オブジェクト
     */
    parseJapanDate: function(dateString) {
        if (!dateString) return null;
        
        console.log(`🌍 [Backend] Parsing date: ${dateString}`);
        
        // YYYY-MM-DD 形式の場合、日本時間として解釈
        const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
        
        // 日本時間で正確に作成（月は0から始まる）
        // 正午で作成してタイムゾーンの影響を最小化
        const japanDate = new Date(year, month - 1, day, 12, 0, 0, 0);
        
        console.log(`✅ [Backend] Parsed to Japan date: ${japanDate.toLocaleDateString('ja-JP')}`);
        return japanDate;
    },

    /**
     * Date オブジェクトを日本時間の YYYY-MM-DD 形式に変換
     * @param {Date} date - Date オブジェクト
     * @returns {string} - YYYY-MM-DD 形式の文字列
     */
    formatJapanDate: function(date) {
        if (!date || isNaN(date.getTime())) {
            return '日付不明';
        }
        
        // 日本時間で年月日を取得
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        const formatted = `${year}-${month}-${day}`;
        console.log(`📅 [Backend] Formatted Japan date: ${formatted}`);
        return formatted;
    },

    /**
     * 日本時間の Date を Firestore Timestamp に変換
     * @param {Date} date - 日本時間の Date オブジェクト
     * @returns {admin.firestore.Timestamp} - Firestore Timestamp
     */
    japanDateToFirestore: function(date) {
        if (!date || isNaN(date.getTime())) return null;
        
        // 日本時間の正午として保存（タイムゾーンの影響を最小化）
        const noonJapan = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
        
        console.log(`🔥 [Backend] Converting to Firestore: ${this.formatJapanDate(noonJapan)}`);
        return admin.firestore.Timestamp.fromDate(noonJapan);
    },

    /**
     * Firestore Timestamp を日本時間の Date に変換
     * @param {admin.firestore.Timestamp} timestamp - Firestore Timestamp
     * @returns {Date} - 日本時間の Date オブジェクト
     */
    firestoreToJapanDate: function(timestamp) {
        if (!timestamp) return null;
        
        // Firestore Timestamp を Date に変換
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        
        // 日本時間として解釈（時間部分は無視）
        const japanDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        
        console.log(`🔥 [Backend] Converted from Firestore: ${this.formatJapanDate(japanDate)}`);
        return japanDate;
    },

    /**
     * 今日の日付を日本時間で取得
     * @returns {Date} - 今日の日付（日本時間）
     */
    getTodayJapan: function() {
        const now = new Date();
        
        // 日本時間で今日の日付を作成（時間は00:00:00）
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        
        console.log(`📅 [Backend] Today Japan: ${today.toLocaleDateString('ja-JP')}`);
        return today;
    },

    /**
     * 日付に日数を加算（日本時間ベース）
     * @param {Date} date - 元の日付
     * @param {number} days - 加算する日数
     * @returns {Date} - 加算後の日付
     */
    addDaysJapan: function(date, days) {
        if (!date || isNaN(date.getTime())) return null;
        
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        
        console.log(`📅 [Backend] Added ${days} days to ${this.formatJapanDate(date)} = ${this.formatJapanDate(result)}`);
        return result;
    },

    /**
     * 日付比較（日本時間ベース）
     * @param {Date} date1 - 比較する日付1
     * @param {Date} date2 - 比較する日付2
     * @returns {number} - -1, 0, 1 (date1 < date2, date1 == date2, date1 > date2)
     */
    compareDatesJapan: function(date1, date2) {
        if (!date1 || !date2) return 0;
        
        // 日付のみで比較（時間は無視）
        const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
        const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
        
        if (d1 < d2) return -1;
        if (d1 > d2) return 1;
        return 0;
    }
};

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
 * トークンの検証
 * @param {string} token - 検証するトークン
 * @returns {Object|null} - {userId: string, timestamp: number} または null
 */
function verifyToken(token) {
  try {
    if (!token) {
      console.log('Token is empty');
      return null;
    }
    
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, timestamp] = decoded.split(':');
    
    if (!userId || !timestamp) {
      console.log('Invalid token format');
      return null;
    }
    
    // 24時間以内のトークンかチェック
    const hoursDiff = (Date.now() - parseInt(timestamp)) / (1000 * 60 * 60);
    if (hoursDiff > 24) {
      console.log(`Token expired: ${hoursDiff} hours old`);
      return null;
    }
    
    console.log(`Token verified for user: ${userId.substring(0, 8)}...`);
    return { userId, timestamp: parseInt(timestamp) };
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

/**
 * ユーザーID検証とユーザー存在確認
 * @param {string} userId - 検証するユーザーID
 * @returns {Promise<boolean>} - 有効なユーザーIDかどうか
 */
async function validateAndEnsureUser(userId) {
  try {
    if (!userId || typeof userId !== 'string' || userId.length < 10) {
      console.log('Invalid userId format');
      return false;
    }
    
    // ユーザー存在確認・作成
    const exists = await userExists(userId);
    if (!exists) {
      console.log('User not found, creating new user');
      await ensureUserExists(userId);
    }
    
    console.log(`User validated: ${userId.substring(0, 8)}...`);
    return true;
  } catch (error) {
    console.error('User validation error:', error);
    return false;
  }
}

/**
 * 初期設定保存API (LIFF + トークン両対応版)
 */
const saveInitialSettings = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== saveInitialSettings called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      
      if (!req.body) {
        return res.status(400).json({ error: 'Request body is required' });
      }
      
      let userId;
      const { token, userId: requestUserId, settings } = req.body;
      
      // 🔧 LIFF + トークン両対応認証
      if (requestUserId) {
        userId = requestUserId;
        const isValid = await validateAndEnsureUser(userId);
        if (!isValid) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }
      } else if (token) {
        const tokenData = verifyToken(token);
        if (!tokenData) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        userId = tokenData.userId;
      } else {
        return res.status(400).json({ error: 'User ID or token required' });
      }
      
      // 設定バリデーション
      if (!settings) {
        return res.status(400).json({ error: 'Settings are required' });
      }
      
      const { cycle, period, notifications } = settings;
      
      if (!cycle || !period) {
        return res.status(400).json({ error: 'Cycle and period are required' });
      }
      
      const cycleNum = parseInt(cycle);
      const periodNum = parseInt(period);
      
      if (isNaN(cycleNum) || isNaN(periodNum)) {
        return res.status(400).json({ error: 'Cycle and period must be numbers' });
      }
      
      if (cycleNum < 21 || cycleNum > 35 || periodNum < 3 || periodNum > 7) {
        return res.status(400).json({ error: 'Invalid cycle or period range' });
      }
      
      // Firestoreに保存
      const userRef = admin.firestore().collection('users').doc(userId);
      
      const userData = {
        userId: userId,
        registeredAt: admin.firestore.FieldValue.serverTimestamp(),
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
        initialSetupCompleted: true,
        initialSetupAt: admin.firestore.FieldValue.serverTimestamp(),
        settings: {
          cycle: cycleNum,
          period: periodNum,
          notifications: notifications === true,
          timezone: 'Asia/Tokyo'
        }
      };
      
      await userRef.set(userData, { merge: true });
      
      res.status(200).json({ 
        success: true,
        message: 'Settings saved successfully',
        userId: userId.substring(0, 8) + '...'
      });
      
    } catch (error) {
      console.error('Error in saveInitialSettings:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

/**
 * ダッシュボードデータ取得API
 */
const getDashboardData = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== getDashboardData called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      let userId;
      
      // GET/POST両対応
      if (req.method === 'GET') {
        if (req.query.userId) {
          userId = req.query.userId;
        } else if (req.query.token) {
          const tokenData = verifyToken(req.query.token);
          if (!tokenData) {
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
        }
      } else if (req.method === 'POST') {
        const { userId: requestUserId, token } = req.body || {};
        if (requestUserId) {
          userId = requestUserId;
        } else if (token) {
          const tokenData = verifyToken(token);
          if (!tokenData) {
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
        }
      }
      
      if (!userId) {
        return res.status(400).json({ error: 'User ID or token required' });
      }
      
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // ユーザー設定と記録を取得
      const settings = await getUserSettings(userId);
      const records = await getUserRecords(userId, 3);
      
      if (!settings) {
        return res.status(404).json({ error: 'User settings not found' });
      }
      
      if (!settings.initialSetupCompleted) {
        return res.status(200).json({
          needsSetup: true,
          message: 'Initial setup required',
          setupUrl: '/setup/'
        });
      }
      
      if (records.length === 0) {
        return res.status(200).json({
          hasRecords: false,
          settings: settings,
          message: 'No period records found'
        });
      }
      
      // 最新記録から現在の状況を計算
      const lastRecord = records[0];
      const lastPeriodStart = lastRecord.startDate.toDate();
      
      const cyclePhase = getCurrentCyclePhase(lastPeriodStart, settings.period, settings.cycle);
      const nextPeriodInfo = getDaysUntilNextPeriod(lastPeriodStart, settings.cycle);
      const ovulationInfo = calculateOvulationDate(lastPeriodStart, settings.cycle);
      
      const responseData = {
        hasRecords: true,
        settings: settings,
        lastRecord: {
          startDate: lastRecord.startDate.toDate().toISOString(),
          endDate: lastRecord.endDate ? lastRecord.endDate.toDate().toISOString() : null
        },
        currentPhase: cyclePhase,
        nextPeriod: nextPeriodInfo,
        ovulation: ovulationInfo ? {
          date: ovulationInfo.ovulationDate.toISOString(),
          fertileStart: ovulationInfo.fertileStart.toISOString(),
          fertileEnd: ovulationInfo.fertileEnd.toISOString()
        } : null,
        debug: {
          userId: userId.substring(0, 8) + '...',
          recordsCount: records.length,
          timestamp: new Date().toISOString()
        }
      };
      
      res.status(200).json(responseData);
      
    } catch (error) {
      console.error('Error in getDashboardData:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

/**
 * カレンダーデータ取得API
 */
const getCalendarData = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== getCalendarData called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      let userId;
      
      // GET/POST両対応
      if (req.method === 'GET') {
        if (req.query.userId) {
          userId = req.query.userId;
        } else if (req.query.token) {
          const tokenData = verifyToken(req.query.token);
          if (!tokenData) {
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
        }
      } else if (req.method === 'POST') {
        const { userId: requestUserId, token } = req.body || {};
        if (requestUserId) {
          userId = requestUserId;
        } else if (token) {
          const tokenData = verifyToken(token);
          if (!tokenData) {
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
        }
      }
      
      if (!userId) {
        return res.status(400).json({ error: 'User ID or token required' });
      }
      
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // ユーザー設定と全記録を取得
      const settings = await getUserSettings(userId);
      
      const db = admin.firestore();
      const recordsRef = db.collection('users')
        .doc(userId)
        .collection('records')
        .where('status', '==', 'active')
        .orderBy('startDate', 'desc');
      
      const recordsSnapshot = await recordsRef.get();
      const records = recordsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      if (!settings) {
        return res.status(404).json({ error: 'User settings not found' });
      }
      
      if (records.length === 0) {
        return res.status(200).json({
          hasRecords: false,
          settings: settings,
          records: [],
          predictions: null
        });
      }
      
      // 記録データを整形
      const formattedRecords = records.map(record => {
        const startDate = TimezoneFixes.firestoreToJapanDate(record.startDate);
        const endDate = record.endDate ? TimezoneFixes.firestoreToJapanDate(record.endDate) : null;
        
        return {
          id: record.id,
          startDate: startDate ? startDate.toISOString() : null,
          endDate: endDate ? endDate.toISOString() : null,
          duration: record.duration || null,
          isActualRecord: true,
          timezone: 'Asia/Tokyo'
        };
      });
      
      // 最新記録から予測を計算
      const lastRecord = records[0];
      const lastPeriodStart = TimezoneFixes.firestoreToJapanDate(lastRecord.startDate);
      
      const nextPeriodInfo = getDaysUntilNextPeriod(lastPeriodStart, settings.cycle);
      const ovulationInfo = calculateOvulationDate(lastPeriodStart, settings.cycle);
      const cyclePhase = getCurrentCyclePhase(lastPeriodStart, settings.period, settings.cycle);
      
      const nextPeriodStart = nextPeriodInfo.nextPeriodDate;
      const nextPeriodEnd = TimezoneFixes.addDaysJapan(nextPeriodStart, settings.period - 1);
      
      // 複数月の予測を生成
      const futurePredictions = [];
      for (let cycleCount = 1; cycleCount <= 6; cycleCount++) {
        const predictedStart = TimezoneFixes.addDaysJapan(lastPeriodStart, settings.cycle * cycleCount);
        const predictedEnd = TimezoneFixes.addDaysJapan(predictedStart, settings.period - 1);
        const predictedOvulation = TimezoneFixes.addDaysJapan(predictedStart, -14);
        
        futurePredictions.push({
          cycle: cycleCount,
          period: {
            startDate: predictedStart.toISOString(),
            endDate: predictedEnd.toISOString(),
            isPrediction: true
          },
          ovulation: {
            date: predictedOvulation.toISOString(),
            isPrediction: true
          }
        });
      }
      
      const predictions = {
        nextPeriod: {
          startDate: nextPeriodStart.toISOString(),
          endDate: nextPeriodEnd.toISOString(),
          isPrediction: true
        },
        ovulation: ovulationInfo ? {
          date: ovulationInfo.ovulationDate.toISOString(),
          fertileStart: ovulationInfo.fertileStart.toISOString(),
          fertileEnd: ovulationInfo.fertileEnd.toISOString(),
          isPrediction: true
        } : null,
        futurePredictions: futurePredictions
      };
      
      const responseData = {
        hasRecords: true,
        settings: settings,
        records: formattedRecords,
        predictions: predictions,
        currentPhase: cyclePhase,
        metadata: {
          timestamp: new Date().toISOString(),
          totalRecords: records.length,
          timezone: 'Asia/Tokyo'
        }
      };
      
      res.status(200).json(responseData);
      
    } catch (error) {
      console.error('Error in getCalendarData:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

/**
 * 設定更新API
 */
const updateWebSettings = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== updateWebSettings called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      
      let userId;
      const { token, userId: requestUserId, settings } = req.body;
      
      if (requestUserId) {
        userId = requestUserId;
        const isValid = await validateAndEnsureUser(userId);
        if (!isValid) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }
      } else if (token) {
        const tokenData = verifyToken(token);
        if (!tokenData) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        userId = tokenData.userId;
      } else {
        return res.status(400).json({ error: 'User ID or token required' });
      }
      
      // 設定更新
      for (const [key, value] of Object.entries(settings)) {
        await updateUserSetting(userId, key, value);
      }
      
      res.status(200).json({
        success: true,
        message: 'Settings updated successfully'
      });
      
    } catch (error) {
      console.error('Error in updateWebSettings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

/**
 * 生理記録保存API
 */
const savePeriodRecord = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== savePeriodRecord called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      
      const { userId, startDate, endDate, duration } = req.body;
      
      if (!userId || !startDate) {
        return res.status(400).json({ error: 'User ID and start date are required' });
      }
      
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // 日付処理
      const startDateJapan = TimezoneFixes.parseJapanDate(startDate);
      const endDateJapan = endDate ? TimezoneFixes.parseJapanDate(endDate) : null;
      const todayJapan = TimezoneFixes.getTodayJapan();
      
      // 日付バリデーション
      if (!startDateJapan || isNaN(startDateJapan.getTime())) {
        return res.status(400).json({ error: 'Invalid start date format' });
      }
      
      if (TimezoneFixes.compareDatesJapan(startDateJapan, todayJapan) > 0) {
        return res.status(400).json({ error: 'Start date cannot be in the future' });
      }
      
      // Firestoreに保存
      const db = admin.firestore();
      const userRef = db.collection('users').doc(userId);
      const recordsRef = userRef.collection('records');
      
      const recordData = {
        userId: userId,
        startDate: TimezoneFixes.japanDateToFirestore(startDateJapan),
        endDate: endDateJapan ? TimezoneFixes.japanDateToFirestore(endDateJapan) : null,
        duration: duration || null,
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        type: 'menstrual',
        status: 'active',
        timezone: 'Asia/Tokyo'
      };
      
      const recordDoc = await recordsRef.add(recordData);
      
      // ユーザーの最終活動日更新
      await userRef.update({
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRecordAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      const responseData = {
        success: true,
        recordId: recordDoc.id,
        message: 'Period record saved successfully',
        savedData: {
          startDate: TimezoneFixes.formatJapanDate(startDateJapan),
          endDate: endDateJapan ? TimezoneFixes.formatJapanDate(endDateJapan) : null,
          duration: duration,
          timezone: 'Asia/Tokyo'
        }
      };
      
      res.status(200).json(responseData);
      
    } catch (error) {
      console.error('Error in savePeriodRecord:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

/**
 * LIFF認証検証API
 */
const verifyLiffToken = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== verifyLiffToken called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      const { idToken, liffId, page, userId } = req.method === 'GET' ? req.query : req.body;
      
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }
      
      // LIFF ID マッピング
      const LIFF_MAPPING = {
        'dashboard': '2007500037-w97Oo2kv',
        'setup': '2007500037-Vw4nPLEq', 
        'calendar': '2007500037-Yb3edQ5o',
        'date_entry': '2007500037-vdpkmNwL'
      };
      
      // ユーザー存在確認・作成
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // ユーザー設定取得
      const settings = await getUserSettings(userId);
      const needsSetup = !settings || !settings.initialSetupCompleted;
      
      console.log(`LIFF user verified: ${userId.substring(0, 8)}..., needsSetup: ${needsSetup}`);
      
      res.status(200).json({
        success: true,
        userId: userId,
        needsSetup: needsSetup,
        settings: settings || {},
        liffId: liffId,
        page: page,
        liffMapping: LIFF_MAPPING
      });
      
    } catch (error) {
      console.error('Error in verifyLiffToken:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  });

/**
 * バックエンドタイムゾーンテスト関数
 */
const testTimezoneBackend = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== testTimezoneBackend called ===');
    
    try {
      const testDate = '2024-07-01';
      const parsed = TimezoneFixes.parseJapanDate(testDate);
      const formatted = TimezoneFixes.formatJapanDate(parsed);
      const today = TimezoneFixes.getTodayJapan();
      const firestoreTimestamp = TimezoneFixes.japanDateToFirestore(parsed);
      const backToDate = TimezoneFixes.firestoreToJapanDate(firestoreTimestamp);
      
      const testResults = {
        input: testDate,
        parsed: {
          date: parsed,
          toString: parsed.toString(),
          toISOString: parsed.toISOString(),
          toLocaleDateString: parsed.toLocaleDateString('ja-JP')
        },
        formatted: formatted,
        today: {
          date: today,
          formatted: TimezoneFixes.formatJapanDate(today)
        },
        firestoreRoundTrip: {
          original: formatted,
          firestoreTimestamp: firestoreTimestamp,
          backToDate: TimezoneFixes.formatJapanDate(backToDate),
          isEqual: formatted === TimezoneFixes.formatJapanDate(backToDate)
        },
        timezone: {
          offset: new Date().getTimezoneOffset(),
          serverTime: new Date().toString()
        }
      };
      
      console.log('🧪 Backend Timezone Test Results:', testResults);
      
      res.status(200).json({
        success: true,
        message: 'Backend timezone test completed',
        results: testResults
      });
      
    } catch (error) {
      console.error('❌ Backend timezone test error:', error);
      res.status(500).json({
        error: 'Test failed',
        message: error.message
      });
    }
  });

// エクスポート
module.exports = {
  generateSecureToken,
  verifyToken,
  validateAndEnsureUser,
  saveInitialSettings,
  getDashboardData,
  getCalendarData,
  updateWebSettings,
  verifyLiffToken,
  savePeriodRecord,
  testTimezoneBackend,
  TimezoneFixes
};