#!/usr/bin/env node
/**
 * OpenList 一键部署脚本（Cloudflare Workers）
 *
 * wrangler.toml 只声明绑定（[[kv_namespaces]] binding = "OPENLIST_KV"），
 * **不存储 id** —— wrangler 4.x 的 Automatic provisioning 会在部署时自动
 * 创建/关联同名 KV namespace，无需手动填写 id。
 *
 * 本脚本额外做两件事：
 *   1. 检测云端是否已有 OPENLIST_KV namespace；没有则显式创建
 *      （确保资源存在；兼容不支持自动配置的旧版 wrangler）
 *   2. 获取官方前端产物 + wrangler deploy
 *
 * 用法：
 *   node scripts/deploy.js          # 自动部署（构建 + 确保 KV + deploy）
 *   node scripts/deploy.js --kv     # 仅确保 KV namespace 存在（不部署）
 *   node scripts/deploy.js --skip-build  跳过前端构建（默认自动构建）
 *   node scripts/deploy.js --help   # 帮助
 */
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const KV_TITLE = "OPENLIST_KV"

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
OpenList 一键部署脚本（KV 自动绑定，无需手动填写 id）

  node scripts/deploy.js          自动部署（确保 KV 存在 + 构建 + wrangler deploy）
  node scripts/deploy.js --kv     仅确保 KV namespace 存在，不部署
  node scripts/deploy.js --skip-build  跳过前端构建（默认自动构建）
  node scripts/deploy.js --help   显示帮助

说明：wrangler.toml 只声明 binding（不存 id），由 wrangler 4.x 的
Automatic provisioning 在部署时自动创建/关联 KV namespace。
`)
  process.exit(0)
}

const onlyKv = args.includes("--kv")
const skipBuild = args.includes("--skip-build")

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  try {
    return execSync(cmd, {
      cwd: ROOT,
      stdio: opts.silent ? "pipe" : "inherit",
      encoding: "utf8",
      env: { ...process.env },
    })
  } catch (e) {
    if (opts.silent) return e.stdout || ""
    throw e
  }
}

/** 解析 `wrangler kv namespace list` 输出，返回 { title: id } 映射。
 *  兼容两种 wrangler 输出：
 *    - 4.118+：纯 JSON 数组 [{ id, title, ... }]
 *    - 旧版：表格行（│ <id> │ <title> │，兼容 | 和 │，Windows 用 Unicode 竖线） */
function parseNamespaceList(stdout) {
  const map = {}
  const text = String(stdout || "").trim()
  if (text) {
    const start = text.indexOf("[")
    const end = text.lastIndexOf("]")
    if (start !== -1 && end > start) {
      try {
        const arr = JSON.parse(text.substring(start, end + 1))
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && item.id && item.title) {
              map[String(item.title)] = String(item.id)
            }
          }
          return map
        }
      } catch {
        // JSON 解析失败时退回表格解析
      }
    }
  }
  // 表格行: │ <id> │ <title> │
  const re = /[|│]\s*([0-9a-fA-F]{32})\s*[|│]\s*([^|│\n]+?)\s*[|│]/g
  let m
  while ((m = re.exec(stdout)) !== null) {
    map[m[2].trim()] = m[1].trim()
  }
  return map
}

/** 从 `wrangler kv namespace create` 输出提取 id（剥离 ANSI 颜色码）。
 *  兼容：旧版 `id = "..."`、以及个别环境直接输出 JSON `{ "id": "..." }`。
 *  注意：wrangler 4.118+ 创建成功不再打印 id（只打印 ✨ Success!），
 *  此时返回 null，调用方应改用「创建后重新 list 校验」。 */
function parseCreatedId(stdout) {
  const clean = String(stdout || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim()
  if (clean) {
    const jsonStart = clean.indexOf("{")
    const jsonEnd = clean.lastIndexOf("}")
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      try {
        const obj = JSON.parse(clean.substring(jsonStart, jsonEnd + 1))
        if (obj && obj.id) return String(obj.id)
      } catch {
        // fall through to text regex
      }
    }
  }
  const m = clean.match(/id\s*=\s*"([0-9a-fA-F]{32})"/)
  return m ? m[1] : null
}

/** 确保 OPENLIST_KV namespace 存在（不存在则创建）。
 *  注意：只创建云端资源，不修改 wrangler.toml —— id 由 wrangler 自动配置。 */
function ensureKvNamespace() {
  let listOut = ""
  try {
    listOut = run("npx wrangler kv namespace list", { silent: true })
  } catch (e) {
    console.error(
      "\n[错误] 无法查询 KV namespace。请先登录 wrangler：\n" +
        "  npx wrangler login\n" +
        "或在环境变量中设置 CLOUDFLARE_API_TOKEN（需要 Workers KV 权限）。",
    )
    process.exit(1)
  }

  const namespaces = parseNamespaceList(listOut)
  const matchedTitle = Object.keys(namespaces).find(
    (t) => t === KV_TITLE || t.includes(KV_TITLE),
  )
  if (matchedTitle) {
    console.log(
      `[KV] 找到 namespace "${matchedTitle}" (id=${namespaces[matchedTitle]})，` +
        `部署时由 wrangler Automatic provisioning 自动绑定`,
    )
    return
  }

  console.log(`[KV] 未找到名为 ${KV_TITLE} 的 namespace，正在创建 ...`)
  let createOut = ""
  try {
    createOut = run(`npx wrangler kv namespace create ${KV_TITLE}`, {
      silent: true,
    })
    console.log(createOut.trim())
  } catch (e) {
    // 并发或历史残留导致的「已存在」等错误：不阻塞，交给下方 list 二次确认
    const msg = String(e.stdout || e.stderr || e.message || e).trim()
    if (!/already exists|10014/i.test(msg)) {
      console.warn(`[KV] create 输出异常（将尝试二次校验）: ${msg.slice(0, 500)}`)
    }
  }

  // 兜底 1：老版本 create 会打印 id = "..."
  const id = parseCreatedId(createOut)
  if (id) {
    console.log(
      `[KV] 已创建 namespace ${KV_TITLE} (id=${id})。` +
        `wrangler.toml 无需改动 —— wrangler 4.x 部署时会自动绑定同名 namespace。`,
    )
    return
  }

  // 兜底 2：wrangler 4.118+ 创建成功不再输出 id，以创建后 list 结果确认为准
  let afterOut = ""
  try {
    afterOut = run("npx wrangler kv namespace list", { silent: true })
  } catch {
    afterOut = ""
  }
  const after = parseNamespaceList(afterOut)
  const afterTitle = Object.keys(after).find(
    (t) => t === KV_TITLE || t.includes(KV_TITLE),
  )
  if (afterTitle) {
    console.log(
      `[KV] 已确认 namespace "${afterTitle}" (id=${after[afterTitle]})。` +
        `wrangler.toml 无需改动 —— wrangler 4.x 部署时会自动绑定同名 namespace。`,
    )
    return
  }

  console.error("[错误] 无法在创建后确认 KV namespace，请检查 wrangler list/create 输出。")
  process.exit(1)
}

function main() {
  console.log(
    `[KV] wrangler.toml 仅声明绑定（不存 id），由 wrangler 自动配置。`,
  )

  // 确保 KV namespace 存在（兜底创建，不写 wrangler.toml）
  ensureKvNamespace()

  if (onlyKv) {
    console.log("\n✅ KV namespace 已就绪，执行 `npm run deploy` 完成部署")
    return
  }

  // 获取前端产物（可选）：从官方前端 OpenList-Frontend 获取构建产物
  if (!skipBuild) {
    console.log("\n[构建] 正在获取官方前端构建产物 ...")
    run("node scripts/fetch-frontend.mjs")
  } else {
    console.log("\n[构建] 跳过前端构建（--skip-build）")
  }

  // 部署（wrangler 4.x Automatic provisioning 自动创建/关联 KV）
  console.log("\n[部署] 正在部署到 Cloudflare Workers ...")
  run("npx wrangler deploy")

  console.log("\n✅ 部署完成！")
  console.log("   验证：访问 https://<你的域名>/api/health 应返回 OpenList")
}

main()
