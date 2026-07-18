"""Composition helpers for the embedded WebUI gateway."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from loguru import logger as default_logger

from nanobot.webui.clouddisk_api import create_clouddisk_gateway
from nanobot.webui.gateway_tokens import GatewayTokenStore
from nanobot.webui.media_gateway import WebUIMediaGateway
from nanobot.webui.transcript import WebUITranscriptRecorder
from nanobot.webui.workspaces import WebUIWorkspaceController
from nanobot.webui.ws_http import GatewayHTTPHandler


@dataclass(frozen=True)
class GatewayServices:
    """Explicit dependencies shared by WebSocket transport and HTTP routes."""

    http: GatewayHTTPHandler
    tokens: GatewayTokenStore
    media: WebUIMediaGateway
    transcripts: WebUITranscriptRecorder
    workspaces: WebUIWorkspaceController
    session_manager: Any | None
    cron_service: Any | None
    cron_pending_job_ids: Callable[[str], set[str]] | None
    channel_manager: Any | None = None
    clouddisk: Any | None = None


def build_gateway_services(
    *,
    config: Any,
    bus: Any,
    session_manager: Any | None,
    static_dist_path: Path | None,
    workspace_path: Path,
    default_restrict_to_workspace: bool,
    runtime_model_name: Any | None,
    runtime_surface: str,
    runtime_capabilities_overrides: dict[str, Any] | None,
    disabled_skills: set[str] | None = None,
    cron_service: Any | None = None,
    cron_pending_job_ids: Callable[[str], set[str]] | None = None,
    channel_manager: Any | None = None,
    root_config: Any | None = None,
    logger: Any = default_logger,
) -> GatewayServices:
    tokens = GatewayTokenStore()

    from nanobot import __version__

    # CloudDisk
    clouddisk = None
    if root_config is not None and getattr(root_config, "clouddisk", None) is not None:
        cd = root_config.clouddisk
        if cd.enabled:
            clouddisk = create_clouddisk_gateway(
                quota_mb=cd.quota_mb,
                max_file_mb=cd.max_file_size_mb,
            )

    media = WebUIMediaGateway(
        workspace_path=workspace_path,
        logger=logger,
        agent_info=f"nanobot v{__version__}",
        clouddisk=clouddisk,
    )
    transcripts = WebUITranscriptRecorder(log=logger)
    workspaces = WebUIWorkspaceController(
        session_manager=session_manager,
        default_workspace=workspace_path,
        default_restrict_to_workspace=default_restrict_to_workspace,
    )

    http = GatewayHTTPHandler(
        config=config,
        session_manager=session_manager,
        static_dist_path=static_dist_path,
        runtime_model_name=runtime_model_name,
        runtime_surface=runtime_surface,
        runtime_capabilities_overrides=runtime_capabilities_overrides,
        bus=bus,
        tokens=tokens,
        media=media,
        workspaces=workspaces,
        skills_workspace_path=workspace_path,
        disabled_skills=disabled_skills,
        cron_service=cron_service,
        cron_pending_job_ids=cron_pending_job_ids,
        channel_manager=channel_manager,
        clouddisk=clouddisk,
        log=logger,
    )
    return GatewayServices(
        http=http,
        tokens=tokens,
        media=media,
        transcripts=transcripts,
        workspaces=workspaces,
        session_manager=session_manager,
        cron_service=cron_service,
        cron_pending_job_ids=cron_pending_job_ids,
        channel_manager=channel_manager,
        clouddisk=clouddisk,
    )
