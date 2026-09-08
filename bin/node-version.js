// 要る Node のバージョンを確かめる。
//
// **ここだけは型注釈を使わない。** 型注釈をそのまま実行するには 22.18 以上が要る。
// 確かめる場所がその条件を満たさないと動かないのでは意味がない。**確認の手前で
// 落ちる。**
//
// 入口とは別のファイルにしている。**入口は npx から別名で呼ばれるため、
// 「直接実行されたか」で分岐できない。** 分岐を置いたところ、npx 経由で何も
// 起きなくなった（AUT-96）。分けておけば、判定のために分岐を置く必要がない。

/** 型注釈をそのまま実行できる最小のバージョン。 */
export const NEEDS = "22.18";

/** 届いていないか。**読めない値は、通さない側へ倒す。** */
export function tooOld(version) {
  const [major, minor] = String(version).split(".").map(Number);
  if (!Number.isFinite(major)) return true;

  const [needMajor, needMinor] = NEEDS.split(".").map(Number);
  if (major !== needMajor) return major < needMajor;
  return (Number.isFinite(minor) ? minor : 0) < needMinor;
}

/**
 * 届いていないときに言うこと。
 *
 * **なぜ・どうすれば・詰まったらどうするかを添える。** バージョンが足りないと言うだけでは、
 * 何をすればよいか分からない。
 */
export function tooOldMessage(version) {
  return (
    `Node ${version} では動かない。${NEEDS} 以上が要る。\n\n` +
    "  型注釈をそのまま実行するため。ビルド手順を持たない代わりに、\n" +
    "  実行する Node のバージョンに条件が付く。\n\n" +
    "  nvm を使っているなら: nvm install 22 && nvm use 22\n" +
    "  分からない場合は言ってください。手順を案内します。\n"
  );
}
