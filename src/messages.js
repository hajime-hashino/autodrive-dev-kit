/**
 * 人に見せる文。
 *
 * **AIが動く前に人が見るものだけを、ここに置く。** `init` の質問と案内、置かれる
 * 雛形の説明。開発が始まればAIが相手の言語で話すため、そこは翻訳の対象ではない。
 *
 * ## 規約と定義は訳さない
 *
 * `docs/autodrive.md` も定義も ADR も、ここには入れない。**毎日書き換わるため、
 * 訳が古くなる。AIが従う規約と人が読む規約が食い違うのは、一言語で持つより悪い。**
 *
 * 代わりに、配布物が「人の言語で話す」ことを求めている。規約を聞かれたら、AIが
 * その場で相手の言語に言い直す。**常に最新版を読むので、古くならない。**
 *
 * ## 増やすとき
 *
 * **両方の言語に足すこと。** 片方だけ足すと、もう片方で空白が出る。判定がそれを
 * 捕まえる（`test/messages.test.js`）。
 */

/** 選べる言語。**増やすなら、すべての文をその言語で埋めること。** */
export const LANGUAGES = ["ja", "en"];

/** @typedef {"ja" | "en"} Language */

/**
 * 表示する文。
 *
 * **項目名は英語にする。** 日本語の項目名にすると、日本語を既定として扱っている
 * ことが構造に出る。ここでは両方が対等である。
 */
const MESSAGES = {
  ja: {
    // --- 見出し ---
    "headline.init": "土台を置いた（版 {version}）。",
    "headline.apply": "既にあるものへ土台を入れた（版 {version}）。",
    "headline.update": "道具を入れ替えた（版 {version}）。",
    "section.config": "構成:",
    "section.todo": "**ここから先は人にしかできない。**",

    // --- 置いたものの扱い ---
    "placement.managed": "置いた（参照実装が管理する。次に入れ替えると上書きされる）",
    "placement.seeded": "置いた（このプロジェクトのものになる）",
    "placement.merged": "足した",
    "placement.skipped": "そのままにした（既にある）",

    // --- どう決まったか ---
    "decided.chosen": "（選んだもの）",
    "decided.inferred": "（見て分かったものを採った: {because}）",
    "decided.recommended": "（聞けなかったため推奨のまま）",
    "decided.onlyOne": "（選択肢が1つ）",
    "decided.seen": "（見て分かった: {because}）",
    "decided.recorded": "（記録されたもの）",

    // --- 聞くこと ---
    "ask.preview": "提出のたびに、動くものを見られる場所を用意しますか？",
    "ask.preview.why":
      "画面の見え方は、動くものを見ないと決められません。用意すると、提出ごとに URL が出ます。",
    "ask.preview.cloudflare": "用意する（Cloudflare Workers）",
    "ask.preview.none": "用意しない（画面の無いものを作る、あとで決める）",
    "ask.sandbox": "AIを、隔離された作業場の中で動かしますか？",
    "ask.sandbox.why": "手元の環境から切り離すと、消してはいけないものへ手が届かなくなります。",
    "ask.sandbox.devcontainer": "隔離する（devcontainer）",
    "ask.sandbox.none": "隔離しない",
    "ask.language": "セットアップの案内を、どの言語で出しますか？",
    "ask.language.why":
      "**開発の会話は、あなたの言語で行われます。** ここで選ぶのは、設定のときに出る文だけです。",
    "ask.language.ja": "日本語",
    "ask.language.en": "English",

    "ask.recommended": "  ← 推奨",
    "ask.prompt": "番号を入れる（そのまま Enter で推奨）: ",
    "ask.notAChoice": "\n  それは選択肢に無い。もう一度。\n",

    // --- 人にしかできないこと ---
    "todo.env": ".env を作り、資格情報を書く（.env.example に必要なものが並んでいる）",
    "todo.reopen":
      "作業場を開き直す（VS Code なら「Reopen in Container」）。" +
      "**.env を作ってから行うこと。** 環境を作るときに読まれる",
    "todo.start": "Claude Code を開き、「はじめる」と伝える。あとはAIが聞き始める",
    "todo.pointer": "CLAUDE.md に次の1行を足すこと: 「作業の進め方は docs/autodrive.md に従う」",
    "todo.staleWorkflow":
      ".github/workflows/verify.yml を削除する（invariants.yml に置き換わった。" +
      "残すと同じ判定が二重に走る）",
  },
  en: {
    "headline.init": "Set up the foundation (version {version}).",
    "headline.apply": "Added the foundation to an existing project (version {version}).",
    "headline.update": "Replaced the tools (version {version}).",
    "section.config": "Configuration:",
    "section.todo": "**Only you can do the rest.**",

    "placement.managed": "placed (owned by dev-kit; overwritten on update)",
    "placement.seeded": "placed (yours from here on)",
    "placement.merged": "added",
    "placement.skipped": "left alone (already present)",

    "decided.chosen": " (you chose this)",
    "decided.inferred": " (took what was found: {because})",
    "decided.recommended": " (could not ask, so kept the recommendation)",
    "decided.onlyOne": " (only one option)",
    "decided.seen": " (found: {because})",
    "decided.recorded": " (from the recorded configuration)",

    "ask.preview": "Do you want a place to see the running app on every submission?",
    "ask.preview.why":
      "You cannot decide how a screen looks without seeing it run. With this, every submission gets a URL.",
    "ask.preview.cloudflare": "Yes (Cloudflare Workers)",
    "ask.preview.none": "No (nothing with a screen, or decide later)",
    "ask.sandbox": "Do you want the AI to run inside an isolated workspace?",
    "ask.sandbox.why":
      "Separating it from your machine keeps it away from things that must not be deleted.",
    "ask.sandbox.devcontainer": "Yes (devcontainer)",
    "ask.sandbox.none": "No",
    "ask.language": "Which language should the setup use?",
    "ask.language.why":
      "**The development conversation happens in your language.** This only sets the text shown during setup.",
    "ask.language.ja": "日本語",
    "ask.language.en": "English",

    "ask.recommended": "  <- recommended",
    "ask.prompt": "Enter a number (or press Enter for the recommendation): ",
    "ask.notAChoice": "\n  That is not one of the options. Try again.\n",

    "todo.env": "Create .env and fill in the credentials (.env.example lists what is needed)",
    "todo.reopen":
      "Reopen the workspace (in VS Code, \"Reopen in Container\"). " +
      "**Create .env first.** It is read when the environment is built",
    "todo.start": "Open Claude Code and say \"let's start\". The AI takes it from there",
    "todo.pointer":
      "Add this line to CLAUDE.md: \"Follow docs/autodrive.md for how to work\"",
    "todo.staleWorkflow":
      "Delete .github/workflows/verify.yml (replaced by invariants.yml. " +
      "Leaving it runs the same check twice)",
  },
};

/**
 * 文を引く。
 *
 * **無い項目名を空白で通さない。** 空白が出ると、何が抜けたのか読む側から分から
 * ない。項目名をそのまま返して、抜けが目に見えるようにする。
 *
 * @param {Language} language
 * @param {string} key
 * @param {Record<string, string>} [values] `{name}` の置き換え
 * @returns {string}
 */
export function say(language, key, values = {}) {
  const table = MESSAGES[language] ?? MESSAGES.ja;
  const text = table[key] ?? MESSAGES.ja[key] ?? `[${key}]`;
  return Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), text);
}

/** 判定のために、持っている項目名を出す。 */
export function keysOf(language) {
  return Object.keys(MESSAGES[language] ?? {});
}
