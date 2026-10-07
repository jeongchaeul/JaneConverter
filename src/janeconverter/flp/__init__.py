"""
FL Studio Project (.flp) parser, inspector, and version downgrader.
Provides binary-level FLP parsing, metadata extraction, and safe cross-version downgrading.
"""

from .models import FLPEvent, FLPProject
from .parser import parse_flp, parse_flp_file
from .inspector import inspect_flp, inspect_flp_file
from .downgrade import downgrade_flp, downgrade_flp_file, TARGET_PROFILES

__all__ = [
    "FLPEvent",
    "FLPProject",
    "parse_flp",
    "parse_flp_file",
    "inspect_flp",
    "inspect_flp_file",
    "downgrade_flp",
    "downgrade_flp_file",
    "TARGET_PROFILES",
]
