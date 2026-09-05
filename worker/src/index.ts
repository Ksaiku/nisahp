interface Env {
  AI: unknown;
  VECTORIZE: unknown;
  EMBEDDING_MODEL: string;
  PRIMARY_MODEL: string;
  FALLBACK_MODEL: string;
}

// 検索・生成ロジックはステップ5（第5〜7章）で実装する。
// このステップでは wrangler.jsonc のバインディング設定を dry-run で確認するための空応答のみ返す。
export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return new Response(
        JSON.stringify({ answer: "", sources: [], no_answer: false, error: false }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};
