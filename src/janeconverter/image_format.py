"""Convert captured and local still images to common raster formats."""

from __future__ import annotations

import os
import shutil

from PIL import Image, ImageOps


_FORMATS = {
    "jpg": ("JPEG", ".jpg"),
    "jpeg": ("JPEG", ".jpeg"),
    "jfif": ("JPEG", ".jfif"),
    "png": ("PNG", ".png"),
    "webp": ("WEBP", ".webp"),
    "bmp": ("BMP", ".bmp"),
    "tif": ("TIFF", ".tif"),
    "tiff": ("TIFF", ".tiff"),
    "gif": ("GIF", ".gif"),
    "ico": ("ICO", ".ico"),
    "tga": ("TGA", ".tga"),
    "ppm": ("PPM", ".ppm"),
    "pgm": ("PPM", ".pgm"),
    "pbm": ("PPM", ".pbm"),
}
_IMAGE_QUALITY = {"best": 95, "high": 90, "balanced": 80, "small": 65}
_ANIMATED_FORMATS = {"GIF", "PNG", "TIFF", "WEBP"}


def _has_alpha(image: Image.Image) -> bool:
    if "A" in image.getbands():
        return image.getchannel("A").getextrema()[0] < 255
    return "transparency" in image.info


def _prepare_frame(image: Image.Image, target_format: str, extension: str) -> Image.Image:
    alpha = _has_alpha(image)
    if target_format == "JPEG":
        rgba = image.convert("RGBA")
        output = Image.new("RGB", rgba.size, "white")
        output.paste(rgba, mask=rgba.getchannel("A"))
        return output
    if extension == ".pgm":
        return image.convert("L")
    if extension == ".pbm":
        return image.convert("1")
    if extension == ".ppm":
        return image.convert("RGB")
    if target_format == "GIF":
        rgba = image.convert("RGBA")
        palette_mode = getattr(getattr(Image, "Palette", Image), "ADAPTIVE", 1)
        output = rgba.convert("P", palette=palette_mode, colors=255)
        if _has_alpha(rgba):
            transparency = rgba.getchannel("A").point(lambda value: 255 if value <= 128 else 0)
            output.paste(255, mask=transparency)
            output.info["transparency"] = 255
        return output
    if target_format == "ICO":
        output = image.convert("RGBA")
        output.thumbnail((256, 256), Image.Resampling.LANCZOS)
        return output
    if target_format in ("BMP", "TGA"):
        return image.convert("RGBA" if alpha else "RGB")
    if target_format == "WEBP":
        return image.convert("RGBA" if alpha else "RGB")
    if target_format == "PNG":
        if alpha:
            return image.convert("RGBA")
        if image.mode in ("1", "L", "LA", "P", "RGB", "I", "I;16"):
            return image.copy()
        return image.convert("RGB")
    if target_format == "TIFF":
        return image.copy()
    return image.convert("RGB")


def convert_image_format(
    image_path: str,
    target_format: str | None,
    quality: str = "best",
    *,
    output_path: str | None = None,
    remove_source: bool = True,
) -> str:
    """Write an image in the selected format, optionally replacing its source.

    Captured social images retain the historical in-place behavior by default.
    Local conversion passes an explicit output path and keeps the input intact.
    Animated GIF, PNG, TIFF, and WebP inputs keep their frames when the target
    format can represent them.
    """
    normalized_format = str(target_format or "source").lower().strip().lstrip(".")
    if normalized_format in ("source", "original", ""):
        return image_path
    if normalized_format not in _FORMATS:
        raise ValueError(f"Unsupported image format: {target_format}")

    pillow_format, extension = _FORMATS[normalized_format]
    source_extension = os.path.splitext(image_path)[1].lower()
    with Image.open(image_path) as source:
        source_format = source.format
        if (
            output_path is None
            and source_format == pillow_format
            and source_extension == extension
        ):
            return image_path

        source_info = dict(source.info)
        frame_count = getattr(source, "n_frames", 1)
        preserve_frames = frame_count > 1 and pillow_format in _ANIMATED_FORMATS
        frame_total = frame_count if preserve_frames else 1
        frames = []
        durations = []
        for index in range(frame_total):
            source.seek(index)
            frame = ImageOps.exif_transpose(source.copy())
            if pillow_format == "JPEG" and frame.mode == "CMYK":
                frame = frame.convert("RGB")
            frames.append(_prepare_frame(frame, pillow_format, extension))
            duration = frame.info.get("duration", source_info.get("duration", 100))
            durations.append(duration if duration is not None else 100)

    if output_path is None:
        output_path = os.path.splitext(image_path)[0] + extension
    output_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_dir, exist_ok=True)

    if (
        source_format == pillow_format
        and source_extension == extension
        and os.path.abspath(output_path) != os.path.abspath(image_path)
    ):
        shutil.copy2(image_path, output_path)
    else:
        quality_value = _IMAGE_QUALITY.get(str(quality).lower().strip(), 95)
        save_options = {}
        icc_profile = source_info.get("icc_profile")
        if icc_profile and pillow_format in {"JPEG", "PNG", "TIFF", "WEBP"}:
            save_options["icc_profile"] = icc_profile

        if pillow_format == "JPEG":
            save_options.update(quality=quality_value, optimize=True, progressive=True)
        elif pillow_format == "PNG":
            save_options["compress_level"] = 9
        elif pillow_format == "WEBP":
            save_options.update(quality=quality_value, method=6)
        elif pillow_format == "GIF" and "transparency" in frames[0].info:
            save_options["transparency"] = frames[0].info["transparency"]

        if len(frames) > 1:
            save_options["save_all"] = True
            save_options["append_images"] = frames[1:]
            if durations:
                save_options["duration"] = durations
            if pillow_format in {"GIF", "PNG", "WEBP"}:
                save_options["loop"] = int(source_info.get("loop", 0) or 0)
            if pillow_format == "GIF":
                save_options["disposal"] = 2

        frames[0].save(output_path, format=pillow_format, **save_options)

    if remove_source and os.path.abspath(output_path) != os.path.abspath(image_path):
        os.remove(image_path)
    return output_path
