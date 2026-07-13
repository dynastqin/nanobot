---
name: chunked-write-file
description: "**MANDATORY for files >200 lines or >16K chars.** write_file rejects content >20K chars. If you are about to write a large file, do NOT call write_file first — go directly to this skill. Use when write_file would reject or truncate, when the user pastes a long file, or when generated content is too large for a single write. Do NOT use for normal-sized files."
metadata: {"nanobot":{"emoji":"📦","requires":{"bins":["python3"]}}}
---

# Chunked Write

## Decision Flow

```
Content > 200 lines or > 16000 chars?
├─ No  → Use write_file directly.
└─ Yes → Content already in conversation context?
    ├─ Yes → Can you pick a delimiter NOT in the content?
    │   ├─ Yes → cat heredoc (primary — simplest, one step)
    │   └─ No  → Python heredoc (fallback — handles delimiter collision)
    └─ No  → Python heredoc (content being generated piecemeal)
        └─ Extremely large (>~50K chars)?
            └─ Yes → Chunked mode with natural boundary splits
```

## Primary Pattern: cat Heredoc

When content is already in the conversation context and you can pick a delimiter that does not appear in the content, use `cat` heredoc. The quoted delimiter disables all shell expansion — `$`, backticks, backslashes, and quotes pass through literally. No base64, no Python, one step.

```bash
cat << 'HTMLEOF' > PATH
...full content here...
HTMLEOF
```

**Delimiter selection:** Scan the content quickly and pick a word that does not appear as a line by itself. Common safe choices: `HTMLEOF`, `ENDOFFILE`, `CONTENTEOF`. If the content contains your delimiter as a whole line, pick a different one.

> **Heredoc is not a loophole.** Even when using heredoc+stdin, the entire `command` string is still a tool-call parameter with its own size limit (~12K chars). A single exec call can hold about **12 000 chars of raw content**. Exceed that and the command is truncated *before* it reaches the shell — the file won't be created at all. Split into ~12K-char chunks even with heredoc.

## Fallback: Python Heredoc

Use when cat heredoc doesn't work — e.g., the content contains every reasonable delimiter, or you're generating content piecemeal from tool output.

```bash
python3 << 'PYEOF'
import sys
content = sys.stdin.read()
with open('PATH', 'w') as f:
    f.write(content)
print(f"Written {len(content)} chars")
PYEOF
```

## Chunked Mode (Very Large Files)

Only when content exceeds ~50K chars and a single exec might time out. Write the first chunk with `'w'`, subsequent chunks with `'a'`.

### Splitting Strategy

Split on **natural boundaries**, not arbitrary byte offsets:
- HTML: between top-level sections (`</section>`, `</div>` closing tags)
- Markdown: between sections (after `## ...` heading blocks)
- Code: between function/class definitions
- Plain text: at paragraph breaks (double newline)

Chunk sizing: ~12K chars per chunk. After each chunk, spot-check with `wc -l`.

```
python3 << 'PYEOF'
import sys
content = sys.stdin.read()
with open('PATH', 'w') as f:
    f.write(content)
print(f"Written {len(content)} chars")
PYEOF
```

```
python3 << 'PYEOF'
import sys
content = sys.stdin.read()
with open('PATH', 'a') as f:
    f.write(content)
print(f"Appended {len(content)} chars")
PYEOF
```

## Verification

After writing, run all of these:

```bash
wc -l PATH        # line count matches expected
head -3 PATH      # file starts correctly (no leading whitespace/garbling)
tail -3 PATH      # file ends correctly (not truncated mid-element)
```

For chunked writes, also verify no gaps between chunks — check that the last few lines of the previous chunk flow naturally into the first few lines of the next chunk.
