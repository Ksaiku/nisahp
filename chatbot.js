/* chatbot.js — NISA案内AI（学習用デモ）
 * index.html（Claude Design生成物）は変更せず、この1ファイルからDOMを組み立てて挿入する。
 * 工程7：5-1のAPI仕様・11-26の表示要件に従う。
 */
(function () {
  "use strict";

  var API_URL = "https://nisa-rag-worker.kasai-dev.workers.dev/api/chat";

  var MAX_LENGTH = 500;
  var DISCLAIMER_TEXT =
    "この回答は金融庁NISA特設サイトの記載のみに基づく学習用デモです。ミナモト証券は架空の会社です。実際のご判断は金融庁の公式サイトでご確認ください。";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "style") {
          node.setAttribute("style", attrs[key]);
        } else if (key === "html") {
          node.innerHTML = attrs[key];
        } else {
          node.setAttribute(key, attrs[key]);
        }
      });
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function text(str) {
    return document.createTextNode(str);
  }

  // "2026-09-05" -> "2026年9月5日"
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    return m[1] + "年" + parseInt(m[2], 10) + "月" + parseInt(m[3], 10) + "日";
  }

  // 本文の [n] を、出典リストの該当項目へのアンカーリンクに変換する。
  // sources[].n は配列（同一URLの重複排除・11-23(3)）なので、逆引きマップを作る。
  function linkifyCitations(answerText, sources) {
    var nToSourceIndex = {};
    sources.forEach(function (s, idx) {
      (s.n || []).forEach(function (n) {
        nToSourceIndex[n] = idx;
      });
    });
    var wrapper = el("p", { style: "margin:0 0 12px; line-height:1.9; font-size:15px;" });
    var parts = String(answerText).split(/(\[\d+\])/g);
    parts.forEach(function (part) {
      var m = /^\[(\d+)\]$/.exec(part);
      if (m && nToSourceIndex.hasOwnProperty(Number(m[1]))) {
        var idx = nToSourceIndex[Number(m[1])];
        wrapper.appendChild(
          el(
            "a",
            {
              href: "#chat-source-" + idx,
              style:
                "text-decoration:none; color: var(--color-accent-700); font-size:12px; vertical-align:super; margin: 0 1px;",
            },
            [text(part)]
          )
        );
      } else {
        wrapper.appendChild(text(part));
      }
    });
    return wrapper;
  }

  function buildSourcesList(sources) {
    if (!sources || sources.length === 0) return null;
    var list = el("ul", { style: "margin:8px 0 0; padding-left:18px; font-size:13px; line-height:1.9;" });
    sources.forEach(function (s, idx) {
      var label = "[" + (s.n || []).join(",") + "] " + s.title + "（" + formatDate(s.as_of) + "時点）";
      var link = el("a", { href: s.url, target: "_blank", rel: "noopener", id: "chat-source-" + idx }, [text(label)]);
      list.appendChild(el("li", null, [link]));
    });
    return el("div", null, [el("div", { style: "font-size:12px; color: var(--color-neutral-600);" }, [text("出典")]), list]);
  }

  function renderResult(container, data) {
    container.innerHTML = "";
    container.hidden = false;

    if (data.error) {
      // 11-26(2)B：error:true のときは出典欄を出さない。
      container.appendChild(el("p", { style: "margin:0; line-height:1.9; font-size:15px;" }, [text(data.answer)]));
      container.appendChild(disclaimerNode());
      return;
    }

    if (data.no_answer) {
      var p = el("p", { style: "margin:0 0 8px; line-height:1.9; font-size:15px;" }, [text(data.answer)]);
      container.appendChild(p);
      container.appendChild(
        el("p", { style: "margin:0 0 12px; font-size:13px; color: var(--color-neutral-600);" }, [
          text("言い換えて質問すると見つかる場合があります。"),
        ])
      );
      container.appendChild(disclaimerNode());
      return;
    }

    container.appendChild(linkifyCitations(data.answer, data.sources || []));
    var sourcesNode = buildSourcesList(data.sources || []);
    if (sourcesNode) container.appendChild(sourcesNode);
    container.appendChild(disclaimerNode());
  }

  function disclaimerNode() {
    // 11-26(2)A：回答欄への常時明示。ミナモト証券自身の断定的な案内に見えないよう、
    // 枠・背景色で視覚的に区別する。
    return el(
      "div",
      {
        style:
          "margin-top:14px; padding:10px 12px; border: 1px dashed var(--color-accent); background: var(--color-neutral-100); font-size:12px; line-height:1.8; color: var(--color-neutral-700);",
      },
      [text(DISCLAIMER_TEXT)]
    );
  }

  function buildWidget() {
    var counter = el("span", { style: "font-size:12px; color: var(--color-neutral-600);" }, [text(MAX_LENGTH + "文字まで")]);

    var textarea = el("textarea", {
      id: "chat-input",
      maxlength: String(MAX_LENGTH),
      rows: "3",
      placeholder: "NISAについて質問する（例：つみたて投資枠の年間投資枠はいくらですか？）",
      style:
        "width:100%; box-sizing:border-box; padding:10px 12px; font-size:15px; font-family: inherit; border: 1px solid var(--color-divider); border-radius:0; resize: vertical;",
    });

    var submitBtn = el("button", { type: "submit", class: "btn btn-primary" }, [text("質問する")]);

    var form = el("form", { id: "chat-form", style: "display:grid; gap:8px;" }, [
      textarea,
      el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [counter, submitBtn]),
    ]);

    var loading = el(
      "div",
      { id: "chat-loading", hidden: "hidden", style: "margin-top:12px; font-size:13px; color: var(--color-neutral-600);" },
      [text("回答を生成しています…")]
    );

    var result = el("div", { id: "chat-result", hidden: "hidden" });

    var badge = el(
      "div",
      {
        style:
          "display:inline-block; font-size:10px; letter-spacing:0.14em; color: var(--color-accent-700); border:1px solid var(--color-accent); padding:4px 10px; margin-bottom:14px;",
      },
      [text("AIによる自動回答・学習用デモ")]
    );

    var box = el(
      "div",
      {
        id: "chat-widget",
        style:
          "border: 1px solid var(--color-accent); background: var(--color-bg); padding: clamp(20px, 4vw, 32px);",
      },
      [badge, form, loading, result]
    );

    textarea.addEventListener("input", function () {
      var remaining = MAX_LENGTH - textarea.value.length;
      counter.textContent = remaining + "文字まで";
    });

    form.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var question = textarea.value.trim();
      if (question.length < 1 || question.length > MAX_LENGTH) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "送信中…";
      loading.hidden = false;
      result.hidden = true;

      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, data: data };
          });
        })
        .then(function (r) {
          renderResult(result, r.data);
        })
        .catch(function () {
          renderResult(result, {
            error: true,
            answer: "通信エラーが発生しました。時間をおいて再度お試しください。",
            sources: [],
            no_answer: false,
          });
        })
        .then(function () {
          loading.hidden = true;
          submitBtn.disabled = false;
          submitBtn.textContent = "質問する";
        });
    });

    return box;
  }

  function buildSection() {
    var kicker = el(
      "div",
      {
        style:
          "font-family: var(--font-body), sans-serif; font-size: 11px; letter-spacing: 0.24em; color: var(--color-accent-700); font-feature-settings: 'tnum' 1;",
      },
      [text("05  —  AIに質問する")]
    );
    var heading = el(
      "h2",
      {
        style:
          "font-family: var(--font-heading), 'Noto Serif JP', serif; font-weight: 400; font-size: clamp(26px, 4vw, 40px); line-height: 1.45; margin: 18px 0 16px;",
      },
      [text("NISA案内AI（学習用デモ）")]
    );
    var lead = el(
      "p",
      { style: "max-width: 62ch; margin: 0 0 32px; font-size: 15px; line-height: 2.05; color: var(--color-neutral-800);" },
      [text("金融庁NISA特設サイトの記載内容だけをもとに、AIが質問にお答えするデモ機能です。ミナモト証券のスタッフや公式見解ではありません。")]
    );

    return el(
      "section",
      { id: "ask", style: "max-width: 1080px; margin: 0 auto; padding: clamp(56px, 9vw, 96px) clamp(20px, 5vw, 48px);" },
      [kicker, heading, lead, buildWidget()]
    );
  }

  function mount() {
    var faq = document.getElementById("faq");
    var section = buildSection();
    if (faq && faq.parentNode) {
      faq.parentNode.insertBefore(section, faq.nextSibling);
    } else {
      document.body.appendChild(section);
    }

    // ナビゲーションにも導線を追加する（既存のnav要素へJSから1項目だけ追記。HTML本体は編集しない）。
    var nav = document.querySelector("header nav");
    if (nav) {
      var navLink = document.createElement("a");
      navLink.href = "#ask";
      navLink.textContent = "AIに質問する";
      navLink.style.textDecoration = "none";
      navLink.style.color = "var(--color-accent-700)";
      nav.appendChild(navLink);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
