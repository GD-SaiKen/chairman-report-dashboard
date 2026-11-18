export class ImportApiError extends Error {
  constructor(value = {}) {
    super(value.message || "请求失败");
    this.name = "ImportApiError";
    this.code = value.code || "UNKNOWN";
    this.status = value.status || 0;
  }
}

export function createImportApi(base = "/api/import") {
  let csrfToken = "";

  async function session() {
    if (csrfToken) return csrfToken;
    const response = await fetch(`${base}/session`, { credentials: "same-origin" });
    // 管理台可能被 Basic Auth 挡在外面，此时返回的是 HTML 而非 JSON
    const value = await response.json().catch(() => null);
    if (!response.ok || !value?.csrfToken) throw new ImportApiError({ code: "SESSION_FAILED", status: response.status, message: `无法建立管理台会话（HTTP ${response.status}）` });
    csrfToken = value.csrfToken;
    return csrfToken;
  }

  async function send(path, options, csrfTokenValue) {
    const method = options.method || "GET";
    const headers = new Headers(options.headers);
    if (method !== "GET" && csrfTokenValue) headers.set("x-csrf-token", csrfTokenValue);
    const response = await fetch(`${base}${path}`, { credentials: "same-origin", ...options, headers });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      // 非 JSON 响应（401 的 HTML、502 页面等）也要给出可读提示，而不是 JSON 解析异常
      throw new ImportApiError(value?.error || { code: "HTTP_ERROR", status: response.status, message: `${method} ${path} 失败（HTTP ${response.status}）` });
    }
    return value;
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    if (method === "GET") return send(path, options, "");
    try {
      return await send(path, options, await session());
    } catch (error) {
      // token 可能已随 cookie 过期失效，取一次新的再试，仍失败才抛给调用方
      if (error?.status === 403) {
        csrfToken = "";
        return await send(path, options, await session());
      }
      throw error;
    }
  }

  return {
    createPeriod: (value) => request("/periods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
    getPeriod: (id) => request(`/periods/${id}`),
    upload: (id, form) => request(`/periods/${id}/files`, { method: "POST", body: form }),
    extract: (id) => request(`/periods/${id}/extract`, { method: "POST" }),
    saveDraft: (id, value) => request(`/periods/${id}/draft`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
    reviewDigest: (id, value) => request(`/periods/${id}/digest/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
    approve: (id, actor) => request(`/periods/${id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor }) }),
    publish: (id, actor) => request(`/periods/${id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor }) }),
  };
}
