//! Choosing a port to listen on.
//!
//! A stale engine holding the port used to kill startup outright, which is a
//! poor trade: the developer wanted a running engine, not a lecture about
//! sockets. Instead the preferred port is tried first and the next few are
//! tried in turn, and whichever one wins is written to a file so the rest of
//! the stack can find it without being told.

use std::path::{Path, PathBuf};
use tokio::net::TcpListener;

/// How many ports past the preferred one to try before giving up.
pub const PORT_SCAN_RANGE: u16 = 10;

/// Where the chosen port is recorded, relative to the repository root.
const PORT_FILE: &str = ".runtime/engine.port";

/// A bound listener and the port it actually got.
pub struct Bound {
    /// The listening socket.
    pub listener: TcpListener,
    /// Port it bound to, which may not be the one requested.
    pub port: u16,
    /// True when the preferred port was taken and a fallback was used.
    pub fell_back: bool,
}

/// Bind the preferred port, or the next free one after it.
///
/// # Errors
/// Returns the last bind error when every candidate in the range is taken,
/// since at that point something is genuinely wrong rather than merely busy.
pub async fn bind_with_fallback(preferred: u16) -> Result<Bound, std::io::Error> {
    let mut last_err = None;
    for offset in 0..PORT_SCAN_RANGE {
        let candidate = preferred.saturating_add(offset);
        match TcpListener::bind(("0.0.0.0", candidate)).await {
            Ok(listener) => {
                // Ask the socket what it actually got rather than assuming it
                // matched the request: port 0 means "any free port", so the
                // requested value is not the one to report or record.
                let port = listener.local_addr().map_or(candidate, |addr| addr.port());
                return Ok(Bound {
                    listener,
                    port,
                    fell_back: offset > 0,
                });
            }
            Err(err) => last_err = Some(err),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrInUse, "no free port in range")
    }))
}

/// Record the chosen port so other processes can discover it.
///
/// Best-effort: failing to write it is not worth refusing to serve over, so
/// the error is returned for logging rather than propagated as fatal.
///
/// # Errors
/// Returns any filesystem error encountered creating or writing the file.
pub fn write_port_file(root: &Path, port: u16) -> Result<PathBuf, std::io::Error> {
    let path = root.join(PORT_FILE);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, port.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[tokio::test]
    async fn takes_the_preferred_port_when_it_is_free() {
        // Port 0 asks the OS for any free port, so this cannot flake.
        let bound = bind_with_fallback(0).await.unwrap();
        assert!(!bound.fell_back);
        assert!(
            bound.port > 0,
            "must report the port actually assigned, not the one requested"
        );
    }

    #[tokio::test]
    async fn reports_the_real_port_for_an_explicit_request() {
        let squatter = TcpListener::bind(("0.0.0.0", 0)).await.unwrap();
        let free = squatter.local_addr().unwrap().port();
        drop(squatter); // release it so the next bind can take it

        let bound = bind_with_fallback(free).await.unwrap();
        assert_eq!(bound.port, free);
        assert_eq!(bound.listener.local_addr().unwrap().port(), bound.port);
    }

    #[tokio::test]
    async fn falls_back_when_the_preferred_port_is_taken() {
        let squatter = TcpListener::bind(("0.0.0.0", 0)).await.unwrap();
        let taken = squatter.local_addr().unwrap().port();

        let bound = bind_with_fallback(taken).await.unwrap();
        assert!(bound.fell_back, "should have moved off the occupied port");
        assert_ne!(bound.port, taken);
        assert!(bound.port > taken && bound.port < taken + PORT_SCAN_RANGE);
    }

    #[test]
    fn writes_the_chosen_port_where_others_can_read_it() {
        let dir = std::env::temp_dir().join(format!("we-bind-{}", std::process::id()));
        let path = write_port_file(&dir, 8091).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "8091");
        std::fs::remove_dir_all(&dir).ok();
    }
}
