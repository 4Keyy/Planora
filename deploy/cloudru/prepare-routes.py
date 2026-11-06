"""Prepare HTTPS edge routes without changing the local Docker configuration."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit


def prepare_routes(source: dict, origin: str) -> dict:
    parsed = urlsplit(origin)
    if (origin != origin.strip() or any(char.isspace() for char in origin)
            or parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.path not in ("", "/")
            or parsed.port not in (None, 443) or parsed.query or parsed.fragment):
        raise ValueError("A public HTTPS origin without credentials or path is required")
    for route in source["Routes"]:
        headers = route.setdefault("UpstreamHeaderTransform", {})
        headers["X-Forwarded-Proto"] = "https"
        headers["X-Forwarded-For"] = "{RemoteIpAddress}"
    source["GlobalConfiguration"]["BaseUrl"] = origin.rstrip("/")
    return source


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("origin")
    args = parser.parse_args()
    data = prepare_routes(json.loads(args.source.read_text(encoding="utf-8-sig")), args.origin)
    args.destination.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
