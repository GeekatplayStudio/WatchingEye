//! CLI flags for optional file-camera ingest.
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

/// Everything we care about from the process arguments.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CliArgs {
    /// When set, spawn a file/video pump into the engine after bind.
    pub file_camera: Option<FileCameraArgs>,
}

/// Parse WatchingEye-relevant flags from an argv-like iterator.
///
/// Recognised:
/// - `--camera file` (required for file mode)
/// - `--input <path>` (required for file mode)
/// - `--camera-id <id>` (optional)
///
/// Called from `main` as `parse_args(std::env::args())`.
///
/// # Example
/// ```ignore
/// let cli = parse_args(["vision-engine", "--camera", "file", "--input", "walk.gray"]);
/// assert!(cli.file_camera.is_some());
/// ```
#[must_use]
pub fn parse_args<I, S>(args: I) -> CliArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut camera_kind: Option<String> = None;
    let mut input: Option<PathBuf> = None;
    let mut camera_id = "file-0".to_owned();

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
                    input = Some(PathBuf::from(v.as_ref()));
                }
            }
            "--camera-id" => {
                if let Some(v) = iter.next() {
                    v.as_ref().clone_into(&mut camera_id);
                }
            }
            _ => {}
        }
    }

    let file_camera = match (camera_kind.as_deref(), input) {
        (Some("file"), Some(input)) => Some(FileCameraArgs { input, camera_id }),
        _ => None,
    };

    CliArgs { file_camera }
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
    }

    #[test]
    fn ignores_file_mode_without_input() {
        let cli = parse_args(["vision-engine", "--camera", "file"]);
        assert!(cli.file_camera.is_none());
    }

    #[test]
    fn default_camera_id_when_omitted() {
        let cli = parse_args(["vision-engine", "--camera", "file", "--input", "x.mp4"]);
        assert_eq!(cli.file_camera.unwrap().camera_id, "file-0");
    }

    #[test]
    fn non_file_camera_kind_is_ignored() {
        let cli = parse_args(["vision-engine", "--camera", "usb", "--input", "/dev/video0"]);
        assert!(cli.file_camera.is_none());
    }
}
