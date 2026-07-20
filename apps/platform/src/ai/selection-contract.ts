export const STRUCTURED_SELECTION_OUTPUT_INSTRUCTION =
  '只返回以下精确结构的 JSON：{"selections":[{"evidenceId":"<confirmedEvidence 中的 id>",' +
  '"requirementIds":["<requirements 中的 id>"],"emphasis":["claim","skills","outcomes"]}]}。' +
  "顶层键只能是 selections，字段名不得改写；emphasis 必须选择一到三个 " +
  "claim、skills、outcomes 值。";

export const STRUCTURED_BLOCK_REWRITE_OUTPUT_INSTRUCTION =
  '只返回以下精确结构的 JSON：{"rewrites":[{"sourceBlockId":"<sourceBlocks 中的 sourceBlockId>",' +
  '"suggestedText":"<真实修改稿>","reason":"<修改原因>",' +
  '"requirementIds":["<requirements 中的 id>"],"evidenceIds":["<confirmedEvidence 中的 id>"]}]}。' +
  "顶层键只能是 rewrites；不需要修改的区块不要输出；不得输出未提供的 ID。";
