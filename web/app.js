(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const cfg = window.MINUTES_CONFIG || {};
  // 文字起こしサーバーの場所。サーバー自身が画面を配信する場合は空（同じオリジン）。
  const apiBase = (cfg.apiBaseUrl || "").replace(/\/+$/, "");

  const els = {
    auth: $("auth"), app: $("app"), userbox: $("userbox"), useremail: $("useremail"),
    logout: $("logout"), tabLogin: $("tab-login"), tabSignup: $("tab-signup"),
    authForm: $("auth-form"), email: $("email"), password: $("password"),
    authSubmit: $("auth-submit"), authMsg: $("auth-msg"),
    rec: $("rec"), file: $("file"), status: $("status"),
    editor: $("editor"), title: $("title"), recordedOn: $("recorded-on"),
    text: $("text"), memo: $("memo"), save: $("save"), copy: $("copy"), discard: $("discard"),
    search: $("search"), list: $("list"), empty: $("empty"),
  };

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    els.auth.hidden = false;
    els.authForm.hidden = true;
    setMsg(els.authMsg, "サーバーにSupabaseの設定（SUPABASE_URL / SUPABASE_ANON_KEY）がありません。README を確認してください。", true);
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  let mode = "login";
  let session = null;
  let items = [];
  let editing = { id: null, duration: null };
  let recorder = null;
  let recChunks = [];
  let recStream = null;

  // タブの切り替え（予定・薬・資料・議事録）
  const VIEWS = ["plans", "meds", "docs", "notes"];
  const tabButtons = Array.from(document.querySelectorAll("#main-nav .tab"));
  function showView(name) {
    for (const b of tabButtons) b.classList.toggle("active", b.dataset.view === name);
    for (const v of VIEWS) {
      const el = $("view-" + v);
      if (el) el.hidden = v !== name;
    }
  }
  for (const b of tabButtons) b.addEventListener("click", () => showView(b.dataset.view));
  // 文字起こしサーバーが設定されているときだけ「議事録」タブを出す
  $("nav-notes").hidden = cfg.transcribeEnabled !== true;

  // 各タブのスクリプト(plans.js / meds.js / docs.js)から使えるように共有する
  window.MinutesCore = {
    sb,
    getSession: () => session,
    today,
    showView,
    state: { plans: [], medicines: [], docs: [] },
  };

  function setMsg(el, text, isError = false) {
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
  }

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /* ---------- 認証 ---------- */
  function setMode(next) {
    mode = next;
    els.tabLogin.classList.toggle("active", mode === "login");
    els.tabSignup.classList.toggle("active", mode === "signup");
    els.authSubmit.textContent = mode === "login" ? "ログイン" : "登録する";
    els.password.autocomplete = mode === "login" ? "current-password" : "new-password";
    setMsg(els.authMsg, "");
  }
  els.tabLogin.addEventListener("click", () => setMode("login"));
  els.tabSignup.addEventListener("click", () => setMode("signup"));

  els.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.authSubmit.disabled = true;
    setMsg(els.authMsg, "");
    const email = els.email.value.trim();
    const password = els.password.value;
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setMsg(els.authMsg, "確認メールを送りました。メール内のリンクを開いてからログインしてください。");
        }
      }
    } catch (err) {
      setMsg(els.authMsg, authErrorText(err), true);
    } finally {
      els.authSubmit.disabled = false;
    }
  });

  function authErrorText(err) {
    const m = (err && err.message) || "";
    if (/invalid login/i.test(m)) return "メールアドレスまたはパスワードが違います。";
    if (/already registered/i.test(m)) return "このメールアドレスは登録済みです。ログインしてください。";
    if (/email not confirmed/i.test(m)) return "メールの確認がまだ完了していません。";
    if (/password/i.test(m)) return "パスワードは8文字以上にしてください。";
    if (/rate limit/i.test(m)) return "短時間に操作が多すぎます。しばらく待ってからお試しください。";
    return "うまくいきませんでした：" + m;
  }

  els.logout.addEventListener("click", () => sb.auth.signOut());

  sb.auth.onAuthStateChange((_event, s) => applySession(s));
  sb.auth.getSession().then(({ data }) => applySession(data.session));

  function applySession(s) {
    const wasIn = !!session;
    session = s;
    const loggedIn = !!s;
    if (loggedIn && !wasIn) document.dispatchEvent(new CustomEvent("minutes:login"));
    if (!loggedIn && wasIn) document.dispatchEvent(new CustomEvent("minutes:logout"));
    if (!loggedIn) showView("plans");
    els.auth.hidden = loggedIn;
    els.app.hidden = !loggedIn;
    els.userbox.hidden = !loggedIn;
    if (loggedIn) {
      els.useremail.textContent = s.user.email;
      if (!wasIn) loadList();
    } else {
      items = [];
      renderList();
      resetEditor();
      els.password.value = "";
    }
  }

  /* ---------- 録音・アップロード ---------- */
  function pickMime() {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return cands.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }
  function extFor(mime) {
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    return "webm";
  }

  els.rec.addEventListener("click", async () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setMsg(els.status, "この端末・ブラウザでは録音できません。ファイルを選んでください（録音にはHTTPS接続が必要です）。", true);
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMsg(els.status, "マイクの使用が許可されていません。ブラウザの設定をご確認ください。", true);
      return;
    }
    const mime = pickMime();
    recChunks = [];
    recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    const startedAt = Date.now();
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.onstop = () => {
      recStream.getTracks().forEach((t) => t.stop());
      els.rec.classList.remove("recording");
      els.rec.textContent = "● 録音する";
      const type = recorder.mimeType || mime || "audio/webm";
      const blob = new Blob(recChunks, { type });
      const f = new File([blob], `recording.${extFor(type)}`, { type });
      transcribe(f, (Date.now() - startedAt) / 1000);
    };
    recorder.start();
    els.rec.classList.add("recording");
    els.rec.textContent = "■ 停止して文字にする";
    setMsg(els.status, "録音中…");
  });

  els.file.addEventListener("change", () => {
    const f = els.file.files[0];
    els.file.value = "";
    if (f) transcribe(f, null);
  });

  async function transcribe(file, fallbackDuration) {
    if (!session) return;
    setBusy(true);
    setMsg(els.status, "文字起こし中…（長い音声は数分かかることがあります。このままお待ちください）");
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const { data } = await sb.auth.getSession();
      const token = data.session && data.session.access_token;
      let res;
      try {
        res = await fetch(`${apiBase}/api/transcribe`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      } catch {
        throw new Error("文字起こしサーバーに接続できません。自宅PCのサーバーが起動しているか確認してください。");
      }
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.json()).detail; } catch { /* ignore */ }
        throw new Error(detail || `エラーが発生しました（${res.status}）`);
      }
      const r = await res.json();
      if (!r.text.trim()) {
        setMsg(els.status, "音声から文字を検出できませんでした。", true);
        return;
      }
      openEditor({
        id: null,
        title: "",
        text: r.text,
        memo: "",
        recorded_on: today(),
        duration_sec: r.duration || fallbackDuration,
      });
      setMsg(els.status, "文字起こしが完了しました。内容を確認して保存してください。");
    } catch (err) {
      setMsg(els.status, err.message || "文字起こしに失敗しました。", true);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(b) {
    els.rec.disabled = b && !(recorder && recorder.state === "recording");
    els.file.disabled = b;
  }

  /* ---------- 編集・保存 ---------- */
  function openEditor(it) {
    editing = { id: it.id, duration: it.duration_sec ?? null };
    els.title.value = it.title || "";
    els.recordedOn.value = it.recorded_on || today();
    els.text.value = it.text || "";
    els.memo.value = it.memo || "";
    els.editor.hidden = false;
    els.editor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetEditor() {
    editing = { id: null, duration: null };
    els.editor.hidden = true;
    els.title.value = els.text.value = els.memo.value = "";
  }

  els.discard.addEventListener("click", () => {
    if (!els.text.value || confirm("この内容を破棄しますか？")) resetEditor();
  });

  els.copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.text.value);
      setMsg(els.status, "コピーしました。");
    } catch {
      els.text.select();
      setMsg(els.status, "コピーできませんでした。本文を選択したので、手動でコピーしてください。", true);
    }
  });

  els.save.addEventListener("click", async () => {
    const text = els.text.value.trim();
    if (!text) {
      setMsg(els.status, "本文が空です。", true);
      return;
    }
    const recordedOn = els.recordedOn.value || today();
    const title = els.title.value.trim() || `${recordedOn} の記録`;
    const row = { title, text, memo: els.memo.value.trim(), recorded_on: recordedOn };
    if (editing.duration != null) row.duration_sec = editing.duration;

    els.save.disabled = true;
    try {
      const q = editing.id
        ? sb.from("transcripts").update(row).eq("id", editing.id)
        : sb.from("transcripts").insert(row);
      const { error } = await q;
      if (error) throw error;
      setMsg(els.status, "保存しました。");
      resetEditor();
      await loadList();
    } catch (err) {
      setMsg(els.status, "保存できませんでした：" + (err.message || ""), true);
    } finally {
      els.save.disabled = false;
    }
  });

  /* ---------- 履歴 ---------- */
  async function loadList() {
    const { data, error } = await sb
      .from("transcripts")
      .select("id,title,text,memo,duration_sec,recorded_on,created_at")
      .order("recorded_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      setMsg(els.status, "履歴を読み込めませんでした：" + error.message, true);
      return;
    }
    items = data;
    renderList();
  }

  els.search.addEventListener("input", renderList);

  function renderList() {
    const q = els.search.value.trim().toLowerCase();
    const shown = q
      ? items.filter((i) => [i.title, i.text, i.memo].join("\n").toLowerCase().includes(q))
      : items;
    els.list.replaceChildren();
    els.empty.hidden = shown.length > 0;
    els.empty.textContent = items.length ? "一致する記録はありません。" : "まだ保存されたものはありません。";

    for (const it of shown) {
      const li = document.createElement("li");

      const head = document.createElement("div");
      head.className = "item-head";
      const title = document.createElement("span");
      title.className = "item-title";
      title.textContent = it.title;
      const date = document.createElement("span");
      date.className = "item-date";
      date.textContent = it.recorded_on;
      head.append(title, date);

      const preview = document.createElement("p");
      preview.className = "item-preview";
      preview.textContent = it.text;

      const body = document.createElement("div");
      body.className = "item-body";
      body.hidden = true;
      const pre = document.createElement("pre");
      pre.textContent = it.text;
      body.append(pre);
      if (it.memo) {
        const memo = document.createElement("div");
        memo.className = "memo";
        memo.textContent = it.memo;
        body.append(memo);
      }
      const acts = document.createElement("div");
      acts.className = "actions";
      acts.style.marginTop = "10px";
      const bEdit = document.createElement("button");
      bEdit.textContent = "編集";
      bEdit.addEventListener("click", () => openEditor(it));
      const bCopy = document.createElement("button");
      bCopy.textContent = "コピー";
      bCopy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(it.text); setMsg(els.status, "コピーしました。"); }
        catch { setMsg(els.status, "コピーできませんでした。", true); }
      });
      const bDel = document.createElement("button");
      bDel.textContent = "削除";
      bDel.className = "danger";
      bDel.addEventListener("click", async () => {
        if (!confirm(`「${it.title}」を削除しますか？元に戻せません。`)) return;
        const { error } = await sb.from("transcripts").delete().eq("id", it.id);
        if (error) { setMsg(els.status, "削除できませんでした：" + error.message, true); return; }
        await loadList();
      });
      acts.append(bEdit, bCopy, bDel);
      body.append(acts);

      head.addEventListener("click", () => {
        body.hidden = !body.hidden;
        preview.hidden = !body.hidden;
      });

      li.append(head, preview, body);
      els.list.append(li);
    }
  }

  setMode("login");
})();
