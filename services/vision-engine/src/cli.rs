//! CLI flags for optional file / USB camera ingest.
//!
//! Parsed from `std::env::args` without a CLI crate so the engine stays
//! dependency-light. Unrecognised flags are ignored (forward-compatible).

use std::path::PathBuf;

/// Optional `--camera file --input <path>` mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileCameraArgs {
    /// Path to a raw gray sequence, frame directory, or video file (`.mp4`).
    pub input: PathBuf,
    /// Stable camera id in the pipeline (default `"file-0"`).
    pub camera_id: String,
}

/// Optional `--camera usb [--input <device>]` mode.
///
/// Device string is platform-specific (`DirectShow` name on Windows, V4L2 path
/// on Linux). See [`crate::usb_pump`] for defaults and env override.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsbCameraArgs {
    /// ffmpeg device identifier (`video=<name>` body on Windows, `/dev/videoN` on Unix).
    pub input: String,
    /// Stable camera id in the pipeline (default `"usb-0"`).
    pub camera_id: String,
}

/// Everything we care about from the process arguments.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CliArgs {
    /// When set, spawn a file/video pump into the engine after bind.
    pub file_camera: Option<FileCameraArgs>,
    /// When set, spawn a USB/V4L2 ffmpeg pump into the engine after bind.
    pub usb_camera: Option<UsbCameraArgs>,
}

/// Parse WatchingEye-relevant flags from an argv-like iterator.
///
/// Recognised:
/// - `--camera file` + `--input <path>` (required for file mode)
/// - `--camera usb` + optional `--input <device>`
/// - `--camera-id <id>` (optional; defaults `"file-0"` / `"usb-0"`)
///
/// Called from `main` as `parse_args(std::env::args())`.
///
/// # Example
/// ```ignore
/// let cli = parse_args(["vision-engine", "--camera", "file", "--input", "walk.gray"]);
/// assert!(cli.file_camera.is_some());
///
/// let usb = parse_args(["vision-engine", "--camera", "usb", "--input", "Integrated Camera"]);
/// assert!(usb.usb_camera.is_some());
/// ```
#[must_use]
pub fn parse_args<I, S>(args: I) -> CliArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut camera_kind: Option<String> = None;
    let mut input: Option<String> = None;
    let mut camera_id: Option<String> = None;

    let mut iter = args.into_iter().peekable();
    // Skip argv[0] when present (binary name).
    if iter.peek().is_some() {
        let first = iter.peek().map(|s| s.as_ref().to_owned());
        if let Some(f) = first {
            if !f.starts_with("--") {
                let _ = iter.next();
            }
        }
    }

    while let Some(arg) = iter.next() {
        let arg = arg.as_ref();
        match arg {
            "--camera" => {
                if let Some(v) = iter.next() {
                    camera_kind = Some(v.as_ref().to_owned());
                }
            }
            "--input" => {
                if let Some(v) = iter.next() {
                    input = Some(v.as_ref().to_owned());
                }
            }
            "--camera-id" => {
                if let Some(v) = iter.next() {
                    camera_id = Some(v.as_ref().to_owned());
                }
            }
            _ => {}
        }
    }

    match camera_kind.as_deref() {
        Some("file") => {
            let Some(path) = input else {
                return CliArgs::default();
            };
            CliArgs {
                file_camera: Some(FileCameraArgs {
                    input: PathBuf::from(path),
                    camera_id: camera_id.unwrap_or_else(|| "file-0".to_owned()),
                }),
                usb_camera: None,
            }
        }
        Some("usb") => {
            let device = input.unwrap_or_else(crate::usb_pump::default_device);
            CliArgs {
                file_camera: None,
                usb_camera: Some(UsbCameraArgs {
                    input: device,
                    camera_id: camera_id.unwrap_or_else(|| "usb-0".to_owned()),
                }),
            }
        }
        _ => CliArgs::default(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn parses_file_camera_flags() {
        let cli = parse_args([
            "vision-engine",
            "--camera",
            "file",
            "--input",
            "sample.gray",
            "--camera-id",
            "desk",
        ]);
        let fc = cli.file_camera.unwrap();
        assert_eq!(fc.input, PathBuf::from("sample.gray"));
        assert_eq!(fc.camera_id, "desk");
        assert!(cli.usb_camera.is_none());
    }

    #[test]
    fn ignores_file_mode_without_input() {
        let cli = parse_args(["vision-engine", "--camera", "file"]);
        assert!(cli.file_camera.is_none());
        assert!(cli.usb_camera.is_none());
    }

    #[test]
    fn default_camera_id_when_omitted() {
        let cli = parse_args(["vision-engine", "--camera", "file", "--input", "x.mp4"]);
        assert_eq!(cli.file_camera.unwrap().camera_id, "file-0");
    }

    #[test]
    fn parses_usb_with_explicit_input() {
        let cli = parse_args([
            "vision-engine",
            "--camera",
            "usb",
            "--input",
            "/dev/video0",
            "--camera-id",
            "desk-cam",
        ]);
        assert!(cli.file_camera.is_none());
        let usb = cli.usb_camera.unwrap();
        assert_eq!(usb.input, "/dev/video0");
        assert_eq!(usb.camera_id, "desk-cam");
    }

    #[test]
    fn parses_usb_without_input_uses_default_device() {
        let cli = parse_args(["vision-engine", "--camera", "usb"]);
        let usb = cli.usb_camera.unwrap();
        assert_eq!(usb.camera_id, "usb-0");
        assert!(!usb.input.is_empty());
        // Platform default — not empty, and matches usb_pump::default_device().
        assert_eq!(usb.input, crate::usb_pump::default_device());
    }

    #[test]
    fn unknown_camera_kind_yields_empty() {
        let cli = parse_args(["vision-engine", "--camera", "webrtc"]);
        assert!(cli.file_camera.is_none());
        assert!(cli.usb_camera.is_none());
    }
}
