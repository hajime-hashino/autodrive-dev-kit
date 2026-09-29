/**
 * 人に見せる文。
 *
 * **AIが動く前に人が見るものだけを、ここに置く。** `init` の質問と案内、置かれる
 * テンプレートの説明。開発が始まればAIが相手の言語で話すため、そこは翻訳の対象ではない。
 *
 * ## 規約と定義は訳さない
 *
 * `docs/autodrive.md` も定義も ADR も、ここには入れない。**毎日書き換わるため、
 * 訳が古くなる。AIが従う規約と人が読む規約が食い違うのは、一言語で持つより悪い。**
 *
 * 代わりに、配布物が「人の言語で話す」ことを求めている。規約を聞かれたら、AIが
 * その場で相手の言語に言い直す。**常に最新のものを読むので、古くならない。**
 *
 * ## 増やすとき
 *
 * **両方の言語に足すこと。** 片方だけ足すと、もう片方で空白が出る。判定がそれを
 * 捕まえる（`test/messages.test.js`）。
 */

/** 選べる言語。**増やすなら、すべての文をその言語で埋めること。** */
/** @type {Language[]} */
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
    "headline.init": "土台を置いた（バージョン {version}）。",
    "headline.apply": "既にあるものへ土台を入れた（バージョン {version}）。",
    "headline.update": "autodrive-dev-kit を入れ替えた（バージョン {version}）。",
    "section.config": "構成:",
    "section.todo": "**ここから先は人にしかできない。**",

    // --- 置いたものの扱い ---
    "placement.managed": "置いた（autodrive-dev-kit が管理する。次に入れ替えると上書きされる）",
    "placement.seeded": "置いた（このプロジェクトのものになる）",
    "placement.merged": "足した",
    "placement.skipped": "そのままにした（既にある）",

    // --- どう決まったか ---
    "decided.chosen": "（選んだもの）",
    "decided.inferred": "（見て分かったものを採った: {because}）",
    "decided.recommended": "（聞けなかったため推奨のまま）",
    "decided.undecided": "（聞けず、案も作れなかった。autodrive.json に書くこと）",
    "decided.onlyOne": "（選択肢が1つ）",
    "decided.seen": "（見て分かった: {because}）",
    "decided.recorded": "（記録されたもの）",
    "decided.changed": "（変えた。前は {from}）",
    "note.trackerChanged":
      "作業単位の置き場を {from} から {to} へ変えた。**それまでの作業単位は移っていない。**\n" +
      "記録（telemetry/）とブランチ名は、前の作業単位IDのまま残る。" +
      "{from} で着手中のものは、{from} の側で閉じること",
    "note.portsUnchecked":
      "前に置いたときの構成の記録が無いため、ポートが変わったかは確かめていない。次の入れ替えからは確かめる",
    "note.leftBehind":
      "前の構成で置いたが、いまの構成では置かないもの（ポートを変えたため）。**消していない。**\n" +
      "要らなければ消すこと。**同じ場所に、このプロジェクトのものとして置いたファイルも残っている" +
      "ことがある**（.devcontainer/devcontainer.json など）。一式で判断すること:\n{paths}",
    "todo.newCredentials": ".env に足す（ポートを変えたため新しく要る）: {names}。何に使うかは .env.example にある",

    // --- 聞くこと ---
    "ask.tracker": "作業単位（やること）を、どこで管理しますか？",
    "ask.tracker.why":
      "起票・状態・記録の紐づけに使います。**途中で変えると、それまでの作業単位が追えなくなります。**",
    "ask.tracker.linear": "Linear を使う",
    "ask.tracker.github": "GitHub Issues を使う（コードと同じ場所で管理する）",
    "ask.preview": "提出のたびに、動くものを見られる場所を用意しますか？",
    "ask.preview.why":
      "画面の見え方は、動くものを見ないと決められません。用意すると、提出ごとに URL が出ます。",
    "ask.preview.cloudflare": "用意する（Cloudflare Workers）",
    "ask.preview.none": "用意しない（画面の無いものを作る、あとで決める）",
    "ask.sandbox": "AIを、どの隔離された環境（サンドボックス）の中で動かしますか？",
    "ask.sandbox.why":
      "手元の環境から切り離すと、消してはいけないものへ手が届かなくなります。\n" +
      "  一式を置くのは devcontainer だけです。他を選んだ場合、用意するのはあなたです。",
    "ask.sandbox.devcontainer": "devcontainer を使う（この道具が一式を置きます）",
    "ask.sandbox.orca": "Orca を使う（作業ごとに使い捨ての環境を起こす）",
    "ask.sandbox.other": "別のものを使う（あとで名前を書きます）",
    "ask.sandbox.none": "隔離しない",
    "ask.language": "セットアップの案内を、どの言語で出しますか？",
    "ask.language.why":
      "**開発の会話は、あなたの言語で行われます。** ここで選ぶのは、設定のときに出る文だけです。",
    "ask.language.ja": "日本語",
    "ask.language.en": "English",

    "ask.recommended": "  ← 推奨",
    "ask.prompt": "番号を入れる（そのまま Enter で推奨）: ",
    "ask.notAChoice": "\n  それは選択肢に無い。もう一度。\n",
    "ask.suggested": "案: {value}（そのまま Enter でこれにする）",
    "ask.prompt.value": "入れる: ",
    "ask.notInShape": "\n  その形では受け取れない（{shape}）。もう一度。\n",
    "ask.tracker.prefix": "作業単位IDの頭に付ける文字を決めてください。",
    "ask.tracker.prefix.why":
      "`AIEP-123` のように使います。**ブランチ名と記録のファイル名になります。** 後から変えると、それまでの作業単位が追えなくなります。",
    "ask.tracker.prefix.shape": "英大文字で始まる2〜4文字（例: AIEP）",

    // --- 人にしかできないこと ---
    "todo.env": ".env を作り、資格情報を書く（.env.example に必要なものが並んでいる）",
    "todo.reopen":
      "サンドボックスを開き直す（VS Code なら「Reopen in Container」）。" +
      "**.env を作ってから行うこと。** 環境を作るときに読まれる",
    "todo.trackerLink":
      "{tracker} と {repo} を連携させ、変更が統合されたら作業単位が完了になるよう設定する\n" +
      "（{tracker} の設定画面から行う。**これをしないと、作業単位は着手中のまま溜まり続ける**）",
    "todo.start": "Claude Code を開き、「はじめる」と伝える。あとはAIが聞き始める",
    "todo.pointer": "CLAUDE.md に次の1行を足すこと: 「作業の進め方は docs/autodrive.md に従う」",
    // --- 判定の出力 ---
    //
    // **CI の失敗ログは人が直接読む。** AIが介在しないため、ここは相手の言語で
    // 出す必要がある（AUT-135）。
    "report.title": "不変条件の状態",
    "report.repos": "判定対象: {repos}",
    "report.scope": "実行範囲: {scope}",
    "report.observed": "観測",
    "report.substituted": "代替",
    "report.unimplemented": "未実装",
    "report.failed": "失敗: {labels}",
    "report.failed.why":
      "代替であること自体は失敗ではない。肩代わりの記録が無いこと、" +
      "および有効かどうかを判定できないことが失敗である。",
    "report.ok": "失敗なし",
    "report.evidence.en": "（観測の中身は英語である。AIに聞けば日本語で言い直す）",

    "state.active": "有効",
    "state.substituted": "代替",
    "state.unsubstituted": "要対応",
    "state.notInScope": "対象外",

    "invariant.outer_loop_running": "外側ループが起動し、継続すること",
    "invariant.telemetry_recorded": "テレメトリが記録されること",
    "invariant.boundary_change_logged": "委譲範囲の変更が履歴に残ること",
    "invariant.ai_cannot_disable": "AIがこれらを無効化できないこと",


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
    "decided.undecided": " (could not ask and could not suggest one; write it in autodrive.json)",
    "decided.onlyOne": " (only one option)",
    "decided.seen": " (found: {because})",
    "decided.recorded": " (from the recorded configuration)",
    "decided.changed": " (changed; was {from})",
    "note.trackerChanged":
      "Moved work items from {from} to {to}. **Existing work items were not moved.**\n" +
      "Records (telemetry/) and branch names keep the old work item IDs. " +
      "Close anything still started in {from} over there",
    "note.portsUnchecked":
      "No record of the previous configuration, so port changes were not checked. The next update will check",
    "note.leftBehind":
      "Placed for the previous configuration but no longer placed (a port changed). **Not deleted.**\n" +
      "Remove them if they are no longer needed. **Files placed as the project's own may remain " +
      "alongside them** (such as .devcontainer/devcontainer.json). Decide on the set as a whole:\n{paths}",
    "todo.newCredentials": "Add to .env (newly needed after the port change): {names}. .env.example says what each is for",

    "ask.tracker": "Where do you track work items?",
    "ask.tracker.why":
      "Used for filing, status, and linking records. **Changing it later breaks the trail of earlier work items.**",
    "ask.tracker.linear": "Linear",
    "ask.tracker.github": "GitHub Issues (same place as the code)",
    "ask.preview": "Do you want a place to see the running app on every submission?",
    "ask.preview.why":
      "You cannot decide how a screen looks without seeing it run. With this, every submission gets a URL.",
    "ask.preview.cloudflare": "Yes (Cloudflare Workers)",
    "ask.preview.none": "No (nothing with a screen, or decide later)",
    "ask.sandbox": "Which isolated workspace should the AI run inside?",
    "ask.sandbox.why":
      "Separating it from your machine keeps it away from things that must not be deleted.\n" +
      "  Only devcontainer comes with a full set. Choose anything else and you provide it.",
    "ask.sandbox.devcontainer": "devcontainer (this tool places the whole set)",
    "ask.sandbox.orca": "Orca (a disposable environment per work item)",
    "ask.sandbox.other": "Something else (write its name later)",
    "ask.sandbox.none": "No",
    "ask.language": "Which language should the setup use?",
    "ask.language.why":
      "**The development conversation happens in your language.** This only sets the text shown during setup.",
    "ask.language.ja": "日本語",
    "ask.language.en": "English",

    "ask.recommended": "  <- recommended",
    "ask.prompt": "Enter a number (or press Enter for the recommendation): ",
    "ask.notAChoice": "\n  That is not one of the options. Try again.\n",
    "ask.suggested": "Suggested: {value} (press Enter to take it)",
    "ask.prompt.value": "Enter a value: ",
    "ask.notInShape": "\n  That is not the expected shape ({shape}). Try again.\n",
    "ask.tracker.prefix": "Choose the characters that lead each work item ID.",
    "ask.tracker.prefix.why":
      "Used as in `AIEP-123`. **It becomes the branch name and the record file name.** Changing it later breaks the trail of earlier work items.",
    "ask.tracker.prefix.shape": "2-4 characters, starting with an uppercase letter (e.g. AIEP)",

    "todo.env": "Create .env and fill in the credentials (.env.example lists what is needed)",
    "todo.reopen":
      "Reopen the workspace (in VS Code, \"Reopen in Container\"). " +
      "**Create .env first.** It is read when the environment is built",
    "todo.trackerLink":
      "Connect {tracker} to {repo} so that work items complete when changes are integrated\n" +
      "(configure this in {tracker}'s settings. **Without it, work items pile up as started**)",
    "todo.start": "Open Claude Code and say \"let's start\". The AI takes it from there",
    "todo.pointer":
      "Add this line to CLAUDE.md: \"Follow docs/autodrive.md for how to work\"",
    "report.title": "Invariant status",
    "report.repos": "Checked: {repos}",
    "report.scope": "Scope: {scope}",
    "report.observed": "observed",
    "report.substituted": "substituted",
    "report.unimplemented": "not built",
    "report.failed": "Failing: {labels}",
    "report.failed.why":
      "Being substituted is not itself a failure. Failure means there is no record " +
      "of anyone covering it, or the state cannot be determined.",
    "report.ok": "Nothing failing",
    "report.evidence.en": "(the observations below are in English)",

    "state.active": "active",
    "state.substituted": "substituted",
    "state.unsubstituted": "unresolved",
    "state.notInScope": "out of scope",

    "invariant.outer_loop_running": "The outer loop has started and is continuing",
    "invariant.telemetry_recorded": "Telemetry is being recorded",
    "invariant.boundary_change_logged": "Delegation changes stay in the history",
    "invariant.ai_cannot_disable": "The AI cannot disable any of these",

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
