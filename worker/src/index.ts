interface Ai {
  run(model: string, input: unknown): Promise<unknown>;
}

interface VectorizeVector {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

interface VectorizeIndex {
  upsert(vectors: VectorizeVector[]): Promise<unknown>;
  query(vector: number[], options?: unknown): Promise<unknown>;
}

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  EMBEDDING_MODEL: string;
  PRIMARY_MODEL: string;
  FALLBACK_MODEL: string;
}

interface IngestChunk {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

interface EmbeddingResult {
  shape: number[];
  data: number[][];
}

// 検索・生成ロジックはステップ5（第5〜7章）で実装する。
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return new Response(
        JSON.stringify({ answer: "", sources: [], no_answer: false, error: false }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 準備用・1回限りの投入ルート（4-1改訂版）。
    // wrangler deploy では絶対に公開しないこと。`wrangler dev --remote` でのみ使う想定
    // （localhostからしか届かないため秘密トークンは不要）。投入完了後、工程9で削除する。
    if (url.pathname === "/admin/ingest" && request.method === "POST") {
      const chunks = (await request.json()) as IngestChunk[];

      if (!Array.isArray(chunks) || chunks.length === 0) {
        return new Response(JSON.stringify({ error: true, message: "チャンク配列が空です。" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const texts = chunks.map((c) => c.text);
      const embedding = (await env.AI.run(env.EMBEDDING_MODEL, { text: texts })) as EmbeddingResult;

      if (!embedding.data || embedding.data.length !== chunks.length) {
        return new Response(
          JSON.stringify({ error: true, message: "埋め込み結果の件数がチャンク数と一致しません。" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const vectors: VectorizeVector[] = chunks.map((c, i) => ({
        id: c.id,
        values: embedding.data[i],
        metadata: c.metadata,
      }));

      const upsertResult = await env.VECTORIZE.upsert(vectors);

      return new Response(
        JSON.stringify({ inserted: vectors.length, mutation: upsertResult }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};
