import { h } from "../../js/core/dom.js";

export const STEP_DEFS = [
  ["period", "创建期次", ["uploaded"]], ["upload", "上传报告", ["uploaded", "failed"]],
  ["extract", "解析进度", ["sanitizing", "extracting", "validating"]],
  ["review", "提取审核", ["review_required", "failed"]], ["publish", "发布确认", ["approved", "publishing", "published"]],
];

export function buildSteps(period = {}) {
  return STEP_DEFS.map(([id, label, states]) => ({ id, label, current: states.includes(period.status) }));
}

export function canPublish(period = {}) {
  return period.status === "approved" && !(period.quality?.issues || []).some((issue) => issue.severity === "blocking" && !issue.resolved);
}

export function groupCandidates(draft = {}) {
  const input = draft.candidates || {};
  return Object.fromEntries(["departments", "people", "demands", "capabilities", "tokens", "radar"].map((key) => [key, input[key] || []]));
}

/**
 * 全部走 DOM 构造：候选名与问题文案都可能来自上传的 HTML，
 * 用 innerHTML 插值会变成存储型 XSS。
 */
export function renderWorkbench(root, state) {
  const period = state.period || {};
  const groups = groupCandidates(state.draft);

  root.querySelector("#steps").replaceChildren(...buildSteps(period).map((step) =>
    h("li", { class: `step ${step.current ? "is-current" : ""}`, ...(step.current ? { "aria-current": "step" } : {}) }, step.label)
  ));

  root.querySelector("#status").textContent = period.status ? `当前状态：${period.status}` : "尚未创建期次";

  root.querySelector("#candidate-summary").replaceChildren(...Object.entries(groups).map(([key, items]) =>
    h("article", null, h("strong", { text: key }), h("span", { text: String((items || []).length) }))
  ));

  const issues = state.quality?.issues || [];
  root.querySelector("#issues").replaceChildren(...(issues.length
    ? issues.map((issue) => h("li", null, h("strong", { text: issue.code || "问题" }), ` ${issue.message || ""}`))
    : [h("li", { text: "暂无质量问题" })]));

  let form = root.querySelector("#digest-form");
  if (!form) {
    form = h("form", { id: "digest-form", class: "digest-form" });
    root.querySelector("#approve-form").before(form);
  }
  const candidates = state.draft?.digestCandidates;
  form.hidden = !candidates || !["review_required", "failed"].includes(period.status);
  if (!form.hidden) {
    const reviewed = state.draft.digest;
    const same = (a, b) => a?.evidence?.sourceFileId === b?.evidence?.sourceFileId && a?.evidence?.blockId === b?.evidence?.blockId;
    const entries = (kind, label, items, limit) => h("fieldset", { class: "digest-group", "data-kind": kind },
      h("legend", { text: `${label}（最多 ${limit} 项）` }),
      items.map((item, index) => {
        const selected = reviewed?.[kind]?.find((value) => same(value, item));
        return h("div", { class: "digest-entry", "data-index": String(index) },
          h("label", null, h("input", { type: "checkbox", checked: reviewed ? Boolean(selected) : index < limit }), "保留"),
          h("textarea", { rows: "3", text: selected?.text || item.text, "aria-label": `${label} ${index + 1}` }),
          h("small", { text: `原文：${item.evidence?.excerpt || item.text}` }),
          h("div", null, h("button", { type: "button", "data-move": "up", text: "上移" }), h("button", { type: "button", "data-move": "down", text: "下移" }))
        );
      })
    );
    form.replaceChildren(
      h("h3", { text: "报告导读审核" }),
      h("p", { text: "核对原文后编辑和排序。保存后才能批准发布。" }),
      h("label", { for: "digest-headline", text: "一句话结论" }),
      h("textarea", { id: "digest-headline", rows: "3", text: reviewed?.headline?.text || candidates.headline?.text || "", required: true }),
      h("small", { text: `原文：${candidates.headline?.evidence?.excerpt || "未提取到结论，请检查报告"}` }),
      entries("highlights", "关键进展", candidates.highlights || [], 3),
      entries("watchItems", "待关注", candidates.watchItems || [], 2),
      h("label", null, "审核人", h("input", { name: "actor", required: true, value: reviewed?.reviewer || "" })),
      h("button", { type: "submit", text: "保存导读审核" })
    );
  }
}

/** 把操作失败显示在页面上，替代原先被吞掉的未处理 Promise 拒绝 */
export function renderError(root, message) {
  const host = root.querySelector("#error");
  if (!host) return;
  if (!message) {
    host.hidden = true;
    host.textContent = "";
    return;
  }
  host.hidden = false;
  host.textContent = message;
}
