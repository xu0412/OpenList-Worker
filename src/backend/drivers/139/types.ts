export interface Yun139Addition {
  authorization: string
  username?: string
  password?: string
  mail_cookies?: string
  root_folder_id?: string
  type?: "personal_new" | "family" | "group" | "personal" | "share"
  link_id?: string
  cloud_id?: string
  user_domain_id?: string
  custom_upload_part_size?: number
  report_real_size?: boolean
  use_large_thumbnail?: boolean
  use_old_stream_upload?: boolean
  order_by?: string
  order_direction?: string
}

export interface RoutePolicyItem {
  modName: string
  httpsUrl: string
}

export interface QueryRoutePolicyResp {
  code: string
  message: string
  success: boolean
  data: {
    routePolicyList: RoutePolicyItem[]
  }
}

export interface Yun139FileItem {
  contentID?: string
  contentName?: string
  contentSize?: number | string
  contentType?: string
  contentSuffix?: string
  createTime?: string
  updateTime?: string
  digest?: string
  thumbnailURL?: string
  bigThumbnailURL?: string
  fileType?: number
  isDir?: boolean
  caID?: string
}

export interface Yun139FolderItem {
  catalogID: string
  catalogName: string
  createTime?: string
  updateTime?: string
}

/** 个人盘(旧 orchestration) / 通用磁盘列表响应 */
export interface Yun139DiskResp {
  code: string
  message: string
  success: boolean
  data: {
    result?: {
      resultCode: string
      resultDesc: string
    }
    getDiskResult?: {
      nodeCount?: number
      fileList?: Yun139FileItem[]
      catalogList?: Array<{
        catalogID: string
        catalogName: string
        createTime?: string
        updateTime?: string
      }>
    }
  }
}

export interface Yun139DownloadResp {
  code: string
  message: string
  success: boolean
  data: {
    downloadURL?: string
    url?: string
  }
}

export interface Yun139StorageDetailsResp {
  code: string
  message: string
  success: boolean
  data: {
    catalogTotalSize?: number
    freeSize?: number
    totalSize?: number
    usedSize?: number
  }
}

export interface PersonalThumbnail {
  style?: string
  url?: string
}

export interface PersonalFileItem {
  fileId: string
  name: string
  size?: number | string
  type: "folder" | "file" | string
  createdAt?: string
  updatedAt?: string
  thumbnailUrls?: PersonalThumbnail[]
}

export interface PersonalListResp {
  code: string
  message: string
  success: boolean
  data?: {
    items?: PersonalFileItem[]
    nextPageCursor?: string
  }
}

export interface PersonalDownloadResp {
  code: string
  message: string
  success: boolean
  data?: {
    url?: string
    cdnUrl?: string
    cdnSwitch?: boolean
  }
}

/* ===================== 家庭云 (family) ===================== */

export interface FamilyContentItem {
  contentID?: string
  contentName?: string
  contentSize?: number
  contentType?: number
  contentSuffix?: string
  createTime?: string
  lastUpdateTime?: string
  thumbnailURL?: string
  bigThumbnailURL?: string
  presentURL?: string
  digest?: string
}

export interface FamilyCatalogItem {
  catalogID?: string
  catalogName?: string
  createTime?: string
  lastUpdateTime?: string
}

/** familyCloud-rebuild/content/v1.2/queryContentList 响应 */
export interface QueryContentListResp {
  code?: string
  message?: string
  success: boolean
  data?: {
    result?: {
      resultCode?: string
      resultDesc?: string
    }
    path?: string
    cloudContentList?: FamilyContentItem[]
    cloudCatalogList?: FamilyCatalogItem[]
    totalCount?: number
  }
}

/** familyCloud-rebuild/content/v1.0/getFileDownLoadURL 响应 */
export interface FamilyDownloadResp {
  code?: string
  message?: string
  success: boolean
  data?: {
    downloadURL?: string
  }
}

/** andAlbum/openApi 接口通用结果包装 */
export interface AndAlbumResultResp {
  success?: boolean
  code?: string
  message?: string
  result?: {
    resultCode?: string
    resultDesc?: string
  }
}

/* ===================== 分享链接 (share) ===================== */

/** 分享引用：link_id + 密码 + 节点 id */
export interface ShareRef {
  linkID: string
  password: string
  nodeID: string
}

export interface ShareCatalogItem {
  caId?: string
  caName?: string
  udTime?: string
}

export interface ShareContentItem {
  coId?: string
  coName?: string
  coSize?: number
  coType?: number
  udTime?: string
  coPath?: string
  presentURL?: string
  downloadURL?: string
}

/** yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6 响应 */
export interface ShareListResp {
  code?: string
  message?: string
  success: boolean
  data?: {
    lkName?: string
    password?: string
    caLst?: ShareCatalogItem[]
    coLst?: ShareContentItem[]
  }
}

/** yun-share/richlifeApp/devapp/IOutLink/getContentInfoFromOutLink 响应 */
export interface ShareContentInfoResp {
  code?: string
  message?: string
  success: boolean
  data?: {
    contentInfo?: {
      presentURL?: string
      cdnDownLoadUrl?: string
    }
  }
}

/** yun-share/richlifeApp/devapp/IOutLink/dlFromOutLinkV3 响应 */
export interface ShareDownloadResp {
  code?: string
  message?: string
  success: boolean
  data?: {
    downloadURL?: string
    redrUrl?: string
    extInfo?: {
      cdnDownloadUrl?: string
    }
  }
}
