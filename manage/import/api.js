export class ImportApiError extends Error {
  constructor(value) { super(value.message); Object.assign(this, value); }
}

export function createImportApi(base = "/api/import") {
  let csrfToken = "";
  async function session() {
    if (csrfToken) return csrfToken;
    const response = await fetch(`${base}/session`, { credentials: "same-origin" });
    csrfToken = (await response.json()).csrfToken;
    return csrfToken;
  }
  async function request(path, options = {}) {
    const method = options.method || "GET";
    const headers = new Headers(options.headers);
    if (method !== "GET") headers.set("x-csrf-token", await session());
    const response = await fetch(`${base}${path}`, { credentials: "same-origin", ...options, headers });
    const value = await response.json();
    if (!response.ok) throw new ImportApiError(value.error || { message: "请求失败" });
    return value;
  }
  return {
    createPeriod: (value) => request("/periods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
    getPeriod: (id) => request(`/periods/${id}`),
    upload: (id, form) => request(`/periods/${id}/files`, { method: "POST", body: form }),
    extract: (id) => request(`/periods/${id}/extract`, { method: "POST" }),
    saveDraft: (id, value) => request(`/periods/${id}/draft`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
    approve: (id, actor) => request(`/periods/${id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor }) }),
    publish: (id, actor) => request(`/periods/${id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor }) }),
  };
}
