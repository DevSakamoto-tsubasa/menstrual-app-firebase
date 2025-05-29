// src/utils/firestoreUtils.js - Firestore操作ユーティリティ

const admin = require('firebase-admin');
const { COLLECTIONS, DOCUMENTS, DEFAULT_SETTINGS, RECORD_STATUS } = require('../config/constants');

const db = admin.firestore();

/**
 * ユーザーの存在確認・作成
 * @param {string} userId - LINE ユーザーID
 */
async function ensureUserExists(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      const userData = {
        userId: userId,
        registeredAt: admin.firestore.FieldValue.serverTimestamp(),
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
        settings: {
          cycle: DEFAULT_SETTINGS.CYCLE,
          period: DEFAULT_SETTINGS.PERIOD,
          notifications: DEFAULT_SETTINGS.NOTIFICATIONS,
          timezone: DEFAULT_SETTINGS.TIMEZONE
        }
      };
      
      await userRef.set(userData);
      console.log(`New user created: ${userId}`);
    } else {
      // 最終アクティブ時刻を更新
      await userRef.update({
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    console.error('Error in ensureUserExists:', error);
    throw error;
  }
}

/**
 * ユーザー設定を取得
 * @param {string} userId - LINE ユーザーID
 * @returns {Object} - ユーザー設定
 */
async function getUserSettings(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    
    if (!userDoc.exists) {
      // デフォルト設定を返す
      return {
        cycle: DEFAULT_SETTINGS.CYCLE,
        period: DEFAULT_SETTINGS.PERIOD,
        notifications: DEFAULT_SETTINGS.NOTIFICATIONS
      };
    }
    
    const userData = userDoc.data();
    return userData.settings || {
      cycle: DEFAULT_SETTINGS.CYCLE,
      period: DEFAULT_SETTINGS.PERIOD,
      notifications: DEFAULT_SETTINGS.NOTIFICATIONS
    };
  } catch (error) {
    console.error('Error getting user settings:', error);
    // エラー時はデフォルト設定を返す
    return {
      cycle: DEFAULT_SETTINGS.CYCLE,
      period: DEFAULT_SETTINGS.PERIOD,
      notifications: DEFAULT_SETTINGS.NOTIFICATIONS
    };
  }
}

/**
 * ユーザー設定を更新
 * @param {string} userId - LINE ユーザーID
 * @param {string} settingKey - 設定キー (cycle, period, notifications)
 * @param {any} value - 設定値
 */
async function updateUserSetting(userId, settingKey, value) {
  try {
    if (!userId || !settingKey) {
      throw new Error('userId and settingKey are required');
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    const updateData = {};
    updateData[`settings.${settingKey}`] = value;
    updateData['updatedAt'] = admin.firestore.FieldValue.serverTimestamp();
    
    await userRef.update(updateData);
    console.log(`Updated ${settingKey} to ${value} for user ${userId}`);
  } catch (error) {
    console.error('Error updating user setting:', error);
    throw error;
  }
}

/**
 * 生理記録を保存
 * @param {string} userId - LINE ユーザーID
 * @param {Object} recordData - 記録データ
 */
async function saveRecord(userId, recordData) {
  try {
    if (!userId || !recordData) {
      throw new Error('userId and recordData are required');
    }

    const record = {
      userId: userId,
      ...recordData,
      status: RECORD_STATUS.ACTIVE,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const recordRef = await db.collection(COLLECTIONS.USERS)
      .doc(userId)
      .collection(COLLECTIONS.RECORDS)
      .add(record);

    console.log(`Record saved with ID: ${recordRef.id}`);
    return recordRef.id;
  } catch (error) {
    console.error('Error saving record:', error);
    throw error;
  }
}

/**
 * ユーザーの記録を取得
 * @param {string} userId - LINE ユーザーID
 * @param {number} limit - 取得件数制限
 * @returns {Array} - 記録の配列
 */
async function getUserRecords(userId, limit = 5) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const snapshot = await db.collection(COLLECTIONS.USERS)
      .doc(userId)
      .collection(COLLECTIONS.RECORDS)
      .where('status', '==', RECORD_STATUS.ACTIVE)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const records = [];
    snapshot.forEach((doc) => {
      records.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return records;
  } catch (error) {
    console.error('Error getting user records:', error);
    throw error;
  }
}

/**
 * 入力フラグを設定
 * @param {string} userId - LINE ユーザーID
 * @param {Object} flagData - フラグデータ
 */
async function setInputFlag(userId, flagData) {
  try {
    if (!userId || !flagData) {
      throw new Error('userId and flagData are required');
    }

    const flagRef = db.collection(COLLECTIONS.USERS)
      .doc(userId)
      .collection(COLLECTIONS.TEMP)
      .doc(DOCUMENTS.INPUT_FLAG);

    const data = {
      ...flagData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await flagRef.set(data);
    console.log(`Input flag set for user ${userId}:`, flagData.type);
  } catch (error) {
    console.error('Error setting input flag:', error);
    throw error;
  }
}

/**
 * 入力フラグを取得
 * @param {string} userId - LINE ユーザーID
 * @returns {Object|null} - フラグデータまたは null
 */
async function getInputFlag(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const flagRef = db.collection(COLLECTIONS.USERS)
      .doc(userId)
      .collection(COLLECTIONS.TEMP)
      .doc(DOCUMENTS.INPUT_FLAG);
    
    const flagDoc = await flagRef.get();
    
    if (!flagDoc.exists) {
      return null;
    }
    
    return flagDoc.data();
  } catch (error) {
    console.error('Error getting input flag:', error);
    return null;
  }
}

/**
 * 入力フラグをクリア
 * @param {string} userId - LINE ユーザーID
 */
async function clearInputFlag(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    await db.collection(COLLECTIONS.USERS)
      .doc(userId)
      .collection(COLLECTIONS.TEMP)
      .doc(DOCUMENTS.INPUT_FLAG)
      .delete();
    
    console.log(`Input flag cleared for user ${userId}`);
  } catch (error) {
    console.error('Error clearing input flag:', error);
    // フラグのクリアエラーは致命的ではないので、スローしない
  }
}

/**
 * ユーザーが存在するかチェック
 * @param {string} userId - LINE ユーザーID
 * @returns {boolean} - 存在する場合 true
 */
async function userExists(userId) {
  try {
    if (!userId) {
      return false;
    }

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    return userDoc.exists;
  } catch (error) {
    console.error('Error checking user existence:', error);
    return false;
  }
}

/**
 * バッチ処理でFirestore操作を実行
 * @param {Array} operations - 操作の配列
 */
async function executeBatch(operations) {
  try {
    const batch = db.batch();
    
    operations.forEach(operation => {
      const { type, ref, data } = operation;
      
      switch (type) {
        case 'set':
          batch.set(ref, data);
          break;
        case 'update':
          batch.update(ref, data);
          break;
        case 'delete':
          batch.delete(ref);
          break;
        default:
          console.warn('Unknown batch operation type:', type);
      }
    });
    
    await batch.commit();
    console.log(`Batch executed with ${operations.length} operations`);
  } catch (error) {
    console.error('Error executing batch:', error);
    throw error;
  }
}

module.exports = {
  ensureUserExists,
  getUserSettings,
  updateUserSetting,
  saveRecord,
  getUserRecords,
  setInputFlag,
  getInputFlag,
  clearInputFlag,
  userExists,
  executeBatch,
  // Firestore インスタンスも公開（必要に応じて）
  db
};