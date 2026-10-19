/* 資料（写真・PDF）管理のロジック。DOMに依存しない純粋な関数（Node でもテストできる） */
(function (root) {
  "use strict";

  const CATEGORIES = {
    receipt: "領収書・明細",
    application: "申請書類",
    certificate: "証明書",
    result: "検査結果・説明資料",
    prescription: "処方箋・薬の説明書",
    other: "その他",
  };

  const MAX_BYTES = 20 * 1024 * 1024; // schema.sql のバケット設定と揃える
  const MIME_BY_EXT = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  const EXT_BY_MIME = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };

  function extOf(name) {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  /* ブラウザが type を空で渡すことがあるため、拡張子から補う */
  function detectMime(file) {
    const t = String((file && file.type) || "").toLowerCase();
    if (EXT_BY_MIME[t]) return t;
    return MIME_BY_EXT[extOf(file && file.name)] || null;
  }

  function validateFile(file) {
    if (!file) return { error: "ファイルを選んでください。" };
    const mime = detectMime(file);
    if (!mime) return { error: `「${file.name}」は対応していない形式です。画像（JPEG/PNG/WebP/HEIC）かPDFを選んでください。` };
    if (!(file.size > 0)) return { error: `「${file.name}」は空のファイルです。` };
    if (file.size > MAX_BYTES) return { error: `「${file.name}」は大きすぎます（${formatSize(file.size)}）。20MBまでです。` };
    return { mime };
  }

  /* 保存先。日本語名はキーに使えないことがあるため、ID+拡張子にする（元の名前はテーブルに残す） */
  function storagePath(userId, docId, mime) {
    return `${userId}/${docId}.${EXT_BY_MIME[mime] || "bin"}`;
  }

  function titleFromFileName(name) {
    return String(name || "").replace(/\.[A-Za-z0-9]{1,8}$/, "").trim().slice(0, 200) || "無題";
  }

  function formatSize(bytes) {
    if (bytes == null) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  /* 「12,345」「¥12,345」「１２３４５円」などを円(整数)にする。空は null。 */
  function parseAmount(input) {
    const s = String(input == null ? "" : input).normalize("NFKC").replace(/[,\s¥円]/g, "");
    if (s === "") return { value: null };
    if (!/^\d{1,9}$/.test(s)) return { error: "金額は数字で入力してください（例：12,345）。" };
    return { value: parseInt(s, 10) };
  }

  /* 領収書の合計（医療費控除や助成金の確認用）。year を渡すとその年(doc_date)だけ。 */
  function sumReceipts(docs, year) {
    let total = 0, count = 0, withoutAmount = 0;
    for (const d of docs) {
      if (d.category !== "receipt") continue;
      if (year && !(d.doc_date || "").startsWith(String(year))) continue;
      if (d.amount_yen == null) {
        withoutAmount++;
        continue;
      }
      total += d.amount_yen;
      count++;
    }
    return { total, count, withoutAmount };
  }

  function filterDocs(docs, { category, query } = {}) {
    const q = String(query || "").trim().toLowerCase();
    return docs
      .filter((d) => !category || d.category === category)
      .filter((d) => !q || [d.title, d.notes, d.file_name].join("\n").toLowerCase().includes(q))
      .sort((a, b) => {
        const ad = a.doc_date || "", bd = b.doc_date || "";
        if (ad !== bd) return ad < bd ? 1 : -1;
        return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      });
  }

  const api = {
    CATEGORIES, MAX_BYTES, detectMime, validateFile, storagePath,
    titleFromFileName, formatSize, parseAmount, sumReceipts, filterDocs,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MinutesDocs = api;
})(typeof window !== "undefined" ? window : globalThis);
