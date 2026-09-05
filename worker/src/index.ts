interface Ai {
  run(model: string, input: unknown): Promise<unknown>;
}

interface VectorizeVector {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface VectorizeQueryResult {
  matches: VectorizeMatch[];
}

interface VectorizeIndex {
  upsert(vectors: VectorizeVector[]): Promise<unknown>;
  query(vector: number[], options?: unknown): Promise<VectorizeQueryResult>;
}

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  EMBEDDING_MODEL: string;
  PRIMARY_MODEL: string;
  FALLBACK_MODEL: string;
  DOC_VERSION: string;
  // 閾値（cosine類似度スコア）。工程4.5・11-13/11-14で実測して確定した値。
  // 5-3・付録Bと同じ値を保つこと。変更する場合はここではなく wrangler.jsonc の vars を編集する。
  SCORE_THRESHOLD_MIN: number;
  SCORE_THRESHOLD_ANSWER: number;
}

interface IngestChunk {
  id: string;
  text: string;
  assumed_questions?: string[];
  metadata: Record<string, unknown>;
}

interface EmbeddingResult {
  shape: number[];
  data: number[][];
}

const TOP_K = 5;
const MAX_QUESTION_LENGTH = 500;
const NO_ANSWER_MESSAGE =
  "提供された資料の範囲では分かりません。金融庁のNISA特設サイト（https://www.fsa.go.jp/policy/nisa2/）をご確認ください。";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 制御文字（コードポイント0x20未満、および0x7F）を除去する。
// 正規表現のhexエスケープに頼らず、1文字ずつコードポイントで判定する。
function stripControlChars(input: string): string {
  let result = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) {
      result += ch;
    }
  }
  return result;
}

// 5-2手順1：入力検証。制御文字を除去し、1〜500文字か確認する。
function validateQuestion(raw: unknown): { ok: true; question: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length < 1 || cleaned.length > MAX_QUESTION_LENGTH) return { ok: false };
  return { ok: true, question: cleaned };
}

// 5-2手順2：質問の埋め込み。失敗時は1回だけ即リトライ（7-2）。
async function embedQuestion(env: Env, question: string): Promise<number[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = (await env.AI.run(env.EMBEDDING_MODEL, { text: [question] })) as EmbeddingResult;
      if (result?.data?.[0]) return result.data[0];
    } catch {
      // 次のループでリトライ、最終失敗はnullを返す
    }
  }
  return null;
}

// 5-2手順3：ベクトル検索。失敗時は1回だけ即リトライ（7-2）。
async function queryVectors(env: Env, vector: number[]): Promise<VectorizeMatch[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await env.VECTORIZE.query(vector, {
        topK: TOP_K,
        returnMetadata: "all",
        returnValues: false,
        filter: { doc_version: env.DOC_VERSION, is_current_system: true },
      });
      if (result?.matches) return result.matches;
    } catch {
      // 次のループでリトライ、最終失敗はnullを返す
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(
          { error: true, answer: "質問は1〜500文字で入力してください。", no_answer: false, sources: [] },
          400
        );
      }

      const questionRaw = (body as { question?: unknown })?.question;
      const validated = validateQuestion(questionRaw);
      if (!validated.ok) {
        return jsonResponse(
          { error: true, answer: "質問は1〜500文字で入力してください。", no_answer: false, sources: [] },
          400
        );
      }

      // 5-2手順2
      const vector = await embedQuestion(env, validated.question);
      if (!vector) {
        return jsonResponse(
          {
            error: true,
            answer: "現在、検索の準備でエラーが発生しました。時間をおいて再度お試しください。",
            sources: [],
            no_answer: false,
          },
          200
        );
      }

      // 5-2手順3
      const matches = await queryVectors(env, vector);
      if (!matches) {
        return jsonResponse(
          {
            error: true,
            answer: "現在、検索でエラーが発生しました。時間をおいて再度お試しください。",
            sources: [],
            no_answer: false,
          },
          200
        );
      }

      // 5-2手順4：閾値判定（5-3・7-1）。
      const adopted = matches.filter((m) => m.score >= env.SCORE_THRESHOLD_MIN);
      const topScore = matches.length > 0 ? matches[0].score : 0;
      const isNoAnswer = matches.length === 0 || adopted.length === 0 || topScore < env.SCORE_THRESHOLD_ANSWER;

      if (isNoAnswer) {
        return jsonResponse({ answer: NO_ANSWER_MESSAGE, sources: [], no_answer: true, error: false }, 200);
      }

      // 5b（LLM生成・システムプロンプト・第6〜7章）は未実装。
      // ここでは採用チャンクの検証ができるよう、暫定的に検索結果をそのまま返す。
      return jsonResponse(
        {
          answer: "",
          sources: [],
          no_answer: false,
          error: false,
          _debug_note: "5b未実装のため生成前の検索結果を返しています（採用チャンクの検証用）",
          _debug_matches: adopted.map((m) => ({
            id: m.id,
            score: m.score,
            heading: m.metadata?.heading,
          })),
        },
        200
      );
    }

    // 準備用・1回限りの投入ルート（4-1改訂版）。
    // wrangler deploy では絶対に公開しないこと。`wrangler dev --remote` でのみ使う想定
    // （localhostからしか届かないため秘密トークンは不要）。投入完了後、工程9で削除する。
    if (url.pathname === "/admin/ingest" && request.method === "POST") {
      const chunks = (await request.json()) as IngestChunk[];

      if (!Array.isArray(chunks) || chunks.length === 0) {
        return jsonResponse({ error: true, message: "チャンク配列が空です。" }, 400);
      }

      // 埋め込む文字列＝【想定される質問】(検索の橋渡し用・11-15対策B) + 原文。
      // metadata.text（LLMに渡す本文）には想定される質問を含めない。
      const embeddingTexts = chunks.map((c) => {
        const prefix = c.assumed_questions?.length
          ? `【想定される質問】${c.assumed_questions.join("／")}\n`
          : "";
        return prefix + c.text;
      });
      const embedding = (await env.AI.run(env.EMBEDDING_MODEL, { text: embeddingTexts })) as EmbeddingResult;

      if (!embedding.data || embedding.data.length !== chunks.length) {
        return jsonResponse({ error: true, message: "埋め込み結果の件数がチャンク数と一致しません。" }, 500);
      }

      const vectors: VectorizeVector[] = chunks.map((c, i) => ({
        id: c.id,
        values: embedding.data[i],
        // metadata.text に原文本体を同梱する（2-3・3-4：Workersは実行時にファイルを読めないため）。
        metadata: { ...c.metadata, text: c.text },
      }));

      const upsertResult = await env.VECTORIZE.upsert(vectors);

      return jsonResponse({ inserted: vectors.length, mutation: upsertResult }, 200);
    }

    return new Response("Not Found", { status: 404 });
  },
};
