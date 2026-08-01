//! Frame integrity checks shared by every [`CameraSource`](crate::CameraSource).
//!
//! The pipeline must never see a truncated or dimension-mismatched buffer.
//! Call [`validate_frame`] before handing a [`Frame`](crate::Frame) to motion
//! or tracking — backends use the same gate so errors stay typed and uniform.

use crate::{CameraError, Frame};

/// Bytes per pixel for formats this crate understands.
///
/// # Errors
/// [`None`] when `format` is not a known raw layout (e.g. `"jpeg"` needs a
/// decoder, not a length check alone).
#[must_use]
pub fn bytes_per_pixel(format: &str) -> Option<usize> {
    match format {
        "gray8" | "grey8" => Some(1),
        "rgb8" => Some(3),
        "rgba8" => Some(4),
        _ => None,
    }
}

/// Expected payload length for a frame of the given size and format.
///
/// # Errors
/// [`None`] when the format is unknown or either dimension is zero.
#[must_use]
pub fn expected_byte_len(width: u32, height: u32, format: &str) -> Option<usize> {
    if width == 0 || height == 0 {
        return None;
    }
    let bpp = bytes_per_pixel(format)?;
    (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(bpp)
}

/// Reject a frame whose dimensions, format, or payload length are inconsistent.
///
/// # Errors
/// [`CameraError::BadFrame`] when the frame is empty, zero-sized, uses an
/// unknown format, or its `data` length does not match `width × height × bpp`.
///
/// # Example
/// ```
/// use camera::{validate::validate_frame, Frame};
/// use chrono::Utc;
///
/// let frame = Frame {
///     number: 1,
///     width: 2,
///     height: 2,
///     data: vec![0; 4],
///     format: "gray8".into(),
///     timestamp: Utc::now(),
/// };
/// assert!(validate_frame(&frame, "cam-1").is_ok());
///
/// let truncated = Frame { data: vec![0; 3], ..frame };
/// assert!(validate_frame(&truncated, "cam-1").is_err());
/// ```
pub fn validate_frame(frame: &Frame, camera_id: &str) -> Result<(), CameraError> {
    if frame.width == 0 || frame.height == 0 {
        return Err(CameraError::BadFrame(
            camera_id.to_owned(),
            format!("zero dimension ({}×{})", frame.width, frame.height),
        ));
    }

    let Some(expected) = expected_byte_len(frame.width, frame.height, &frame.format) else {
        return Err(CameraError::BadFrame(
            camera_id.to_owned(),
            format!("unsupported or invalid format '{}'", frame.format),
        ));
    };

    if frame.data.is_empty() {
        return Err(CameraError::BadFrame(
            camera_id.to_owned(),
            "empty payload".into(),
        ));
    }

    if frame.data.len() != expected {
        return Err(CameraError::BadFrame(
            camera_id.to_owned(),
            format!(
                "truncated or corrupt: expected {expected} bytes for {}×{} {}, got {}",
                frame.width,
                frame.height,
                frame.format,
                frame.data.len()
            ),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use chrono::Utc;

    fn gray(w: u32, h: u32, data: Vec<u8>) -> Frame {
        Frame {
            number: 1,
            width: w,
            height: h,
            data,
            format: "gray8".into(),
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn accepts_a_well_formed_gray_frame() {
        validate_frame(&gray(2, 2, vec![1, 2, 3, 4]), "c").unwrap();
    }

    #[test]
    fn rejects_truncated_payload() {
        let err = validate_frame(&gray(2, 2, vec![1, 2, 3]), "driveway").unwrap_err();
        match err {
            CameraError::BadFrame(id, msg) => {
                assert_eq!(id, "driveway");
                assert!(msg.contains("truncated") || msg.contains("expected"));
            }
            other @ CameraError::Disconnected(_) => {
                panic!("expected BadFrame, got {other}")
            }
        }
    }

    #[test]
    fn rejects_empty_payload() {
        let err = validate_frame(&gray(2, 2, vec![]), "c").unwrap_err();
        assert!(matches!(err, CameraError::BadFrame(_, _)));
    }

    #[test]
    fn rejects_zero_dimensions() {
        let err = validate_frame(&gray(0, 10, vec![0; 10]), "c").unwrap_err();
        assert!(matches!(err, CameraError::BadFrame(_, msg) if msg.contains("zero")));
    }

    #[test]
    fn rejects_unknown_format() {
        let mut frame = gray(1, 1, vec![0]);
        frame.format = "jpeg".into();
        let err = validate_frame(&frame, "c").unwrap_err();
        assert!(matches!(err, CameraError::BadFrame(_, msg) if msg.contains("format")));
    }

    #[test]
    fn rgb8_expects_three_bytes_per_pixel() {
        assert_eq!(expected_byte_len(2, 2, "rgb8"), Some(12));
        let frame = Frame {
            number: 1,
            width: 2,
            height: 2,
            data: vec![0; 12],
            format: "rgb8".into(),
            timestamp: Utc::now(),
        };
        validate_frame(&frame, "c").unwrap();
    }
}
