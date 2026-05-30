import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    codeToHtml(code, { lang: language || "text", theme: "github-dark-default" })
      .then((result) => {
        if (active) setHtml(result);
      })
      .catch(() => {
        if (active) setHtml(`<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`);
      });
    return () => {
      active = false;
    };
  }, [code, language]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-zinc-800">
      <button
        onClick={onCopy}
        className="absolute right-2 top-2 z-10 rounded bg-zinc-800/80 p-1.5 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100"
        aria-label="复制代码"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <div className="overflow-x-auto text-sm [&_pre]:m-0 [&_pre]:p-4" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
