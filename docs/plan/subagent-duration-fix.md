# Fix Subagent "Worked for Xs" Duration Display [done]

## Context

When viewing a subagent's activity in the Agents tab of the Artifact drawer, the "Worked for Xs" duration is always inaccurate (often showing "1s"). The root cause:

1. Subagent runs via `AgentRunner.run()` directly, bypassing `AgentLoop._state_save()` where `turn_latency_ms` is computed
2. The inner `AgentActivityCluster` in `SessionDrawer.tsx` renders without `turnLatencyMs` prop
3. `totalDuration` falls back to `createdAt` timestamps — which are synthetic (`_ts_base + idx` in history replay) with only a few ms range
4. `formatActivityDuration` rounds any value `0 < ms < 1000` to `1s`

## Approach

Mirror the main agent's `latency_ms` pattern: compute wall-clock time around `self.runner.run()`, publish a `_subagent_end` event through the bus, propagate through websocket → transcript → frontend, and stamp `latencyMs` on subagent messages. Update `totalDuration` to check message-level `latencyMs` as a fallback.

## Changes

### 1. `nanobot/agent/subagent.py` — Track and publish subagent latency

In `_run_subagent`:
- Record `start_wall = time.time()` before `self.runner.run()` (line 292)
- Record `end_wall = time.time()` right after (before line 313)
- After all `_announce_result` calls (after line 332), publish an `OutboundMessage`:

```python
await self.bus.publish_outbound(OutboundMessage(
    channel=origin["channel"],
    chat_id=origin["chat_id"],
    content="",
    metadata={
        "_subagent_end": True,
        "_subagent_task_id": task_id,
        "_subagent_title": label,
        "latency_ms": int((end_wall - start_wall) * 1000),
    },
))
```

Also publish in the `except` path (line 338) and on cancellation.

### 2. `nanobot/channels/websocket.py` — Handle `_subagent_end` metadata

In `send()`, add a handler before the general message path (before line 1050):

```python
if msg.metadata.get("_subagent_end"):
    body: dict[str, Any] = {
        "event": "subagent_end",
        "chat_id": msg.chat_id,
        "latency_ms": msg.metadata.get("latency_ms"),
    }
    task_id = msg.metadata.get("_subagent_task_id")
    if task_id:
        body["_subagent_task_id"] = task_id
    self._transcripts.prepare_and_append(msg.chat_id, body, metadata=msg.metadata, phase="complete")
    raw = json.dumps(body, ensure_ascii=False)
    for connection in conns:
        await self._safe_send_to(connection, raw, label=" subagent_end ")
    return
```

### 3. `nanobot/webui/transcript.py` — Stamp latency during history replay

In `replay_transcript`, add handling for `subagent_end` records (alongside existing `turn_end` handling around line 2088):

```python
if ev == "subagent_end":
    task_id = rec.get("_subagent_task_id")
    lat = rec.get("latency_ms")
    if isinstance(task_id, str) and isinstance(lat, (int, float)) and lat >= 0:
        for i in range(len(messages) - 1, -1, -1):
            m = messages[i]
            if m.get("subagentTaskId") == task_id and m.get("role") == "assistant" and m.get("kind") != "trace":
                messages[i] = {**m, "latencyMs": int(lat)}
                break
    continue
```

### 4. `webui/src/hooks/useNanobotStream.ts` — Handle live `subagent_end` event

Add handler alongside existing `turn_end` handler (around line 901):

```typescript
if (ev.event === "subagent_end") {
  const taskId = ev._subagent_task_id;
  const latencyMs = typeof ev.latency_ms === "number" ? Math.round(ev.latency_ms) : undefined;
  if (taskId && latencyMs != null) {
    setMessages((prev) => stampSubagentLatency(prev, taskId, latencyMs));
  }
  return;
}
```

Add helper function:

```typescript
function stampSubagentLatency(prev: UIMessage[], taskId: string, latencyMs: number): UIMessage[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    const m = prev[i];
    if (m.subagentTaskId === taskId && m.role === "assistant" && m.kind !== "trace") {
      return [...prev.slice(0, i), { ...m, latencyMs, isStreaming: false }, ...prev.slice(i + 1)];
    }
  }
  return prev;
}
```

### 5. `webui/src/components/thread/AgentActivityCluster.tsx` — Fallback to message `latencyMs`

In `totalDuration` computation (line 700-710), add a message-level `latencyMs` fallback between the `turnLatencyMs` check and the `createdAt` fallback:

```typescript
const totalDuration = useMemo(() => {
    if (turnLatencyMs != null) return formatActivityDuration(turnLatencyMs);
    // Check messages for latencyMs (used by subagent_end events)
    for (let i = messages.length - 1; i >= 0; i--) {
      const lat = messages[i].latencyMs;
      if (typeof lat === "number" && Number.isFinite(lat) && lat >= 0) {
        return formatActivityDuration(lat);
      }
    }
    // Fall back to createdAt timestamps
    const timestamps = messages
      .map((m) => m.createdAt)
      .filter((v) => Number.isFinite(v));
    if (!timestamps.length) return "";
    const first = Math.min(...timestamps);
    const last = isTurnStreaming ? now : Math.max(...timestamps);
    const ms = Math.max(0, last - first);
    return ms > 0 ? formatActivityDuration(ms) : "";
}, [messages, turnLatencyMs, isTurnStreaming, now]);
```

### 6. No changes needed

- **`SessionDrawer.tsx`**: `AgentsTab` already strips `subagentTaskId`/`subagentTitle` but preserves other fields like `latencyMs`. The updated `totalDuration` will automatically pick it up.
- **`activity-timeline.ts`**: No changes — `activityTurnLatencyMs` already searches messages for `latencyMs`.

## Verification

1. **Backend test**: `uv run pytest tests/agent/test_subagent.py -v -k latency` (if exists) or manually verify the `_subagent_end` message is published
2. **Frontend test**: `cd webui && bun run test` — check that existing `AgentActivityCluster` and `useNanobotStream` tests still pass
3. **Manual e2e**:
   - Start gateway: `nanobot gateway`
   - Send a prompt that spawns a subagent (e.g., "write a python script to calculate fibonacci and save to outputs/")
   - Open the Artifact drawer → Agents tab → click the subagent
   - Verify "Worked for Xs" shows a realistic duration (not "1s")
   - Refresh the page and reopen the session from history — verify the same duration is displayed
