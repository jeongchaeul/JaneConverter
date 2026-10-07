"""Run a short, offline conversion through a freshly packaged JaneConverter engine."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def _run(command: list[str], environment: dict[str, str], working_directory: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=working_directory,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, help="Packaged JaneConverterEngine executable")
    parser.add_argument("--runtime-bin", type=Path, required=True, help="Folder containing bundled FFmpeg and FFprobe")
    parser.add_argument("--work-directory", type=Path, required=True, help="Disposable smoke-test work area")
    args = parser.parse_args()

    work_directory = args.work_directory.resolve()
    runtime_bin = args.runtime_bin.resolve()
    work_directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="engine-smoke-", dir=work_directory) as temporary:
        temporary_directory = Path(temporary)
        data_directory = temporary_directory / "app-data"
        source_path = temporary_directory / "smoke-input.wav"
        output_directory = temporary_directory / "converted"
        environment = os.environ.copy()
        environment["PATH"] = os.pathsep.join(
            part for part in (str(runtime_bin), environment.get("PATH", "")) if part
        )
        environment["JANECONVERTER_DATA_DIR"] = str(data_directory)
        environment["PYTHONUTF8"] = "1"
        environment["PYTHONIOENCODING"] = "utf-8"

        with wave.open(str(source_path), "wb") as sample:
            sample.setnchannels(1)
            sample.setsampwidth(2)
            sample.setframerate(44100)
            sample.writeframes(
                b"".join(
                    struct.pack("<h", int(8192 * math.sin(2 * math.pi * 440 * index / 44100)))
                    for index in range(44100)
                )
            )

        if args.engine:
            engine = [str(args.engine.resolve())]
        else:
            engine = [sys.executable, "-m", "janeconverter.cli"]
        version = _run([*engine, "--version"], environment, work_directory)
        compatibility = _run([*engine, "--compatibility-info"], environment, work_directory)
        if compatibility.returncode:
            raise RuntimeError("The packaged engine compatibility check failed.")
        contract = json.loads(compatibility.stdout)
        if contract.get("bridgeProtocol") != 2 or not contract.get("captureValidation") or not contract.get("extractorVersion"):
            raise RuntimeError("The packaged engine has an incompatible Browser Bridge or extractor runtime.")
        if version.returncode != 0 or "JaneConverter" not in version.stdout:
            raise RuntimeError(
                f"Packaged engine did not start successfully: {version.stderr.strip() or version.stdout.strip()}"
            )

        conversion = _run(
            [
                *engine,
                "--source", str(source_path),
                "--format", "mp3",
                "--output", str(output_directory),
                "--bitrate", "128k",
                "--sample-rate", "44100",
                "--no-update",
                "--no-cover-art",
                "--no-metadata",
                "--no-gpu",
            ],
            environment,
            work_directory,
        )
        if conversion.returncode != 0:
            detail = conversion.stderr.strip() or conversion.stdout.strip()
            raise RuntimeError(f"Packaged engine conversion failed: {detail}")

        outputs = list(output_directory.rglob("*.mp3"))
        if len(outputs) != 1 or outputs[0].stat().st_size < 1024:
            raise RuntimeError("Packaged engine did not create one non-empty MP3 output.")
        capture = _run([*engine, "--validate-browser-capture", str(outputs[0]), "--capture-kind", "audio"], environment, work_directory)
        if capture.returncode or not json.loads(capture.stdout).get("mimeType", "").startswith("audio/"):
            raise RuntimeError("The packaged engine could not validate its own audio output.")
        ffprobe = shutil.which("ffprobe", path=environment["PATH"])
        if not ffprobe:
            raise RuntimeError("The packaged FFprobe executable is unavailable on the runtime path.")
        probe = _run(
            [
                ffprobe,
                "-v", "error",
                "-show_entries", "format=duration:stream=codec_type",
                "-of", "json",
                str(outputs[0]),
            ],
            environment,
            work_directory,
        )
        if probe.returncode != 0:
            raise RuntimeError(f"FFprobe could not read the packaged conversion: {probe.stderr.strip()}")
        details = json.loads(probe.stdout)
        streams = details.get("streams", [])
        duration = float(details.get("format", {}).get("duration") or 0)
        if not any(stream.get("codec_type") == "audio" for stream in streams) or not 0.8 <= duration <= 1.2:
            raise RuntimeError("The packaged conversion output failed its audio stream or duration check.")

        # FL Studio Project (.flp) smoke test
        from janeconverter.flp.models import FLPProject, FLPEvent
        smoke_flp = temporary_directory / "smoke-project.flp"
        flp_out = temporary_directory / "smoke-downgraded.flp"
        proj = FLPProject(
            format=0,
            channels=4,
            ppq=96,
            events=[
                FLPEvent(event_id=199, data=b"25.1.0.4000\x00"),
                FLPEvent(event_id=194, data="Smoke Test".encode("utf-16le")),
                FLPEvent(event_id=68, data=struct.pack("<H", 1400)),
            ],
        )
        smoke_flp.write_bytes(proj.to_bytes())

        flp_inspect_proc = _run([*engine, "--flp-inspect", str(smoke_flp)], environment, work_directory)
        if flp_inspect_proc.returncode != 0:
            raise RuntimeError(f"Packaged engine FLP inspection failed: {flp_inspect_proc.stderr.strip() or flp_inspect_proc.stdout.strip()}")
        flp_info = json.loads(flp_inspect_proc.stdout)
        if flp_info.get("version") != "25.1.0.4000" or flp_info.get("title") != "Smoke Test":
            raise RuntimeError(f"Packaged engine FLP inspection returned invalid metadata: {flp_info}")

        flp_downgrade_proc = _run(
            [*engine, "--flp-downgrade", str(smoke_flp), "--flp-target", "21", "--flp-output", str(flp_out)],
            environment,
            work_directory,
        )
        if flp_downgrade_proc.returncode != 0 or not flp_out.exists():
            raise RuntimeError(f"Packaged engine FLP downgrade failed: {flp_downgrade_proc.stderr.strip() or flp_downgrade_proc.stdout.strip()}")

    print("Packaged engine smoke test passed: local WAV converted to a readable one-second MP3, and FL Studio project parsed and downgraded.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        print(f"Packaged engine smoke test failed: {error}", file=sys.stderr)
        raise SystemExit(1)
