import {
  calcFileType,
  FileItem,
  StorageDriver,
} from "../../internal/driver/base"
import { sortFileItems } from "../../internal/driver/sort"
import { Yun139Addition } from "./types"
import { Yun139ApiClient, decodeShareRefs } from "./util"

type FolderLike = { catalogID: string; catalogName: string; updateTime?: string }
type FileLike = {
  contentID?: string
  contentName?: string
  contentSize?: number | string
  createTime?: string
  updateTime?: string
  thumbnailURL?: string
  bigThumbnailURL?: string
}

export class Yun139Driver implements StorageDriver {
  private addition: Yun139Addition
  private client: Yun139ApiClient

  constructor(addition: Yun139Addition) {
    this.addition = addition
    this.client = new Yun139ApiClient(addition)
  }

  async init(): Promise<void> {
    // 分享类型允许无授权浏览；其余类型需要有 authorization 并做路由探测
    if (this.client.isShare() && !(this.addition.authorization || "").trim()) {
      return
    }
    await this.client.init()
  }

  private cleanPath(p: string): string {
    const s = "/" + (p || "").split("/").filter(Boolean).join("/")
    return s === "/" ? "/" : s
  }

  private nowIso(): string {
    return new Date().toISOString()
  }

  private isShare(): boolean {
    return this.client.isShare()
  }

  private isFamily(): boolean {
    return this.client.isFamily()
  }

  /* ---------------- 通用映射 ---------------- */

  private mapFolder(f: FolderLike): FileItem {
    return {
      name: f.catalogName,
      size: 0,
      is_dir: true,
      modified: f.updateTime || this.nowIso(),
      sign: f.catalogID,
      type: 1,
      raw_url: "",
    }
  }

  private mapFile(f: FileLike): FileItem {
    const sizeNum =
      typeof f.contentSize === "number"
        ? f.contentSize
        : parseInt(String(f.contentSize || "0"), 10)
    const name = f.contentName || "file"
    return {
      name,
      size: isNaN(sizeNum) ? 0 : sizeNum,
      is_dir: false,
      modified: f.updateTime || f.createTime || this.nowIso(),
      sign: f.contentID || name,
      type: calcFileType(name, false),
      thumb: f.thumbnailURL || f.bigThumbnailURL,
      raw_url: "",
    }
  }

  private sort(items: FileItem[]): FileItem[] {
    return sortFileItems(
      items,
      this.addition.order_by,
      this.addition.order_direction,
    )
  }

  /* ---------------- 个人云 ---------------- */

  private getRootId(): string {
    if (this.addition.root_folder_id) {
      return this.addition.root_folder_id
    }
    return this.client.isPersonalNew() ? "/" : ""
  }

  private async resolveCatalogId(physicalPath: string): Promise<string> {
    const clean = this.cleanPath(physicalPath)
    if (clean === "/") {
      return this.getRootId()
    }

    const parts = clean.split("/").filter(Boolean)
    let currentCatalogId = this.getRootId()

    for (const part of parts) {
      const disk = await this.client.listFiles(currentCatalogId)
      const foundFolder = disk.folders.find((f) => f.catalogName === part)
      if (foundFolder) {
        currentCatalogId = foundFolder.catalogID
      } else {
        break
      }
    }

    return currentCatalogId
  }

  private async listPersonal(physicalPath: string): Promise<FileItem[]> {
    const clean = this.cleanPath(physicalPath)
    const catalogId = await this.resolveCatalogId(clean)
    const disk = await this.client.listFiles(catalogId)

    const items = [...disk.folders.map(this.mapFolder), ...disk.files.map(this.mapFile)]
    return this.sort(items)
  }

  private async getPersonal(physicalPath: string): Promise<FileItem> {
    const clean = this.cleanPath(physicalPath)
    const name = clean.split("/").filter(Boolean).pop() || "root"

    if (clean === "/") {
      return {
        name: "root",
        size: 0,
        is_dir: true,
        modified: this.nowIso(),
        sign: this.getRootId(),
        type: 1,
        raw_url: "",
      }
    }

    const parentPath = clean.substring(0, clean.lastIndexOf("/")) || "/"
    const parentCatalogId = await this.resolveCatalogId(parentPath)
    const disk = await this.client.listFiles(parentCatalogId)

    const foundFolder = disk.folders.find((f) => f.catalogName === name)
    if (foundFolder) {
      return this.mapFolder(foundFolder)
    }

    const foundFile = disk.files.find((f) => f.contentName === name)
    if (foundFile) {
      const item = this.mapFile(foundFile)
      if (foundFile.contentID) {
        try {
          const rawUrl = await this.client.getDownloadUrl(foundFile.contentID)
          item.raw_url = rawUrl
        } catch (e) {
          console.warn("[139] failed to get download url in get():", e)
        }
      }
      return item
    }

    throw new Error(`Item not found: ${clean}`)
  }

  /* ---------------- 家庭云 ---------------- */

  /** 家庭云根目录：优先使用 addition.root_folder_id（子目录 catalogID）；
   *  未配置时返回 ""，表示家庭云整体根目录。 */
  private familyRootId(): string {
    return (this.addition.root_folder_id || "").trim()
  }

  /** 按路径解析出目标目录的 catalogID；根目录返回 familyRootId()。 */
  private async familyDirIdForPath(clean: string): Promise<string> {
    if (clean === "/") return this.familyRootId()
    const parts = clean.split("/").filter(Boolean)
    let cur = this.familyRootId()
    for (const part of parts) {
      const disk = await this.client.familyList(cur)
      const found = disk.folders.find((f) => f.catalogName === part)
      if (!found) throw new Error(`Folder not found: ${clean}`)
      cur = found.catalogID
    }
    return cur
  }

  /** 列出指定目录（id 为 "" 时是家庭云根）。 */
  private async listFamilyAt(dirId: string): Promise<FileItem[]> {
    const disk = await this.client.familyList(dirId)
    const items = [
      ...disk.folders.map(this.mapFolder),
      ...disk.files.map(this.mapFile),
    ]
    return this.sort(items)
  }

  private async listFamily(physicalPath: string): Promise<FileItem[]> {
    const clean = this.cleanPath(physicalPath)
    const dirId = await this.familyDirIdForPath(clean)
    return this.listFamilyAt(dirId)
  }

  private async getFamily(physicalPath: string): Promise<FileItem> {
    const clean = this.cleanPath(physicalPath)
    const name = clean.split("/").filter(Boolean).pop() || "root"
    if (clean === "/") {
      return {
        name: "root",
        size: 0,
        is_dir: true,
        modified: this.nowIso(),
        sign: this.familyRootId(),
        type: 1,
        raw_url: "",
      }
    }
    const parentPath = clean.substring(0, clean.lastIndexOf("/")) || "/"
    const parentDirId = await this.familyDirIdForPath(parentPath)
    const disk = await this.client.familyList(parentDirId)
    const folder = disk.folders.find((f) => f.catalogName === name)
    if (folder) return this.mapFolder(folder)
    const file = disk.files.find((f) => f.contentName === name)
    if (file) {
      const item = this.mapFile(file)
      if (file.contentID) {
        try {
          item.raw_url = await this.client.familyDownloadUrl(file.contentID, disk.path)
          item.raw_url_headers = {
            Referer: "https://yun.139.com/",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          }
        } catch (e) {
          item.raw_url_error = `139 家庭云获取下载链接失败：${(e as Error)?.message || String(e)}`
          console.warn("[139] family getDownloadUrl failed in get():", e)
        }
      }
      return item
    }
    throw new Error(`Item not found: ${clean}`)
  }

  /* ---------------- 分享链接 ---------------- */

  private async shareMergedForRefs(refs: ReturnType<Yun139ApiClient["shareRootRefs"]>): Promise<{
    files: FileLike[]
    folders: FolderLike[]
  }> {
    const disk = await this.client.shareListMerged(refs)
    return { files: disk.files as FileLike[], folders: disk.folders }
  }

  /** 解析分享目标路径：返回其父目录下匹配该层级的项（用于 get / link / 导航）。 */
  private async shareResolve(clean: string): Promise<FileItem> {
    if (clean === "/") {
      return {
        name: "root",
        size: 0,
        is_dir: true,
        modified: this.nowIso(),
        sign: "root",
        type: 1,
        raw_url: "",
      }
    }
    const parts = clean.split("/").filter(Boolean)
    let refs = this.client.shareRootRefs()
    if (refs.length === 0) throw new Error("[139] link_id is empty")

    // 逐级进入目录；最后一级可能是文件或目录
    let current: { files: FileLike[]; folders: FolderLike[] } | null = null
    let matched: FileItem | null = null

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const listing = await this.shareMergedForRefs(refs)
      current = listing

      const folder = listing.folders.find((f) => f.catalogName === part)
      if (folder) {
        const item = this.mapFolder(folder)
        matched = item
        const next = decodeShareRefs(folder.catalogID)
        if (!next) throw new Error(`Invalid share ref: ${clean}`)
        refs = next
        continue
      }
      const file = listing.files.find((f) => f.contentName === part)
      if (file) {
        matched = this.mapFile(file)
        if (i !== parts.length - 1) throw new Error(`Item not found: ${clean}`)
        // 分享文件：raw 下载流程只读 get() 的 raw_url，这里直接解析直链
        const decoded = decodeShareRefs(matched.sign)
        if (decoded && decoded.length > 0) {
          try {
            matched.raw_url = await this.client.shareDownloadUrl(
              decoded[0],
              decoded[0].nodeID,
            )
          } catch (e) {
            matched.raw_url_error = `139 分享获取下载链接失败：${(e as Error)?.message || String(e)}`
            console.warn("[139] share getDownloadUrl failed in get():", e)
          }
        }
        break
      }
      throw new Error(`Item not found: ${clean}`)
    }

    if (!matched || !current) throw new Error(`Item not found: ${clean}`)
    return matched
  }

  private async listShare(physicalPath: string): Promise<FileItem[]> {
    const clean = this.cleanPath(physicalPath)
    const refs = this.client.shareRootRefs()
    if (refs.length === 0) throw new Error("[139] link_id is empty")

    if (clean === "/") {
      const disk = await this.client.shareListMerged(refs)
      const items = [...disk.folders.map(this.mapFolder), ...disk.files.map(this.mapFile)]
      return this.sort(items)
    }

    // 解析到目录，再列出
    const parts = clean.split("/").filter(Boolean)
    let curRefs = refs
    for (const part of parts) {
      const listing = await this.shareMergedForRefs(curRefs)
      const folder = listing.folders.find((f) => f.catalogName === part)
      if (!folder) throw new Error(`Folder not found: ${clean}`)
      const next = decodeShareRefs(folder.catalogID)
      if (!next) throw new Error(`Invalid share ref: ${clean}`)
      curRefs = next
    }
    const disk = await this.client.shareListMerged(curRefs)
    const items = [...disk.folders.map(this.mapFolder), ...disk.files.map(this.mapFile)]
    return this.sort(items)
  }

  private async linkShare(item: FileItem): Promise<{ url: string; headers?: Record<string, string> }> {
    const decoded = decodeShareRefs(item.sign)
    let ref: ReturnType<Yun139ApiClient["shareRootRefs"]>[number] | null = null
    let coID = item.sign
    if (decoded && decoded.length > 0) {
      ref = decoded[0]
      coID = decoded[0].nodeID
    } else {
      const entries = this.client.shareRootRefs()
      ref = entries.length > 0 ? entries[0] : null
    }
    if (!ref) throw new Error("[139] share ref not found")
    const url = await this.client.shareDownloadUrl(ref, coID)
    return { url }
  }

  /* ---------------- StorageDriver 实现 ---------------- */

  async list(virtualPath: string, physicalPath: string): Promise<FileItem[]> {
    if (this.isShare()) return this.listShare(physicalPath)
    if (this.isFamily()) return this.listFamily(physicalPath)
    return this.listPersonal(physicalPath)
  }

  async get(virtualPath: string, physicalPath: string): Promise<FileItem> {
    if (this.isShare()) return this.shareResolve(this.cleanPath(physicalPath))
    if (this.isFamily()) return this.getFamily(physicalPath)
    return this.getPersonal(physicalPath)
  }

  async link(
    virtualPath: string,
    physicalPath: string,
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    const clean = this.cleanPath(physicalPath)
    const item = await this.get(virtualPath, clean)
    if (item.is_dir) {
      throw new Error(`Cannot get link for folder: ${physicalPath}`)
    }

    // 分享：解码 ref 走 share 加密通道
    if (this.isShare()) {
      return this.linkShare(item)
    }

    // 家庭云：需要在父目录列表中拿服务器 path
    if (this.isFamily()) {
      const parentPath = clean.substring(0, clean.lastIndexOf("/")) || "/"
      const parentDirId = await this.familyDirIdForPath(parentPath)
      const disk = await this.client.familyList(parentDirId)
      const file = disk.files.find((f) => f.contentName === item.name)
      if (!file || !file.contentID) {
        throw new Error(`Item not found: ${physicalPath}`)
      }
      const url = await this.client.familyDownloadUrl(file.contentID, disk.path)
      return {
        url,
        headers: {
          Referer: "https://yun.139.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    }

    const url = await this.client.getDownloadUrl(item.sign)
    return {
      url,
      headers: {
        Referer: "https://yun.139.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }
  }

  async mkdir(virtualPath: string, physicalPath: string): Promise<void> {
    if (this.isShare()) {
      throw new Error("[139] mkdir is not supported for share type")
    }
    if (this.isFamily()) {
      const clean = this.cleanPath(physicalPath)
      const parentPath = clean.substring(0, clean.lastIndexOf("/")) || "/"
      const dirName = clean.substring(clean.lastIndexOf("/") + 1)
      const parentDirId = await this.familyDirIdForPath(parentPath)
      const disk = await this.client.familyList(parentDirId)
      await this.client.familyCreateFolder(dirName, disk.path)
      return
    }
    const clean = this.cleanPath(physicalPath)
    const parentPath = clean.substring(0, clean.lastIndexOf("/")) || "/"
    const dirName = clean.substring(clean.lastIndexOf("/") + 1)
    const parentCatalogId = await this.resolveCatalogId(parentPath)
    await this.client.createCatalog(parentCatalogId, dirName)
  }

  async rename(
    virtualPath: string,
    physicalPath: string,
    newName: string,
  ): Promise<void> {
    if (this.isShare()) {
      throw new Error("[139] rename is not supported for share type")
    }
    if (this.isFamily()) {
      const clean = this.cleanPath(physicalPath)
      const name = clean.split("/").filter(Boolean).pop() || ""
      const parentPath = clean.substring(0, clean.lastIndexOf("/")) || "/"
      const parentDirId = await this.familyDirIdForPath(parentPath)
      const disk = await this.client.familyList(parentDirId)

      const folder = disk.folders.find((f) => f.catalogName === name)
      if (folder) {
        const fullPath = disk.path
          ? `${disk.path}/${folder.catalogID}`
          : `root:/${folder.catalogID}`
        await this.client.familyRenameFolder(folder.catalogID, newName, fullPath)
        return
      }
      const file = disk.files.find((f) => f.contentName === name)
      if (file && file.contentID) {
        await this.client.familyRenameFile(file.contentID, newName, disk.path)
        return
      }
      throw new Error(`Item not found: ${clean}`)
    }
    const item = await this.get(virtualPath, physicalPath)
    await this.client.rename(item.sign, newName)
  }

  async remove(
    virtualPath: string,
    physicalPath: string,
    names: string[],
  ): Promise<void> {
    if (this.isShare()) {
      throw new Error("[139] remove is not supported for share type")
    }
    if (this.isFamily()) {
      const clean = this.cleanPath(physicalPath)
      const dirId = await this.familyDirIdForPath(clean)
      const disk = await this.client.familyList(dirId)
      const catalogIds: string[] = []
      const contentIds: string[] = []
      for (const name of names) {
        const folder = disk.folders.find((f) => f.catalogName === name)
        if (folder) {
          catalogIds.push(folder.catalogID)
        } else {
          const file = disk.files.find((f) => f.contentName === name)
          if (file && file.contentID) contentIds.push(file.contentID)
        }
      }
      await this.client.familyRemoveBatch(catalogIds, contentIds, disk.path)
      return
    }

    const clean = this.cleanPath(physicalPath)
    const catalogId = await this.resolveCatalogId(clean)
    const disk = await this.client.listFiles(catalogId)

    for (const name of names) {
      const folder = disk.folders.find((f) => f.catalogName === name)
      if (folder) {
        await this.client.deleteCatalog(folder.catalogID)
      } else {
        const file = disk.files.find((f) => f.contentName === name)
        if (file && file.contentID) {
          await this.client.deleteFile(file.contentID)
        }
      }
    }
  }

  async move(
    srcDir: string,
    dstDir: string,
    names: string[],
    srcPhys: string,
    dstPhys: string,
  ): Promise<void> {
    console.warn(`[139] move from ${srcPhys} to ${dstPhys}`)
  }

  async copy(
    srcDir: string,
    dstDir: string,
    names: string[],
    srcPhys: string,
    dstPhys: string,
  ): Promise<void> {
    console.warn(`[139] copy from ${srcPhys} to ${dstPhys}`)
  }

  async put(
    virtualPath: string,
    physicalPath: string,
    content: Buffer | Uint8Array,
  ): Promise<void> {
    console.warn(`[139] put for ${physicalPath}`)
  }

  async getDetails(): Promise<{ total_space?: number; used_space?: number }> {
    try {
      const details = await this.client.getStorageDetails()
      return {
        total_space: details.total,
        used_space: details.used,
      }
    } catch {
      return {}
    }
  }
}
