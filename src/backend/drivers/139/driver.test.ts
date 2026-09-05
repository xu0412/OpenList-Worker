import test from "node:test"
import assert from "node:assert/strict"
import { Yun139Driver } from "./driver"
import { Yun139Addition } from "./types"
import {
  calSign,
  parseShareEntries,
  encodeShareRef,
  decodeShareRef,
  encodeShareRefs,
  decodeShareRefs,
  sortedJsonStringify,
} from "./util"

test("Yun139 calculation and signing", () => {
  const sign = calSign("{}", "2026-08-24 16:00:00", "1234567890abcdef")
  assert.ok(sign)
  assert.equal(typeof sign, "string")
  assert.equal(sign.length, 32)
})

test("Yun139Driver instantiation and methods", async () => {
  const addition: Yun139Addition = {
    authorization: Buffer.from(
      "Basic:13800138000:token123|1|1|1780000000000",
    ).toString("base64"),
    type: "personal_new",
  }

  const driver = new Yun139Driver(addition)
  assert.ok(driver)

  // Mock listFiles
  ;(driver as any).client.listFiles = async (catalogId: string) => {
    return {
      folders: [
        {
          catalogID: "cat_101",
          catalogName: "photos",
          updateTime: "2026-08-24T12:00:00Z",
        },
      ],
      files: [
        {
          contentID: "cnt_201",
          contentName: "photo.jpg",
          contentSize: 500000,
          updateTime: "2026-08-24T12:00:00Z",
        },
      ],
    }
  }

  const items = await driver.list("/", "/")
  assert.equal(items.length, 2)
  assert.equal(items[0].name, "photos")
  assert.equal(items[0].is_dir, true)
  assert.equal(items[1].name, "photo.jpg")
  assert.equal(items[1].is_dir, false)
  assert.equal(items[1].size, 500000)

  // Mock getDownloadUrl
  ;(driver as any).client.getDownloadUrl = async (contentId: string) =>
    "https://download.yun.139.com/photo.jpg"

  const link = await driver.link("/photo.jpg", "/photo.jpg")
  assert.equal(link.url, "https://download.yun.139.com/photo.jpg")
})

test("share ref encode/decode roundtrip (single & merged)", () => {
  const ref = { linkID: "abc/def", password: "p@ss", nodeID: "ca_1" }
  const encoded = encodeShareRef(ref)
  assert.deepEqual(decodeShareRef(encoded), ref)
  assert.equal(decodeShareRef("broken"), null)

  const refs = [
    { linkID: "a", password: "", nodeID: "ca_1" },
    { linkID: "b", password: "x", nodeID: "ca_2" },
  ]
  const merged = encodeShareRefs(refs)
  assert.ok(merged.startsWith("shares:"))
  const decoded = decodeShareRefs(merged)
  assert.ok(decoded)
  assert.deepEqual(decoded, refs)

  const single = encodeShareRefs([refs[0]])
  assert.equal(single, encodeShareRef(refs[0]))
  const singleDecoded = decodeShareRefs(single)
  assert.ok(singleDecoded)
  assert.equal(singleDecoded.length, 1)
})

test("parseShareEntries splits multi link_id and handles #password", () => {
  const entries = parseShareEntries("abc123, def456\nghi789#secret ;x")
  assert.deepEqual(entries, [
    { linkID: "abc123", password: "" },
    { linkID: "def456", password: "" },
    { linkID: "ghi789", password: "secret" },
    { linkID: "x", password: "" },
  ])
})

test("sortedJsonStringify produces stable key ordering", () => {
  const out = sortedJsonStringify({
    z: 1,
    a: { y: 2, b: "c" },
    arr: ["x", { k: 1 }],
    flag: true,
  })
  assert.equal(out, '{"a":{"b":"c","y":2},"arr":["x",{"k":1}],"flag":true,"z":1}')
})

test("Yun139Driver share list uses root refs and merged listing", async () => {
  const addition: Yun139Addition = {
    authorization: "",
    type: "share",
    link_id: "shareA",
  }
  const driver = new Yun139Driver(addition)
  const folderId = encodeShareRef({ linkID: "shareA", password: "", nodeID: "ca_1" })
  ;(driver as any).client.shareListMerged = async () => ({
    folders: [{ catalogID: folderId, catalogName: "dir1", updateTime: "2026-08-24T00:00:00Z" }],
    files: [],
  })

  const items = await driver.list("/", "/")
  assert.equal(items.length, 1)
  assert.equal(items[0].name, "dir1")
  assert.equal(items[0].is_dir, true)
  assert.equal(items[0].sign, folderId)
})

test("Yun139Driver family list/link uses familyList + server path", async () => {
  const addition: Yun139Addition = {
    authorization: Buffer.from("Basic:13800138000:token|1|1|1780000000000").toString(
      "base64",
    ),
    type: "family",
    cloud_id: "cloud_1",
  }
  const driver = new Yun139Driver(addition)
  ;(driver as any).client.familyList = async () => ({
    folders: [],
    files: [
      {
        contentID: "cnt_family_1",
        contentName: "movie.mp4",
        contentSize: 1024,
        updateTime: "2026-08-24T00:00:00Z",
      },
    ],
    path: "root:/familyRoot/cat_1",
  })
  ;(driver as any).client.familyDownloadUrl = async (id: string, path: string) =>
    `https://dl.example/${id}?path=${encodeURIComponent(path)}`

  const items = await driver.list("/", "/")
  assert.equal(items.length, 1)
  assert.equal(items[0].name, "movie.mp4")
  assert.equal(items[0].is_dir, false)
  assert.equal(items[0].sign, "cnt_family_1")

  const link = await driver.link("/movie.mp4", "/movie.mp4")
  assert.equal(
    link.url,
    "https://dl.example/cnt_family_1?path=root%3A%2FfamilyRoot%2Fcat_1",
  )
})

test("share type rejects file operations", async () => {
  const addition: Yun139Addition = {
    authorization: "",
    type: "share",
    link_id: "shareA",
  }
  const driver = new Yun139Driver(addition)
  await assert.rejects(() => driver.mkdir("/", "/newdir"), /not supported/)
  await assert.rejects(() => driver.rename("/", "/a", "b"), /not supported/)
  await assert.rejects(() => driver.remove("/", "/", ["a"]), /not supported/)
})
