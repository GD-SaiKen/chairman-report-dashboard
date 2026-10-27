import { validateExtractionResult } from "./extraction-schema.mjs";

export class ExtractionProvider {
  async extract() { throw new Error("not implemented"); }
}

export class RulesOnlyExtractionProvider extends ExtractionProvider {
  async extract({ ruleResult }) {
    return { departments: [], people: [], demands: [], capabilities: [], tokens: [], radar: [], warnings: [{ code: "AI_PROVIDER_MISSING", message: "未配置 AI 提取服务；请完成规则结果的人工审核。" }], ruleResult };
  }
}

export class HttpExtractionProvider extends ExtractionProvider {
  constructor({ endpoint, apiKey, model, fetchImpl = fetch }) { super(); Object.assign(this, { endpoint, apiKey, model, fetchImpl }); }
  async extract({ blocks, ruleResult, period }) {
    const payload = { model: this.model, input: { period, blocks: blocks.map(({ id, kind, sectionTitle, text, rows }) => ({ id, kind, sectionTitle, text, rows })), ruleResult }, response_format: { type: "json_object" } };
    const response = await this.fetchImpl(this.endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`AI extraction failed: HTTP ${response.status}`);
    const body = await response.json();
    const value = typeof body.output === "string" ? JSON.parse(body.output) : body.output || body;
    const result = validateExtractionResult(value, new Set(blocks.map((block) => block.id)));
    if (!result.ok) throw new Error(`AI extraction schema failed: ${result.errors.join("; ")}`);
    return value;
  }
}

export function createExtractionProvider(config = {}) {
  const endpoint = config.endpoint || process.env.AI_EXTRACTION_ENDPOINT;
  const apiKey = config.apiKey || process.env.AI_EXTRACTION_API_KEY;
  const model = config.model || process.env.AI_EXTRACTION_MODEL;
  return endpoint && apiKey && model ? new HttpExtractionProvider({ endpoint, apiKey, model, fetchImpl: config.fetchImpl }) : new RulesOnlyExtractionProvider();
}
