// functions/src/handlers/webHandler.js - デバッグ機能強化版

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getUserSettings, getUserRecords, userExists, updateUserSetting } = require('../utils/firestoreUtils');
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
 * 初期設定保存API (デバッグ強化版)
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
      
      const { token, settings } = req.body;
      console.log('Extracted token:', token ? 'Present' : 'Missing');
      console.log('Extracted settings:', JSON.stringify(settings, null, 2));
      
      // トークン検証
      const tokenData = verifyToken(token);
      if (!tokenData) {
        console.log('Token verification failed');
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      const { userId } = tokenData;
      console.log('User ID from token:', userId);
      
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
        userId: userId.substring(0, 8) + '...' // 部分的なIDのみ返す
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
 * ダッシュボードデータ取得API (デバッグ強化版)
 */
const getDashboardData = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== getDashboardData called ===');
    console.log('Method:', req.method);
    console.log('Query:', JSON.stringify(req.query, null, 2));
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        console.log('Handling CORS preflight');
        return res.status(200).send('');
      }
      
      const token = req.query.token;
      console.log('Token from query:', token ? 'Present' : 'Missing');
      
      // トークン検証
      const tokenData = verifyToken(token);
      if (!tokenData) {
        console.log('Token verification failed');
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      const { userId } = tokenData;
      console.log('Getting dashboard data for user:', userId);
      
      // ユーザー設定取得
      const settings = await getUserSettings(userId);
      console.log('User settings:', JSON.stringify(settings, null, 2));
      
      // 最新の記録取得
      const records = await getUserRecords(userId, 1);
      console.log('User records count:', records.length);
      
      if (records.length === 0) {
        console.log('No records found for user');
        return res.status(200).json({
          hasRecords: false,
          settings: settings
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
          endDate: lastRecord.endDate.toDate().toISOString()
        },
        currentPhase: cyclePhase,
        nextPeriod: nextPeriodInfo,
        ovulation: ovulationInfo
      };
      
      console.log('Dashboard data response prepared successfully');
      res.status(200).json(responseData);
      
    } catch (error) {
      console.error('Error in getDashboardData:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

/**
 * カレンダーデータ取得API (デバッグ強化版)
 */
const getCalendarData = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== getCalendarData called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      const token = req.query.token;
      
      // トークン検証
      const tokenData = verifyToken(token);
      if (!tokenData) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      const { userId } = tokenData;
      console.log('Getting calendar data for user:', userId);
      
      // ユーザー設定とすべての記録を取得
      const settings = await getUserSettings(userId);
      const records = await getUserRecords(userId, 12); // 最新12件
      
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
        endDate: record.endDate.toDate().toISOString(),
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
 * 設定更新API (デバッグ強化版)
 */
const updateWebSettings = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== updateWebSettings called ===');
    
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
      
      const { token, settings } = req.body;
      
      // トークン検証
      const tokenData = verifyToken(token);
      if (!tokenData) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      const { userId } = tokenData;
      console.log('Updating settings for user:', userId);
      
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

module.exports = {
  generateSecureToken,
  verifyToken,
  saveInitialSettings,
  getDashboardData,
  getCalendarData,
  updateWebSettings
};