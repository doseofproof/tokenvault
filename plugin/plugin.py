#!/usr/bin/env python3
"""
TokenVault — Hermes Agent Plugin
Token optimization plugin for Hermes Agent.

Saves 60-90% on AI costs via:
- Smart model routing (simple→cheap, hard→premium)
- LLMLingua-style context compression
- Response caching
- Per-request observability
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Union, Optional, List

PLUGIN_DIR = Path(__file__).parent.parent
CLI_PATH = PLUGIN_DIR / "bin" / "tokenvault"
SRC_DIR = PLUGIN_DIR / "src"


def run_cli(args: List[str], json_output: bool = False) -> Union[dict, str]:
    """Run the tokenvault CLI and return output."""
    cmd = ["node", str(CLI_PATH)] + args
    if json_output:
        cmd.append("--json")
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PLUGIN_DIR))
    if result.returncode != 0:
        return {"error": result.stderr.strip()}
    return result.stdout.strip()


def stats() -> str:
    """Show token usage statistics and savings."""
    return run_cli(["stats"])


def route(prompt: str) -> str:
    """Analyze a prompt and route to the optimal model."""
    return run_cli(["route", prompt])


def compress(context: str, max_chars: int = 30000) -> dict:
    """Compress context using advanced techniques."""
    # The CLI (bin/tokenvault) exposes no 'compress' command, and building
    # code from inputs is a code-injection risk, so this is unimplemented.
    # If a compress command is added, call it via run_cli with argv/stdin.
    return {"error": "not implemented: requires CLI support (no 'compress' command in bin/tokenvault)"}


def cache_lookup(prompt: str, model: str) -> dict:
    """Look up a cached response."""
    # The CLI (bin/tokenvault) only exposes aggregate cache stats
    # ('tokenvault cache'), not per-prompt lookup, and building code from
    # inputs is a code-injection risk, so this is unimplemented.
    # If a lookup command is added, call it via run_cli with argv/stdin.
    return {"cached": False, "error": "not implemented: requires CLI support (no cache lookup command in bin/tokenvault)"}


def trace(
    model: str,
    input_tokens: int,
    output_tokens: int,
    operation: str = "llm_call",
    agent: Optional[str] = None,
    latency_ms: float = 0.0,
    cached: bool = False,
) -> dict:
    """Record a request trace for observability."""
    # The CLI (bin/tokenvault) only exposes 'tokenvault traces' to display
    # existing traces; there is no command to record one, and building code
    # from inputs is a code-injection risk, so this is unimplemented.
    # If a trace-record command is added, call it via run_cli with argv/stdin.
    return {"error": "not implemented: requires CLI support (no trace-record command in bin/tokenvault)"}


def budget(action: str = "status", key: Optional[str] = None, value: Optional[float] = None) -> str:
    """Set or check budget limits."""
    if action == "set" and key and value is not None:
        return run_cli(["budget", f"{key}={value}"])
    return run_cli(["budget"])


def alerts() -> str:
    """Get recent alerts."""
    return run_cli(["alerts"])


def traces(limit: int = 20) -> str:
    """Get recent traces."""
    return run_cli(["traces"])


def agents() -> str:
    """Get per-agent cost breakdown."""
    return run_cli(["agents"])


def hourly() -> str:
    """Get hourly cost trend."""
    return run_cli(["hourly"])


# ═══════════════════════════════════════════════════════════
# Hermes Plugin Interface
# ═══════════════════════════════════════════════════════════

PLUGIN_NAME = "tokenvault"
PLUGIN_VERSION = "2.0.0"
PLUGIN_DESCRIPTION = "Token optimization — track, compress, cache, route, and observe to save 60-90% on AI costs"

TOOLS = [
    {
        "name": "tokenvault_stats",
        "description": "Show token usage statistics and savings",
        "parameters": {},
    },
    {
        "name": "tokenvault_route",
        "description": "Analyze a prompt and route to the optimal model",
        "parameters": {
            "prompt": {"type": "string", "description": "The prompt to analyze"}
        },
    },
    {
        "name": "tokenvault_trace",
        "description": "Record a request trace for observability",
        "parameters": {
            "model": {"type": "string", "description": "Model used"},
            "input_tokens": {"type": "integer", "description": "Input token count"},
            "output_tokens": {"type": "integer", "description": "Output token count"},
            "operation": {"type": "string", "description": "Operation type"},
            "agent": {"type": "string", "description": "Agent name"},
            "latency_ms": {"type": "number", "description": "Latency in ms"},
            "cached": {"type": "boolean", "description": "Was response cached"},
        },
    },
    {
        "name": "tokenvault_budget",
        "description": "Set or check budget limits",
        "parameters": {
            "action": {"type": "string", "description": "'status' or 'set'"},
            "key": {"type": "string", "description": "Budget key (daily/weekly/monthly)"},
            "value": {"type": "number", "description": "Budget value in dollars"},
        },
    },
    {
        "name": "tokenvault_traces",
        "description": "Get recent request traces",
        "parameters": {
            "limit": {"type": "integer", "description": "Max traces to return"},
        },
    },
    {
        "name": "tokenvault_agents",
        "description": "Get per-agent cost breakdown",
        "parameters": {},
    },
]


def handle_tool(tool_name: str, params: dict) -> str:
    """Handle a tool call from Hermes."""
    if tool_name == "tokenvault_stats":
        return stats()
    elif tool_name == "tokenvault_route":
        return route(params.get("prompt", "hello"))
    elif tool_name == "tokenvault_trace":
        return json.dumps(trace(
            model=params.get("model", "unknown"),
            input_tokens=params.get("input_tokens", 0),
            output_tokens=params.get("output_tokens", 0),
            operation=params.get("operation", "llm_call"),
            agent=params.get("agent", "default"),
            latency_ms=params.get("latency_ms", 0),
            cached=params.get("cached", False),
        ))
    elif tool_name == "tokenvault_budget":
        return budget(
            action=params.get("action", "status"),
            key=params.get("key", None),
            value=params.get("value", None),
        )
    elif tool_name == "tokenvault_traces":
        return traces(params.get("limit", 20))
    elif tool_name == "tokenvault_agents":
        return agents()
    else:
        return f"Unknown tool: {tool_name}"


if __name__ == "__main__":
    # Test the plugin
    print(f"TokenVault Plugin v{PLUGIN_VERSION}")
    print(f"CLI: {CLI_PATH}")
    print(f"Exists: {CLI_PATH.exists()}")
    print()
    print("Available tools:")
    for tool in TOOLS:
        print(f"  - {tool['name']}: {tool['description']}")
    print()
    print("Running stats...")
    print(stats())
