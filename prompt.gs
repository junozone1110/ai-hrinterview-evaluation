/**
 * システムプロンプト構築
 * Claude用のプロンプトを外部ファイルから組み立てる
 */

/**
 * Claude用のシステムプロンプトを構築
 * 外部ファイルから読み込んだ内容を組み合わせる
 * @returns {string}
 */
function getSystemPrompt() {
  const promptInstructions = getPromptInstructions();
  const guidelines = getEvaluationGuidelines();
  const template = getReportTemplate();

  return `${promptInstructions}

---

# 評価ガイドライン（A）

${guidelines}

---

# レポート雛形（B）

${template}`;
}
