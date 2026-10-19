const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../../web/docs-lib.js");

test("validateFile: 画像とPDFは通り、他は弾く", () => {
  assert.equal(lib.validateFile({ name: "a.pdf", type: "application/pdf", size: 1000 }).mime, "application/pdf");
  assert.equal(lib.validateFile({ name: "IMG_1.JPG", type: "", size: 1000 }).mime, "image/jpeg"); // typeが空でも拡張子で判定
  assert.equal(lib.validateFile({ name: "x.heic", type: "image/heic", size: 5 }).mime, "image/heic");
  assert.match(lib.validateFile({ name: "a.exe", type: "application/octet-stream", size: 10 }).error, /対応していない/);
  assert.match(lib.validateFile({ name: "a.docx", type: "", size: 10 }).error, /対応していない/);
  assert.match(lib.validateFile({ name: "a.pdf", type: "application/pdf", size: 0 }).error, /空/);
  assert.match(lib.validateFile({ name: "big.pdf", type: "application/pdf", size: 21 * 1024 * 1024 }).error, /20MB/);
  assert.match(lib.validateFile(null).error, /選んで/);
});

test("storagePath: 日本語名でも安全なキー、ユーザーのフォルダ配下", () => {
  assert.equal(lib.storagePath("u1", "d1", "application/pdf"), "u1/d1.pdf");
  assert.equal(lib.storagePath("u1", "d1", "image/jpeg"), "u1/d1.jpg");
  assert.equal(lib.storagePath("u1", "d1", "text/plain"), "u1/d1.bin");
});

test("titleFromFileName / formatSize", () => {
  assert.equal(lib.titleFromFileName("領収書_10月.pdf"), "領収書_10月");
  assert.equal(lib.titleFromFileName(".pdf"), "無題");
  assert.equal(lib.formatSize(512), "512B");
  assert.equal(lib.formatSize(2048), "2KB");
  assert.equal(lib.formatSize(5.5 * 1024 * 1024), "5.5MB");
});

test("parseAmount: カンマ・全角・円記号・空・不正", () => {
  assert.equal(lib.parseAmount("12,345").value, 12345);
  assert.equal(lib.parseAmount("１２３４５円").value, 12345);
  assert.equal(lib.parseAmount("¥ 800").value, 800);
  assert.equal(lib.parseAmount("").value, null);
  assert.equal(lib.parseAmount(null).value, null);
  assert.match(lib.parseAmount("1.5万").error, /数字/);
  assert.match(lib.parseAmount("-100").error, /数字/);
});

test("sumReceipts: 領収書だけ・年で絞る・金額なしは別集計", () => {
  const docs = [
    { category: "receipt", doc_date: "2026-10-01", amount_yen: 10000 },
    { category: "receipt", doc_date: "2026-11-01", amount_yen: 5000 },
    { category: "receipt", doc_date: "2025-12-31", amount_yen: 700 },
    { category: "receipt", doc_date: "2026-10-05", amount_yen: null },
    { category: "certificate", doc_date: "2026-10-01", amount_yen: 3000 },
  ];
  assert.deepEqual(lib.sumReceipts(docs, 2026), { total: 15000, count: 2, withoutAmount: 1 });
  assert.deepEqual(lib.sumReceipts(docs), { total: 15700, count: 3, withoutAmount: 1 });
});

test("filterDocs: 種類・検索・日付の新しい順", () => {
  const docs = [
    { id: "a", title: "診察の領収書", category: "receipt", doc_date: "2026-10-01", created_at: "1" },
    { id: "b", title: "証明書", category: "certificate", doc_date: "2026-10-10", created_at: "2", notes: "病院で記入" },
    { id: "c", title: "日付なし", category: "receipt", doc_date: null, created_at: "3", file_name: "scan.pdf" },
  ];
  assert.deepEqual(lib.filterDocs(docs).map((d) => d.id), ["b", "a", "c"]);
  assert.deepEqual(lib.filterDocs(docs, { category: "receipt" }).map((d) => d.id), ["a", "c"]);
  assert.deepEqual(lib.filterDocs(docs, { query: "病院" }).map((d) => d.id), ["b"]);
  assert.deepEqual(lib.filterDocs(docs, { query: "SCAN" }).map((d) => d.id), ["c"]);
});
