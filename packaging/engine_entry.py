"""PyInstaller entry point for the self-contained JaneConverter CLI engine."""

from janeconverter.engine_override import activate_yt_dlp_override

activate_yt_dlp_override()

from janeconverter.cli import main


if __name__ == "__main__":
    main()
