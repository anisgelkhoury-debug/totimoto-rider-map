import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { storagePathFromUrlOrPath } from "../../src/utils/storagePath.ts"

describe("storagePathFromUrlOrPath", () => {
  it("passes through raw storage paths", () => {
    assert.equal(storagePathFromUrlOrPath("reports/abc/img.jpg"), "reports/abc/img.jpg")
  })

  it("decodes Firebase download URLs", () => {
    const url =
      "https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/reports%2Fabc%2Fimg.jpg?alt=media&token=xyz"
    assert.equal(storagePathFromUrlOrPath(url), "reports/abc/img.jpg")
  })

  it("rejects non-storage http URLs", () => {
    assert.throws(() => storagePathFromUrlOrPath("https://example.com/photo.jpg"))
  })
})
