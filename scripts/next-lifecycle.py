#!/usr/bin/env python3
"""Run Next directly; on Linux terminate it if its launching process disappears."""
import ctypes
import os
from pathlib import Path
import signal
import sys


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in {"start", "dev"}:
        raise SystemExit("Usage: next-lifecycle.py {start|dev} [Next options]")
    if sys.platform == "linux":
        parent = os.getppid()
        libc = ctypes.CDLL(None, use_errno=True)
        # PR_SET_PDEATHSIG survives exec. Unlike npm -> shell -> Next, the
        # tracked child is the actual server and follows its parent's lifetime.
        if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "Cannot set parent-death signal")
        if parent == 1 or os.getppid() != parent:
            raise SystemExit("Launching process exited before Next startup")
    cli = Path(__file__).resolve().parents[1] / "node_modules/next/dist/bin/next"
    os.execvp("node", ["node", str(cli), *sys.argv[1:]])


if __name__ == "__main__":
    main()
