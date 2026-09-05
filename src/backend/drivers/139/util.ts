import CryptoJS from "crypto-js"
import {
  Yun139Addition,
  QueryRoutePolicyResp,
  Yun139DiskResp,
  Yun139DownloadResp,
  Yun139FileItem,
  Yun139StorageDetailsResp,
  PersonalListResp,
  PersonalDownloadResp,
  PersonalFileItem,
  QueryContentListResp,
  FamilyDownloadResp,
  AndAlbumResultResp,
  ShareRef,
  ShareListResp,
  ShareContentInfoResp,
  ShareDownloadResp,
} from "./types"

export function encodeURIComponentCustom(str: string): string {
  let r = encodeURIComponent(str)
  r = r.replace(/\+/g, "%20")
  r = r.replace(/!/g, "%21")
  r = r.replace(/'/g, "%27")
  r = r.replace(/\(/g, "%28")
  r = r.replace(/\)/g, "%29")
  r = r.replace(/\*/g, "%2A")
  return r
}

export function md5(str: string): string {
  return CryptoJS.MD5(str).toString(CryptoJS.enc.Hex)
}

export function calSign(body: string, ts: string, randStr: string): string {
  const enc = encodeURIComponentCustom(body)
  const sorted = enc.split("").sort().join("")
  const words = CryptoJS.enc.Utf8.parse(sorted)
  const b64 = CryptoJS.enc.Base64.stringify(words)
  const res = md5(b64) + md5(`${ts}:${randStr}`)
  return md5(res).toUpperCase()
}

export function randomString(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let res = ""
  for (let i = 0; i < len; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return res
}

export function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/* ===================== 二进制 / AES-CBC 助手 ===================== */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

function asciiToHex(s: string): string {
  let out = ""
  for (const ch of s) {
    out += ch.charCodeAt(0).toString(16).padStart(2, "0")
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function bytesToWordArray(bytes: Uint8Array): any {
  const words: number[] = []
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) << 24) |
        (((bytes[i + 1] ?? 0) << 16) & 0xffffff) |
        (((bytes[i + 2] ?? 0) << 8) & 0xffff) |
        ((bytes[i + 3] ?? 0) & 0xff),
    )
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length)
}

function wordArrayToBytes(wa: any): Uint8Array {
  const len = wa.sigBytes
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
  }
  return out
}

function aesCbcEncryptBytes(
  plain: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const enc = CryptoJS.AES.encrypt(bytesToWordArray(plain), bytesToWordArray(key), {
    iv: bytesToWordArray(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  })
  return wordArrayToBytes(enc.ciphertext)
}

function aesCbcDecryptBytes(
  cipher: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const dec = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: bytesToWordArray(cipher) }),
    bytesToWordArray(key),
    {
      iv: bytesToWordArray(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  )
  return wordArrayToBytes(dec)
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

const decoder = new TextDecoder()

/** 按 key 排序后紧凑序列化 JSON（与 Go sortedJsonStringify 语义对齐） */
export function sortedJsonStringify(value: any): string {
  if (value === null || value === undefined) return "null"
  const t = typeof value
  if (t === "string") return JSON.stringify(value)
  if (t === "number" || t === "boolean") return String(value)
  if (Array.isArray(value)) {
    return "[" + value.map((v) => sortedJsonStringify(v)).join(",") + "]"
  }
  if (t === "object") {
    const keys = Object.keys(value).sort()
    const parts: string[] = []
    for (const k of keys) {
      const v = (value as any)[k]
      if (v === undefined) continue
      parts.push(JSON.stringify(k) + ":" + sortedJsonStringify(v))
    }
    return "{" + parts.join(",") + "}"
  }
  return JSON.stringify(String(value))
}

/* 分享加密通道使用的 AES 密钥：hex("PVGDwmcvfs1uV3d1")，AES-128 */
const shareAesKeyHex = asciiToHex("PVGDwmcvfs1uV3d1")
/* andAlbum / 相册 / 登录 第一层 AES 密钥（AES-256） */
const KEY_HEX_1 = "73634235495062495331515373756c734e7253306c673d3d"

/**
 * 139 分享/相册加密请求公共流程：
 *  1. body 排序序列化 → AES/CBC 加密 → base64(iv+cipher) 作为请求体；
 *  2. 响应若以 '{' 开头则视为明文 JSON，否则 base64 解码后 AES/CBC 解密。
 */
async function yun139EncryptedRequest(
  url: string,
  bodyObj: any,
  headers: Record<string, string>,
  aesKeyHex: string,
): Promise<any> {
  const keyBytes = hexToBytes(aesKeyHex)
  const sorted = sortedJsonStringify(bodyObj || {})
  const ivBytes = wordArrayToBytes(CryptoJS.lib.WordArray.random(16))
  const encrypted = aesCbcEncryptBytes(
    new TextEncoder().encode(sorted),
    keyBytes,
    ivBytes,
  )
  const payload = bytesToBase64(concatBytes(ivBytes, encrypted))

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json;charset=UTF-8",
    },
    body: payload,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`139 encrypted API error (${res.status}): ${text}`)
  }

  const raw = (await res.text()).trim()
  let text = raw
  if (raw.length > 0 && raw[0] !== "{") {
    const decoded = base64ToBytes(raw)
    if (decoded.length < 16) {
      throw new Error(
        `139 encrypted API: decoded response too short. Raw: ${raw.slice(0, 120)}`,
      )
    }
    text = decoder.decode(aesCbcDecryptBytes(decoded.slice(16), keyBytes, decoded.slice(0, 16)))
  }

  let json: any
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(
      `139 encrypted API: failed to parse response. Body: ${text.slice(0, 200)}`,
    )
  }
  if (json && json.success === false && json.message) {
    throw new Error(`139 encrypted API error: ${json.message}`)
  }
  return json
}

/* ===================== 分享 ref 编解码 ===================== */

export const MULTI_SHARE_REF_PREFIX = "shares:"

function pathEscape(s: string): string {
  return encodeURIComponent(s)
}

function pathUnescape(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function base64UrlEncode(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function base64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  return decoder.decode(base64ToBytes(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")))
}

export function encodeShareRef(ref: ShareRef): string {
  return (
    pathEscape(ref.linkID) +
    "|" +
    pathEscape(ref.password) +
    "|" +
    pathEscape(ref.nodeID)
  )
}

export function decodeShareRef(id: string): ShareRef | null {
  const parts = id.split("|")
  if (parts.length !== 3) return null
  const linkID = pathUnescape(parts[0])
  const password = pathUnescape(parts[1])
  const nodeID = pathUnescape(parts[2])
  if (linkID === "") return null
  return { linkID, password, nodeID }
}

export function encodeShareRefs(refs: ShareRef[]): string {
  if (refs.length === 1) {
    return encodeShareRef(refs[0])
  }
  return MULTI_SHARE_REF_PREFIX + base64UrlEncode(JSON.stringify(refs))
}

export function decodeShareRefs(id: string): ShareRef[] | null {
  if (!id.startsWith(MULTI_SHARE_REF_PREFIX)) {
    const ref = decodeShareRef(id)
    return ref ? [ref] : null
  }
  try {
    const data = base64UrlDecode(id.slice(MULTI_SHARE_REF_PREFIX.length))
    const refs = JSON.parse(data) as ShareRef[]
    if (!Array.isArray(refs) || refs.length === 0) return null
    return refs
  } catch {
    return null
  }
}

/** 解析 link_id 配置：支持逗号/分号/换行分隔多个分享；link_id#password 带密码 */
export function parseShareEntries(raw: string): Array<{ linkID: string; password: string }> {
  if (!raw) return []
  const entries: Array<{ linkID: string; password: string }> = []
  const parts = raw.split(/[\n\r,;]/)
  for (let part of parts) {
    part = part.trim()
    if (!part) continue
    let linkID = part
    let password = ""
    const hashIdx = part.indexOf("#")
    if (hashIdx >= 0) {
      linkID = part.substring(0, hashIdx).trim()
      password = part.substring(hashIdx + 1).trim()
    }
    if (linkID) {
      entries.push({ linkID, password })
    }
  }
  return entries
}

function yun139TimeToIso(t?: string): string {
  if (!t) return new Date().toISOString()
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(t)
  if (!m) return new Date().toISOString()
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  )
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

/* ===================== API 客户端 ===================== */

export class Yun139ApiClient {
  private addition: Yun139Addition
  public personalHost = "https://yun.139.com"
  public familyHost = "https://yun.139.com"
  public groupHost = "https://yun.139.com"
  public account = ""

  constructor(addition: Yun139Addition) {
    this.addition = addition
    this.extractAccount()
  }

  private extractAccount(): void {
    if (!this.addition.authorization) return
    try {
      const authStr = this.getAuthString()
      const decoded = CryptoJS.enc.Base64.parse(authStr).toString(
        CryptoJS.enc.Utf8,
      )
      const splits = decoded.split(":")
      if (splits.length >= 2) {
        this.account = splits[1]
      }
    } catch {
      // Ignored
    }
  }

  public getAuthString(): string {
    let auth = (this.addition.authorization || "").trim()
    if (auth.startsWith("Basic ")) {
      auth = auth.slice(6).trim()
    }
    return auth
  }

  isPersonalNew(): boolean {
    return !this.addition.type || this.addition.type === "personal_new"
  }

  isFamily(): boolean {
    return this.addition.type === "family"
  }

  isGroup(): boolean {
    return this.addition.type === "group"
  }

  isShare(): boolean {
    return this.addition.type === "share"
  }

  getHost(): string {
    if (this.isFamily()) return this.familyHost
    if (this.isGroup()) return this.groupHost
    return this.personalHost
  }

  async request<T = any>(uriOrUrl: string, body: any): Promise<T> {
    const ts = formatTime(new Date())
    const randStr = randomString(16)
    const bodyStr = JSON.stringify(body || {})
    const sign = calSign(bodyStr, ts, randStr)

    let url: string
    if (uriOrUrl.startsWith("http://") || uriOrUrl.startsWith("https://")) {
      url = uriOrUrl
    } else if (uriOrUrl.startsWith("/orchestration/")) {
      // Orchestration APIs are strictly hosted on yun.139.com
      url = `https://yun.139.com${uriOrUrl}`
    } else {
      url = `${this.getHost()}${uriOrUrl}`
    }

    const svcType = this.isFamily() ? "2" : "1"
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "CMS-DEVICE": "default",
      Authorization: `Basic ${this.getAuthString()}`,
      Caller: "web",
      "Mcloud-Channel": "1000101",
      "Mcloud-Client": "10701",
      "Mcloud-Route": "001",
      "mcloud-channel": "1000101",
      "mcloud-client": "10701",
      "mcloud-sign": `${ts},${randStr},${sign}`,
      "mcloud-version": "7.14.0",
      Origin: "https://yun.139.com",
      Referer: "https://yun.139.com/w/",
      "x-DeviceInfo": "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||",
      "x-huawei-channelSrc": "10000034",
      "x-inner-ntwk": "2",
      "x-m4c-caller": "PC",
      "x-m4c-src": "10002",
      "x-SvcType": svcType,
      "Inner-Hcy-Router-Https": "1",
      "X-Yun-Api-Version": "v1",
      "X-Yun-App-Channel": "10000034",
      "X-Yun-Channel-Source": "10000034",
      "X-Yun-Client-Info":
        "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||dW5kZWZpbmVk||",
      "X-Yun-Module-Type": "100",
      "X-Yun-Svc-Type": "1",
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`139 Cloud API error (${res.status}): ${text}`)
    }

    const json = (await res.json()) as any
    if (json.success === false && json.message) {
      throw new Error(`139 Cloud API error: ${json.message}`)
    }
    return json as T
  }

  async init(): Promise<void> {
    if (!this.addition.authorization) {
      throw new Error("139 Cloud Authorization is required")
    }

    try {
      const routeRes = await this.request<QueryRoutePolicyResp>(
        "https://user-njs.yun.139.com/user/route/qryRoutePolicy",
        {
          userInfo: {
            userType: 1,
            accountType: 1,
            accountName: this.account,
          },
          modAddrType: 1,
        },
      )

      if (routeRes.data?.routePolicyList) {
        for (const policy of routeRes.data.routePolicyList) {
          if (policy.modName === "personal" && policy.httpsUrl) {
            this.personalHost = policy.httpsUrl
          } else if (policy.modName === "group" && policy.httpsUrl) {
            this.groupHost = policy.httpsUrl
          } else if (policy.modName === "family" && policy.httpsUrl) {
            this.familyHost = policy.httpsUrl
          }
        }
      }
    } catch (e) {
      console.warn(
        "[139] queryRoutePolicy warning, fallback to default host:",
        e,
      )
    }
  }

  async listFiles(folderId = ""): Promise<{
    files: Yun139FileItem[]
    folders: Array<{
      catalogID: string
      catalogName: string
      updateTime?: string
    }>
  }> {
    if (this.isPersonalNew()) {
      let nextPageCursor = ""
      const allItems: PersonalFileItem[] = []
      const parentFileId = folderId || this.addition.root_folder_id || "/"

      do {
        const res = await this.request<PersonalListResp>("/file/list", {
          parentFileId,
          pageInfo: {
            pageCursor: nextPageCursor,
            pageSize: 100,
          },
          orderBy: "updated_at",
          orderDirection: "DESC",
          imageThumbnailStyleList: ["Small", "Large"],
        })

        const items = res.data?.items || []
        allItems.push(...items)
        nextPageCursor = res.data?.nextPageCursor || ""
      } while (nextPageCursor)

      const folders = allItems
        .filter((i) => i.type === "folder")
        .map((i) => ({
          catalogID: i.fileId,
          catalogName: i.name,
          updateTime: i.updatedAt,
        }))

      const files: Yun139FileItem[] = allItems
        .filter((i) => i.type !== "folder")
        .map((i) => ({
          contentID: i.fileId,
          contentName: i.name,
          contentSize: i.size,
          updateTime: i.updatedAt,
          createTime: i.createdAt,
          thumbnailURL: i.thumbnailUrls?.[0]?.url,
        }))

      return { files, folders }
    }

    return this.getDisk(folderId)
  }

  async getDisk(catalogId = ""): Promise<{
    files: Yun139FileItem[]
    folders: Array<{
      catalogID: string
      catalogName: string
      updateTime?: string
    }>
  }> {
    const res = await this.request<Yun139DiskResp>(
      "/orchestration/personalCloud/catalog/v1.0/getDisk",
      {
        catalogID: catalogId || "",
        sortDirection: 1,
        filterType: 0,
        catalogSortType: 0,
        contentSortType: 0,
        startNumber: 1,
        endNumber: 5000,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )

    const diskResult = res.data?.getDiskResult
    return {
      files: diskResult?.fileList || [],
      folders: diskResult?.catalogList || [],
    }
  }

  async getDownloadUrl(contentIdOrFileId: string): Promise<string> {
    if (this.isPersonalNew()) {
      const res = await this.request<PersonalDownloadResp>(
        "/file/getDownloadUrl",
        {
          fileId: contentIdOrFileId,
        },
      )
      const url =
        (res.data?.cdnSwitch ? res.data?.cdnUrl : null) ||
        res.data?.url ||
        res.data?.cdnUrl
      if (!url) {
        throw new Error("Empty download URL received from 139 Cloud")
      }
      return url
    }

    const res = await this.request<Yun139DownloadResp>(
      "/orchestration/personalCloud/uploadAndDownload/v1.0/downloadRequest",
      {
        contentID: contentIdOrFileId,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )

    const url = res.data?.downloadURL || res.data?.url
    if (!url) {
      throw new Error("Empty download URL received from 139 Cloud")
    }
    return url
  }

  async createCatalog(parentCatalogId: string, name: string): Promise<string> {
    if (this.isPersonalNew()) {
      const res = await this.request<any>("/file/create", {
        parentFileId: parentCatalogId || this.addition.root_folder_id || "/",
        name,
        description: "",
        type: "folder",
        fileRenameMode: "force_rename",
      })
      return res.data?.fileId || ""
    }

    const res = await this.request<any>(
      "/orchestration/personalCloud/catalog/v1.0/createCatalog",
      {
        parentCatalogID: parentCatalogId || "",
        catalogName: name,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
    return res.data?.catalogID || ""
  }

  async deleteFile(contentIdOrFileId: string): Promise<void> {
    if (this.isPersonalNew()) {
      await this.request("/file/delete", {
        fileIds: [contentIdOrFileId],
      })
      return
    }

    await this.request(
      "/orchestration/personalCloud/catalog/v1.0/deleteContent",
      {
        contentID: contentIdOrFileId,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
  }

  async deleteCatalog(catalogIdOrFileId: string): Promise<void> {
    if (this.isPersonalNew()) {
      await this.request("/file/delete", {
        fileIds: [catalogIdOrFileId],
      })
      return
    }

    await this.request(
      "/orchestration/personalCloud/catalog/v1.0/deleteCatalog",
      {
        catalogID: catalogIdOrFileId,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
  }

  async rename(id: string, newName: string): Promise<void> {
    if (this.isPersonalNew()) {
      await this.request("/file/update", {
        fileId: id,
        name: newName,
        description: "",
      })
      return
    }

    await this.request(
      "/orchestration/personalCloud/catalog/v1.0/updateCatalogInfo",
      {
        catalogID: id,
        catalogName: newName,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
  }

  async getStorageDetails(): Promise<{ total?: number; used?: number }> {
    try {
      const res = await this.request<Yun139StorageDetailsResp>(
        "/orchestration/personalCloud/catalog/v1.0/getUserDomainInfo",
        {
          commonAccountInfo: {
            account: this.account,
            accountType: 1,
          },
        },
      )
      return {
        total: res.data?.totalSize,
        used: res.data?.usedSize,
      }
    } catch {
      return {}
    }
  }

  /* ===================== 家庭云 family ===================== */

  /** family 通用追加字段：catalogType=3 + cloudID/cloudType + commonAccountInfo */
  private familyJson(data: Record<string, any>): Record<string, any> {
    return {
      catalogType: 3,
      cloudID: this.addition.cloud_id || "",
      cloudType: 1,
      commonAccountInfo: {
        account: this.account,
        accountType: 1,
      },
      ...data,
    }
  }

  /** 目录浏览（分页拉取）。catalogId 传空字符串表示家庭云根目录。 */
  async familyList(catalogId = ""): Promise<{
    files: Yun139FileItem[]
    folders: Array<{
      catalogID: string
      catalogName: string
      updateTime?: string
    }>
    path: string
  }> {
    const folders: Array<{
      catalogID: string
      catalogName: string
      updateTime?: string
    }> = []
    const files: Yun139FileItem[] = []
    let serverPath = ""
    let pageNum = 1

    for (;;) {
      const data = this.familyJson({
        catalogID: catalogId || "",
        contentSortType: 0,
        pageInfo: {
          pageNum,
          pageSize: 100,
        },
        sortDirection: 1,
      })
      const res = await this.request<QueryContentListResp>(
        "/orchestration/familyCloud-rebuild/content/v1.2/queryContentList",
        data,
      )

      serverPath = res.data?.path || serverPath
      const catalogs = res.data?.cloudCatalogList || []
      const contents = res.data?.cloudContentList || []
      for (const c of catalogs) {
        folders.push({
          catalogID: c.catalogID || "",
          catalogName: c.catalogName || "",
          updateTime: c.lastUpdateTime || c.createTime,
        })
      }
      for (const c of contents) {
        files.push({
          contentID: c.contentID,
          contentName: c.contentName,
          contentSize: c.contentSize,
          updateTime: c.lastUpdateTime || c.createTime,
          createTime: c.createTime,
          thumbnailURL: c.thumbnailURL || c.bigThumbnailURL,
        })
      }
      const total = res.data?.totalCount ?? 0
      if (total === 0 || catalogs.length + contents.length < 100) break
      pageNum++
    }

    return { files, folders, path: serverPath }
  }

  /** 家庭云下载直链：path 为文件所在目录的服务器 path（来自 familyList 的 path）。 */
  async familyDownloadUrl(contentID: string, path: string): Promise<string> {
    const res = await this.request<FamilyDownloadResp>(
      "/orchestration/familyCloud-rebuild/content/v1.0/getFileDownLoadURL",
      this.familyJson({ contentID, path }),
    )
    const url = res.data?.downloadURL
    if (!url) {
      throw new Error("Empty family download URL received from 139 Cloud")
    }
    return url
  }

  /** 家庭云新建目录：parentFullPath 为目标父目录的服务器 path。 */
  async familyCreateFolder(
    docLibName: string,
    parentFullPath: string,
  ): Promise<void> {
    await this.request(
      "/orchestration/familyCloud-rebuild/cloudCatalog/v1.0/createCloudDoc",
      this.familyJson({
        docLibName,
        path: parentFullPath,
      }),
    )
  }

  /** 家庭云重命名文件夹（andAlbum 加密通道）。fullPath 为该目录自身的服务器 path。 */
  async familyRenameFolder(
    docLibraryID: string,
    newName: string,
    fullPath: string,
  ): Promise<void> {
    const body = {
      catalogType: 3,
      cloudID: this.addition.cloud_id || "",
      commonAccountInfo: {
        account: this.account,
        accountType: "1",
      },
      docLibName: newName,
      docLibraryID,
      path: fullPath,
    }
    const res = await this.andAlbumRequest("/modifyCloudDocV2", body)
    const rc = res?.result?.resultCode ?? (res?.success === false ? res?.message : "")
    if (rc && rc !== "0") {
      throw new Error(`Failed to rename family folder: ${res?.result?.resultDesc || rc}`)
    }
  }

  /** 家庭云重命名文件。path 为文件所在目录的服务器 path。 */
  async familyRenameFile(
    contentID: string,
    contentName: string,
    path: string,
  ): Promise<void> {
    await this.request(
      "/orchestration/familyCloud-rebuild/photoContent/v1.0/modifyContentInfo",
      this.familyJson({ contentID, contentName, path }),
    )
  }

  /** 家庭云删除（回收站）。path 为被删对象所在目录的服务器 path。 */
  async familyRemoveBatch(
    catalogIds: string[],
    contentIds: string[],
    path: string,
  ): Promise<void> {
    await this.request(
      "/orchestration/familyCloud-rebuild/batchOprTask/v1.0/createBatchOprTask",
      {
        catalogList: catalogIds,
        contentList: contentIds,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
        sourceCloudID: this.addition.cloud_id || "",
        sourceCatalogType: 1002,
        taskType: 2,
        path,
      },
    )
  }

  /** andAlbum 加密请求（家庭云相册/文档操作，FamilyCloudHost + KEY_HEX_1）。 */
  async andAlbumRequest(
    pathname: string,
    body: any,
  ): Promise<AndAlbumResultResp> {
    const url = this.familyHost + "/andAlbum/openApi" + pathname
    const headers: Record<string, string> = {
      authorization: "Basic " + this.getAuthString(),
      "x-svctype": "2",
      "hcy-cool-flag": "1",
      "api-version": "v2",
      "x-huawei-channelsrc": "10246600",
      "x-sdk-channelsrc": "",
      "x-mm-source": "0",
      "x-deviceinfo":
        "1|127.0.0.1|1|12.3.2|Xiaomi|23116PN5BC||02-00-00-00-00-00|android 15|1440x3200|android|zh||||032|0|",
      "content-type": "application/json; charset=utf-8",
      "user-agent": "okhttp/4.11.0",
      "accept-encoding": "gzip",
    }
    return yun139EncryptedRequest(url, body, headers, KEY_HEX_1) as Promise<AndAlbumResultResp>
  }

  /* ===================== 分享链接 share ===================== */

  private shareHeaders(): Record<string, string> {
    let auth = this.getAuthString()
    if (auth && !/^basic /i.test(auth)) {
      auth = "Basic " + auth
    }
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      "X-Deviceinfo": "||9|12.27.0|firefox|140.0|||linux unknown|1920X526|zh-CN|||",
      "hcy-cool-flag": "1",
      "CMS-DEVICE": "default",
      "x-m4c-caller": "PC",
      "X-Yun-Api-Version": "v1",
      Origin: "https://yun.139.com",
      Referer: "https://yun.139.com/",
    }
    if (auth) {
      headers["Authorization"] = auth
    }
    return headers
  }

  private async sharePost(pathname: string, data: any): Promise<any> {
    const url = "https://share-kd-njs.yun.139.com/yun-share" + pathname
    return yun139EncryptedRequest(url, data, this.shareHeaders(), shareAesKeyHex)
  }

  shareRootRefs(): ShareRef[] {
    return parseShareEntries(this.addition.link_id || "").map((e) => ({
      linkID: e.linkID,
      password: e.password,
      nodeID: "root",
    }))
  }

  /** 通过单个分享 ref 浏览目录（返回通用 files/folders 结构，sign 内编码 ref）。 */
  async shareListByRef(ref: ShareRef, pCaID?: string): Promise<{
    files: Yun139FileItem[]
    folders: Array<{ catalogID: string; catalogName: string; updateTime?: string }>
  }> {
    if (!ref.nodeID) ref.nodeID = "root"
    const caID = pCaID || ref.nodeID
    const resp = await this.sharePost(
      "/richlifeApp/devapp/IOutLink/getOutLinkInfoV6",
      {
        getOutLinkInfoReq: {
          account: this.account,
          linkID: ref.linkID,
          passwd: ref.password,
          pCaID: caID,
        },
      },
    ) as ShareListResp

    const folders: Array<{ catalogID: string; catalogName: string; updateTime?: string }> =
      (resp.data?.caLst || []).map((c) => ({
        catalogID: encodeShareRef({
          linkID: ref.linkID,
          password: ref.password,
          nodeID: c.caId || "",
        }),
        catalogName: c.caName || "",
        updateTime: yun139TimeToIso(c.udTime),
      }))
    const files: Yun139FileItem[] = (resp.data?.coLst || []).map((c) => ({
      contentID: encodeShareRef({
        linkID: ref.linkID,
        password: ref.password,
        nodeID: c.coId || "",
      }),
      contentName: c.coName || "",
      contentSize: c.coSize,
      updateTime: yun139TimeToIso(c.udTime),
      createTime: yun139TimeToIso(c.udTime),
    }))
    return { files, folders }
  }

  /** 合并多个分享的根目录/同名目录（与 Go shareGetMergedFiles 对齐）。 */
  async shareListMerged(refs: ShareRef[]): Promise<{
    files: Yun139FileItem[]
    folders: Array<{ catalogID: string; catalogName: string; updateTime?: string }>
  }> {
    const files: Yun139FileItem[] = []
    const folders: Array<{ catalogID: string; catalogName: string; updateTime?: string }> = []
    const folderIndex = new Map<string, number>()
    let firstErr: Error | null = null

    for (const ref of refs) {
      let items: { files: Yun139FileItem[]; folders: Array<{ catalogID: string; catalogName: string; updateTime?: string }> }
      try {
        items = await this.shareListByRef(ref, ref.nodeID)
      } catch (e) {
        if (!firstErr) firstErr = e as Error
        continue
      }
      for (const f of items.files) {
        files.push(f)
      }
      for (const d of items.folders) {
        const idx = folderIndex.get(d.catalogName)
        if (idx === undefined) {
          folderIndex.set(d.catalogName, folders.length)
          folders.push(d)
          continue
        }
        // 同名目录：合并 ref（Go 中仅当双方均为目录时合并）
        const existingRefs = decodeShareRefs(folders[idx].catalogID)
        const newRefs = decodeShareRefs(d.catalogID)
        if (existingRefs && newRefs) {
          folders[idx] = {
            catalogID: encodeShareRefs([...existingRefs, ...newRefs]),
            catalogName: d.catalogName,
            updateTime: d.updateTime,
          }
        }
      }
    }
    if (folders.length === 0 && files.length === 0 && firstErr) {
      throw firstErr
    }
    return { files, folders }
  }

  /** 分享文件下载：先取内容信息，再请求下载 URL（参考 Go shareGetLinkWithRef 的下载分支）。 */
  async shareDownloadUrl(ref: ShareRef, coID: string): Promise<string> {
    const infoResp = await this.sharePost(
      "/richlifeApp/devapp/IOutLink/getContentInfoFromOutLink",
      {
        getContentInfoFromOutLinkReq: {
          contentId: coID,
          linkID: ref.linkID,
          passwd: ref.password,
          account: this.account,
        },
      },
    ) as ShareContentInfoResp
    const presentURL = infoResp.data?.contentInfo?.presentURL || ""

    if (!this.account) {
      if (presentURL) return presentURL
      throw new Error("139 share download requires account authentication")
    }

    const dlResp = await this.sharePost(
      "/richlifeApp/devapp/IOutLink/dlFromOutLinkV3",
      {
        dlFromOutLinkReqV3: {
          account: this.account,
          linkID: ref.linkID,
          passwd: ref.password,
          coIDLst: {
            item: [coID],
          },
        },
      },
    ) as ShareDownloadResp

    const cdn = dlResp.data?.extInfo?.cdnDownloadUrl
    const redr = dlResp.data?.redrUrl
    const direct = dlResp.data?.downloadURL
    if (cdn) return cdn
    if (redr) return redr
    if (direct) return direct
    if (presentURL) return presentURL
    throw new Error("Failed to get 139 share download link")
  }
}
