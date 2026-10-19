/* 予定・投薬・助成金管理のロジック（DOMに依存しない純粋な関数。Node でもテストできる） */
(function (root) {
  "use strict";

  const KINDS = {
    visit: "通院",
    medication: "投薬",
    procedure: "採卵・移植など",
    grant: "助成金・手続き",
    other: "その他",
  };

  const MAX_DAYS = 60;
  const MAX_ROWS = 120;

  /* 助成金・費用まわりの確認リスト。自治体ごとに条件が違うため「確認すること」だけを載せ、金額や期限は載せない。 */
  const GRANT_CHECKLIST = [
    {
      title: "お住まいの自治体の助成制度を確認する",
      notes: "都道府県と市区町村で別々の制度があることがあります。対象の治療・治療の開始日・年齢や回数の条件・所得制限・事前の申請が必要かを確認します。",
    },
    {
      title: "助成金の申請期限を調べて、日付つきで登録する",
      notes: "期限の数え方は自治体ごとに違います（治療の終了日から、交付決定の通知日から、年度ごとなど）。",
    },
    {
      title: "病院に証明書（受診証明など）の記入を依頼する",
      notes: "自治体指定の様式を病院が記入する形が多く、できあがるまで日数がかかることがあります。",
    },
    {
      title: "領収書をすべて保管する（コピーも取る）",
      notes: "提出した領収書が返却されない自治体があります。必要ならコピーを手元に残します。",
    },
    {
      title: "限度額適用認定証を用意する（またはマイナ保険証で限度額情報の表示に同意する）",
      notes: "加入している医療保険（保険者）に確認します。提示しないと、後から高額療養費を申請することになり、助成金の支払いも遅れることがあります。",
    },
    {
      title: "高額療養費・付加給付金の支給決定通知書を保管する",
      notes: "助成額が、高額療養費や付加給付金を引いた後の自己負担額で計算される自治体があり、通知書の提出を求められることがあります。",
    },
    {
      title: "申請に必要な書類（口座・本人確認・保険情報など）を揃える",
      notes: "戸籍謄本など、状況によって追加で必要になる書類があります。自治体の案内で確認します。",
    },
    {
      title: "助成金を受け取ったら、確定申告の医療費控除から差し引く",
      notes: "助成金は、医療費控除では「補てんされる金額」として差し引く扱いです。詳しくは税務署に確認します。",
    },
  ];

  /* ---------- 日付ユーティリティ（'YYYY-MM-DD' の文字列で扱い、タイムゾーンの影響を避ける） ---------- */
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }
  function fmtDate(dt) {
    return dt.toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const dt = parseDate(s);
    dt.setUTCDate(dt.getUTCDate() + n);
    return fmtDate(dt);
  }
  function diffDays(from, to) {
    return Math.round((parseDate(to) - parseDate(from)) / 86400000);
  }
  function normTime(t) {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
  }

  /* ---------- 投薬のまとめ登録 ---------- */
  function parseTimes(input) {
    const raw = String(input || "").split(/[,、，\s]+/).filter(Boolean);
    const out = [];
    for (const r of raw) {
      const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(r);
      if (!m) return { error: `時刻「${r}」を読み取れません。21:00 のように入力してください。` };
      out.push(`${m[1].padStart(2, "0")}:${m[2]}`);
    }
    return Array.from(new Set(out)).sort();
  }

  function expandMedication({ title, startDate, endDate, times, notes }) {
    const t = String(title || "").trim();
    if (!t) return { error: "薬の名前やメモを入力してください。" };
    const end = endDate || startDate;
    if (!parseDate(startDate) || !parseDate(end)) return { error: "開始日と終了日を入力してください。" };
    const days = diffDays(startDate, end) + 1;
    if (days < 1) return { error: "終了日は開始日以降にしてください。" };
    if (days > MAX_DAYS) return { error: `一度に登録できるのは${MAX_DAYS}日分までです。` };
    const ts = parseTimes(times);
    if (ts.error) return { error: ts.error };
    const slots = ts.length ? ts : [null];
    if (days * slots.length > MAX_ROWS) return { error: `一度に登録できるのは${MAX_ROWS}件までです。期間を分けてください。` };
    const rows = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(startDate, i);
      for (const tm of slots) {
        rows.push({ kind: "medication", title: t, due_date: d, due_time: tm, notes: String(notes || "").trim() });
      }
    }
    return { rows };
  }

  /* ---------- 並び替え ---------- */
  function sortPlans(plans) {
    return plans.slice().sort((a, b) => {
      const ad = a.due_date || "9999-99-99", bd = b.due_date || "9999-99-99";
      if (ad !== bd) return ad < bd ? -1 : 1;
      const at = normTime(a.due_time) || (a.due_date ? "99:99" : ""), bt = normTime(b.due_time) || (b.due_date ? "99:99" : "");
      if (at !== bt) return at < bt ? -1 : 1;
      return String(a.created_at || "") < String(b.created_at || "") ? -1 : 1;
    });
  }

  /* ---------- おすすめ（ルールベース。通院・投薬の内容そのものは提案しない） ---------- */
  function buildSuggestions(plans, today) {
    const out = [];
    const open = plans.filter((p) => !p.done);
    const titles = new Set(plans.map((p) => p.title));
    const upcoming = open.filter((p) => p.due_date && p.due_date >= today);

    // 期限が近い・過ぎている手続き
    for (const p of open) {
      if (p.kind !== "grant" || !p.due_date) continue;
      const left = diffDays(today, p.due_date);
      if (left < 0) {
        out.push({ id: `late-${p.id}`, type: "alert", title: `「${p.title}」の期限を過ぎています`, reason: `${p.due_date} が期限でした。自治体に相談できるか確認してみてください。` });
      } else if (left <= 30) {
        out.push({ id: `soon-${p.id}`, type: "alert", title: `「${p.title}」の期限まであと${left}日です`, reason: `期限は ${p.due_date} です。` });
      }
    }

    // 助成金チェックリスト
    const missing = GRANT_CHECKLIST.filter((g) => !titles.has(g.title));
    if (missing.length) {
      const started = plans.some((p) => p.kind === "grant");
      out.push({
        id: "grant-checklist",
        type: "add_checklist",
        title: started ? `助成金チェックリストの残り${missing.length}件を追加` : "助成金・費用のチェックリストを追加",
        reason: "助成金は条件・期限・書類が自治体ごとに違い、治療の前に確認しておくことが多いものです。",
        items: missing.map((g) => ({ kind: "grant", title: g.title, notes: g.notes })),
      });
    }

    const hasVisit = upcoming.some((p) => p.kind === "visit" && p.title !== "次回の通院日を登録する");
    const hasMedOrProc = upcoming.some((p) => p.kind === "medication" || p.kind === "procedure");
    const T1 = "次回の通院日を登録する";
    if (hasMedOrProc && !hasVisit && !titles.has(T1)) {
      out.push({
        id: "next-visit",
        type: "add_plan",
        title: T1,
        reason: "投薬や処置の予定はありますが、先の通院日がまだ登録されていません。",
        plan: { kind: "visit", title: T1, notes: "" },
      });
    }

    const T2 = "薬の受け取り方法と保管方法を、病院・薬局に確認する";
    if (upcoming.some((p) => p.kind === "medication") && !titles.has(T2)) {
      out.push({
        id: "med-storage",
        type: "add_plan",
        title: T2,
        reason: "注射薬などは、冷蔵が必要なものがあります。薬ごとの扱いは薬剤師や病院の指示に従います。",
        plan: { kind: "medication", title: T2, notes: "" },
      });
    }

    const T3 = "採卵・移植の当日の持ち物・来院時間・食事の指示を病院に確認する";
    const soonProc = upcoming.find((p) => p.kind === "procedure" && diffDays(today, p.due_date) <= 14);
    if (soonProc && !titles.has(T3)) {
      out.push({
        id: "procedure-prep",
        type: "add_plan",
        title: T3,
        reason: `「${soonProc.title}」が ${soonProc.due_date} に予定されています。`,
        plan: { kind: "visit", title: T3, due_date: addDays(soonProc.due_date, -3), notes: "指示は病院のものを優先します。" },
      });
    }

    return out;
  }

  /* ---------- カレンダー(.ics)出力 ---------- */
  function icsEscape(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  function foldLine(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = "", bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) {
        out.push(cur);
        cur = " " + ch;
        bytes = 1 + b;
      } else {
        cur += ch;
        bytes += b;
      }
    }
    out.push(cur);
    return out.join("\r\n");
  }

  function buildIcs(plans, now) {
    const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Minutes//JP", "CALSCALE:GREGORIAN"];
    for (const p of plans) {
      if (p.done || !parseDate(p.due_date)) continue;
      const ymd = p.due_date.replace(/-/g, "");
      const tm = normTime(p.due_time);
      const summary = `[${KINDS[p.kind] || KINDS.other}] ${p.title}`;
      lines.push("BEGIN:VEVENT", `UID:${p.id}@minutes`, `DTSTAMP:${stamp}`);
      if (tm) {
        lines.push(`DTSTART:${ymd}T${tm.replace(":", "")}00`, "DURATION:PT30M");
      } else {
        lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${addDays(p.due_date, 1).replace(/-/g, "")}`);
      }
      lines.push(`SUMMARY:${icsEscape(summary)}`);
      if (p.notes) lines.push(`DESCRIPTION:${icsEscape(p.notes)}`);
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(summary)}`, tm ? "TRIGGER:-PT10M" : "TRIGGER;RELATED=START:PT9H", "END:VALARM");
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  const api = {
    KINDS, GRANT_CHECKLIST, MAX_DAYS, MAX_ROWS,
    parseDate, addDays, diffDays, normTime, parseTimes,
    expandMedication, sortPlans, buildSuggestions, buildIcs,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MinutesPlans = api;
})(typeof window !== "undefined" ? window : globalThis);
