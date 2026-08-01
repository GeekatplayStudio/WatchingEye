//! File-backed [`CameraSource`](crate::CameraSource) for deterministic ingest.
//!
//! Two layouts are supported — both raw **gray8**, no container:
//!
//! 1. **Concatenated file** — `width × height` bytes per frame, back-to-back.
//! 2. **Directory** — one gray8 file per frame; names sorted lexicographically.
//!
//! MP4 / RTSP decoding stays in the service layer (ffmpeg), matching
//! `vision-engine`'s RTSP path. This module stays dependency-light so
//! `cargo test` never needs ffmpeg.

use crate::validate::{expected_byte_len, validate_frame};
use crate::{CameraError, CameraInfo, CameraSource, Frame};
use chrono::{DateTime, Utc};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

/// Sample grid the live pipeline (browser webcam / RTSP) uses.
///
/// Keep file-camera pumps on this size when feeding `vision-engine` so motion
/// and tracking thresholds stay consistent across backends.
pub const GRID_WIDTH: u32 = 96;
/// See [`GRID_WIDTH`].
pub const GRID_HEIGHT: u32 = 72;

/// How frames are stored on disk.
#[derive(Debug)]
enum Backing {
    /// Single file of concatenated gray8 frames.
    Concat(BufReader<File>),
    /// Ordered list of per-frame files; `index` is the next to read.
    Directory { files: Vec<PathBuf>, index: usize },
}

/// Reads a raw gray8 sequence from a file or directory.
///
/// # Example
/// ```no_run
/// use camera::file::FileCamera;
/// use camera::CameraSource;
///
/// let mut cam = FileCamera::open("fixtures/walk.gray", 96, 72, "file-1")
///     .expect("open");
/// let frame = cam.next_frame().expect("first frame");
/// assert_eq!((frame.width, frame.height), (96, 72));
/// ```
#[derive(Debug)]
pub struct FileCamera {
    info: CameraInfo,
    width: u32,
    height: u32,
    frame_bytes: usize,
    number: u64,
    backing: Backing,
}

impl FileCamera {
    /// Open `path` as a concatenated gray8 file or a directory of frames.
    ///
    /// Dimensions must be non-zero; format is always `"gray8"`.
    ///
    /// # Errors
    /// [`CameraError::BadFrame`] when dimensions are invalid, the path is
    /// missing, or a directory contains no readable frame files.
    /// [`CameraError::Disconnected`] is not used at open time.
    pub fn open(
        path: impl AsRef<Path>,
        width: u32,
        height: u32,
        id: impl Into<String>,
    ) -> Result<Self, CameraError> {
        let id = id.into();
        let path = path.as_ref();
        let frame_bytes = expected_byte_len(width, height, "gray8").ok_or_else(|| {
            CameraError::BadFrame(
                id.clone(),
                format!("invalid dimensions {width}×{height} for gray8"),
            )
        })?;

        let meta = fs::metadata(path).map_err(|err| {
            CameraError::BadFrame(
                id.clone(),
                format!("cannot open '{}': {err}", path.display()),
            )
        })?;

        let backing = if meta.is_dir() {
            Backing::Directory {
                files: list_frame_files(path, &id)?,
                index: 0,
            }
        } else {
            let file = File::open(path).map_err(|err| {
                CameraError::BadFrame(
                    id.clone(),
                    format!("cannot open '{}': {err}", path.display()),
                )
            })?;
            Backing::Concat(BufReader::new(file))
        };

        Ok(Self {
            info: CameraInfo {
                id,
                kind: "file".into(),
                location: path.display().to_string(),
            },
            width,
            height,
            frame_bytes,
            number: 0,
            backing,
        })
    }

    /// Open at the engine's standard 96×72 gray8 grid.
    ///
    /// # Errors
    /// Same as [`FileCamera::open`].
    pub fn open_grid(path: impl AsRef<Path>, id: impl Into<String>) -> Result<Self, CameraError> {
        Self::open(path, GRID_WIDTH, GRID_HEIGHT, id)
    }

    fn read_exact_frame(&mut self, buf: &mut [u8]) -> Result<(), CameraError> {
        let id = self.info.id.clone();
        match &mut self.backing {
            Backing::Concat(reader) => read_concat_frame(reader, buf, &id),
            Backing::Directory { files, index } => {
                if *index >= files.len() {
                    return Err(CameraError::Disconnected(id));
                }
                let path = &files[*index];
                *index += 1;
                read_file_frame(path, buf, &id)
            }
        }
    }
}

impl CameraSource for FileCamera {
    fn info(&self) -> CameraInfo {
        self.info.clone()
    }

    fn next_frame(&mut self) -> Result<Frame, CameraError> {
        let mut data = vec![0u8; self.frame_bytes];
        self.read_exact_frame(&mut data)?;
        self.number = self.number.saturating_add(1);
        let frame = Frame {
            number: self.number,
            width: self.width,
            height: self.height,
            data,
            format: "gray8".into(),
            timestamp: frame_timestamp(self.number),
        };
        validate_frame(&frame, &self.info.id)?;
        Ok(frame)
    }
}

/// Deterministic capture time derived from the frame number (no wall clock).
fn frame_timestamp(number: u64) -> DateTime<Utc> {
    let secs = 1_700_000_000i64.saturating_add(i64::try_from(number).unwrap_or(i64::MAX));
    DateTime::from_timestamp(secs, 0).unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
}

fn list_frame_files(dir: &Path, id: &str) -> Result<Vec<PathBuf>, CameraError> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|err| {
            CameraError::BadFrame(
                id.to_owned(),
                format!("cannot read '{}': {err}", dir.display()),
            )
        })?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.is_file() {
                Some(path)
            } else {
                None
            }
        })
        .collect();
    files.sort();
    if files.is_empty() {
        return Err(CameraError::BadFrame(
            id.to_owned(),
            format!("no frame files in '{}'", dir.display()),
        ));
    }
    Ok(files)
}

fn read_concat_frame(
    reader: &mut BufReader<File>,
    buf: &mut [u8],
    id: &str,
) -> Result<(), CameraError> {
    let mut filled = 0usize;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..]) {
            Ok(0) if filled == 0 => return Err(CameraError::Disconnected(id.to_owned())),
            Ok(0) => {
                return Err(CameraError::BadFrame(
                    id.to_owned(),
                    format!("truncated frame: got {filled} of {} bytes", buf.len()),
                ));
            }
            Ok(n) => filled += n,
            Err(err) => {
                return Err(CameraError::BadFrame(
                    id.to_owned(),
                    format!("read error: {err}"),
                ));
            }
        }
    }
    Ok(())
}

fn read_file_frame(path: &Path, buf: &mut [u8], id: &str) -> Result<(), CameraError> {
    let mut file = File::open(path).map_err(|err| {
        CameraError::BadFrame(
            id.to_owned(),
            format!("cannot open '{}': {err}", path.display()),
        )
    })?;
    let mut filled = 0usize;
    while filled < buf.len() {
        match file.read(&mut buf[filled..]) {
            Ok(0) => {
                return Err(CameraError::BadFrame(
                    id.to_owned(),
                    format!(
                        "truncated frame in '{}': got {filled} of {} bytes",
                        path.display(),
                        buf.len()
                    ),
                ));
            }
            Ok(n) => filled += n,
            Err(err) => {
                return Err(CameraError::BadFrame(
                    id.to_owned(),
                    format!("read error on '{}': {err}", path.display()),
                ));
            }
        }
    }
    // Extra trailing bytes mean the file is not a single gray frame.
    let mut extra = [0u8; 1];
    match file.read(&mut extra) {
        Ok(0) => Ok(()),
        Ok(_) => Err(CameraError::BadFrame(
            id.to_owned(),
            format!(
                "corrupt frame in '{}': longer than {} bytes",
                path.display(),
                buf.len()
            ),
        )),
        Err(err) => Err(CameraError::BadFrame(
            id.to_owned(),
            format!("read error on '{}': {err}", path.display()),
        )),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use std::io::Write;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "watchingeye-filecam-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn golden_concat_file_yields_exact_frame_count() {
        let dir = temp_dir("concat");
        let path = dir.join("seq.gray");
        let (w, h) = (4u32, 3u32);
        let n_frames = 7u64;
        let mut file = File::create(&path).unwrap();
        for i in 0..n_frames {
            let byte = u8::try_from(i).unwrap();
            file.write_all(&vec![byte; (w * h) as usize]).unwrap();
        }
        drop(file);

        let mut cam = FileCamera::open(&path, w, h, "golden").unwrap();
        let mut count = 0u64;
        loop {
            match cam.next_frame() {
                Ok(frame) => {
                    count += 1;
                    assert_eq!(frame.number, count);
                    assert_eq!(frame.data.len(), (w * h) as usize);
                    assert_eq!(frame.data[0], u8::try_from(count - 1).unwrap());
                }
                Err(CameraError::Disconnected(_)) => break,
                Err(err) => panic!("unexpected: {err}"),
            }
        }
        assert_eq!(count, n_frames);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn golden_directory_yields_exact_frame_count() {
        let dir = temp_dir("dir");
        let (w, h) = (2u32, 2u32);
        for i in 0..5 {
            let path = dir.join(format!("frame_{i:03}.gray"));
            let pixel = u8::try_from(i).unwrap();
            fs::write(&path, vec![pixel; (w * h) as usize]).unwrap();
        }

        let mut cam = FileCamera::open(&dir, w, h, "dir-cam").unwrap();
        let mut count = 0u64;
        while cam.next_frame().is_ok() {
            count += 1;
        }
        assert_eq!(count, 5);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn truncated_concat_frame_is_bad_frame() {
        let dir = temp_dir("trunc");
        let path = dir.join("trunc.gray");
        // Two full 2×2 frames + 3 stray bytes.
        fs::write(&path, vec![9u8; 4 + 4 + 3]).unwrap();
        let mut cam = FileCamera::open(&path, 2, 2, "trunc").unwrap();
        assert!(cam.next_frame().is_ok());
        assert!(cam.next_frame().is_ok());
        let err = cam.next_frame().unwrap_err();
        assert!(matches!(err, CameraError::BadFrame(_, msg) if msg.contains("truncated")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn truncated_directory_frame_is_bad_frame() {
        let dir = temp_dir("trunc-dir");
        fs::write(dir.join("a.gray"), vec![1u8; 4]).unwrap();
        fs::write(dir.join("b.gray"), vec![2u8; 3]).unwrap(); // short
        let mut cam = FileCamera::open(&dir, 2, 2, "d").unwrap();
        assert!(cam.next_frame().is_ok());
        let err = cam.next_frame().unwrap_err();
        assert!(matches!(err, CameraError::BadFrame(_, _)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_directory_fails_at_open() {
        let dir = temp_dir("empty");
        let err = FileCamera::open(&dir, 2, 2, "e").unwrap_err();
        assert!(matches!(err, CameraError::BadFrame(_, _)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn zero_dimensions_fail_at_open() {
        let err = FileCamera::open(".", 0, 72, "z").unwrap_err();
        assert!(matches!(err, CameraError::BadFrame(_, _)));
    }

    #[test]
    fn info_reports_file_kind() {
        let dir = temp_dir("info");
        let path = dir.join("one.gray");
        fs::write(&path, vec![0u8; (GRID_WIDTH * GRID_HEIGHT) as usize]).unwrap();
        let cam = FileCamera::open_grid(&path, "grid-1").unwrap();
        let info = cam.info();
        assert_eq!(info.kind, "file");
        assert_eq!(info.id, "grid-1");
        let _ = fs::remove_dir_all(&dir);
    }
}
