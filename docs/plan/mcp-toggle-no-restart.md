# Plan: MCP Enable/Disable Takes Effect for New Sessions [done]

## Context

When users toggle MCP presets on/off in the WebUI, the config is saved to disk but the
running agent does not pick up changes without a restart (or hot reload, which crashes due
to anyio cancel scope conflicts in the agent loop task).

Goal: enable/disable changes should take effect for new sessions without restarting
nanobot or running a hot reload.

## Approach

Three changes:

### 1. `nanobot/webui/mcp_presets_api.py` — Remove `requires_restart` for enable/disable

In `mcp_presets_action`, the enable action sets `payload["requires_restart"] = True`.
Change this to not set the flag, so the frontend stops prompting the user to restart.

The hot-reload skip (`action not in {"enable", "remove"}`) from the previous change stays.

### 2. `nanobot/agent/tools/mcp.py` — Refresh `_mcp_servers` from config in `connect_missing_servers`

Add a helper `_refresh_mcp_servers(state)` that re-reads the config file and updates
`state._mcp_servers` with the latest server configs. This is **additive only** — it
does not tear down any existing connections or remove tools.

Call this at the start of `connect_missing_servers` so newly enabled servers are visible.

### 3. `nanobot/agent/loop.py` — Call `_connect_mcp()` at the start of `_process_message`

Add `await self._connect_mcp()` at the top of `_process_message` (after
`_refresh_provider_snapshot()`). This calls `connect_missing_servers`, which now:
- Refreshes `state._mcp_servers` from config  
- Connects any new servers that are in config but not yet connected
- Returns immediately (cheap guard) when nothing changed

## Files to Modify

| File | Change |
|------|--------|
| `nanobot/webui/mcp_presets_api.py` | Remove `requires_restart: True` from enable payload |
| `nanobot/agent/tools/mcp.py` | Add `_refresh_mcp_servers()` helper; call before `connect_missing_servers` |
| `nanobot/agent/loop.py` | Call `_connect_mcp()` at start of `_process_message` |

## Verification

1. Start the gateway, open a session with an MCP preset enabled
2. In WebUI Settings, disable that MCP preset
3. Open a **new** session — the disabled preset's tools should not be available
4. Re-enable the preset in Settings
5. Open another new session — the preset's tools should be available
6. No "restart required" prompt should appear for enable/disable actions
7. The gateway should not crash after repeated toggle operations
