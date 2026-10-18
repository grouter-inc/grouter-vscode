#!/usr/bin/env python3
"""Create the gRouter repo fresh and push a single clean root commit.

Run AFTER the old repo has been deleted. A brand-new repo carries zero prior
git objects, so no earlier commit or its message can resurface via a direct
SHA URL. That is the only total fix -- GitHub retains unreachable objects
until GC, and the forced-GC API is unavailable on ordinary repos.

Idempotent and safe: refuses to touch a repo that already has commits.

Usage:  python scripts/recreate-repo.py
"""
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

OWNER = "grouter-inc"
REPO = "grouter-vscode"
ROOT = r"C:/Users/Administrator/rebrand-work/grouter-vscode"
CREDS = r"C:/Users/Administrator/.git-credentials"

DESCRIPTION = (
    "gRouter - AI coding, debugging & planning for VS Code. "
    "Four modes, a coding agent with approval gates, and MCP in both "
    "directions, powered by the gRouter gateway (https://prod.grouter.web.id)."
)


def token():
    with open(CREDS, encoding="utf-8", errors="replace") as f:
        m = re.match(r"https?://[^:]+:([^@]+)@", f.read().strip().split()[0])
    return m.group(1)


def api(tok, method, path, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        f"https://api.github.com{path}", data=data, method=method,
        headers={"User-Agent": "hermes", "Accept": "application/vnd.github+json",
                 "Authorization": f"token {tok}",
                 **({"Content-Type": "application/json"} if body else {})})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:250]


def git(*args, **kw):
    return subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True,
                          text=True, timeout=900, input=kw.pop("input", None))


def main():
    tok = token()

    # 1. the old repo must be gone, or it must still be empty.
    #    NOTE: the API's `size` field lags behind for minutes after a push, so
    #    it is NOT reliable for "has content". Probe the commit list instead:
    #    a repo with no commits returns 409 (Git Repository is empty).
    s, r = api(tok, "GET", f"/repos/{OWNER}/{REPO}")
    if s == 200:
        sc, commits = api(tok, "GET",
                          f"/repos/{OWNER}/{REPO}/commits?per_page=1")
        if sc == 200 and commits:
            print(f"!! {OWNER}/{REPO} exists and already has "
                  f"{'commits' if commits else 'content'} "
                  f"(head {commits[0]['sha'][:10]}).")
            print("   Delete it first: Settings -> bottom -> Delete this repository")
            sys.exit(1)
        print(f"[1] repo exists but has no commits (HTTP {sc}); reusing it")
    elif s == 404:
        print("[1] old repo is gone; creating fresh")
        s, r = api(tok, "POST", "/user/repos", {
            "name": REPO, "description": DESCRIPTION,
            "homepage": "https://prod.grouter.web.id",
            "private": False, "has_issues": True, "has_wiki": False,
            "has_projects": False, "auto_init": False,
        })
        if s not in (200, 201):
            print(f"!! create failed: HTTP {s} {r}")
            sys.exit(1)
        print(f"[1] created {r['full_name']} "
              f"({'private' if r['private'] else 'public'})")
    else:
        print(f"!! unexpected response for the repo: HTTP {s} {r}")
        sys.exit(1)

    # 2. local tree must be clean, committed, and a single parentless commit
    if git("status", "--short").stdout.strip():
        print("!! local tree is dirty; commit or stash first")
        sys.exit(1)
    n = git("rev-list", "--count", "HEAD").stdout.strip()
    parents = git("log", "--format=%P", "-1").stdout.strip()
    if n != "1" or parents:
        print(f"!! HEAD is not a single root commit (commits={n}, parents={parents!r})")
        sys.exit(1)
    head = git("rev-parse", "HEAD").stdout.strip()
    files = len([f for f in git("ls-files").stdout.split("\n") if f.strip()])
    print(f"[2] local HEAD={head[:12]} root commit, {files} files")

    # 3. push the single commit (bypass GCM: it hangs on this host)
    url = f"https://{OWNER}:{tok}@github.com/{OWNER}/{REPO}.git"
    git("remote", "remove", "origin")
    git("remote", "add", "origin", url)
    p = git("-c", "credential.helper=", "-c", "core.askpass=",
            "push", "--force", "-u", "origin", "HEAD:main")
    out = (p.stdout + p.stderr).replace(tok, "[REDACTED]").strip()
    print(f"[3] push exit={p.returncode}\n    {out[-300:]}")
    if p.returncode != 0:
        sys.exit(1)

    # 4. verify from GitHub's side: exactly one commit, no parents
    time.sleep(4)
    s, c = api(tok, "GET", f"/repos/{OWNER}/{REPO}/commits/main")
    if s != 200:
        print(f"!! verify failed: HTTP {s}")
        sys.exit(1)
    print(f"[4] remote main={c['sha'][:12]} parents={len(c['parents'])} "
          f"msg={c['commit']['message'].splitlines()[0][:50]}")
    s, hist = api(tok, "GET", f"/repos/{OWNER}/{REPO}/commits?per_page=100")
    print(f"    commits reachable on remote: {len(hist) if hist else 0}")

    # 5. images must be publicly fetchable in a public repo
    print("[5] public asset check:")
    for f in ["assets/screenshot-tests.png", "assets/screenshot-models.png",
              "assets/screenshot-chat.png", "assets/icon.png", "assets/banner.png"]:
        try:
            rq = urllib.request.Request(
                f"https://raw.githubusercontent.com/{OWNER}/{REPO}/main/{f}",
                headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(rq, timeout=25) as rr:
                print(f"      {f:34s} HTTP {rr.status}  {len(rr.read())} bytes")
        except urllib.error.HTTPError as e:
            print(f"      {f:34s} HTTP {e.code}")

    print(f"\nDONE -> https://github.com/{OWNER}/{REPO}")


if __name__ == "__main__":
    main()
