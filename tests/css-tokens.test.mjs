import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * 设计令牌回归测试。
 *
 * 历史缺陷：dashboard.css 里用了 --ink / --muted / --accent / --wash，
 * 这四者在 tokens.css 中从未定义，于是组件一直吃 `var(--x, #hex)` 的硬编码回退值，
 * 暗色主题只改了令牌却改不动这些组件。这个测试把「组件只能用已声明的令牌」变成硬约束。
 */

const TOKENS = new URL("../css/tokens.css", import.meta.url);
const COMPONENTS = ["../css/app.css", "../css/dashboard.css", "../css/report-return.css"];

/** 逐个元素注入的错峰变量，带 fallback 属于合法用法 */
const PER_ELEMENT = new Set(["--i"]);

function definedProperties(css) {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
}

function usedProperties(css) {
  const used = new Map();
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
    used.set(match[1], (used.get(match[1]) || 0) + 1);
  }
  return used;
}

test("component styles only consume design tokens declared in tokens.css", async () => {
  const tokens = definedProperties(await readFile(TOKENS, "utf8"));

  for (const relative of COMPONENTS) {
    const css = await readFile(new URL(relative, import.meta.url), "utf8");
    const undefinedProps = [...usedProperties(css)]
      .map(([name, count]) => ({ name, count }))
      .filter(({ name }) => !tokens.has(name) && !PER_ELEMENT.has(name));

    assert.deepEqual(
      undefinedProps,
      [],
      `${relative} 使用了 tokens.css 未定义的变量：${undefinedProps.map((item) => item.name).join("、")}`,
    );
  }
});

test("dashboard.css keeps colors and shadows in the token layer", async () => {
  const css = await readFile(new URL("../css/dashboard.css", import.meta.url), "utf8");

  // 组件层出现字面色值，等于把主题切成了两半：暗色只改了令牌，这里不会跟着变
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "dashboard.css 不应硬编码十六进制颜色");
  assert.doesNotMatch(css, /\.theme-dark\b/, "暗色主题由 :root[data-theme=dark] 令牌驱动，不应用 .theme-dark 选择器");
});

test("every token used by the dark theme is declared by the light theme", async () => {
  const css = await readFile(TOKENS, "utf8");
  const blocks = css.split(/:root\[data-theme="dark"\]/);
  assert.equal(blocks.length, 2, "tokens.css 应恰好有一个暗色令牌覆盖块");

  const light = definedProperties(blocks[0]);
  const dark = definedProperties(blocks[1]);

  for (const name of dark) {
    assert.ok(light.has(name), `暗色主题定义了 ${name}，但浅色主题没有对应令牌`);
  }
});
