#!/usr/bin/env python3
"""Model drift canary.

Probes the target model alias with a fixed low-effort seed prompt at
temperature 0, hashes the first 200 characters of the response, and exits
non-zero (writing a DRIFT file at the repo root) if the fingerprint deviates
from canary/golden.json.

Usage:
  ANTHROPIC_API_KEY=... python3 canary/verifier.py            # verify
  ANTHROPIC_API_KEY=... python3 canary/verifier.py --capture  # (re)seed golden.json

Stdlib only — no dependencies. Note: LLM output is not guaranteed
deterministic even at temperature 0; a fingerprint mismatch means "inspect",
and the DRIFT file halts the unattended loop until a human clears it.
"""

import hashlib
import json
import os
import sys
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOLDEN_PATH = os.path.join(REPO_ROOT, "canary", "golden.json")
DRIFT_PATH = os.path.join(REPO_ROOT, "DRIFT")

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


def probe(model, prompt, max_tokens):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("ANTHROPIC_API_KEY is not set", file=sys.stderr)
        sys.exit(2)

    body = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "temperature": 0,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(API_URL, data=body, method="POST", headers={
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())

    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    return text


def fingerprint(text):
    return hashlib.sha256(text[:200].encode()).hexdigest()


def main():
    capture = "--capture" in sys.argv

    if not os.path.exists(GOLDEN_PATH):
        example = GOLDEN_PATH + ".example"
        if not capture:
            print(f"missing {GOLDEN_PATH} — seed it with --capture (see {example})", file=sys.stderr)
            sys.exit(2)
        golden = json.load(open(example))
    else:
        golden = json.load(open(GOLDEN_PATH))

    text = probe(golden["model"], golden["prompt"], golden["max_tokens"])
    fp = fingerprint(text)

    if capture:
        golden["fingerprint"] = fp
        golden["sample"] = text[:200]
        with open(GOLDEN_PATH, "w") as f:
            json.dump(golden, f, indent=2)
            f.write("\n")
        print(f"golden.json seeded: {fp}")
        return

    if fp != golden.get("fingerprint"):
        with open(DRIFT_PATH, "w") as f:
            f.write(
                "Model drift detected by canary/verifier.py\n"
                f"model: {golden['model']}\n"
                f"expected: {golden.get('fingerprint')}\n"
                f"actual:   {fp}\n"
                f"response_head: {text[:200]!r}\n"
                "The unattended loop is halted until this file is removed\n"
                "and golden.json is re-seeded (--capture) after human review.\n"
            )
        print(f"DRIFT: fingerprint {fp} != golden {golden.get('fingerprint')}", file=sys.stderr)
        sys.exit(1)

    print(f"canary ok: {fp}")


if __name__ == "__main__":
    main()
