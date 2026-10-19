/* 資料タブ（写真・PDF を Supabase Storage の非公開バケットに保存し、documents テーブルで管理） */
(() => {
  "use strict";

  const core = window.MinutesCore;
  const lib = window.MinutesDocs;
  if (!core || !lib) return;
  const sb = core.sb;
  const $ = (id) => document.getElementById(id);
  const BUCKET = "documents";

  const els = {
    summary: $("docs-summary"), summaryText: $("docs-summary-text"),
    form: $("doc-form"), formTitle: $("doc-form-title"), fileLabel: $("doc-file-label"), file: $("doc-file"),
    category: $("doc-category"), title: $("doc-title"), date: $("doc-date"), amount: $("doc-amount"),
    notes: $("doc-notes"), save: $("doc-save"), cancel: $("doc-cancel"),
    filter: $("doc-filter"), search: $("doc-search"), list: $("doc-list"), empty: $("doc-empty"), msg: $("doc-msg"),
  };

  let docs = [];
  let editingId = null;

  function msg(text, isError = false) {
    els.msg.textContent = text || "";
    els.msg.classList.toggle("error", !!isError);
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const yen = (n) => `¥${Number(n).toLocaleString("ja-JP")}`;

  /* 種類の選択肢 */
  for (const [k, label] of Object.entries(lib.CATEGORIES)) {
    els.category.append(new Option(label, k));
    els.filter.append(new Option(label, k));
  }
  els.filter.prepend(new Option("すべての種類", ""));
  els.filter.value = "";
  els.category.value = "receipt";

  /* ---------- 読み込み ---------- */
  async function load() {
    const { data, error } = await sb
      .from("documents")
      .select("*")
      .order("doc_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      msg("資料を読み込めませんでした：" + error.message + "（Supabase で最新の schema.sql を実行したか確認してください）", true);
      return;
    }
    docs = data;
    core.state.docs = docs;
    render();
  }

  /* ---------- 表示 ---------- */
  function renderSummary() {
    const receipts = docs.filter((d) => d.category === "receipt");
    els.summary.hidden = receipts.length === 0;
    if (!receipts.length) return;
    const years = Array.from(new Set(receipts.map((d) => (d.doc_date || "").slice(0, 4)).filter(Boolean)))
      .sort()
      .reverse()
      .slice(0, 3);
    const lines = years.map((y) => {
      const r = lib.sumReceipts(docs, y);
      return `${y}年：${yen(r.total)}（${r.count}件）` + (r.withoutAmount ? `／金額が未入力 ${r.withoutAmount}件` : "");
    });
    const noDate = receipts.filter((d) => !d.doc_date).length;
    if (noDate) lines.push(`日付なし：${noDate}件（合計には含みません）`);
    els.summaryText.textContent = lines.join("\n");
  }

  function docItem(d) {
    const li = document.createElement("li");
    li.className = "doc";

    const head = document.createElement("div");
    head.className = "item-head";
    const title = document.createElement("span");
    title.className = "plan-title";
    title.textContent = d.title;
    const date = document.createElement("span");
    date.className = "item-date";
    date.textContent = d.doc_date || "日付なし";
    head.append(title, date);

    const meta = document.createElement("div");
    meta.className = "plan-meta";
    const cat = document.createElement("span");
    cat.className = "badge";
    cat.textContent = lib.CATEGORIES[d.category] || lib.CATEGORIES.other;
    meta.append(cat);
    if (d.amount_yen != null) {
      const a = document.createElement("span");
      a.textContent = yen(d.amount_yen);
      meta.append(a);
    }
    if (d.file_name) {
      const f = document.createElement("span");
      f.textContent = `${d.file_name}（${lib.formatSize(d.size_bytes)}）`;
      meta.append(f);
    }
    li.append(head, meta);

    if (d.notes) {
      const n = document.createElement("p");
      n.className = "plan-notes doc-notes";
      n.textContent = d.notes;
      li.append(n);
    }

    const acts = document.createElement("div");
    acts.className = "plan-actions doc-actions";
    if (d.file_path) acts.append(btn("開く", () => openFile(d)));
    acts.append(btn("編集", () => startEdit(d)), btn("削除", () => remove(d), "danger"));
    li.append(acts);
    return li;
  }

  function btn(text, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    return b;
  }

  function render() {
    const shown = lib.filterDocs(docs, { category: els.filter.value, query: els.search.value });
    els.list.replaceChildren(...shown.map(docItem));
    els.empty.hidden = shown.length > 0;
    els.empty.textContent = docs.length ? "一致する資料はありません。" : "まだ資料はありません。";
    renderSummary();
  }
  els.filter.addEventListener("change", render);
  els.search.addEventListener("input", render);

  /* ---------- ファイルを開く（短時間だけ有効な署名つきURL） ---------- */
  async function openFile(d) {
    const w = window.open("", "_blank"); // ポップアップが止められないよう、先に開く
    if (w) w.opener = null;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.file_path, 120);
    if (error) {
      if (w) w.close();
      msg("ファイルを開けませんでした：" + error.message, true);
      return;
    }
    if (w) w.location.href = data.signedUrl;
    else location.href = data.signedUrl;
  }

  /* ---------- 追加・編集 ---------- */
  function startEdit(d) {
    editingId = d.id;
    els.fileLabel.hidden = true;
    els.category.value = d.category;
    els.title.value = d.title;
    els.date.value = d.doc_date || "";
    els.amount.value = d.amount_yen == null ? "" : String(d.amount_yen);
    els.notes.value = d.notes || "";
    els.formTitle.textContent = "資料を編集（ファイルの差し替えはできません）";
    els.save.textContent = "保存";
    els.cancel.hidden = false;
    els.form.scrollIntoView({ behavior: "smooth", block: "center" });
    els.title.focus();
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.category.value = "receipt";
    els.fileLabel.hidden = false;
    els.formTitle.textContent = "資料を追加";
    els.save.textContent = "保存";
    els.cancel.hidden = true;
  }
  els.cancel.addEventListener("click", resetForm);

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = lib.parseAmount(els.amount.value);
    if (amount.error) return msg(amount.error, true);

    els.save.disabled = true;
    try {
      if (editingId) {
        const title = els.title.value.trim();
        if (!title) return msg("タイトルを入力してください。", true);
        const { error } = await sb
          .from("documents")
          .update({
            title,
            category: els.category.value,
            doc_date: els.date.value || null,
            amount_yen: amount.value,
            notes: els.notes.value.trim(),
          })
          .eq("id", editingId);
        if (error) throw error;
        msg("保存しました。");
        resetForm();
        await load();
        return;
      }

      const files = Array.from(els.file.files || []);
      if (!files.length) return msg("写真またはPDFを選んでください。", true);
      if (files.length > 1 && amount.value != null) {
        return msg("複数のファイルに同じ金額は入れられません。金額は1件ずつ登録してください。", true);
      }
      for (const f of files) {
        const v = lib.validateFile(f);
        if (v.error) return msg(v.error, true);
      }

      const session = core.getSession();
      if (!session) return msg("ログインが切れました。ログインし直してください。", true);
      const userId = session.user.id;
      const base = els.title.value.trim();

      let saved = 0;
      for (const [i, f] of files.entries()) {
        msg(`アップロード中…（${i + 1}/${files.length}）`);
        const mime = lib.validateFile(f).mime;
        const id = uuid();
        const path = lib.storagePath(userId, id, mime);
        const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: mime, upsert: false });
        if (up.error) throw new Error(`「${f.name}」を保存できませんでした：` + up.error.message);

        const title = base ? (files.length > 1 ? `${base} (${i + 1})` : base) : lib.titleFromFileName(f.name);
        const { error } = await sb.from("documents").insert({
          id,
          title,
          category: els.category.value,
          doc_date: els.date.value || null,
          amount_yen: amount.value,
          notes: els.notes.value.trim(),
          file_path: path,
          file_name: f.name,
          mime_type: mime,
          size_bytes: f.size,
        });
        if (error) {
          await sb.storage.from(BUCKET).remove([path]); // 記録できなかったファイルは残さない
          throw new Error(`「${f.name}」の情報を保存できませんでした：` + error.message);
        }
        saved++;
      }
      msg(`${saved}件を保存しました。`);
      resetForm();
      await load();
    } catch (err) {
      msg(err.message || "保存できませんでした。", true);
      await load(); // 途中まで保存できた分を反映する
    } finally {
      els.save.disabled = false;
    }
  });

  /* ---------- 削除 ---------- */
  async function remove(d) {
    if (!confirm(`「${d.title}」を削除しますか？ファイルも消え、元に戻せません。`)) return;
    if (d.file_path) {
      const { error } = await sb.storage.from(BUCKET).remove([d.file_path]);
      if (error) {
        msg("ファイルを削除できませんでした：" + error.message, true);
        return;
      }
    }
    const { error } = await sb.from("documents").delete().eq("id", d.id);
    if (error) {
      msg("削除できませんでした：" + error.message, true);
      return;
    }
    if (editingId === d.id) resetForm();
    await load();
  }

  /* ---------- 連携 ---------- */
  document.addEventListener("minutes:login", load);
  document.addEventListener("minutes:logout", () => {
    docs = [];
    core.state.docs = [];
    resetForm();
    render();
  });
  if (core.getSession()) load();
})();
