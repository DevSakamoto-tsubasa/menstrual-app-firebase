// functions/src/handlers/webHandler.js - 最新版（新LIFF ID対応）

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getUserSettings, getUserRecords, userExists, updateUserSetting, ensureUserExists } = require('../utils/firestoreUtils');
const { getCurrentCyclePhase, calculateOvulationDate, getDaysUntilNextPeriod } = require('../utils/dateUtils');

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
    console.log('Method:', req.method);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        console.log('Handling CORS preflight');
        return res.status(200).send('');
      }
      
      if (req.method !== 'POST') {
        console.log('Invalid method:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
      }
      
      // リクエストボディの確認
      if (!req.body) {
        console.log('Request body is empty');
        return res.status(400).json({ error: 'Request body is required' });
      }
      
      let userId;
      const { token, userId: requestUserId, settings } = req.body;
      
      // 🔧 LIFF + トークン両対応認証
      if (requestUserId) {
        // LIFF経由のアクセス
        userId = requestUserId;
        console.log('LIFF access - User ID:', userId?.substring(0, 8) + '...');
        
        // ユーザーID検証
        const isValid = await validateAndEnsureUser(userId);
        if (!isValid) {
          console.log('Invalid user ID from LIFF');
          return res.status(400).json({ error: 'Invalid user ID' });
        }
      } else if (token) {
        // トークン経由のアクセス
        console.log('Token access - Token:', token ? 'Present' : 'Missing');
        const tokenData = verifyToken(token);
        if (!tokenData) {
          console.log('Token verification failed');
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        userId = tokenData.userId;
        console.log('Token access - User ID:', userId?.substring(0, 8) + '...');
      } else {
        console.log('Neither userId nor token provided');
        return res.status(400).json({ error: 'User ID or token required' });
      }
      
      console.log('Authenticated user ID:', userId);
      
      // 設定バリデーション
      if (!settings) {
        console.log('Settings object is missing');
        return res.status(400).json({ error: 'Settings are required' });
      }
      
      const { cycle, period, notifications } = settings;
      console.log('Settings validation:', { cycle, period, notifications });
      
      if (!cycle || !period) {
        console.log('Cycle or period is missing');
        return res.status(400).json({ error: 'Cycle and period are required' });
      }
      
      const cycleNum = parseInt(cycle);
      const periodNum = parseInt(period);
      
      if (isNaN(cycleNum) || isNaN(periodNum)) {
        console.log('Cycle or period is not a number');
        return res.status(400).json({ error: 'Cycle and period must be numbers' });
      }
      
      if (cycleNum < 21 || cycleNum > 35 || periodNum < 3 || periodNum > 7) {
        console.log('Cycle or period out of range:', { cycleNum, periodNum });
        return res.status(400).json({ error: 'Invalid cycle or period range' });
      }
      
      // Firestoreに保存
      console.log('Saving to Firestore...');
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
      
      console.log('User data to save:', JSON.stringify(userData, null, 2));
      
      await userRef.set(userData, { merge: true });
      
      console.log(`Initial settings saved successfully for user: ${userId}`);
      res.status(200).json({ 
        success: true,
        message: 'Settings saved successfully',
        userId: userId.substring(0, 8) + '...'
      });
      
    } catch (error) {
      console.error('Error in saveInitialSettings:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

/**
 * ダッシュボードデータ取得API (LIFF + トークン両対応・デバッグ強化版)
 */
const getDashboardData = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== getDashboardData called ===');
    console.log('Method:', req.method);
    console.log('Query:', JSON.stringify(req.query, null, 2));
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    try {
      // CORS設定 - より包括的に
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.set('Access-Control-Max-Age', '86400');
      
      if (req.method === 'OPTIONS') {
        console.log('Handling CORS preflight');
        return res.status(200).send('');
      }
      
      let userId;
      
      // 🔧 LIFF + トークン + GET/POST両対応
      if (req.method === 'GET') {
        // GET リクエスト (クエリパラメータから取得)
        if (req.query.userId) {
          // LIFF経由のアクセス
          userId = req.query.userId;
          console.log('GET LIFF access - User ID:', userId?.substring(0, 8) + '...');
        } else if (req.query.token) {
          // トークン経由のアクセス
          const tokenData = verifyToken(req.query.token);
          if (!tokenData) {
            console.log('GET Token verification failed');
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
          console.log('GET Token access - User ID:', userId?.substring(0, 8) + '...');
        }
      } else if (req.method === 'POST') {
        // POST リクエスト (リクエストボディから取得)
        const { userId: requestUserId, token } = req.body || {};
        if (requestUserId) {
          userId = requestUserId;
          console.log('POST LIFF access - User ID:', userId?.substring(0, 8) + '...');
        } else if (token) {
          const tokenData = verifyToken(token);
          if (!tokenData) {
            console.log('POST Token verification failed');
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
          console.log('POST Token access - User ID:', userId?.substring(0, 8) + '...');
        }
      }
      
      if (!userId) {
        console.log('No authentication method provided');
        return res.status(400).json({ 
          error: 'Authentication required',
          message: 'User ID or token required',
          receivedQuery: req.query,
          receivedBody: req.body
        });
      }
      
      // ユーザーID検証
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        console.log('Invalid user ID');
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      console.log('Getting dashboard data for user:', userId?.substring(0, 8) + '...');
      
      // ユーザー設定取得
      const settings = await getUserSettings(userId);
      console.log('User settings:', JSON.stringify(settings, null, 2));
      
      if (!settings) {
        console.log('User settings not found');
        return res.status(404).json({ 
          error: 'User not found',
          message: 'Please complete initial setup first'
        });
      }
      
      // 最新の記録取得
      const records = await getUserRecords(userId, 1);
      console.log('User records count:', records.length);
      
      if (records.length === 0) {
        console.log('No records found for user');
        return res.status(200).json({
          hasRecords: false,
          settings: settings,
          message: 'No menstrual records found'
        });
      }
      
      const lastRecord = records[0];
      const lastPeriodStart = lastRecord.startDate.toDate();
      console.log('Last period start:', lastPeriodStart.toISOString());
      
      // 現在の周期段階を計算
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
        ovulation: ovulationInfo,
        debug: {
          userId: userId.substring(0, 8) + '...',
          recordsCount: records.length,
          settingsValid: !!settings,
          timestamp: new Date().toISOString(),
          liffMapping: {
            dashboard: '2007500037-w97Oo2kv',
            setup: '2007500037-Vw4nPLEq',
            calendar: '2007500037-Yb3edQ5o',
            date_entry: '2007500037-vdpkmNwL'
          }
        }
      };
      
      console.log('Dashboard data response prepared successfully');
      console.log('Response data keys:', Object.keys(responseData));
      res.status(200).json(responseData);
      
    } catch (error) {
      console.error('Error in getDashboardData:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString(),
        debug: {
          method: req.method,
          query: req.query,
          body: req.body
        }
      });
    }
  });

/**
 * カレンダーデータ取得API (LIFF + トークン両対応版)
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
      
      // 🔧 GET/POST両対応
      if (req.method === 'GET') {
        if (req.query.userId) {
          userId = req.query.userId;
          console.log('GET LIFF access - User ID:', userId?.substring(0, 8) + '...');
        } else if (req.query.token) {
          const tokenData = verifyToken(req.query.token);
          if (!tokenData) {
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
          console.log('GET Token access - User ID:', userId?.substring(0, 8) + '...');
        }
      } else if (req.method === 'POST') {
        const { userId: requestUserId, token } = req.body || {};
        if (requestUserId) {
          userId = requestUserId;
          console.log('POST LIFF access - User ID:', userId?.substring(0, 8) + '...');
        } else if (token) {
          const tokenData = verifyToken(token);
          if (!tokenData) {
            return res.status(401).json({ error: 'Invalid or expired token' });
          }
          userId = tokenData.userId;
          console.log('POST Token access - User ID:', userId?.substring(0, 8) + '...');
        }
      }
      
      if (!userId) {
        return res.status(400).json({ error: 'User ID or token required' });
      }
      
      // ユーザーID検証
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      console.log('Getting calendar data for user:', userId?.substring(0, 8) + '...');
      
      // ユーザー設定とすべての記録を取得
      const settings = await getUserSettings(userId);
      const records = await getUserRecords(userId, 12); // 最新12件
      
      if (!settings) {
        return res.status(404).json({ error: 'User not found' });
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
      const formattedRecords = records.map(record => ({
        startDate: record.startDate.toDate().toISOString(),
        endDate: record.endDate ? record.endDate.toDate().toISOString() : null,
        id: record.id
      }));
      
      // 最新記録から予測を計算
      const lastRecord = records[0];
      const lastPeriodStart = lastRecord.startDate.toDate();
      
      const nextPeriodInfo = getDaysUntilNextPeriod(lastPeriodStart, settings.cycle);
      const ovulationInfo = calculateOvulationDate(lastPeriodStart, settings.cycle);
      const cyclePhase = getCurrentCyclePhase(lastPeriodStart, settings.period, settings.cycle);
      
      // 次回生理期間を計算
      const nextPeriodStart = nextPeriodInfo.nextPeriodDate;
      const nextPeriodEnd = new Date(nextPeriodStart);
      nextPeriodEnd.setDate(nextPeriodStart.getDate() + settings.period - 1);
      
      const predictions = {
        nextPeriod: {
          startDate: nextPeriodStart.toISOString(),
          endDate: nextPeriodEnd.toISOString()
        },
        ovulation: ovulationInfo ? {
          date: ovulationInfo.ovulationDate.toISOString(),
          fertileStart: ovulationInfo.fertileStart.toISOString(),
          fertileEnd: ovulationInfo.fertileEnd.toISOString()
        } : null
      };
      
      res.status(200).json({
        hasRecords: true,
        settings: settings,
        records: formattedRecords,
        predictions: predictions,
        currentPhase: cyclePhase
      });
      
    } catch (error) {
      console.error('Error in getCalendarData:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

/**
 * 設定更新API (LIFF + トークン両対応版)
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
      
      // 🔧 LIFF + トークン両対応
      if (requestUserId) {
        userId = requestUserId;
        console.log('LIFF access - User ID:', userId?.substring(0, 8) + '...');
        
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
        console.log('Token access - User ID:', userId?.substring(0, 8) + '...');
      } else {
        return res.status(400).json({ error: 'User ID or token required' });
      }
      
      console.log('Updating settings for user:', userId?.substring(0, 8) + '...');
      
      // 設定更新
      for (const [key, value] of Object.entries(settings)) {
        console.log(`Updating ${key} to ${value}`);
        await updateUserSetting(userId, key, value);
      }
      
      console.log(`Settings updated successfully for user: ${userId}`);
      res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('Error in updateWebSettings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

/**
 * LIFF トークン検証・ユーザー情報取得 (複数LIFF ID対応)
 */
const verifyLiffToken = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== verifyLiffToken called ===');
    
    try {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      const { idToken, userId, liffId, page } = req.body;
      console.log('LIFF verification request:', { 
        userId: userId?.substring(0, 8) + '...', 
        hasIdToken: !!idToken,
        liffId: liffId,
        page: page
      });
      
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
 * 生理記録保存API (開始日入力画面用)
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
      
      // ユーザーID検証
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      console.log(`Saving period record for user: ${userId.substring(0, 8)}...`);
      console.log(`Period: ${startDate} to ${endDate} (${duration} days)`);
      
      // 日付バリデーション
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : null;
      const today = new Date();
      
      if (isNaN(start.getTime())) {
        return res.status(400).json({ error: 'Invalid start date format' });
      }
      
      if (start > today) {
        return res.status(400).json({ error: 'Start date cannot be in the future' });
      }
      
      // 3ヶ月以上前のチェック
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      if (start < threeMonthsAgo) {
        return res.status(400).json({ error: 'Start date cannot be more than 3 months ago' });
      }
      
      // Firestoreに記録保存
      const recordsRef = admin.firestore().collection('records');
      const recordData = {
        userId: userId,
        startDate: admin.firestore.Timestamp.fromDate(start),
        endDate: end ? admin.firestore.Timestamp.fromDate(end) : null,
        duration: duration || null,
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        type: 'menstrual'
      };
      
      const recordDoc = await recordsRef.add(recordData);
      console.log(`Period record saved with ID: ${recordDoc.id}`);
      
      // ユーザーの最終活動日更新
      const userRef = admin.firestore().collection('users').doc(userId);
      await userRef.update({
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRecordAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      res.status(200).json({
        success: true,
        recordId: recordDoc.id,
        message: 'Period record saved successfully'
      });
      
    } catch (error) {
      console.error('Error in savePeriodRecord:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  });

module.exports = {
  generateSecureToken,
  verifyToken,
  saveInitialSettings,
  getDashboardData,
  getCalendarData,
  updateWebSettings,
  verifyLiffToken,
  savePeriodRecord
};