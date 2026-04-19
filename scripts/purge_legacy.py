"""One-shot script to remove the legacy /opt/endo-bot/ install from the server.

Context: the pre-orchestrator single-bot deployment lived under /opt/endo-bot/
and was run by a systemd unit called endo-bot.service. We already stopped and
disabled that unit interactively; this script removes the files too, so the
old code can never accidentally be re-invoked (cron, manual ssh, etc.).

Safe to run multiple times — all deletions are idempotent.
"""
import paramiko

HOST = "81.31.245.65"
USER = "root"
PASS = "vm54YC7i#u+^ks"

CMDS = [
    # Belt and braces — make sure nothing is running under the legacy path.
    "systemctl stop endo-bot.service 2>/dev/null || true",
    "systemctl disable endo-bot.service 2>/dev/null || true",
    "rm -f /etc/systemd/system/endo-bot.service",
    "rm -f /etc/systemd/system/multi-user.target.wants/endo-bot.service",
    "systemctl daemon-reload",
    # Delete the install tree. /opt/endo-bot2/ (our current install) is
    # untouched.
    "rm -rf /opt/endo-bot",
    # Verify nothing of the sort is left.
    "ls /opt/ | grep endo || true",
    "systemctl list-units --type=service --all | grep endo || true",
]


def main() -> None:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)
    for c in CMDS:
        _, so, se = ssh.exec_command(c, timeout=30)
        out = so.read().decode("utf-8", "replace").strip()
        err = se.read().decode("utf-8", "replace").strip()
        print(f">>> {c}")
        if out:
            print(out)
        if err:
            print(f"STDERR: {err}")
    ssh.close()
    print("Legacy install purged.")


if __name__ == "__main__":
    main()
