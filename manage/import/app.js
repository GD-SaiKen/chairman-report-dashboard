import { createImportApi } from "./api.js";
import { renderWorkbench, renderError } from "./views.js";

const api = createImportApi();
const root = document.querySelector("#workbench");
const live = document.querySelector("#live");
let periodId = "";
let state = { period: null, draft: {}, quality: { issues: [] } };
const announce = (message) => { live.textContent = message; };

/**
 * 统一错误处理。
 * 原先五个回调都是裸 async，任何 4xx/5xx 都会变成未处理的 Promise 拒绝，
 * 界面毫无反应；这里把它们收敛成页面上可见的提示。
 */
async function run(task) {
  try {
    return await task();
  } catch (error) {
    const message = error?.message || String(error);
    renderError(root, message);
    announce(`操作失败：${message}`);
    return undefined;
  }
}

/** 表单提交期间禁用按钮，避免重复点击造成重复发布 */
async function submit(form, task) {
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.disabled = false;
  }
}

async function refresh() {
  await run(async () => {
    state = await api.getPeriod(periodId);
    state.period.quality = state.quality;
    renderError(root, "");
    renderWorkbench(root, state);
  });
}

document.querySelector("#period-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  submit(form, () => run(async () => {
    const value = Object.fromEntries(new FormData(form));
    state.period = await api.createPeriod(value);
    periodId = state.period.id;
    await refresh();
    announce("期次草稿已创建");
  }));
});

document.querySelector("#upload-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  submit(form, () => run(async () => {
    if (!periodId) {
      renderError(root, "请先创建期次");
      return;
    }
    await api.upload(periodId, new FormData(form));
    await refresh();
    announce("HTML 报告已上传");
  }));
});

document.querySelector("#extract").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await run(async () => {
      if (!periodId) {
        renderError(root, "请先创建期次");
        return;
      }
      await api.extract(periodId);
      await refresh();
      announce("解析完成，请审核质量问题");
    });
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#approve-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  submit(form, () => run(async () => {
    await api.approve(periodId, new FormData(form).get("actor"));
    await refresh();
    announce("审核已确认");
  }));
});

document.querySelector("#publish-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  submit(form, () => run(async () => {
    await api.publish(periodId, new FormData(form).get("actor"));
    await refresh();
    announce("期次已发布");
  }));
});

renderWorkbench(root, state);
