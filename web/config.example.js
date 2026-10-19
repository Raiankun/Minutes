// 手元で試すとき用。web/config.js にコピーして値を入れてください（config.js は Git に入りません）。
// Supabase の Project Settings > API の値です。anon キーは公開前提の値ですが、service_role キーは入れないでください。
window.MINUTES_CONFIG = {
  supabaseUrl: "https://xxxxxxxxxxxx.supabase.co",
  supabaseAnonKey: "",
  apiBaseUrl: "",          // 文字起こしサーバーを使うときだけ（例: https://pc.example.ts.net）
  transcribeEnabled: false // 文字起こしサーバーを使うときだけ true
};
