import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@/components/CodeBlock";
import { cn } from "@/lib/utils";

export type ViewMode = "source" | "preview";

const RENDERABLE_LANGUAGES = new Set(["markdown", "html"]);

export function isRenderableFile(language: string): boolean {
  return RENDERABLE_LANGUAGES.has(language.toLowerCase());
}

interface FilePreviewContentProps {
  language: string;
  content: string;
  viewMode: ViewMode;
  showLineNumbers?: boolean;
  wrapLongLines?: boolean;
  className?: string;
}

export function FilePreviewContent({
  language,
  content,
  viewMode,
  showLineNumbers = true,
  wrapLongLines = false,
  className,
}: FilePreviewContentProps) {
  const normalizedLang = language.toLowerCase();

  if (viewMode === "source" || !isRenderableFile(normalizedLang)) {
    return (
      <div className={cn("overflow-auto", className)}>
        <CodeBlock
          language={language}
          code={content}
          chrome="none"
          showLineNumbers={showLineNumbers}
          wrapLongLines={wrapLongLines}
        />
      </div>
    );
  }

  if (normalizedLang === "markdown") {
    return (
      <div className={cn("overflow-auto", className)}>
        <MarkdownPreview content={content} />
      </div>
    );
  }

  if (normalizedLang === "html") {
    return <HtmlPreview content={content} className={className} />;
  }

  return (
    <div className={cn("overflow-auto", className)}>
      <CodeBlock
        language={language}
        code={content}
        chrome="none"
        showLineNumbers={showLineNumbers}
        wrapLongLines={wrapLongLines}
      />
    </div>
  );
}

function extractText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement(child)) {
        return extractText((child.props as { children?: ReactNode }).children);
      }
      return "";
    })
    .join("");
}

function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  const components = useMemo(
    () => ({
      pre({ children: preChildren, node }: { children?: ReactNode; node?: unknown }) {
        let language = "text";
        // Extract language from the HAST node: pre > code > data.language
        const hastNode = node as Record<string, unknown> | undefined;
        if (hastNode?.children) {
          const codeNode = (hastNode.children as Array<Record<string, unknown>>)?.find(
            (c) => c?.tagName === "code",
          );
          if (codeNode?.data) {
            const data = codeNode.data as Record<string, unknown>;
            language = String(data?.language || "text");
          } else if (codeNode?.properties) {
            const props = codeNode.properties as Record<string, unknown>;
            const classList: unknown[] = Array.isArray(props?.className) ? props.className as unknown[] : [props?.className];
            for (const c of classList) {
              const m = /^language-(.+)$/.exec(String(c ?? ""));
              if (m) { language = m[1]; break; }
            }
          }
        }
        const code = extractText(preChildren).replace(/\n$/, "");
        return (
          <CodeBlock
            language={language}
            code={code}
            chrome="default"
            className="my-3"
          />
        );
      },
    }),
    [],
  );

  return (
    <div
      className={cn(
        "markdown-content prose max-w-none dark:prose-invert p-4",
        "prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-h4:text-[13px]",
        "prose-p:my-2",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        "prose-blockquote:my-3 prose-blockquote:border-l-2 prose-blockquote:font-normal",
        "prose-blockquote:not-italic prose-blockquote:text-foreground/80",
        "prose-a:text-blue-500 prose-a:underline-offset-2",
        "prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0",
        "prose-code:before:content-none prose-code:after:content-none prose-code:font-normal",
        "prose-table:my-3 prose-th:text-left prose-th:font-medium",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function HtmlPreview({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <iframe
        srcDoc={content}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="HTML preview"
        className="w-full flex-1 min-h-0 border-0 bg-white dark:bg-zinc-900"
      />
    </div>
  );
}
