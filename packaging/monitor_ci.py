"""Monitor live GitHub Actions CI workflows for a specific commit and report outcomes.

Designed for automated CI monitoring following git push operations.
Exits 0 if all workflows complete successfully; exits 1 if any workflow fails.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


def get_git_credential_token() -> Optional[str]:
    try:
        proc = subprocess.run(
            ["git", "credential", "fill"],
            input="protocol=https\nhost=github.com\n",
            capture_output=True,
            text=True,
            check=True,
        )
        match = re.search(r"password=([^\r\n]+)", proc.stdout)
        if match:
            return match.group(1).strip()
    except Exception:
        pass
    return None


def get_current_commit() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def get_repo_slug() -> str:
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            check=True,
        )
        url = result.stdout.strip()
        # Handles https://github.com/owner/repo.git or git@github.com:owner/repo.git
        if url.endswith(".git"):
            url = url[:-4]
        if "github.com/" in url:
            return url.split("github.com/")[1]
        if "github.com:" in url:
            return url.split("github.com:")[1]
    except Exception:
        pass
    return "jeongchaeul/JaneConverter"


def github_request(url: str, token: Optional[str] = None) -> Dict[str, Any]:
    headers = {
        "User-Agent": "JaneConverter-CI-Monitor",
        "Accept": "application/vnd.github+json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API HTTP {error.code}: {body}") from error


def get_runs_for_commit(repo: str, commit_sha: str, token: Optional[str]) -> List[Dict[str, Any]]:
    url = f"https://api.github.com/repos/{repo}/actions/runs?per_page=20"
    data = github_request(url, token)
    runs = data.get("workflow_runs", [])
    return [r for r in runs if r.get("head_sha", "").startswith(commit_sha)]


def get_failed_jobs(repo: str, run_id: int, token: Optional[str]) -> List[Dict[str, Any]]:
    url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/jobs?per_page=50"
    data = github_request(url, token)
    return [j for j in data.get("jobs", []) if j.get("conclusion") in ("failure", "timed_out", "cancelled")]


def monitor(
    repo: str,
    commit_sha: str,
    timeout_seconds: int = 1800,
    interval_seconds: int = 15,
    token: Optional[str] = None,
) -> int:
    print(f"Monitoring GitHub Actions for {repo} @ commit {commit_sha[:8]}...", flush=True)
    start_time = time.time()
    discovered = False

    while True:
        elapsed = int(time.time() - start_time)
        if elapsed > timeout_seconds:
            print(f"[TIMEOUT] CI monitoring exceeded timeout of {timeout_seconds}s.", file=sys.stderr, flush=True)
            return 1

        try:
            runs = get_runs_for_commit(repo, commit_sha, token)
        except Exception as err:
            print(f"[WARN] Error fetching workflow runs ({err}), retrying in {interval_seconds}s...", flush=True)
            time.sleep(interval_seconds)
            continue

        if not runs:
            if not discovered:
                print(f"[WAITING] No workflow runs detected yet for commit {commit_sha[:8]} ({elapsed}s elapsed)...", flush=True)
                time.sleep(interval_seconds)
                continue
            else:
                print(f"[WARN] Workflow runs disappeared for {commit_sha[:8]}?", file=sys.stderr, flush=True)
                return 1

        discovered = True
        all_completed = True
        has_failure = False

        status_line = []
        for run in runs:
            name = run.get("name", "Workflow")
            status = run.get("status", "unknown")
            conclusion = run.get("conclusion") or "running"
            status_line.append(f"{name}: {conclusion}")

            if status != "completed":
                all_completed = False
            elif conclusion not in ("success", "skipped"):
                has_failure = True

        print(f"[{elapsed}s] " + " | ".join(status_line), flush=True)

        if all_completed:
            if has_failure:
                print("\n[ALERT] One or more CI workflows failed!", file=sys.stderr, flush=True)
                for run in runs:
                    conclusion = run.get("conclusion")
                    if conclusion not in ("success", "skipped"):
                        run_id = run.get("id")
                        name = run.get("name")
                        html_url = run.get("html_url")
                        print(f"\n--- Failed Workflow: {name} ({conclusion}) ---", file=sys.stderr, flush=True)
                        print(f"Link: {html_url}", file=sys.stderr, flush=True)
                        try:
                            failed_jobs = get_failed_jobs(repo, run_id, token)
                            for job in failed_jobs:
                                job_name = job.get("name")
                                job_conclusion = job.get("conclusion")
                                print(f"  Job: {job_name} -> {job_conclusion}", file=sys.stderr, flush=True)
                                for step in job.get("steps", []):
                                    if step.get("conclusion") == "failure":
                                        print(f"    Failed Step: {step.get('name')}", file=sys.stderr, flush=True)
                        except Exception as job_err:
                            print(f"  Could not load jobs: {job_err}", file=sys.stderr, flush=True)
                return 1
            else:
                print(f"\n[SUCCESS] All workflows for {commit_sha[:8]} completed green (success).", flush=True)
                return 0

        time.sleep(interval_seconds)


def main() -> int:
    parser = argparse.ArgumentParser(description="Monitor GitHub Actions CI status for a commit.")
    parser.add_argument("--commit", default="", help="Commit SHA to monitor (defaults to HEAD).")
    parser.add_argument("--repo", default="", help="GitHub repository (defaults to origin remote).")
    parser.add_argument("--timeout", type=int, default=1800, help="Max monitoring duration in seconds.")
    parser.add_argument("--interval", type=int, default=15, help="Polling interval in seconds.")
    args = parser.parse_args()

    commit_sha = args.commit or get_current_commit()
    repo = args.repo or get_repo_slug()
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or get_git_credential_token()

    return monitor(
        repo=repo,
        commit_sha=commit_sha,
        timeout_seconds=args.timeout,
        interval_seconds=args.interval,
        token=token,
    )


if __name__ == "__main__":
    sys.exit(main())
