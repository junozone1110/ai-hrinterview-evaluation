/**
 * 過去フィードバック比較機能
 * 同一面接官の過去レポートを取得し、比較コンテキストを生成
 */

/**
 * 同一面接官の過去フィードバックレポートを取得
 * @param {string} interviewerName - 面接官名
 * @param {string} excludeDate - 除外する日付（YYYYMMDD形式、今回の面接日）
 * @param {number} limit - 取得件数上限
 * @returns {Array<{date: string, content: string, fileName: string}>}
 */
function getPreviousFeedbacksByInterviewer(interviewerName, excludeDate, limit = CONFIG.PAST_FEEDBACK_LIMIT) {
  if (!interviewerName) {
    return [];
  }

  const config = getScriptConfig();
  const folder = DriveApp.getFolderById(config.outputFolderId);
  const files = folder.getFiles();
  const pastReports = [];
  const normalizedTargetName = normalizeInterviewerName(interviewerName);

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    if (!fileName.startsWith('面接フィードバックレポート_')) {
      continue;
    }

    const parsed = parseFeedbackFileName(fileName);
    if (!parsed || parsed.date === excludeDate) {
      continue;
    }

    if (normalizeInterviewerName(parsed.interviewer) === normalizedTargetName) {
      pastReports.push({
        date: parsed.date,
        content: file.getBlob().getDataAsString('UTF-8'),
        fileName: fileName
      });
    }
  }

  pastReports.sort((a, b) => b.date.localeCompare(a.date));

  const result = pastReports.slice(0, limit);
  console.log(`過去フィードバック取得: ${interviewerName} -> ${result.length}件`);

  return result;
}

/**
 * フィードバックレポートのファイル名をパース
 * @param {string} fileName
 * @returns {{date: string, interviewer: string}|null}
 */
function parseFeedbackFileName(fileName) {
  const match = fileName.match(/^面接フィードバックレポート_(\d{8})_(.+)\.md$/);
  if (!match) {
    return null;
  }

  return {
    date: match[1],
    interviewer: match[2]
  };
}

/**
 * 面接官名を正規化
 * @param {string} name
 * @returns {string}
 */
function normalizeInterviewerName(name) {
  return name.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');
}

/**
 * 文字起こしから話者名を抽出
 * @param {string} transcript
 * @returns {string[]}
 */
function extractSpeakersFromTranscript(transcript) {
  const speakers = new Set();

  // パターン1: "名前:" で始まる行
  const pattern1 = /^([^\n:：]+)[：:]\s*/gm;
  let match;

  while ((match = pattern1.exec(transcript)) !== null) {
    const name = match[1].trim();
    if (isValidSpeakerName(name)) {
      speakers.add(name);
    }
  }

  // パターン2: 参加者セクションから抽出
  const participantPattern = /参加者[：:]\s*([^\n]+)/g;
  while ((match = participantPattern.exec(transcript)) !== null) {
    match[1].split(/[,、]/).forEach(p => {
      const name = p.trim();
      if (name.length >= 2) {
        speakers.add(name);
      }
    });
  }

  console.log(`話者抽出: ${Array.from(speakers).join(', ')}`);
  return Array.from(speakers);
}

/**
 * 有効な話者名かどうか判定
 * @param {string} name
 * @returns {boolean}
 */
function isValidSpeakerName(name) {
  return name.length >= 2 &&
         !/^\d+$/.test(name) &&
         !/^(タブ|===)/.test(name);
}

/**
 * 全話者の過去フィードバックを収集
 * @param {string[]} speakers
 * @param {string} currentDate
 * @returns {Object}
 */
function collectPastFeedbacksForSpeakers(speakers, currentDate) {
  const result = {};

  speakers.forEach(speaker => {
    const pastFeedbacks = getPreviousFeedbacksByInterviewer(speaker, currentDate);
    if (pastFeedbacks.length > 0) {
      result[speaker] = pastFeedbacks;
    }
  });

  return result;
}

/**
 * 全話者の過去フィードバックを統合したコンテキストを生成
 * @param {Object} pastFeedbacksBySpeaker
 * @returns {string}
 */
function buildAllComparisonContexts(pastFeedbacksBySpeaker) {
  const contexts = [];

  for (const [speaker, feedbacks] of Object.entries(pastFeedbacksBySpeaker)) {
    if (feedbacks.length > 0) {
      contexts.push(buildSpeakerFeedbackContext(speaker, feedbacks));
    }
  }

  if (contexts.length === 0) {
    return buildNoHistoryContext();
  }

  return buildComparisonInstructions(contexts);
}

/**
 * 単一話者のフィードバックコンテキストを構築
 * @param {string} speaker
 * @param {Array} feedbacks
 * @returns {string}
 */
function buildSpeakerFeedbackContext(speaker, feedbacks) {
  const feedbackTexts = feedbacks.map((fb, i) => {
    const formattedDate = formatDateJapanese(fb.date);
    return `#### ${i + 1}件前（${formattedDate}）
${fb.content}`;
  }).join('\n\n');

  return `
### 面接官「${speaker}」の過去フィードバック履歴（直近${feedbacks.length}件）

${feedbackTexts}
`;
}

/**
 * 過去フィードバックがない場合のコンテキスト
 * @returns {string}
 */
function buildNoHistoryContext() {
  return `
---

【過去フィードバック比較セクションについて】
この面接の面接官には過去のフィードバック履歴がありません。
レポート雛形の「過去フィードバックとの比較」セクションには「過去のフィードバック履歴がないため、比較対象なし」と記載してください。
`;
}

/**
 * 比較セクションの指示を含むコンテキストを構築
 * @param {string[]} contexts
 * @returns {string}
 */
function buildComparisonInstructions(contexts) {
  return `
---

## 面接官の過去フィードバック履歴

以下は各面接官が過去に受けたフィードバックレポートです。今回のフィードバックと比較して、改善点や継続課題を分析してください。

${contexts.join('\n')}

---

【重要】上記に過去フィードバック履歴がある面接官については、その面接官のフィードバックレポートの末尾に以下の形式で比較セクションを追加してください：

## 過去フィードバックとの比較

### 評価項目の推移

| 評価項目 | 前回 | 今回 | 変化 |
|:--|:--|:--|:--|
| 質問力（深掘り） | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| 傾聴・共感力 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| アトラクト力 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| 時間配分 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |

### 改善が見られた点
- （過去と比較して改善した具体的な点を記載）

### 継続して取り組むべき課題
- （過去から継続している課題を記載）

### 総評
（面接官としての成長や今後の期待について1〜2文で記載）

※過去フィードバック履歴がない面接官については、比較セクションは追加しないでください。
`;
}

/**
 * YYYYMMDD形式の日付を日本語形式に変換
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateJapanese(dateStr) {
  return `${dateStr.substring(0, 4)}年${dateStr.substring(4, 6)}月${dateStr.substring(6, 8)}日`;
}
