import { createImportApi } from "./api.js";
import { renderWorkbench } from "./views.js";

const api = createImportApi();
const root = document.querySelector("#workbench");
const live = document.querySelector("#live");
let periodId = "";
let state = { period: null, draft: {}, quality: { issues: [] } };
const announce = (message) => { live.textContent = message; };
async function refresh() { state = await api.getPeriod(periodId); state.period.quality = state.quality; renderWorkbench(root, state); }
document.querySelector("#period-form").addEventListener("submit", async (event) => { event.preventDefault(); const value = Object.fromEntries(new FormData(event.currentTarget)); state.period = await api.createPeriod(value); periodId = state.period.id; await refresh(); announce("期次草稿已创建"); });
document.querySelector("#upload-form").addEventListener("submit", async (event) => { event.preventDefault(); if (!periodId) return announce("请先创建期次"); await api.upload(periodId, new FormData(event.currentTarget)); await refresh(); announce("HTML 报告已上传"); });
document.querySelector("#extract").addEventListener("click", async () => { if (!periodId) return announce("请先创建期次"); await api.extract(periodId); await refresh(); announce("解析完成，请审核质量问题"); });
document.querySelector("#approve-form").addEventListener("submit", async (event) => { event.preventDefault(); await api.approve(periodId, new FormData(event.currentTarget).get("actor")); await refresh(); announce("审核已确认"); });
document.querySelector("#publish-form").addEventListener("submit", async (event) => { event.preventDefault(); await api.publish(periodId, new FormData(event.currentTarget).get("actor")); await refresh(); announce("期次已发布"); });
renderWorkbench(root, state);
