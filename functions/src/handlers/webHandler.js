/**
 * カレンダーデータ取得API (リアルタイム更新対応版)
 */
const getCalendarData = functions
  .region('asia-northeast1')
  .https.onRequest(async (req, res) => {
    console.log('=== getCalendarData called (REALTIME VERSION) ===');
    
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
      
      console.log('Getting REALTIME calendar data for user:', userId?.substring(0, 8) + '...');
      
      // 🚀 修正1: 最新データを強制取得（キャッシュ回避）
      const settings = await getUserSettings(userId);
      
      // 🚀 修正2: 全記録を取得（制限なし）してソート
      const recordsRef = db.collection(COLLECTIONS.USERS)
        .doc(userId)
        .collection(COLLECTIONS.RECORDS)
        .where('status', '==', RECORD_STATUS.ACTIVE)
        .orderBy('startDate', 'desc'); // 最新順
      
      const recordsSnapshot = await recordsRef.get();
      const records = recordsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`✅ Found ${records.length} records for calendar display`);
      
      if (!settings) {
        return res.status(404).json({ error: 'User settings not found' });
      }
      
      if (records.length === 0) {
        return res.status(200).json({
          hasRecords: false,
          settings: settings,
          records: [],
          predictions: null,
          timestamp: new Date().toISOString(), // 🚀 修正3: レスポンスタイムスタンプ
          debug: {
            message: 'No records found',
            userId: userId.substring(0, 8) + '...'
          }
        });
      }
      
      // 🚀 修正4: 記録データを厳密に整形（nullチェック強化）
      const formattedRecords = records.map(record => {
        const startDate = record.startDate?.toDate ? record.startDate.toDate() : new Date(record.startDate);
        const endDate = record.endDate?.toDate ? record.endDate.toDate() : 
                        record.endDate ? new Date(record.endDate) : null;
        
        return {
          id: record.id,
          startDate: startDate.toISOString(),
          endDate: endDate ? endDate.toISOString() : null,
          duration: record.duration || null,
          recordedAt: record.recordedAt?.toDate?.()?.toISOString() || null,
          // 🚀 修正5: 実際の記録フラグを追加
          isActualRecord: true
        };
      });
      
      // 最新記録から予測を計算
      const lastRecord = records[0];
      const lastPeriodStart = lastRecord.startDate?.toDate ? lastRecord.startDate.toDate() : new Date(lastRecord.startDate);
      
      const nextPeriodInfo = getDaysUntilNextPeriod(lastPeriodStart, settings.cycle);
      const ovulationInfo = calculateOvulationDate(lastPeriodStart, settings.cycle);
      const cyclePhase = getCurrentCyclePhase(lastPeriodStart, settings.period, settings.cycle);
      
      // 🚀 修正6: 次回生理期間を正確に計算
      const nextPeriodStart = nextPeriodInfo.nextPeriodDate;
      const nextPeriodEnd = new Date(nextPeriodStart);
      nextPeriodEnd.setDate(nextPeriodStart.getDate() + settings.period - 1);
      
      // 🚀 修正7: 複数月の予測を生成（6ヶ月分）
      const futurePredictions = [];
      for (let cycleCount = 1; cycleCount <= 6; cycleCount++) {
        const predictedStart = new Date(lastPeriodStart);
        predictedStart.setDate(lastPeriodStart.getDate() + (settings.cycle * cycleCount));
        
        const predictedEnd = new Date(predictedStart);
        predictedEnd.setDate(predictedStart.getDate() + settings.period - 1);
        
        const predictedOvulation = new Date(predictedStart);
        predictedOvulation.setDate(predictedStart.getDate() - 14);
        
        futurePredictions.push({
          cycle: cycleCount,
          period: {
            startDate: predictedStart.toISOString(),
            endDate: predictedEnd.toISOString(),
            // 🚀 修正8: 予測フラグを追加
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
        // 🚀 修正9: 複数月予測を追加
        futurePredictions: futurePredictions
      };
      
      const responseData = {
        hasRecords: true,
        settings: settings,
        records: formattedRecords,
        predictions: predictions,
        currentPhase: cyclePhase,
        // 🚀 修正10: メタデータを追加
        metadata: {
          timestamp: new Date().toISOString(),
          totalRecords: records.length,
          latestRecordDate: lastPeriodStart.toISOString(),
          dataVersion: Date.now() // キャッシュ無効化用
        },
        debug: {
          userId: userId.substring(0, 8) + '...',
          recordsCount: records.length,
          settingsValid: !!settings,
          lastUpdate: new Date().toISOString()
        }
      };
      
      console.log('✅ REALTIME calendar data response prepared successfully');
      console.log('📊 Response contains:', Object.keys(responseData));
      console.log('📝 Records count:', formattedRecords.length);
      console.log('🔮 Predictions count:', futurePredictions.length);
      
      res.status(200).json(responseData);
      
    } catch (error) {
      console.error('❌ Error in getCalendarData:', error);
      console.error('📍 Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString(),
        debug: {
          method: req.method,
          hasUserId: !!req.query?.userId || !!req.body?.userId,
          hasToken: !!req.query?.token || !!req.body?.token
        }
      });
    }
  });
