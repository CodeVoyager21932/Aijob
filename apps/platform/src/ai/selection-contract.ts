export const STRUCTURED_SELECTION_OUTPUT_INSTRUCTION =
  '只返回以下精确结构的 JSON：{"selections":[{"evidenceId":"<confirmedEvidence 中的 id>",' +
  '"requirementIds":["<requirements 中的 id>"],"emphasis":["claim","skills","outcomes"]}]}。' +
  "顶层键只能是 selections，字段名不得改写；emphasis 必须选择一到三个 " +
  "claim、skills、outcomes 值。";
