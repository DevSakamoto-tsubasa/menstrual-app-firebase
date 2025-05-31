// functions/src/handlers/webHandler.js - LIFF対応パートナー機能完全版 (第1部)

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getUserSettings, getUserRecords, userExists, updateUserSetting, ensureUserExists } = require('../utils/firestoreUtils');
const { getCurrentCyclePhase, calculateOvulationDate, getDaysUntilNextPeriod } = require('../utils/dateUtils');
const { 
  getPartnerId,
  getPartnershipData 
} = require('./partnerHandler');

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
 * ユニークID生成
 */
function generateUniqueId() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${randomStr}`;
}

/**
 * パートナーシップID生成
 */
function generatePartnershipId(user1, user2) {
  const sortedUsers = [user1, user2].sort();
  return `${sortedUsers[0]}_${sortedUsers[1]}`;
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

  // functions/src/handlers/webHandler.js - LIFF対応パートナー機能完全版 (第2部)

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
            date_entry: '2007500037-vdpkmNwL',
            partner: '2007500037-XROaPWoj',
            partner_invite: '2007500037-PartnerInv'
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
 * パートナーデータ取得API
 */
const getPartnerData = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== getPartnerData called ===');
    
    try {
      // CORS設定
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      let userId;
      
      // 認証処理
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
      
      // ユーザーID検証
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      console.log('Getting partner data for user:', userId?.substring(0, 8) + '...');
      
      // パートナー情報取得
      const partnerId = await getPartnerId(userId);
      const partnershipData = await getPartnershipData(userId);
      
      if (!partnerId) {
        // パートナー未接続
        return res.status(200).json({
          hasPartner: false,
          message: 'No partner connected'
        });
      }
      
      // パートナー接続済み
      const connectionDate = partnershipData?.createdAt?.toDate()?.toLocaleDateString('ja-JP') || '不明';
      
      res.status(200).json({
        hasPartner: true,
        partnerId: partnerId.substring(0, 8) + '...',
        connectionDate: connectionDate,
        partnershipData: {
          status: partnershipData?.status || 'active',
          createdAt: partnershipData?.createdAt?.toDate()?.toISOString() || null,
          connectionMethod: partnershipData?.connectionMethod || 'unknown'
        }
      });
      
    } catch (error) {
      console.error('Error in getPartnerData:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // functions/src/handlers/webHandler.js - LIFF対応パートナー機能完全版 (第3部)

/**
 * パートナー招待リンク生成API
 */
const generatePartnerInvite = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== generatePartnerInvite called ===');
    console.log('Method:', req.method);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      
      let userId;
      const { userId: requestUserId, token } = req.body;
      
      // 認証処理
      if (requestUserId) {
        userId = requestUserId;
        console.log('Using direct userId from request');
      } else if (token) {
        const tokenData = verifyToken(token);
        if (!tokenData) {
          return res.status(401).json({ error: 'Invalid token' });
        }
        userId = tokenData.userId;
        console.log('Using userId from token');
      } else {
        return res.status(400).json({ error: 'Authentication required' });
      }
      
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }
      
      console.log(`Generating partner invite for user: ${userId.substring(0, 8)}...`);
      
      // ユーザー存在確認
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // 既存パートナーチェック
      const { getPartnerId } = require('./partnerHandler');
      const existingPartnerId = await getPartnerId(userId);
      if (existingPartnerId) {
        console.log(`User already has partner: ${existingPartnerId.substring(0, 8)}...`);
        return res.status(400).json({ 
          error: 'Partner already exists',
          partnerId: existingPartnerId.substring(0, 8) + '...'
        });
      }
      
      // 招待データ生成
      const inviteId = generateUniqueId();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24時間後
      
      console.log(`Generated invite ID: ${inviteId}`);
      
      // 招待者の表示名取得（オプション）
      let inviterName = 'パートナー';
      try {
        const userDoc = await admin.firestore().collection('users').doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          inviterName = userData.displayName || userData.name || 'パートナー';
        }
      } catch (nameError) {
        console.log('Could not get inviter name:', nameError.message);
      }
      
      const inviteData = {
        inviteId: inviteId,
        inviterUserId: userId,
        inviterName: inviterName,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        type: 'liff_partner_invite'
      };
      
      // Firestoreに保存
      await admin.firestore().collection('partnerInvites').doc(inviteId).set(inviteData);
      console.log(`Partner invite saved to Firestore: ${inviteId}`);
      
      // LIFF招待URL生成
      const PARTNER_LIFF_ID = '2007500037-XROaPWoj'; // パートナー管理用LIFF ID
      const inviteUrl = `https://liff.line.me/${PARTNER_LIFF_ID}?mode=invite&inviteId=${inviteId}`;
      
      // LINE共有用URL生成
      const shareText = encodeURIComponent(`🌸 生理日共有アプリのパートナー招待\n\n💕 一緒に健康管理をしませんか？\n下のリンクをタップして承認してください！\n\n有効期限: 24時間`);
      const lineShareUrl = `https://line.me/R/msg/text/?${shareText}%0A%0A${encodeURIComponent(inviteUrl)}`;
      
      console.log(`Partner invite generated successfully:`);
      console.log(`  Invite ID: ${inviteId}`);
      console.log(`  Invite URL: ${inviteUrl}`);
      console.log(`  Expires at: ${expiresAt.toISOString()}`);
      
      res.status(200).json({
        success: true,
        inviteId: inviteId,
        inviteUrl: inviteUrl,
        lineShareUrl: lineShareUrl,
        expiresAt: expiresAt.toISOString()
      });
      
    } catch (error) {
      console.error('Error in generatePartnerInvite:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

/**
 * 招待情報取得API（承認画面用）
 */
const getPartnerInviteInfo = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    try {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      const { inviteId } = req.query;
      
      if (!inviteId) {
        return res.status(400).json({ error: 'Invite ID required' });
      }
      
      // 招待データ取得
      const inviteDoc = await admin.firestore().collection('partnerInvites').doc(inviteId).get();
      
      if (!inviteDoc.exists) {
        return res.status(404).json({ error: 'Invite not found' });
      }
      
      const inviteData = inviteDoc.data();
      
      // 有効期限チェック
      const now = new Date();
      const expiresAt = inviteData.expiresAt.toDate();
      
      if (now > expiresAt || inviteData.status !== 'pending') {
        return res.status(400).json({ 
          error: 'Invite expired or already used',
          status: inviteData.status 
        });
      }
      
      // 招待者情報取得（表示用）
      const inviterInfo = await getUserSettings(inviteData.inviterUserId);
      
      res.status(200).json({
        success: true,
        inviteData: {
          inviteId: inviteId,
          inviterUserId: inviteData.inviterUserId.substring(0, 8) + '...',
          inviterName: inviterInfo?.displayName || 'パートナー',
          createdAt: inviteData.createdAt.toDate().toISOString(),
          expiresAt: inviteData.expiresAt.toDate().toISOString(),
          status: inviteData.status
        }
      });
      
    } catch (error) {
      console.error('Error in getPartnerInviteInfo:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

/**
 * パートナー招待承認API
 */
const acceptPartnerInvite = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    try {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.status(200).send('');
      }
      
      const { inviteId, userId } = req.body;
      
      if (!inviteId || !userId) {
        return res.status(400).json({ error: 'Invite ID and User ID required' });
      }
      
      // ユーザー検証・作成
      const isValid = await validateAndEnsureUser(userId);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // 既存パートナーチェック
      const existingPartnerId = await getPartnerId(userId);
      if (existingPartnerId) {
        return res.status(400).json({ 
          error: 'User already has partner',
          partnerId: existingPartnerId 
        });
      }
      
      // 招待データ取得・検証
      const inviteDoc = await admin.firestore().collection('partnerInvites').doc(inviteId).get();
      
      if (!inviteDoc.exists) {
        return res.status(404).json({ error: 'Invite not found' });
      }
      
      const inviteData = inviteDoc.data();
      
      // 自分の招待でないかチェック
      if (inviteData.inviterUserId === userId) {
        return res.status(400).json({ error: 'Cannot accept own invite' });
      }
      
      // 有効期限・ステータスチェック
      const now = new Date();
      const expiresAt = inviteData.expiresAt.toDate();
      
      if (now > expiresAt) {
        await admin.firestore().collection('partnerInvites').doc(inviteId).update({
          status: 'expired',
          expiredAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.status(400).json({ error: 'Invite expired' });
      }
      
      if (inviteData.status !== 'pending') {
        return res.status(400).json({ 
          error: 'Invite already processed',
          status: inviteData.status 
        });
      }
      
      // パートナーシップ作成
      const inviterUserId = inviteData.inviterUserId;
      const partnershipId = generatePartnershipId(inviterUserId, userId);
      
      const partnershipData = {
        user1: inviterUserId,
        user2: userId,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        inviteId: inviteId,
        invitedBy: inviterUserId,
        connectionMethod: 'liff_invite'
      };
      
      // トランザクション実行
      await admin.firestore().runTransaction(async (transaction) => {
        // パートナーシップ作成
        transaction.set(
          admin.firestore().collection('partners').doc(partnershipId), 
          partnershipData
        );
        
        // 招待ステータス更新
        transaction.update(
          admin.firestore().collection('partnerInvites').doc(inviteId),
          {
            status: 'accepted',
            acceptedBy: userId,
            acceptedAt: admin.firestore.FieldValue.serverTimestamp()
          }
        );
        
        // ユーザー最終活動日更新
        transaction.update(
          admin.firestore().collection('users').doc(userId),
          {
            lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
            partnerConnectedAt: admin.firestore.FieldValue.serverTimestamp()
          }
        );
        
        transaction.update(
          admin.firestore().collection('users').doc(inviterUserId),
          {
            partnerConnectedAt: admin.firestore.FieldValue.serverTimestamp()
          }
        );
      });
      
      console.log(`Partner connection established: ${inviterUserId} ↔ ${userId}`);
      
      // 招待者に通知送信
      await notifyInviterAcceptance(inviterUserId, userId);
      
      res.status(200).json({
        success: true,
        message: 'Partner connection established',
        partnershipId: partnershipId,
        partnerId: inviterUserId.substring(0, 8) + '...'
      });
      
    } catch (error) {
      console.error('Error in acceptPartnerInvite:', error);
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
        'date_entry': '2007500037-vdpkmNwL',
        'partner': '2007500037-XROaPWoj',
        'partner_invite': '2007500037-PartnerInv'
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
 * 生理記録保存API (開始日入力画面用・パートナー通知対応)
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
      
      // パートナー通知処理
      try {
        await sendPartnerPeriodNotification(userId, start, end, duration);
      } catch (notificationError) {
        console.error('Partner notification error:', notificationError);
        // 通知エラーは記録保存の成功に影響しない
      }
      
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

/**
 * 招待承認通知
 */
async function notifyInviterAcceptance(inviterUserId, accepterUserId) {
  try {
    // LINE Bot クライアントが必要
    const line = require('@line/bot-sdk');
    const functions = require('firebase-functions');
    
    const config = {
      channelAccessToken: functions.config().line.channel_access_token,
      channelSecret: functions.config().line.channel_secret,
    };
    
    const client = new line.Client(config);
    
    const message = `💕 パートナー招待が承認されました！

🎉 パートナーシップが成立しました
👫 新しいパートナー: ${accepterUserId.substring(0, 8)}...

✨ 今後の機能:
• 生理開始日の自動通知
• 健康状態の共有
• お互いのサポート

これからデータを共有して、お互いをサポートしましょう ❤️`;

    await client.pushMessage(inviterUserId, {
      type: 'text',
      text: message
    });
    
    console.log(`Invite acceptance notification sent to: ${inviterUserId}`);
    
  } catch (error) {
    console.error('Error sending invite acceptance notification:', error);
  }
}

/**
 * パートナーへの生理開始通知（savePeriodRecord用）
 */
async function sendPartnerPeriodNotification(userId, startDate, endDate, duration) {
  try {
    console.log(`[NOTIFICATION] Starting partner notification for user: ${userId}`);
    
    const partnerId = await getPartnerId(userId);
    
    if (!partnerId) {
      console.log('[NOTIFICATION] No partner found');
      return;
    }
    
    const partnerSettings = await getUserSettings(partnerId);
    
    if (!partnerSettings || !partnerSettings.notifications) {
      console.log('[NOTIFICATION] Partner notifications disabled');
      return;
    }

    // ユーザー設定から次回予測日を計算
    const userSettings = await getUserSettings(userId);
    if (!userSettings) {
      console.log('[NOTIFICATION] User settings not found');
      return;
    }

    const nextStartDate = new Date(startDate);
    nextStartDate.setDate(nextStartDate.getDate() + userSettings.cycle);

    const endDateStr = endDate ? 
      endDate.toLocaleDateString('ja-JP') : 
      `約${duration || userSettings.period}日間`;
    
    const notificationText = `💕 パートナーからの通知

🩸 生理が始まりました

📅 開始日: ${startDate.toLocaleDateString('ja-JP')}
📅 予測終了: ${endDateStr}  
📅 次回予測: ${nextStartDate.toLocaleDateString('ja-JP')}

いつもありがとう ❤️
お互いを大切にしながら過ごしましょう。`;

    // LINE Bot クライアント設定
    const line = require('@line/bot-sdk');
    const functions = require('firebase-functions');
    
    const config = {
      channelAccessToken: functions.config().line.channel_access_token,
      channelSecret: functions.config().line.channel_secret,
    };
    
    const client = new line.Client(config);

    await client.pushMessage(partnerId, {
      type: 'text',
      text: notificationText
    });
    
    console.log(`[NOTIFICATION] Sent successfully to: ${partnerId}`);

  } catch (error) {
    console.error('[NOTIFICATION] Error:', error);
    throw error; // 通知エラーを上位に伝播
  }
}

module.exports = {
  // 既存のエクスポート
  generateSecureToken,
  verifyToken,
  saveInitialSettings,
  getDashboardData,
  getCalendarData,
  updateWebSettings,
  savePeriodRecord,
  
  // 新規追加: LIFF & パートナー機能
  verifyLiffToken,
  getPartnerData,
  generatePartnerInvite,
  getPartnerInviteInfo,
  acceptPartnerInvite
};