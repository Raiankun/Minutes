/* 薬タブ（Supabase の medicines テーブル。投薬の予定は plans にひも付ける） */
(() => {
  "use strict";

  const core = window.MinutesCore;
  const lib = window.MinutesPlans;
  if (!core || !lib) return;
  const sb = core.sb;
  const $ = (id) => document.getElementById(id);

  const els = {
    list: $("med-list"), empty: $("med-empty"), showInactive: $("med-show-inactive"), msg: $("med-msg"),
    form: $("med-form"), formTitle: $("med-form-title"), name: $("med-name"), received: $("med-received"),
    remaining: $("med-remaining"), quantity: $("med-quantity"), storage: $("med-storage"), caution: $("med-caution"),
    save: $("med-save"), cancel: $("med-cancel"),
  };

  let medicines = [];
  let editingId = null;
  let openScheduleId = null; // 「予定をまとめて登録」を開いている薬

  function msg(text, isError = false) {
    els.msg.textContent = text || "";
    els.msg.classList.toggle("error", !!isError);
  }

  /* ---------- 読み込み ---------- */
  async function load() {
    const { data, error } = await sb.from("medicines").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) {
      msg("薬を読み込めませんでした：" + error.message + "（Supabase で最新の schema.sql を実行したか確認してください）", true);
      return;
    }
    medicines = data;
    core.state.medicines = medicines;
    document.dispatchEvent(new CustomEvent("minutes:changed", { detail: { kind: "medicines" } }));
    render();
  }

  function reloadPlans() {
    document.dispatchEvent(new CustomEvent("minutes:reload", { detail: { kind: "plans" } }));
  }

  /* ---------- 表示 ---------- */
  function line(label, text) {
    const p = document.createElement("p");
    p.className = "med-line";
    const b = document.createElement("span");
    b.className = "med-label";
    b.textContent = label;
    const t = document.createElement("span");
    t.textContent = text;
    p.append(b, t);
    return p;
  }

  function button(text, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    return b;
  }

  function medItem(m) {
    const li = document.createElement("li");
    li.className = "med" + (m.active ? "" : " is-inactive");

    const head = document.createElement("div");
    head.className = "med-head";
    const name = document.createElement("span");
    name.className = "plan-title";
    name.textContent = m.name;
    head.append(name);
    if (!m.active) {
      const bd = document.createElement("span");
      bd.className = "badge";
      bd.textContent = "終了";
      head.append(bd);
    }
    li.append(head);

    if (m.received_on) li.append(line("受け取った日", m.received_on));
    if (m.quantity_note) li.append(line("数のメモ", m.quantity_note));
    if (m.storage_note) li.append(line("保管", m.storage_note));
    if (m.caution_note) li.append(line("注意", m.caution_note));

    // 残り（手動で調整）
    const rem = document.createElement("div");
    rem.className = "stepper";
    const remLabel = document.createElement("span");
    remLabel.className = "med-label";
    remLabel.textContent = "残り（手動）";
    const minus = button("−", () => adjustRemaining(m, -1));
    minus.setAttribute("aria-label", "残りを1減らす");
    minus.disabled = m.remaining == null || m.remaining <= 0;
    const val = document.createElement("span");
    val.className = "stepper-value";
    val.textContent = m.remaining == null ? "未設定" : `${m.remaining}回分`;
    const plus = button("＋", () => adjustRemaining(m, +1));
    plus.setAttribute("aria-label", "残りを1増やす");
    rem.append(remLabel, minus, val, plus);
    li.append(rem);

    // 投薬の予定の集計
    const sum = lib.medicineSummary(m.id, core.state.plans, core.today());
    const sumEl = document.createElement("p");
    sumEl.className = "small";
    let text = `予定 ${sum.total}件（完了 ${sum.done}件）`;
    if (sum.next) text += `／次：${sum.next.due_date}${sum.next.due_time ? " " + sum.next.due_time : ""}`;
    if (sum.overdue) text += `／日付が過ぎた未完了 ${sum.overdue}件`;
    sumEl.textContent = text;
    li.append(sumEl);

    const acts = document.createElement("div");
    acts.className = "plan-actions";
    acts.append(
      button(openScheduleId === m.id ? "予定の登録を閉じる" : "予定をまとめて登録", () => {
        openScheduleId = openScheduleId === m.id ? null : m.id;
        render();
      }),
      button("編集", () => startEdit(m)),
      button(m.active ? "終了にする" : "再開する", () => setActive(m, !m.active)),
      button("削除", () => remove(m), "danger")
    );
    li.append(acts);

    if (openScheduleId === m.id) li.append(scheduleForm(m));
    return li;
  }

  function scheduleForm(m) {
    const f = document.createElement("form");
    f.className = "sched";
    f.innerHTML = `
      <p class="small">病院から指示された日付と時刻のとおりに入力してください。期間内の毎日に、同じ時刻で予定を作ります（量や回数はここでは扱いません）。</p>
      <div class="two">
        <label>開始日<input name="start" type="date" required></label>
        <label>終了日<input name="end" type="date"></label>
      </div>
      <label>時刻（複数はカンマ区切り。省略可）
        <input name="times" type="text" inputmode="numeric" placeholder="例：21:00 または 08:00,20:00">
      </label>
      <label>メモ
        <input name="notes" type="text" maxlength="200" placeholder="病院の指示を書き写す">
      </label>
      <button class="primary" type="submit">予定を登録</button>`;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const r = lib.expandMedication({
        title: m.name,
        startDate: fd.get("start"),
        endDate: fd.get("end"),
        times: fd.get("times"),
        notes: fd.get("notes"),
        medicineId: m.id,
      });
      if (r.error) return msg(r.error, true);
      if (r.rows.length > 30 && !confirm(`${r.rows.length}件の予定を登録します。よろしいですか？`)) return;
      try {
        for (let i = 0; i < r.rows.length; i += 100) {
          const { error } = await sb.from("plans").insert(r.rows.slice(i, i + 100));
          if (error) throw error;
        }
        msg(`「${m.name}」の予定を${r.rows.length}件登録しました。「予定」タブで確認できます。`);
        openScheduleId = null;
        reloadPlans();
        render();
      } catch (err) {
        msg("登録できませんでした：" + (err.message || ""), true);
      }
    });
    return f;
  }

  function render() {
    const shown = medicines.filter((m) => m.active || els.showInactive.checked);
    els.list.replaceChildren(...shown.map(medItem));
    els.empty.hidden = shown.length > 0;
    els.empty.textContent = medicines.length ? "表示できる薬がありません（終了した薬は、チェックで表示できます）。" : "まだ薬は登録されていません。下のフォームから追加できます。";
  }
  els.showInactive.addEventListener("change", render);

  /* ---------- 操作 ---------- */
  async function update(id, fields, failText) {
    const { error } = await sb.from("medicines").update(fields).eq("id", id);
    if (error) {
      msg(failText + error.message, true);
      return false;
    }
    await load();
    return true;
  }

  function adjustRemaining(m, delta) {
    const next = Math.max(0, (m.remaining ?? 0) + delta);
    return update(m.id, { remaining: next }, "更新できませんでした：");
  }

  function setActive(m, active) {
    return update(m.id, { active }, "更新できませんでした：");
  }

  async function remove(m) {
    if (!confirm(`「${m.name}」を削除しますか？この薬の予定は残りますが、薬とのひも付けは外れます。元に戻せません。`)) return;
    const { error } = await sb.from("medicines").delete().eq("id", m.id);
    if (error) {
      msg("削除できませんでした：" + error.message, true);
      return;
    }
    if (editingId === m.id) resetForm();
    if (openScheduleId === m.id) openScheduleId = null;
    await load();
    reloadPlans();
  }

  function startEdit(m) {
    editingId = m.id;
    els.name.value = m.name;
    els.received.value = m.received_on || "";
    els.remaining.value = m.remaining == null ? "" : String(m.remaining);
    els.quantity.value = m.quantity_note || "";
    els.storage.value = m.storage_note || "";
    els.caution.value = m.caution_note || "";
    els.formTitle.textContent = "薬を編集";
    els.save.textContent = "保存";
    els.cancel.hidden = false;
    els.form.scrollIntoView({ behavior: "smooth", block: "center" });
    els.name.focus();
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.formTitle.textContent = "薬を追加";
    els.save.textContent = "追加";
    els.cancel.hidden = true;
  }
  els.cancel.addEventListener("click", resetForm);

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.name.value.trim();
    if (!name) return msg("薬の名前を入力してください。", true);

    let remaining = null;
    if (els.remaining.value.trim() !== "") {
      if (!/^\d{1,4}$/.test(els.remaining.value.trim())) return msg("残りは0以上の整数で入力してください。", true);
      remaining = parseInt(els.remaining.value.trim(), 10);
    }
    const row = {
      name,
      received_on: els.received.value || null,
      remaining,
      quantity_note: els.quantity.value.trim(),
      storage_note: els.storage.value.trim(),
      caution_note: els.caution.value.trim(),
    };

    els.save.disabled = true;
    try {
      const q = editingId
        ? sb.from("medicines").update(row).eq("id", editingId)
        : sb.from("medicines").insert(row);
      const { error } = await q;
      if (error) throw error;
      msg(editingId ? "保存しました。" : "追加しました。投薬の予定は、一覧の「予定をまとめて登録」から入れられます。");
      resetForm();
      await load();
    } catch (err) {
      msg("保存できませんでした：" + (err.message || ""), true);
    } finally {
      els.save.disabled = false;
    }
  });

  /* ---------- 連携 ---------- */
  document.addEventListener("minutes:login", load);
  document.addEventListener("minutes:logout", () => {
    medicines = [];
    core.state.medicines = [];
    openScheduleId = null;
    resetForm();
    render();
  });
  document.addEventListener("minutes:changed", (e) => {
    if (e.detail && e.detail.kind === "plans") render(); // 予定の集計を更新
  });
  if (core.getSession()) load();
})();
