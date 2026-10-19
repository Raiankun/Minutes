const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../../web/plans-lib.js");

test("parseTimes: 区切り・正規化・重複除去・不正値", () => {
  assert.deepEqual(lib.parseTimes("21:00, 8:30、21:00"), ["08:30", "21:00"]);
  assert.deepEqual(lib.parseTimes(""), []);
  assert.match(lib.parseTimes("25:00").error, /読み取れません/);
  assert.match(lib.parseTimes("9時").error, /読み取れません/);
});

test("日付計算: 月またぎ・うるう年・不正な日付", () => {
  assert.equal(lib.addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(lib.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(lib.diffDays("2026-10-19", "2026-10-26"), 7);
  assert.equal(lib.parseDate("2026-02-30"), null);
  assert.equal(lib.parseDate("abc"), null);
});

test("expandMedication: 期間×時刻で行を作る", () => {
  const r = lib.expandMedication({ title: "ゴナール", startDate: "2026-10-20", endDate: "2026-10-22", times: "21:00", notes: "病院の指示どおり" });
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => x.due_date), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.ok(r.rows.every((x) => x.kind === "medication" && x.due_time === "21:00" && x.notes === "病院の指示どおり"));
});

test("expandMedication: 1日2回、時刻なし、終了日省略", () => {
  assert.equal(lib.expandMedication({ title: "A", startDate: "2026-10-20", endDate: "2026-10-21", times: "08:00,20:00" }).rows.length, 4);
  const noTime = lib.expandMedication({ title: "A", startDate: "2026-10-20", times: "" });
  assert.equal(noTime.rows.length, 1);
  assert.equal(noTime.rows[0].due_time, null);
});

test("expandMedication: 入力エラー", () => {
  assert.match(lib.expandMedication({ title: " ", startDate: "2026-10-20" }).error, /名前/);
  assert.match(lib.expandMedication({ title: "A", startDate: "" }).error, /開始日/);
  assert.match(lib.expandMedication({ title: "A", startDate: "2026-10-22", endDate: "2026-10-20" }).error, /開始日以降/);
  assert.match(lib.expandMedication({ title: "A", startDate: "2026-01-01", endDate: "2026-04-01" }).error, /60日/);
  assert.match(lib.expandMedication({ title: "A", startDate: "2026-01-01", endDate: "2026-02-15", times: "06:00,12:00,18:00" }).error, /120件/);
});

test("sortPlans: 日付順、日付なしは最後、時刻なしは同日の最後", () => {
  const sorted = lib.sortPlans([
    { id: "n", title: "日付なし", due_date: null, created_at: "1" },
    { id: "b", due_date: "2026-10-21", due_time: null, created_at: "2" },
    { id: "a2", due_date: "2026-10-20", due_time: "21:00", created_at: "3" },
    { id: "a1", due_date: "2026-10-20", due_time: "08:00:00", created_at: "4" },
  ]);
  assert.deepEqual(sorted.map((p) => p.id), ["a1", "a2", "b", "n"]);
});

const T = "2026-10-19";

test("buildSuggestions: 何もないときは助成金チェックリストのみ", () => {
  const s = lib.buildSuggestions([], T);
  assert.equal(s.length, 1);
  assert.equal(s[0].type, "add_checklist");
  assert.equal(s[0].items.length, lib.GRANT_CHECKLIST.length);
});

test("buildSuggestions: 追加済みの項目は重ねて提案しない", () => {
  const have = lib.GRANT_CHECKLIST.slice(0, 3).map((g, i) => ({ id: `g${i}`, kind: "grant", title: g.title, done: false }));
  const s = lib.buildSuggestions(have, T).find((x) => x.type === "add_checklist");
  assert.equal(s.items.length, lib.GRANT_CHECKLIST.length - 3);
  const all = lib.GRANT_CHECKLIST.map((g, i) => ({ id: `g${i}`, kind: "grant", title: g.title, done: true }));
  assert.equal(lib.buildSuggestions(all, T).filter((x) => x.type === "add_checklist").length, 0);
});

test("buildSuggestions: 投薬があって通院日がなければ通院日を提案", () => {
  const plans = [{ id: "m", kind: "medication", title: "ゴナール", due_date: "2026-10-20", done: false }];
  const ids = lib.buildSuggestions(plans, T).map((x) => x.id);
  assert.ok(ids.includes("next-visit"));
});

test("buildSuggestions: 薬のメモ・残り・予定の抜けをヒントにする（購入や用量は提案しない）", () => {
  const meds = [
    { id: "m1", name: "ゴナール", active: true, storage_note: "", remaining: 2 },
    { id: "m2", name: "別の薬", active: true, storage_note: "冷蔵", remaining: 10 },
    { id: "m3", name: "終了した薬", active: false, storage_note: "", remaining: 0 },
  ];
  const plans = [{ id: "p", kind: "medication", medicine_id: "m2", title: "別の薬", due_date: "2026-10-20", done: false }];
  const hints = lib.buildSuggestions(plans, T, meds).filter((x) => x.type === "hint");
  assert.deepEqual(hints.map((h) => h.id).sort(), ["low-m1", "noplan-m1", "storage-m1"]);
  assert.ok(hints.every((h) => !/mg|IU|単位|増や|減ら/.test(h.title + h.reason)));
});

test("medicineSummary: 薬ごとの件数と次の予定", () => {
  const plans = [
    { id: "1", medicine_id: "m1", due_date: "2026-10-18", done: false },
    { id: "2", medicine_id: "m1", due_date: "2026-10-20", due_time: "21:00", done: false },
    { id: "3", medicine_id: "m1", due_date: "2026-10-19", done: true },
    { id: "4", medicine_id: "m2", due_date: "2026-10-20", done: false },
  ];
  const s = lib.medicineSummary("m1", plans, T);
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.next.id, "2");
  assert.equal(lib.medicineSummary("none", plans, T).next, null);
});

test("expandMedication: medicineId が各行に入る", () => {
  const r = lib.expandMedication({ title: "A", startDate: "2026-10-20", endDate: "2026-10-21", medicineId: "m1" });
  assert.ok(r.rows.every((x) => x.medicine_id === "m1"));
  assert.equal(lib.expandMedication({ title: "A", startDate: "2026-10-20" }).rows[0].medicine_id, null);
});

test("buildSuggestions: 先の通院日があれば通院日は提案しない", () => {
  const plans = [
    { id: "m", kind: "medication", title: "ゴナール", due_date: "2026-10-20", done: false },
    { id: "v", kind: "visit", title: "診察", due_date: "2026-10-25", done: false },
  ];
  assert.ok(!lib.buildSuggestions(plans, T).some((x) => x.id === "next-visit"));
});

test("buildSuggestions: 2週間以内の採卵・移植で当日の確認を提案（病院の指示を優先する文言）", () => {
  const plans = [{ id: "p", kind: "procedure", title: "採卵", due_date: "2026-10-30", done: false }];
  const s = lib.buildSuggestions(plans, T).find((x) => x.id === "procedure-prep");
  assert.ok(s);
  assert.equal(s.plan.due_date, "2026-10-27");
  assert.match(s.plan.notes, /病院/);
  const far = [{ id: "p", kind: "procedure", title: "採卵", due_date: "2026-12-30", done: false }];
  assert.ok(!lib.buildSuggestions(far, T).some((x) => x.id === "procedure-prep"));
});

test("buildSuggestions: 期限が近い・過ぎた手続きを警告", () => {
  const plans = [
    { id: "a", kind: "grant", title: "申請", due_date: "2026-10-25", done: false },
    { id: "b", kind: "grant", title: "別の申請", due_date: "2026-10-01", done: false },
    { id: "c", kind: "grant", title: "遠い申請", due_date: "2027-03-01", done: false },
    { id: "d", kind: "grant", title: "完了済み", due_date: "2026-10-20", done: true },
  ];
  const alerts = lib.buildSuggestions(plans, T).filter((x) => x.type === "alert");
  assert.equal(alerts.length, 2);
  assert.match(alerts.find((x) => x.id === "soon-a").title, /あと6日/);
  assert.match(alerts.find((x) => x.id === "late-b").title, /過ぎています/);
});

test("buildIcs: 時刻あり・終日・完了済みの除外・エスケープ・CRLF・75バイト折り返し", () => {
  const long = "とても長いメモ".repeat(20) + ",;\\";
  const ics = lib.buildIcs(
    [
      { id: "1", kind: "medication", title: "ゴナール", due_date: "2026-10-20", due_time: "21:00:00", notes: long, done: false },
      { id: "2", kind: "visit", title: "診察", due_date: "2026-10-21", due_time: null, notes: "", done: false },
      { id: "3", kind: "visit", title: "完了済み", due_date: "2026-10-22", done: true },
      { id: "4", kind: "other", title: "日付なし", due_date: null, done: false },
    ],
    "2026-10-19T10:00:00.000Z"
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes("DTSTART:20261020T210000"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261021"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261022"));
  assert.ok(ics.includes("DTSTAMP:20261019T100000Z"));
  assert.ok(ics.includes("SUMMARY:[投薬] ゴナール"));
  assert.ok(!ics.includes("完了済み") && !ics.includes("日付なし"));
  const enc = new TextEncoder();
  for (const line of ics.split("\r\n")) assert.ok(enc.encode(line).length <= 75, `too long: ${line}`);
  // 折り返しを戻すとエスケープ済みの文字が壊れていないこと
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("\\,\\;\\\\"));
});
