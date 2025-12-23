/**
 * ユーティリティ関数
 * 共通で使用するヘルパー関数
 */

/**
 * 現在日付をYYYYMMDD形式で取得
 * @returns {string}
 */
function getDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 日付オブジェクトをYYYYMMDD形式に変換
 * @param {Date} date
 * @returns {string}
 */
function formatDateToYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * YYYYMMDD形式の日付をDateオブジェクトに変換
 * @param {string} dateStr
 * @returns {Date}
 */
function parseYYYYMMDD(dateStr) {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

/**
 * メールアドレスの形式を検証
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 名前の形式を検証
 * @param {string} name
 * @returns {boolean}
 */
function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  return name.length >= 1 && name.length <= 100;
}

/**
 * エラーメッセージから機密情報を除去
 * @param {string} message
 * @returns {string}
 */
function sanitizeErrorMessage(message) {
  if (!message || typeof message !== 'string') return message;
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/xoxb-\S+/gi, '[REDACTED]')
    .replace(/sk-ant-\S+/gi, '[REDACTED]');
}
