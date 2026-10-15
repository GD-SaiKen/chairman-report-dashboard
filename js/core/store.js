/**
 * core/store.js — 极简可订阅状态容器
 *
 * 本项目状态只有三件事：目录数据、当前期次、主题。
 * 用不到 Redux / Pinia，一个订阅集合 + 浅合并即可覆盖全部场景，
 * 且天然支持「一次 set → 全量重渲染」的单向数据流。
 */

/**
 * @param {Object} initialState
 * @returns {{ get: () => Object, set: (patch: Object|Function) => void, subscribe: (fn: Function) => Function }}
 */
export function createStore(initialState = {}) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    get: () => state,

    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(next)) {
        if (state[key] !== next[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...next };
      listeners.forEach((fn) => fn(state));
    },

    subscribe(fn) {
      listeners.add(fn);
      fn(state); // 订阅即同步首帧，避免首屏空白
      return () => listeners.delete(fn);
    },
  };
}
