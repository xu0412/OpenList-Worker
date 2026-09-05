# GitHub Actions 部署指南（Cloudflare Workers）

本仓库默认推荐通过 **GitHub Actions 自行执行 `wrangler deploy`** 完成部署，取代 Cloudflare Dashboard 的 Workers Builds（Git 集成），从而绕开此前遇到的 **Workers Builds Blocked / Error 12052** 限制。

对应工作流文件：`.github/workflows/deploy.yml`（复用仓库自带一键部署脚本 `scripts/deploy.js`）。

---

## 目录

- [方案概述](#方案概述)
- [前置准备](#前置准备)
- [Cloudflare 侧一次性初始化](#cloudflare-侧一次性初始化)
- [GitHub 侧配置 Secrets](#github-侧配置-secrets)
- [首次部署](#首次部署)
- [部署后一次性配置（Secrets）](#部署后一次性配置secrets)
- [验证部署](#验证部署)
- [后续部署](#后续部署)
- [自定义域名与 workers.dev 切换](#自定义域名与-workersdev-切换)
- [故障排查](#故障排查)

---

## 方案概述

| 部署方式 | 是否推荐 |
| --- | --- |
| Cloudflare Dashboard Workers Builds（Git 集成） | ❌ 当前账号可能受限（Error 12052） |
| 本地 `wrangler deploy` | ✅ 可行 |
| **GitHub Actions + wrangler** | ✅ **推荐**（本指南方案） |

GitHub Actions 的本质是让 GitHub 的 Runner 在云端执行 `wrangler deploy`，与 Cloudflare 的 Workers Builds 系统无关，因此不受其限制。

工作流执行链路：

```text
push 到 main / 手动触发
        ↓
actions/checkout → pnpm setup → node 22 → pnpm install
        ↓
node scripts/deploy.js（注入 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）
        ↓
① 检测/兜底创建 OPENLIST_KV namespace（无需填 id）
② 拉取官方 OpenList-Frontend 产物并构建到 dist/
③ wrangler deploy → 更新 Worker「openlist」
```

---

## 前置准备

- Cloudflare 账号（用于承载 Worker「openlist」），已启用 Workers。
- 本仓库的 GitHub 远端 `xu0412/OpenList-Worker`，默认分支 `main`。
- 本地无需安装 pnpm / wrangler（CI 自带）；如要本地调试可参考
  [0-00002-Deploy-Cloudflare-Workers.md](./0-00002-Deploy-Cloudflare-Workers.md)。

---

## Cloudflare 侧一次性初始化

以下步骤只需执行一次。

### 1. 确保 Worker「openlist」具备可用的发布目标（关键前置）

> [!IMPORTANT]
> 本仓库 `wrangler.toml` 保持 **`workers_dev = false` 且未配置任何 `routes` / `custom_domain`**。
> 按 Wrangler 官方语义，此时部署的 Worker **不会被分配任何公网访问目标**（`*.workers.dev` 子域、zone route、自定义域名均不会生成）。
> 因此**首次运行 CI 之前**，必须先在 Cloudflare 侧让同名 Worker「openlist」存在并绑定至少一个发布目标，否则 `wrangler deploy` 会因无发布目标而失败（预期行为，非工作流 bug）。

推荐做法（需要先在 Cloudflare 有一个 DNS 托管在 Cloudflare 的域名 / Zone）：

1. Dashboard → **Workers & Pages** → **Create** → **Worker**，名称填写 **`openlist`**（与 `wrangler.toml` 的 `name` 一致），入口可先用默认模板，后续由 CI 覆盖。
2. 进入 Worker「openlist」→ **Settings** → **Triggers** → **Custom Domains** → **Add Custom Domain**，绑定你的域名（例如 `openlist.example.com`）。
3. 完成绑定后，该域名即成为 Worker 的发布目标；此后每次 CI 部署仅更新脚本与静态资源，**Dashboard 上维护的自定义域名不会被 wrangler 移除**。

> [!NOTE]
> 若你暂时没有域名、希望使用 `*.workers.dev` 子域，则必须把 `wrangler.toml` 中的 `workers_dev` 改为 `true` 并提交（这是唯一需要改动配置的地方，默认不修改；是否启用由你决定）。
> 注意：**不要同时使用两种方式重复创建同名 Worker 的不同版本配置**，以 Dashboard 为准即可。

### 2. KV 命名空间：无需手动创建

`wrangler.toml` 中的 `[[kv_namespaces]]` 只声明 `binding = "OPENLIST_KV"`、**未填 `id`**，由 Wrangler 4.x 的 **Automatic Provisioning** 在首次 `wrangler deploy` 时按绑定名自动创建并关联同名 namespace；`scripts/deploy.js` 还内置了「列表检测 + 兜底显式创建」逻辑，二者保证 CI 中无需任何 KV 手工操作。

> CI（非交互）环境下自动创建后，namespace ID 只会显示在 Cloudflare Dashboard，**不会写回仓库配置**，属正常现象；后续部署会按名称自动关联同一 namespace。

### 3. 创建 Cloudflare API Token

Dashboard → **My Profile → API Tokens → Create Token**，选择 **Edit Cloudflare Workers**（或自定义 Token），权限建议：

| 资源类型 | 权限 |
| --- | --- |
| Account → Workers Scripts | Edit |
| Account → Workers KV Storage | Edit（`deploy.js` 需查询/创建 KV namespace） |
| Account → Account Settings | Read（可选，便于 wrangler 解析账号） |

Token 作用域建议限定到目标 Account（需要绑定 zone 路由/自定义域名时，再为对应 Zone 授权 **Workers Routes / Workers Custom Domains** 的 Edit）。创建后复制并妥善保存 Token（只显示一次）。

### 4. 获取 Cloudflare Account ID

Cloudflare Dashboard 首页右侧（或 URL 中）可找到 **Account ID**，形如 32 位十六进制字符串。后续填入 GitHub Secrets。

---

## GitHub 侧配置 Secrets

进入仓库 **Settings → Secrets and variables → Actions**，新增以下两个 Repository secrets：

| Secret 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步创建的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

> ⚠️ 切勿把 Token 明文提交到仓库文件。GitHub Actions 会将这些 Secret 以环境变量形式注入部署步骤。

---

## 首次部署

方式一（推荐先验证）：仓库 **Actions** 页 → 选择 **Deploy to Cloudflare Workers** → **Run workflow**，手动触发一次。

方式二：向 `main` 分支推送代码，工作流自动触发。

CI 大约需要数分钟，主要耗时在「克隆官方 `OpenList-Frontend` → `pnpm install` → vite build → 复制到 `dist/`」。成功时部署步骤输出会包含 Worker 上传信息与可访问地址（如自定义域名或 `*.workers.dev`）。

> 若 CI 在 `wrangler deploy` 前因无发布目标报错，请回到[发布目标就绪](#1-确保-workeropenlist-具备可用的发布目标关键前置)完成 Cloudflare 侧配置后重新 Run workflow。

---

## 部署后一次性配置（Secrets）

Worker 级敏感配置**只放在 Cloudflare Dashboard**，CI 不做任何 secret 同步：

1. Dashboard → **Workers & Pages** → Worker「openlist」→ **Settings → Variables and Secrets**。
2. 添加两个 **Secret**（也可本地用 `wrangler secret put ADMIN_PASSWORD` / `JWT_SECRET` 配置）：
   - `ADMIN_PASSWORD`：后台管理密码
   - `JWT_SECRET`：JWT 签名密钥
3. 如果未配置 `ADMIN_PASSWORD`，系统首次启动会生成随机初始密码，并**仅在启动日志打印一次**（`[SECURITY] Initial admin password: xxxx`），请从日志获取后登录并立即修改。

> Worker 级 Secrets 属于 Worker 而非某次脚本版本：之后每次 CI `wrangler deploy` 覆盖脚本/静态资源时，已配置的 Secrets 会保留，无需重复设置。

---

## 验证部署

浏览器访问部署输出中的地址（自定义域名或 `*.workers.dev`）：

- 打开站点首页，确认前端正常加载；
- 访问 `/api/health`，应返回包含 OpenList 标识的健康响应。

后台路径（默认 `/login` 或按版本约定）使用 `ADMIN_PASSWORD` 登录。

---

## 后续部署

```text
每次 push 到 main
        ↓
GitHub Actions 自动运行
        ↓
构建前端 → wrangler deploy → 自动更新 Cloudflare Worker
```

未改代码时也可在 Actions 页手动 **Run workflow** 重新部署。

> 可选清理：如果 Cloudflare Dashboard 仍保留着旧的 Workers Builds（Git 集成），每次 push 它可能仍尝试构建并报 12052（不影响本 GitHub Actions 部署）。可在 Dashboard 对应 Worker 的 **Settings → Builds** 里解除仓库连接以消除噪音。

---

## 自定义域名与 workers.dev 切换

- **绑定自定义域名后**：保持 `workers_dev = true` 时，自定义域名与 `*.workers.dev` 可同时访问；也可在 Dashboard 绑定自定义域名后继续由 Dashboard 维护（本仓库配置不动，CI 部署不会移除该域名）。
- **若需彻底关闭 `*.workers.dev`**：`wrangler.toml` 当前已为 `workers_dev = false`，此时必须保证 Worker 存在自定义域名/路由发布目标，否则 `wrangler deploy` 无发布目标会失败。若首次配置时就决定关闭 workers.dev，请务必先按上文完成自定义域名绑定，再运行 CI。

---

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| CI 中 `wrangler deploy` 报「无发布目标」 | `workers_dev = false` 且 Worker 尚未绑定任何自定义域名/路由。先在 Dashboard 为 Worker「openlist」绑定发布目标后重跑（见[关键前置](#1-确保-workeropenlist-具备可用的发布目标关键前置)）。 |
| `401 / 权限不足` | `CLOUDFLARE_API_TOKEN` 缺少 Workers Scripts / KV 权限，或未限定到正确 Account；回到 Token 配置检查。 |
| `fetch-frontend` 克隆/构建失败 | 前端产物来自官方 `OpenListTeam/OpenList-Frontend@main`，若官方仓库或 npm registry 网络抖动会失败，可直接重跑；CI 已设 `timeout-minutes: 40`。 |
| Dashboard 仍报 12052 | 旧 Workers Builds Git 集成仍在触发，与 GitHub Actions 部署无关；可在 Dashboard 解除仓库连接。 |
