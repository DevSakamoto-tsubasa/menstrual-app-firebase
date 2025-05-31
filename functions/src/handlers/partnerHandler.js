// src/handlers/partnerHandler.js - LIFF対応完全版

const admin = require('firebase-admin');
const { getUserSettings, db } = require('../utils/firestoreUtils');
const { COLLECTIONS, COMMANDS } = require('../config/constants');

/**
 * 招待コード生成（従来方式）
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function generateInviteCode(userId) {
  try {
    console.log(`Generating invite code for user: ${userId}`);
    
    // 既存のパートナー確認
    const existingPartnerId = await getPartnerId(userId);
    if (existingPartnerId) {
      return `⚠️ すでにパートナーが登録されています。

👫 現在のパートナー: ${existingPartnerId}

新しいパートナーを登録したい場合は、まず「パートナー解除」を実行してください。`;
    }
    
    // 既存の有効な招待コード確認
    const existingCode = await getValidInviteCode(userId);
    if (existingCode) {
      return `💕 既に有効な招待コードがあります！

🎫 招待コード: ${existingCode.code}

このコードを相手に共有してください。
相手の方は「招待コード ${existingCode.code}」と送信してください。

⏰ 有効期限: ${formatExpiryTime(existingCode.expiresAt)}
🔄 新しいコードが必要な場合は「パートナー解除」後に再生成してください。`;
    }
    
    // 新しい招待コード生成
    const inviteCode = await createUniqueInviteCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24時間後
    
    // 招待コードをFirestoreに保存
    const inviteData = {
      code: inviteCode,
      generatedBy: userId,
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      maxUses: 1,
      currentUses: 0
    };
    
    await db.collection(COLLECTIONS.INVITE_CODES).doc(inviteCode).set(inviteData);
    
    return `💕 招待コードを生成しました！

🎫 招待コード: ${inviteCode}

📋 使用方法:
1. このコードを相手に共有
2. 相手が「招待コード ${inviteCode}」と送信
3. パートナー登録が完了！

⏰ 有効期限: 24時間
🔄 新しいコードが必要な場合は「招待コード生成」を再度送信

コードをコピーして相手に送ってください 📱`;

  } catch (error) {
    console.error('Error in generateInviteCode:', error);
    return 'エラーが発生しました。再度お試しください。';
  }
}

/**
 * LIFF招待リンク生成（新機能）
 * @param {string} userId - LINE ユーザーID
 * @returns {Object} - 招待データ
 */
async function generateInviteLiffLink(userId) {
  try {
    console.log(`Generating LIFF invite link for user: ${userId}`);
    
    // 既存のパートナー確認
    const existingPartnerId = await getPartnerId(userId);
    if (existingPartnerId) {
      throw new Error('Partner already exists');
    }
    
    // 既存の有効な招待コードを無効化
    await invalidateUserInviteCodes(userId);
    
    // 新しい招待コード生成
    const inviteCode = await createUniqueInviteCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24時間後
    
    // LIFF URL生成
    const INVITE_LIFF_ID = '2007500037-InviteXxx'; // 招待受諾用LIFF ID
    const inviteUrl = `https://liff.line.me/${INVITE_LIFF_ID}?code=${inviteCode}`;
    
    // 招待データをFirestoreに保存
    const inviteData = {
      code: inviteCode,
      generatedBy: userId,
      status: 'active',
      type: 'liff',
      liffUrl: inviteUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      maxUses: 1,
      currentUses: 0
    };
    
    await db.collection(COLLECTIONS.INVITE_CODES).doc(inviteCode).set(inviteData);
    
    console.log(`LIFF invite link generated: ${inviteUrl}`);
    
    return {
      code: inviteCode,
      url: inviteUrl,
      expiresAt: expiresAt
    };

  } catch (error) {
    console.error('Error in generateInviteLiffLink:', error);
    throw error;
  }
}

/**
 * 招待コード使用（従来方式）
 * @param {string} userId - LINE ユーザーID
 * @param {string} message - メッセージ（招待コード含む）
 * @returns {string} - 返信メッセージ
 */
async function useInviteCode(userId, message) {
  try {
    console.log(`Processing invite code for user ${userId}: ${message}`);
    
    // 招待コード抽出
    const codeMatch = message.match(/招待コード\s*([A-Z0-9]{6})/i);
    if (!codeMatch) {
      return `❌ 招待コードの形式が正しくありません。

正しい形式: 「招待コード ABC123」
例: 招待コード XYZ789

6桁の英数字を正確に入力してください。`;
    }

    const inviteCode = codeMatch[1].trim().toUpperCase();
    console.log(`Extracted invite code: ${inviteCode}`);

    return await processInviteAcceptance(userId, inviteCode);

  } catch (error) {
    console.error('Error in useInviteCode:', error);
    return '招待コードの処理中にエラーが発生しました。再度お試しください。';
  }
}

/**
 * LIFF招待受諾処理（新機能）
 * @param {string} inviteCode - 招待コード
 * @param {string} newUserId - 新しいユーザーID
 * @returns {Object} - 処理結果
 */
async function acceptLiffInvite(inviteCode, newUserId) {
  try {
    console.log(`Processing LIFF invite acceptance: ${inviteCode} by ${newUserId}`);
    
    const result = await processInviteAcceptance(newUserId, inviteCode);
    
    if (result.includes('💕 パートナー登録が完了しました！')) {
      return {
        success: true,
        message: result
      };
    } else {
      throw new Error(result);
    }

  } catch (error) {
    console.error('Error in acceptLiffInvite:', error);
    throw error;
  }
}

/**
 * 招待受諾処理（共通ロジック）
 * @param {string} userId - ユーザーID
 * @param {string} inviteCode - 招待コード
 * @returns {string} - 処理結果メッセージ
 */
async function processInviteAcceptance(userId, inviteCode) {
  // 自分のコードでないかチェック
  if (await isOwnInviteCode(userId, inviteCode)) {
    return `❌ 自分が生成した招待コードは使用できません。

相手からの招待コードを入力してください。`;
  }

  // 既存のパートナー確認
  const existingPartnerId = await getPartnerId(userId);
  if (existingPartnerId) {
    return `⚠️ すでにパートナーが登録されています。

👫 現在のパートナー: ${existingPartnerId}

新しいパートナーを登録したい場合は、まず「パートナー解除」を実行してください。`;
  }

  // 招待コードの確認
  const codeData = await getInviteCodeData(inviteCode);
  if (!codeData) {
    return `❌ 無効な招待コードです。

🔧 確認事項:
• コードが正確に入力されているか
• 6桁の英数字であるか
• 相手から正しいコードを受け取ったか

再度確認して入力してください。`;
  }

  if (codeData.status !== 'active') {
    return `❌ この招待コードは既に使用済みです。

新しい招待コードを生成してもらってください。`;
  }

  // 有効期限チェック
  const now = new Date();
  const expiresAt = codeData.expiresAt.toDate();
  if (now > expiresAt) {
    // 期限切れのコードを無効化
    await markInviteCodeAsExpired(inviteCode);
    return `❌ この招待コードは期限切れです（24時間経過）。

新しい招待コードを生成してもらってください。`;
  }

  // パートナー関係を作成
  const inviterUserId = codeData.generatedBy;
  const partnershipId = generatePartnershipId(inviterUserId, userId);
  
  const partnershipData = {
    user1: inviterUserId,
    user2: userId,
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    activatedAt: admin.firestore.FieldValue.serverTimestamp(),
    inviteCode: inviteCode,
    invitedBy: inviterUserId,
    inviteType: codeData.type || 'traditional'
  };

  await db.collection(COLLECTIONS.PARTNERS).doc(partnershipId).set(partnershipData);

  // 招待コードを使用済みにマーク
  await markInviteCodeAsUsed(inviteCode, userId);

  // 成功メッセージ
  const successMessage = `💕 パートナー登録が完了しました！

🎉 パートナーシップが確立されました
👫 パートナー: ${inviterUserId}

✨ 今後の機能:
• 生理開始日を登録すると自動でパートナーに通知
• 「パートナー確認」で関係を確認
• 「パートナー解除」で関係を解除

これからデータを共有して、お互いをサポートしましょう ❤️`;

  // 招待者に通知
  await notifyPartnerRegistration(inviterUserId, userId, inviteCode);

  return successMessage;
}

/**
 * パートナー確認
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function checkPartner(userId) {
  try {
    console.log(`Checking partner for user: ${userId}`);
    
    const partnerId = await getPartnerId(userId);
    
    if (!partnerId) {
      return `👫 現在パートナーは登録されていません。

💡 パートナー登録方法:
1. 「招待コード生成」でコードを作成
2. 相手にコードを共有
3. 相手が「招待コード [コード]」で登録完了！

パートナー機能を使って、大切な人と情報を共有しましょう 💕`;
    }

    // パートナーシップの詳細情報取得
    const partnershipData = await getPartnershipData(userId);
    const createdDate = partnershipData?.createdAt?.toDate()?.toLocaleDateString('ja-JP') || '不明';

    return `👫 パートナー情報

💕 パートナー: ${partnerId}
📅 登録日: ${createdDate}
✅ ステータス: アクティブ

🌸 利用可能な機能:
• 生理日登録時の自動通知
• データの共有
• お互いのサポート

🔧 管理機能:
• パートナー解除 - 関係を解除

パートナーと一緒に健康管理を続けましょう！`;

  } catch (error) {
    console.error('Error in checkPartner:', error);
    return 'パートナー情報の取得中にエラーが発生しました。';
  }
}

/**
 * パートナー解除
 * @param {string} userId - LINE ユーザーID
 * @returns {string} - 返信メッセージ
 */
async function removePartner(userId) {
  try {
    console.log(`Removing partner for user: ${userId}`);
    
    const partnerId = await getPartnerId(userId);
    
    if (!partnerId) {
      return `⚠️ 解除するパートナーが見つかりません。

現在パートナーは登録されていません。`;
    }

    // パートナーシップを無効化
    const partnershipData = await getPartnershipData(userId);
    if (partnershipData) {
      const partnershipId = generatePartnershipId(partnershipData.user1, partnershipData.user2);
      await db.collection(COLLECTIONS.PARTNERS).doc(partnershipId).update({
        status: 'inactive',
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deactivatedBy: userId
      });
    }

    // 関連する招待コードを無効化
    await invalidateUserInviteCodes(userId);
    await invalidateUserInviteCodes(partnerId);

    // パートナーに通知
    await notifyPartnerRemoval(partnerId, userId);

    return `💔 パートナー関係を解除しました。

• データの共有が停止されました
• 今後の通知も停止されます
• 新しいパートナーを登録することができます

新しいパートナーを登録したい場合は「招待コード生成」から始めてください。

これまでありがとうございました。`;

  } catch (error) {
    console.error('Error in removePartner:', error);
    return 'パートナー解除中にエラーが発生しました。再度お試しください。';
  }
}

/**
 * サポート設定保存
 * @param {string} userId - ユーザーID
 * @param {Object} supportData - サポート設定データ
 * @returns {boolean} - 成功/失敗
 */
async function saveSupportSettings(userId, supportData) {
  try {
    console.log(`Saving support settings for user: ${userId}`);
    
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    await userRef.update({
      supportSettings: {
        actions: supportData.actions || '',
        wantedFoods: supportData.wantedFoods || [],
        avoidFoods: supportData.avoidFoods || [],
        message: supportData.message || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`Support settings saved for user: ${userId}`);
    return true;

  } catch (error) {
    console.error('Error saving support settings:', error);
    return false;
  }
}

/**
 * サポート設定取得
 * @param {string} userId - ユーザーID
 * @returns {Object} - サポート設定
 */
async function getSupportSettings(userId) {
  try {
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    
    if (!userDoc.exists) {
      return {
        actions: '',
        wantedFoods: [],
        avoidFoods: [],
        message: ''
      };
    }
    
    const userData = userDoc.data();
    return userData.supportSettings || {
      actions: '',
      wantedFoods: [],
      avoidFoods: [],
      message: ''
    };

  } catch (error) {
    console.error('Error getting support settings:', error);
    return {
      actions: '',
      wantedFoods: [],
      avoidFoods: [],
      message: ''
    };
  }
}

// === ユーティリティ関数 ===

/**
 * パートナーIDを取得
 * @param {string} userId - ユーザーID
 * @returns {string|null} - パートナーID
 */
async function getPartnerId(userId) {
  try {
    const snapshot = await db.collection(COLLECTIONS.PARTNERS)
      .where('status', '==', 'active')
      .get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.user1 === userId) {
        return data.user2;
      } else if (data.user2 === userId) {
        return data.user1;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting partner ID:', error);
    return null;
  }
}

/**
 * パートナーシップデータを取得
 * @param {string} userId - ユーザーID
 * @returns {Object|null} - パートナーシップデータ
 */
async function getPartnershipData(userId) {
  try {
    const snapshot = await db.collection(COLLECTIONS.PARTNERS)
      .where('status', '==', 'active')
      .get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.user1 === userId || data.user2 === userId) {
        return data;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting partnership data:', error);
    return null;
  }
}

/**
 * 有効な招待コードを取得
 * @param {string} userId - ユーザーID
 * @returns {Object|null} - 招待コードデータ
 */
async function getValidInviteCode(userId) {
  try {
    const snapshot = await db.collection(COLLECTIONS.INVITE_CODES)
      .where('generatedBy', '==', userId)
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const codeData = snapshot.docs[0].data();
    const now = new Date();
    const expiresAt = codeData.expiresAt.toDate();

    // 期限チェック
    if (now > expiresAt) {
      // 期限切れの場合は無効化
      await markInviteCodeAsExpired(codeData.code);
      return null;
    }

    return codeData;
  } catch (error) {
    console.error('Error getting valid invite code:', error);
    return null;
  }
}

/**
 * 招待コードデータを取得
 * @param {string} code - 招待コード
 * @returns {Object|null} - コードデータ
 */
async function getInviteCodeData(code) {
  try {
    const doc = await db.collection(COLLECTIONS.INVITE_CODES).doc(code).get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error('Error getting invite code data:', error);
    return null;
  }
}

/**
 * 自分の招待コードかチェック
 * @param {string} userId - ユーザーID
 * @param {string} code - 招待コード
 * @returns {boolean} - 自分のコードかどうか
 */
async function isOwnInviteCode(userId, code) {
  try {
    const codeData = await getInviteCodeData(code);
    return codeData && codeData.generatedBy === userId;
  } catch (error) {
    console.error('Error checking own invite code:', error);
    return false;
  }
}

/**
 * ユニークな招待コードを生成
 * @returns {string} - 招待コード
 */
async function createUniqueInviteCode() {
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    const code = generateRandomCode();
    const existing = await getInviteCodeData(code);
    
    if (!existing) {
      return code;
    }
    
    attempts++;
  }
  
  throw new Error('Failed to generate unique invite code');
}

/**
 * ランダムな6桁コードを生成
 * @returns {string} - 6桁のコード
 */
function generateRandomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * パートナーシップIDを生成
 * @param {string} user1 - ユーザー1
 * @param {string} user2 - ユーザー2
 * @returns {string} - パートナーシップID
 */
function generatePartnershipId(user1, user2) {
  // アルファベット順でソートして一意のIDを生成
  const sortedUsers = [user1, user2].sort();
  return `${sortedUsers[0]}_${sortedUsers[1]}`;
}

/**
 * 招待コードを使用済みにマーク
 * @param {string} code - 招待コード
 * @param {string} userId - 使用者ID
 */
async function markInviteCodeAsUsed(code, userId) {
  try {
    await db.collection(COLLECTIONS.INVITE_CODES).doc(code).update({
      status: 'used',
      usedBy: userId,
      usedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error marking invite code as used:', error);
  }
}

/**
 * 招待コードを期限切れにマーク
 * @param {string} code - 招待コード
 */
async function markInviteCodeAsExpired(code) {
  try {
    await db.collection(COLLECTIONS.INVITE_CODES).doc(code).update({
      status: 'expired',
      expiredAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error marking invite code as expired:', error);
  }
}

/**
 * ユーザーの招待コードを無効化
 * @param {string} userId - ユーザーID
 */
async function invalidateUserInviteCodes(userId) {
  try {
    const snapshot = await db.collection(COLLECTIONS.INVITE_CODES)
      .where('generatedBy', '==', userId)
      .where('status', '==', 'active')
      .get();

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'invalidated',
        invalidatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();
  } catch (error) {
    console.error('Error invalidating user invite codes:', error);
  }
}

/**
 * 期限切れ時刻をフォーマット
 * @param {admin.firestore.Timestamp} timestamp - タイムスタンプ
 * @returns {string} - フォーマット済み時刻
 */
function formatExpiryTime(timestamp) {
  try {
    const date = timestamp.toDate();
    return date.toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return '不明';
  }
}

// === 通知関数 ===

/**
 * パートナー登録通知
 * @param {string} inviterUserId - 招待者ID
 * @param {string} newPartnerId - 新しいパートナーID
 * @param {string} inviteCode - 使用された招待コード
 */
async function notifyPartnerRegistration(inviterUserId, newPartnerId, inviteCode) {
  // この関数は後でLINE通知機能と連携
  console.log(`Partner registration notification: ${inviterUserId} <- ${newPartnerId} (code: ${inviteCode})`);
}

/**
 * パートナー解除通知
 * @param {string} partnerId - パートナーID
 * @param {string} removedBy - 解除実行者ID
 */
async function notifyPartnerRemoval(partnerId, removedBy) {
  // この関数は後でLINE通知機能と連携
  console.log(`Partner removal notification: ${partnerId} removed by ${removedBy}`);
}

module.exports = {
  generateInviteCode,
  generateInviteLiffLink,
  useInviteCode,
  acceptLiffInvite,
  checkPartner,
  removePartner,
  saveSupportSettings,
  getSupportSettings,
  getPartnerId,
  getPartnershipData
};