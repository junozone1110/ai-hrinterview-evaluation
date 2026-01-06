/**
 * Slack連携
 * 通知、ファイルアップロード、ユーザー検索
 */

// キャッシュ（スクリプト実行中のみ有効）
const SlackCache = {
  users: null,
  usersTimestamp: null,
  channelMembers: null,
  channelMembersTimestamp: null
};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

/**
 * キャッシュが有効かどうかを判定
 * @param {number|null} timestamp
 * @returns {boolean}
 */
function isCacheValid(timestamp) {
  if (!timestamp) return false;
  return (Date.now() - timestamp) < CACHE_TTL_MS;
}

/**
 * MDファイルをSlackにアップロード（スレッド形式）
 * @param {Array<{id: string, name: string, content: string, url: string}>} files
 */
function uploadFilesToSlack(files) {
  const config = getScriptConfig();

  if (!config.slackBotToken || !config.slackChannelId) {
    console.warn('Slack設定が不完全です（SLACK_BOT_TOKEN または SLACK_CHANNEL_ID が未設定）');
    return;
  }

  const metadata = extractInterviewMetadata(files);
  const threadTs = postSlackSummaryMessage(metadata, config.slackBotToken, config.slackChannelId);

  files.forEach(file => {
    uploadFileToSlack(file, config.slackBotToken, config.slackChannelId, threadTs);
  });
}

/**
 * レポートから面接メタデータを抽出
 * @param {Array} files
 * @returns {{date: string, candidate: string, interviewers: Array}}
 */
function extractInterviewMetadata(files) {
  const metadata = {
    date: null,
    candidate: null,
    interviewers: []
  };

  files.forEach(file => {
    const content = file.content;

    if (file.name.includes('サマリ') || content.includes('# 面接サマリ')) {
      metadata.candidate = extractFromContent(content, /\|\s*候補者\s*\|\s*(.+?)\s*\|/);
      metadata.date = extractFromContent(content, /\|\s*面接日時\s*\|\s*(.+?)\s*\|/);
    }

    if (file.name.includes('フィードバックレポート') || content.includes('# 面接官フィードバックレポート')) {
      const interviewerInfo = extractFromContent(content, /\*\*面接官 \(Email\)\*\*\s*\|\s*(.+?)\s*\|/);
      if (interviewerInfo) {
        const emailMatch = interviewerInfo.match(/([^\s]+@[^\s]+)/);
        metadata.interviewers.push({
          name: interviewerInfo.replace(/@[^\s]+/, '').trim() || interviewerInfo,
          email: emailMatch ? emailMatch[1] : null
        });
      }
    }
  });

  metadata.date = metadata.date || new Date().toLocaleDateString('ja-JP');
  metadata.candidate = metadata.candidate || '不明';

  return metadata;
}

/**
 * コンテンツから正規表現でマッチを抽出
 * @param {string} content
 * @param {RegExp} pattern
 * @returns {string|null}
 */
function extractFromContent(content, pattern) {
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Slack親メッセージを投稿してthread_tsを取得
 * @param {Object} metadata
 * @param {string} botToken
 * @param {string} channelId
 * @returns {string|null}
 */
function postSlackSummaryMessage(metadata, botToken, channelId) {
  const interviewerText = formatInterviewerMentions(metadata.interviewers, botToken, channelId);

  const message = `📋 *面接フィードバックレポート生成完了*\n\n` +
                  `📅 *面接日時:* ${metadata.date}\n` +
                  `👤 *候補者:* ${metadata.candidate}\n` +
                  `🎤 *面接官:* ${interviewerText}`;

  const result = postSlackMessage(channelId, message, botToken);

  if (!result.ok) {
    console.error(`Slack親メッセージ投稿失敗: ${result.error || 'unknown'}`);
    return null;
  }

  console.log(`Slack親メッセージ投稿完了 (ts: ${result.ts})`);
  return result.ts;
}

/**
 * Slackにメッセージを投稿
 * @param {string} channelId
 * @param {string} text
 * @param {string} botToken
 * @param {string|null} threadTs
 * @returns {Object}
 */
function postSlackMessage(channelId, text, botToken, threadTs = null) {
  const payload = { channel: channelId, text: text };
  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  return JSON.parse(response.getContentText());
}

/**
 * 面接官のメンション/名前表示をフォーマット
 * @param {Array} interviewers
 * @param {string} botToken
 * @param {string} channelId
 * @returns {string}
 */
function formatInterviewerMentions(interviewers, botToken, channelId) {
  if (!interviewers || interviewers.length === 0) {
    return '不明';
  }

  const channelMembers = getChannelMembers(channelId, botToken);

  return interviewers.map(interviewer => {
    const userId = findSlackUserId(interviewer, botToken);

    if (userId) {
      if (channelMembers && !channelMembers.includes(userId)) {
        console.log('チャンネル外ユーザーのためメンションスキップ');
        return `*${interviewer.name || interviewer.email}*`;
      }
      return `<@${userId}>`;
    }

    return `*${interviewer.name || interviewer.email || '不明'}*`;
  }).join(', ');
}

/**
 * 面接官のSlackユーザーIDを検索
 * @param {Object} interviewer
 * @param {string} botToken
 * @returns {string|null}
 */
function findSlackUserId(interviewer, botToken) {
  if (interviewer.email) {
    const userId = getSlackUserIdByEmail(interviewer.email, botToken);
    if (userId) return userId;
  }

  if (interviewer.name) {
    return getSlackUserIdByName(interviewer.name, botToken);
  }

  return null;
}

/**
 * メールアドレスからSlackユーザーIDを取得
 * @param {string} email
 * @param {string} botToken
 * @returns {string|null}
 */
function getSlackUserIdByEmail(email, botToken) {
  if (!isValidEmail(email)) return null;

  try {
    const response = UrlFetchApp.fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      {
        method: 'get',
        headers: { 'Authorization': `Bearer ${botToken}` },
        muteHttpExceptions: true
      }
    );

    const result = JSON.parse(response.getContentText());
    return (result.ok && result.user) ? result.user.id : null;
  } catch (e) {
    console.warn('Slackユーザー検索エラー');
    return null;
  }
}

/**
 * Slackワークスペースの全ユーザーを取得（キャッシュ付き）
 * @param {string} botToken
 * @returns {Array}
 */
function getAllSlackUsers(botToken) {
  if (SlackCache.users && isCacheValid(SlackCache.usersTimestamp)) {
    return SlackCache.users;
  }

  const allUsers = [];
  let cursor = null;

  try {
    do {
      let url = 'https://slack.com/api/users.list?limit=200';
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': `Bearer ${botToken}` },
        muteHttpExceptions: true
      });

      const result = JSON.parse(response.getContentText());
      if (!result.ok) {
        console.warn(`Slackユーザー一覧取得失敗: ${result.error}`);
        break;
      }

      result.members
        .filter(user => !user.deleted && !user.is_bot && user.id !== 'USLACKBOT')
        .forEach(user => {
          allUsers.push({
            id: user.id,
            name: user.name,
            realName: user.real_name || '',
            displayName: user.profile?.display_name || ''
          });
        });

      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    console.log(`Slackユーザー取得完了: ${allUsers.length}名`);
    SlackCache.users = allUsers;
    SlackCache.usersTimestamp = Date.now();
    return allUsers;
  } catch (e) {
    console.warn(`Slackユーザー一覧取得エラー: ${e.message}`);
    return [];
  }
}

/**
 * 名前からSlackユーザーIDを検索
 * @param {string} name
 * @param {string} botToken
 * @returns {string|null}
 */
function getSlackUserIdByName(name, botToken) {
  if (!isValidName(name)) return null;

  const users = getAllSlackUsers(botToken);
  const normalizedName = normalizeName(name);
  const MIN_MATCH_LENGTH = 3;

  // 完全一致
  for (const user of users) {
    if (matchesUserName(user, normalizedName, true)) {
      return user.id;
    }
  }

  // 部分一致
  for (const user of users) {
    if (matchesUserName(user, normalizedName, false, MIN_MATCH_LENGTH)) {
      return user.id;
    }
  }

  return null;
}

/**
 * 名前を正規化
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return name.toLowerCase().replace(/\s+/g, '');
}

/**
 * ユーザー名がマッチするか判定
 * @param {Object} user
 * @param {string} normalizedName
 * @param {boolean} exactMatch
 * @param {number} minLength
 * @returns {boolean}
 */
function matchesUserName(user, normalizedName, exactMatch, minLength = 0) {
  const realNameNorm = normalizeName(user.realName);
  const displayNameNorm = normalizeName(user.displayName);
  const userNameNorm = user.name.toLowerCase();

  if (exactMatch) {
    return realNameNorm === normalizedName ||
           displayNameNorm === normalizedName ||
           userNameNorm === normalizedName;
  }

  if (realNameNorm.length >= minLength) {
    if (realNameNorm.includes(normalizedName) || normalizedName.includes(realNameNorm)) {
      return true;
    }
  }
  if (displayNameNorm.length >= minLength) {
    if (displayNameNorm.includes(normalizedName) || normalizedName.includes(displayNameNorm)) {
      return true;
    }
  }

  return false;
}

/**
 * Slackチャンネルのメンバー一覧を取得（キャッシュ付き）
 * @param {string} channelId
 * @param {string} botToken
 * @returns {Array|null}
 */
function getChannelMembers(channelId, botToken) {
  if (SlackCache.channelMembers && isCacheValid(SlackCache.channelMembersTimestamp)) {
    return SlackCache.channelMembers;
  }

  const members = [];
  let cursor = null;

  try {
    do {
      let url = `https://slack.com/api/conversations.members?channel=${channelId}&limit=200`;
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': `Bearer ${botToken}` },
        muteHttpExceptions: true
      });

      const result = JSON.parse(response.getContentText());
      if (!result.ok) {
        console.warn(`チャンネルメンバー取得失敗: ${result.error}`);
        return null;
      }

      members.push(...result.members);
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    console.log(`チャンネルメンバー取得完了: ${members.length}名`);
    SlackCache.channelMembers = members;
    SlackCache.channelMembersTimestamp = Date.now();
    return members;
  } catch (e) {
    console.warn(`チャンネルメンバー取得エラー: ${e.message}`);
    return null;
  }
}

/**
 * 単一ファイルをSlackにアップロード
 * @param {Object} file
 * @param {string} botToken
 * @param {string} channelId
 * @param {string|null} threadTs
 */
function uploadFileToSlack(file, botToken, channelId, threadTs = null) {
  const uploadUrlResponse = getSlackUploadUrl(file.name, file.content, botToken);

  if (!uploadUrlResponse.ok) {
    console.error(`Slack upload URL取得失敗: ${uploadUrlResponse.error || 'unknown'}`);
    return;
  }

  const uploadResponse = UrlFetchApp.fetch(uploadUrlResponse.upload_url, {
    method: 'post',
    payload: file.content,
    headers: { 'Content-Type': 'text/markdown' },
    muteHttpExceptions: true
  });

  if (uploadResponse.getResponseCode() !== 200) {
    console.error(`Slack ファイルアップロード失敗: ${uploadResponse.getResponseCode()}`);
    return;
  }

  completeSlackUpload(uploadUrlResponse.file_id, channelId, file.name, botToken, threadTs);
  console.log(`Slackアップロード完了: ${file.name}${threadTs ? ' (スレッド返信)' : ''}`);
}

/**
 * Slack upload URLを取得
 * @param {string} filename
 * @param {string} content
 * @param {string} botToken
 * @returns {Object}
 */
function getSlackUploadUrl(filename, content, botToken) {
  const blob = Utilities.newBlob(content, 'text/plain', filename);
  const byteLength = blob.getBytes().length;

  const response = UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: `filename=${encodeURIComponent(filename)}&length=${byteLength}`,
    muteHttpExceptions: true
  });

  return JSON.parse(response.getContentText());
}

/**
 * Slackアップロード完了通知
 * @param {string} fileId
 * @param {string} channelId
 * @param {string} title
 * @param {string} botToken
 * @param {string|null} threadTs
 */
function completeSlackUpload(fileId, channelId, title, botToken, threadTs = null) {
  const payload = {
    files: [{ id: fileId, title: title }],
    channel_id: channelId
  };

  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    console.error(`Slack complete upload 失敗: ${result.error || 'unknown'}`);
  }
}

/**
 * エラー通知をSlackに送信
 * エラー通知用チャンネル（SLACK_ERROR_CHANNEL_ID）を優先、未設定なら通常チャンネルにフォールバック
 * @param {GoogleAppsScript.Drive.File|null} file
 * @param {Error} error
 */
function sendErrorNotification(file, error) {
  const config = getScriptConfig();

  const errorChannelId = config.slackErrorChannelId || config.slackChannelId;
  if (!config.slackBotToken || !errorChannelId) {
    return;
  }

  const fileName = file ? file.getName() : '不明';
  const message = `⚠️ *面接フィードバックレポート生成エラー*\n\n` +
                  `*ドキュメント:* ${fileName}\n` +
                  `*エラー内容:* ${error.message}\n` +
                  `*発生日時:* ${new Date().toLocaleString('ja-JP')}`;

  const result = postSlackMessage(errorChannelId, message, config.slackBotToken);
  if (!result.ok) {
    console.error(`Slack通知失敗: ${result.error || 'unknown'}`);
  }
}
