const failureMessages: Record<string, string> = {
  AI_TASK_FAILED: "后台任务没有完成，原回答已保留，可以重试。",
  AI_REQUEST_FAILED: "接口暂时不可用，请检查地址、网络和服务商状态后重试。",
  AI_INPUT_TOO_LARGE: "这一轮材料较长，可以选择更少经历或新开一次任务。",
  AI_RESPONSE_TOO_LARGE: "接口返回内容过长，可以缩短生成长度后重试。",
  AI_NOT_READY: "请先接入并启用自己的 API。",
  AI_CONNECTION_CHANGED: "API 配置已改变，重试会使用当前配置。",
  AI_BUDGET_EXHAUSTED: "已达到你设置的用量限制，可以调整限制后重试。",
  AI_CONCURRENCY_LIMIT: "你的其他 AI 任务正在处理，稍后再试。",
  AI_AUTHENTICATION_FAILED: "API Key 无效或没有访问权限，请检查配置。",
  AI_RATE_LIMITED: "接口供应商暂时限流或额度不足，请稍后重试。",
  AI_MODEL_UNAVAILABLE: "模型或接口地址不可用，请检查模型名称和地址。",
  AI_TIMEOUT: "接口响应超时，原回答已保留。",
  AI_RESPONSE_INVALID: "模型返回的内容格式不完整，可以重试或调整 JSON 模式。",
  AI_SOURCE_QUOTE_INVALID: "模型引用没有对应到原材料，本轮未采用。",
  AI_UNSUPPORTED_FACT: "模型加入了材料中没有的数字，本轮未采用。",
};

export function aiFailureMessage(code: string | null | undefined) {
  return (
    failureMessages[code ?? ""] ?? "本次处理未完成，可以检查接口配置后重试；手工编辑仍可使用。"
  );
}
