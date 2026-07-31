//! Scanning as a job you poll, rather than one long request.
//!
//! A sweep takes seconds to tens of seconds depending on the subnet, and the
//! dashboard's dev proxy abandons a request at 30 — returning a 500 that
//! looks like a crash when the scan was in fact working. Holding a request
//! open for the duration is the wrong shape regardless: it gives the
//! operator no progress and no way to look away.
//!
//! So a scan is started, and its state is polled. The synchronous endpoint
//! stays for scripts, where blocking is what you want.

use crate::netscan;
use crate::onvif_client;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use camera::discovery::Candidate;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

/// How long to listen for ONVIF multicast replies.
const ONVIF_WAIT: Duration = Duration::from_millis(1500);

/// Finished jobs are dropped after this long, so the map cannot grow without
/// bound in a long-running process.
const RETAIN: Duration = Duration::from_mins(10);

/// Where a scan has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanState {
    /// Sweeping, or confirming what answered.
    Running,
    /// Finished; `candidates` is complete.
    Done,
    /// Gave up; `error` says why.
    Failed,
}

/// One scan, in progress or complete.
#[derive(Debug, Clone, Serialize)]
pub struct ScanJob {
    /// Job identifier.
    pub id: String,
    /// The range being swept.
    pub cidr: String,
    /// Current state.
    pub state: ScanState,
    /// What has been found. Populated when the job reaches `Done`.
    pub candidates: Vec<Candidate>,
    /// Why it failed, when it did.
    pub error: Option<String>,
    /// Milliseconds since the job started — enough for the UI to show that
    /// something is still happening without inventing a percentage it cannot
    /// know.
    pub elapsed_ms: u64,
    #[serde(skip)]
    started: Instant,
}

/// Shared job registry.
pub type Jobs = Arc<Mutex<HashMap<String, ScanJob>>>;

/// Request to begin a scan.
#[derive(Debug, Deserialize)]
pub struct StartRequest {
    /// CIDR range to sweep.
    pub cidr: String,
}

/// Routes for starting and polling scans.
pub fn router() -> Router {
    let jobs: Jobs = Arc::new(Mutex::new(HashMap::new()));
    Router::new()
        .route("/api/cameras/scan/start", post(start))
        .route("/api/cameras/scan/{id}", get(status))
        .with_state(jobs)
}

/// Take the lock, surviving a poisoned mutex.
///
/// A panicked scan must not disable scanning for the rest of the process.
fn lock(jobs: &Jobs) -> std::sync::MutexGuard<'_, HashMap<String, ScanJob>> {
    match jobs.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Begin a scan and return its id immediately.
async fn start(State(jobs): State<Jobs>, Json(req): Json<StartRequest>) -> Response {
    let id = Uuid::new_v4().to_string();
    let job = ScanJob {
        id: id.clone(),
        cidr: req.cidr.clone(),
        state: ScanState::Running,
        candidates: Vec::new(),
        error: None,
        elapsed_ms: 0,
        started: Instant::now(),
    };

    {
        let mut guard = lock(&jobs);
        guard.retain(|_, j| j.state == ScanState::Running || j.started.elapsed() < RETAIN);
        guard.insert(id.clone(), job);
    }

    let spawned = jobs.clone();
    let job_id = id.clone();
    tokio::spawn(async move {
        let outcome = run(&req.cidr).await;
        let mut guard = lock(&spawned);
        if let Some(job) = guard.get_mut(&job_id) {
            job.elapsed_ms = elapsed_ms(job.started);
            match outcome {
                Ok(candidates) => {
                    job.candidates = candidates;
                    job.state = ScanState::Done;
                }
                Err(err) => {
                    job.error = Some(err);
                    job.state = ScanState::Failed;
                }
            }
        }
    });

    (StatusCode::ACCEPTED, Json(serde_json::json!({ "id": id }))).into_response()
}

/// Report a scan's state.
async fn status(State(jobs): State<Jobs>, Path(id): Path<String>) -> Response {
    let guard = lock(&jobs);
    match guard.get(&id) {
        Some(job) => {
            let mut job = job.clone();
            if job.state == ScanState::Running {
                job.elapsed_ms = elapsed_ms(job.started);
            }
            Json(job).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "no such scan" })),
        )
            .into_response(),
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Sweep, then confirm every candidate concurrently.
pub async fn run(cidr: &str) -> Result<Vec<Candidate>, String> {
    let mut candidates = netscan::discover(cidr, ONVIF_WAIT)
        .await
        .map_err(|e| e.to_string())?;

    let mut set = tokio::task::JoinSet::new();
    for (index, candidate) in candidates.iter().enumerate() {
        if candidate.onvif_url.is_some() {
            continue;
        }
        let address = candidate.address.clone();
        set.spawn(async move { (index, onvif_client::confirm(&address).await) });
    }
    while let Some(joined) = set.join_next().await {
        let Ok((index, Some(service))) = joined else {
            continue;
        };
        if let Some(candidate) = candidates.get_mut(index) {
            candidate.onvif_url = Some(service.url);
            "onvif-camera".clone_into(&mut candidate.hint);
        }
    }

    Ok(candidates)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn jobs() -> Jobs {
        Arc::new(Mutex::new(HashMap::new()))
    }

    #[tokio::test]
    async fn starting_a_scan_returns_immediately_with_an_id() {
        // The whole point: the caller is not held for the length of the sweep.
        let jobs = jobs();
        let res = start(
            State(jobs.clone()),
            Json(StartRequest {
                // A /30 of reserved documentation space: nothing answers, and
                // it finishes quickly.
                cidr: "203.0.113.0/30".into(),
            }),
        )
        .await;
        assert_eq!(res.status(), StatusCode::ACCEPTED);
        assert_eq!(lock(&jobs).len(), 1, "the job is registered");
    }

    #[tokio::test]
    async fn an_unknown_id_is_not_found_rather_than_an_empty_success() {
        let res = status(State(jobs()), Path("nope".into())).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn a_scan_reaches_done_and_keeps_its_results() {
        let jobs = jobs();
        let _ = start(
            State(jobs.clone()),
            Json(StartRequest {
                cidr: "203.0.113.0/30".into(),
            }),
        )
        .await;
        let id = lock(&jobs).keys().next().cloned().unwrap();

        for _ in 0..100 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if lock(&jobs).get(&id).map(|j| j.state) != Some(ScanState::Running) {
                break;
            }
        }
        let guard = lock(&jobs);
        let job = guard.get(&id).unwrap();
        assert_eq!(job.state, ScanState::Done, "error: {:?}", job.error);
        assert!(job.candidates.is_empty(), "nothing lives in 203.0.113.0/30");
    }

    #[tokio::test]
    async fn a_bad_range_fails_the_job_with_a_reason() {
        let jobs = jobs();
        let _ = start(
            State(jobs.clone()),
            Json(StartRequest {
                cidr: "10.0.0.0/8".into(),
            }),
        )
        .await;
        let id = lock(&jobs).keys().next().cloned().unwrap();

        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if lock(&jobs).get(&id).map(|j| j.state) != Some(ScanState::Running) {
                break;
            }
        }
        let guard = lock(&jobs);
        let job = guard.get(&id).unwrap();
        assert_eq!(job.state, ScanState::Failed);
        assert!(
            job.error.as_deref().unwrap_or_default().contains("limit"),
            "expected the size limit to be explained, got {:?}",
            job.error
        );
    }
}
