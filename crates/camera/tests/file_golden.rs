//! Golden integration: fixed gray sequence → exact frame count.
//!
//! Fixtures are generated under a temp directory (no large binaries in git).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camera::file::FileCamera;
use camera::{CameraError, CameraSource};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

fn scratch(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "watchingeye-cam-itest-{label}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn golden_concatenated_gray_file_frame_count() {
    let dir = scratch("concat");
    let path = dir.join("walk.gray");
    let (w, h) = (96u32, 72u32);
    let expected = 13u64;
    let mut out = File::create(&path).unwrap();
    for i in 0..expected {
        let pixel = u8::try_from(i % 256).unwrap();
        out.write_all(&vec![pixel; (w * h) as usize]).unwrap();
    }
    drop(out);

    let mut cam = FileCamera::open(&path, w, h, "golden-itest").unwrap();
    let mut count = 0u64;
    loop {
        match cam.next_frame() {
            Ok(_) => count += 1,
            Err(CameraError::Disconnected(_)) => break,
            Err(err) => panic!("unexpected error: {err}"),
        }
    }
    assert_eq!(count, expected);
    let _ = fs::remove_dir_all(&dir);
}
