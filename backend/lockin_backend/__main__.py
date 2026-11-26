"""python -m lockin_backend [--config path] [--host H] [--port N]"""
import argparse
import logging

import uvicorn

from .app import create_app
from .config import load_settings


def main() -> None:
    ap = argparse.ArgumentParser(prog="lockin_backend")
    ap.add_argument("--config")
    ap.add_argument("--host")
    ap.add_argument("--port", type=int)
    a = ap.parse_args()
    s = load_settings(a.config)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(create_app(s), host=a.host or s.server.host, port=a.port or s.server.port, log_level="info")


if __name__ == "__main__":
    main()
