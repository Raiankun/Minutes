/* 予定・手続きタブ（Supabase の plans テーブルを操作する） */
(() => {
  "use strict";

  const core = window.MinutesCore;
  const lib = window.MinutesPlans;
  if (!core || !lib) return; // 設定が足りないときは app.js 側がメッセージを出す
  const sb = core.sb;
  const $ = (id) => document.getElementById(id);

  const els = {
    suggestCard: $("suggest-card"), suggestList: $("suggest-list"),
    planList: $("plan-list"), planEmpty: $("plan-empty"),
    doneList: $("done-list"), doneCount: $("done-count"),
    ics: $("ics"), msg: $("plan-msg"),
    form: $("plan-form"), formTitle: $("plan-form-title"),
    kind: $("plan-kind"), title: $("plan-title"), date: $("plan-date"), time: $("plan-time"),
    notes: $("plan-notes"), save: $("plan-save"), cancel: $("plan-cancel"),
  };

  let plans = [];
  let editingId = null;

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function msg(text, isError = false) {
    els.msg.textContent = text || "";
    els.msg.classList.toggle("error", !!isError);
  }

  /* ---------- 読み込み・登録 ---------- */
  async function load() {
    const { data, error } = await sb.from("plans").select("*").limit(1000);
    if (error) {
      msg("予定を読み込めませんでした：" + error.message + "（Supabase で最新の schema.sql を実行したか確認してください）", true);
      return;
    }
    plans = data.map((p) => ({ ...p, due_time: lib.normTime(p.due_time) }));
    core.state.plans = plans;
    document.dispatchEvent(new CustomEvent("minutes:changed", { detail: { kind: "plans" } }));
    render();
  }

  async function insertRows(rows) {
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await sb.from("plans").insert(rows.slice(i, i + 100));
      if (error) throw error;
    }
  }

  /* ---------- 表示 ---------- */
  function dueBadge(p) {
    if (!p.due_date || p.done) return null;
    const left = lib.diffDays(today(), p.due_date);
    if (left < 0) return { text: `${-left}日過ぎています`, cls: "late" };
    if (left === 0) return { text: "今日", cls: "warn" };
    if (left <= 7) return { text: `あと${left}日`, cls: "warn" };
    return null;
  }

  function planItem(p) {
    const li = document.createElement("li");
    li.className = "plan" + (p.done ? " is-done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!p.done;
    cb.setAttribute("aria-label", p.done ? "未完了に戻す" : "完了にする");
    cb.addEventListener("change", () => toggleDone(p, cb));

    const main = document.createElement("div");
    const title = document.createElement("div");
    title.className = "plan-title";
    title.textContent = p.title;
    const meta = document.createElement("div");
    meta.className = "plan-meta";
    const kind = document.createElement("span");
    kind.className = "badge";
    kind.textContent = lib.KINDS[p.kind] || lib.KINDS.other;
    meta.append(kind);
    if (p.due_date) {
      const when = document.createElement("span");
      when.textContent = p.due_date + (p.due_time ? " " + p.due_time : "");
      meta.append(when);
    } else {
      const when = document.createElement("span");
      when.textContent = "日付未定";
      meta.append(when);
    }
    const b = dueBadge(p);
    if (b) {
      const bs = document.createElement("span");
      bs.className = "badge " + b.cls;
      bs.textContent = b.text;
      meta.append(bs);
    }
    main.append(title, meta);
    li.append(cb, main);

    if (p.notes) {
      const n = document.createElement("p");
      n.className = "plan-notes";
      n.textContent = p.notes;
      li.append(n);
    }

    const acts = document.createElement("div");
    acts.className = "plan-actions";
    const bEdit = document.createElement("button");
    bEdit.type = "button";
    bEdit.textContent = "編集";
    bEdit.addEventListener("click", () => startEdit(p));
    const bDel = document.createElement("button");
    bDel.type = "button";
    bDel.className = "danger";
    bDel.textContent = "削除";
    bDel.addEventListener("click", () => remove(p));
    acts.append(bEdit, bDel);
    li.append(acts);
    return li;
  }

  function render() {
    const open = lib.sortPlans(plans.filter((p) => !p.done));
    const done = plans
      .filter((p) => p.done)
      .sort((a, b) => String(b.done_at || "").localeCompare(String(a.done_at || "")));

    els.planList.replaceChildren(...open.map(planItem));
    els.planEmpty.hidden = open.length > 0;
    els.doneList.replaceChildren(...done.map(planItem));
    els.doneCount.textContent = String(done.length);
    renderSuggestions();
  }

  function renderSuggestions() {
    const list = lib.buildSuggestions(plans, today(), core.state.medicines);
    els.suggestCard.hidden = list.length === 0;
    els.suggestList.replaceChildren(
      ...list.map((s) => {
        const li = document.createElement("li");
        li.className = "suggest" + (s.type === "alert" ? " alert" : "");
        const t = document.createElement("div");
        t.className = "suggest-title";
        t.textContent = s.title;
        const r = document.createElement("p");
        r.className = "suggest-reason";
        r.textContent = s.reason;
        li.append(t, r);
        if (s.type === "add_checklist" && s.items) {
          const ul = document.createElement("ul");
          ul.className = "small";
          for (const it of s.items) {
            const item = document.createElement("li");
            item.textContent = it.title;
            ul.append(item);
          }
          li.append(ul);
        }
        if (s.type !== "alert" && s.type !== "hint") {
          const acts = document.createElement("div");
          acts.className = "actions";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "追加する";
          btn.addEventListener("click", () => applySuggestion(s, btn));
          acts.append(btn);
          li.append(acts);
        }
        return li;
      })
    );
  }

  async function applySuggestion(s, btn) {
    btn.disabled = true;
    try {
      if (s.type === "add_checklist") {
        await insertRows(s.items.map((it) => ({ kind: it.kind, title: it.title, notes: it.notes, due_date: null, due_time: null })));
        msg(`${s.items.length}件を追加しました。申請期限などの日付は、各項目の「編集」から入れてください。`);
      } else if (s.type === "add_plan") {
        const p = s.plan;
        await insertRows([{ kind: p.kind, title: p.title, notes: p.notes || "", due_date: p.due_date || null, due_time: null }]);
        msg("追加しました。");
      }
      await load();
    } catch (err) {
      msg("追加できませんでした：" + (err.message || ""), true);
      btn.disabled = false;
    }
  }

  /* ---------- 完了・編集・削除 ---------- */
  async function toggleDone(p, cb) {
    cb.disabled = true;
    const done = cb.checked;
    const { error } = await sb.from("plans").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", p.id);
    if (error) {
      msg("更新できませんでした：" + error.message, true);
      cb.checked = !done;
      cb.disabled = false;
      return;
    }
    await load();
  }

  function startEdit(p) {
    editingId = p.id;
    els.kind.value = p.kind;
    els.title.value = p.title;
    els.date.value = p.due_date || "";
    els.time.value = p.due_time || "";
    els.notes.value = p.notes || "";
    els.formTitle.textContent = "予定を編集";
    els.save.textContent = "保存";
    els.cancel.hidden = false;
    els.form.scrollIntoView({ behavior: "smooth", block: "center" });
    els.title.focus();
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.formTitle.textContent = "予定を追加";
    els.save.textContent = "追加";
    els.cancel.hidden = true;
  }
  els.cancel.addEventListener("click", resetForm);

  async function remove(p) {
    if (!confirm(`「${p.title}」を削除しますか？元に戻せません。`)) return;
    const { error } = await sb.from("plans").delete().eq("id", p.id);
    if (error) {
      msg("削除できませんでした：" + error.message, true);
      return;
    }
    if (editingId === p.id) resetForm();
    await load();
  }

  /* ---------- フォーム ---------- */
  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = els.title.value.trim();
    if (!title) return msg("内容を入力してください。", true);
    if (els.time.value && !els.date.value) return msg("時刻を入れるときは日付も入れてください。", true);

    const row = {
      kind: els.kind.value,
      title,
      due_date: els.date.value || null,
      due_time: els.date.value && els.time.value ? els.time.value : null,
      notes: els.notes.value.trim(),
    };
    els.save.disabled = true;
    try {
      if (editingId) {
        const { error } = await sb.from("plans").update(row).eq("id", editingId);
        if (error) throw error;
        msg("保存しました。");
      } else {
        await insertRows([row]);
        msg("追加しました。");
      }
      resetForm();
      await load();
    } catch (err) {
      msg("保存できませんでした：" + (err.message || ""), true);
    } finally {
      els.save.disabled = false;
    }
  });

  /* ---------- カレンダー書き出し ---------- */
  els.ics.addEventListener("click", () => {
    const ics = lib.buildIcs(plans, Date.now());
    if (!ics.includes("BEGIN:VEVENT")) return msg("日付が入っている未完了の予定がありません。", true);
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "minutes-calendar.ics";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    msg("カレンダー用のファイルを書き出しました。開いて、お使いのカレンダーアプリに取り込んでください。");
  });

  /* ---------- ログイン状態との連動 ---------- */
  document.addEventListener("minutes:login", load);
  document.addEventListener("minutes:logout", () => {
    plans = [];
    core.state.plans = [];
    resetForm();
    render();
  });
  document.addEventListener("minutes:changed", (e) => {
    if (e.detail && e.detail.kind === "medicines") renderSuggestions();
  });
  document.addEventListener("minutes:reload", (e) => {
    if (e.detail && e.detail.kind === "plans") load();
  });
  if (core.getSession()) load();
})();
