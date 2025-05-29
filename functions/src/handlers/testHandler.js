// src/handlers/testHandler.js - テスト機能ハンドラー

const { getPartnerId } = require('./partnerHandler');
const { getUserSettings } = require('../utils/firestoreUtils');
const line = require('@line/bot-sdk');
const functions = require('firebase-functions');

/**
 * パートナー通知テスト
 * @param {string} userId - テスト実行者のユーザーID
 * @returns {string} - テスト結果メッセージ
 */
async function testPartnerNotification(userId) {
  try {
    console.log(`[TEST] Starting partner notification test for user: ${userId}`);
    
    let testResults = '🧪 パートナー通知テスト結果\n\n';
    
    // ステップ1: パートナー関係確認
    console.log('[TEST] Step 1: Checking partner relationship...');
    const partnerId = await getPartnerId(userId);
    
    if (!partnerId) {
      testResults += '❌ ステップ1: パートナーが見つかりません\n';
      testResults += '→ まず「招待コード生成」または「招待コード [コード]」でパートナー登録してください\n\n';
      return testResults + '⚠️ テスト中断：パートナー未登録';
    }
    
    testResults += `✅ ステップ1: パートナー発見\n`;
    testResults += `   パートナーID: ${partnerId.substring(0, 8)}...\n\n`;
    
    // ステップ2: パートナーの通知設定確認
    console.log('[TEST] Step 2: Checking partner notification settings...');
    const partnerSettings = await getUserSettings(partnerId);
    
    if (!partnerSettings.notifications) {
      testResults += '❌ ステップ2: パートナーの通知設定がOFF\n';
      testResults += '→ パートナーに「通知設定」で通知をONにしてもらってください\n\n';
      return testResults + '⚠️ テスト中断：通知設定OFF';
    }
    
    testResults += '✅ ステップ2: パートナーの通知設定OK\n';
    testResults += '   通知設定: ON\n\n';
    
    // ステップ3: LINE Client設定確認
    console.log('[TEST] Step 3: Checking LINE client configuration...');
    
    let client;
    try {
      const config = {
        channelAccessToken: functions.config().line.channel_access_token,
        channelSecret: functions.config().line.channel_secret,
      };
      
      if (!config.channelAccessToken) {
        throw new Error('Channel Access Token not configured');
      }
      
      client = new line.Client(config);
      testResults += '✅ ステップ3: LINE Bot設定OK\n\n';
      
    } catch (configError) {
      testResults += '❌ ステップ3: LINE Bot設定エラー\n';
      testResults += `   エラー: ${configError.message}\n\n`;
      return testResults + '⚠️ テスト中断：LINE設定エラー';
    }
    
    // ステップ4: テスト通知送信
    console.log('[TEST] Step 4: Sending test notification...');
    
    const testMessage = `🧪 テスト通知

💕 パートナー通知テストです

📅 これはテストメッセージです
🔧 通知機能が正常に動作しています

このメッセージが届いていれば、
パートナー通知機能は正常です！ ✅`;

    try {
      await client.pushMessage(partnerId, {
        type: 'text',
        text: testMessage
      });
      
      testResults += '✅ ステップ4: テスト通知送信成功\n';
      testResults += '   パートナーにテストメッセージが送信されました\n\n';
      
    } catch (sendError) {
      testResults += '❌ ステップ4: 通知送信エラー\n';
      testResults += `   エラー: ${sendError.message}\n\n`;
      return testResults + '⚠️ テスト失敗：送信エラー';
    }
    
    // テスト完了
    testResults += '🎉 テスト完了！\n\n';
    testResults += '📋 結果まとめ:\n';
    testResults += '• パートナー関係: ✅ 正常\n';
    testResults += '• 通知設定: ✅ 有効\n';
    testResults += '• LINE Bot設定: ✅ 正常\n';
    testResults += '• 通知送信: ✅ 成功\n\n';
    testResults += '💡 パートナーにテストメッセージが届いているか確認してください。\n';
    testResults += '届いていれば、生理日登録時の自動通知も正常に動作するはずです！';
    
    console.log('[TEST] Partner notification test completed successfully');
    return testResults;
    
  } catch (error) {
    console.error('[TEST] Error in partner notification test:', error);
    return `🚨 テストエラー

テスト実行中にエラーが発生しました:
${error.message}

🔧 対処法:
1. 「パートナー確認」でパートナー関係を確認
2. 「設定確認」で通知設定を確認
3. 再度テストを実行してください`;
  }
}

/**
 * パートナー情報詳細デバッグ
 * @param {string} userId - ユーザーID
 * @returns {string} - デバッグ情報
 */
async function debugPartnerInfo(userId) {
  try {
    console.log(`[DEBUG] Getting detailed partner info for user: ${userId}`);
    
    let debugInfo = '🔍 パートナー情報デバッグ\n\n';
    
    // 基本情報
    const partnerId = await getPartnerId(userId);
    debugInfo += `👤 ユーザーID: ${userId.substring(0, 8)}...\n`;
    debugInfo += `👫 パートナーID: ${partnerId ? partnerId.substring(0, 8) + '...' : '未登録'}\n\n`;
    
    if (!partnerId) {
      debugInfo += '⚠️ パートナー未登録のため、これ以上のデバッグ情報はありません';
      return debugInfo;
    }
    
    // 設定情報
    const userSettings = await getUserSettings(userId);
    const partnerSettings = await getUserSettings(partnerId);
    
    debugInfo += '⚙️ 通知設定:\n';
    debugInfo += `   あなた: ${userSettings.notifications ? 'ON' : 'OFF'}\n`;
    debugInfo += `   パートナー: ${partnerSettings.notifications ? 'ON' : 'OFF'}\n\n`;
    
    debugInfo += '📊 その他設定:\n';
    debugInfo += `   あなたの周期: ${userSettings.cycle}日\n`;
    debugInfo += `   あなたの期間: ${userSettings.period}日\n\n`;
    
    // パートナーシップ詳細
    const { getPartnershipData } = require('./partnerHandler');
    const partnershipData = await getPartnershipData(userId);
    
    if (partnershipData) {
      const createdDate = partnershipData.createdAt?.toDate()?.toLocaleDateString('ja-JP') || '不明';
      debugInfo += '📋 パートナーシップ詳細:\n';
      debugInfo += `   登録日: ${createdDate}\n`;
      debugInfo += `   ステータス: ${partnershipData.status}\n`;
      debugInfo += `   招待者: ${partnershipData.invitedBy?.substring(0, 8) || '不明'}...\n`;
    }
    
    return debugInfo;
    
  } catch (error) {
    console.error('[DEBUG] Error in debugPartnerInfo:', error);
    return `🚨 デバッグエラー: ${error.message}`;
  }
}

module.exports = {
  testPartnerNotification,
  debugPartnerInfo
};