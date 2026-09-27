# 测试

纯逻辑模块（`src/core/`）不依赖 Obsidian API，直接用 Node 内置测试运行器执行：

```bash
npm test
```

需要 Node 22.18 以上（依赖内置的 TypeScript 类型剥离）。
