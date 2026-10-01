//! LLM HTTP transport via the Rust backend (CORS bypass).
//!
//! Webview `fetch` is subject to CORS, and local servers like LM Studio do not
//! send `Access-Control-Allow-Origin`, so the browser blocks even successful
//! (HTTP 200) responses with `TypeError: Failed to fetch`. `reqwest` runs
//! outside the webview and is not affected, so the frontend routes LLM traffic
//! through these commands when running inside Tauri (`pnpm tauri dev`/build).
//! Plain `vite dev` web preview keeps using `fetch`.

use tauri::ipc::Channel;

/// SSRF guard: plain `http` is only allowed for loopback hosts
/// (local runtimes: Ollama, LM Studio, llama-server, vLLM, Jan).
/// `https` (cloud APIs / gateways) is allowed for any host.
pub fn is_llm_url_allowed(url: &str) -> bool {
    let parsed = match url.parse::<tauri::Url>() {
        Ok(u) => u,
        Err(_) => return false,
    };
    match parsed.scheme() {
        "https" => true,
        "http" => match parsed.host_str().map(|h| h.to_ascii_lowercase()) {
            Some(h) => h == "localhost" || h == "127.0.0.1" || h == "::1",
            None => return false,
        },
        _ => false,
    }
}

fn reject(url: &str) -> String {
    format!("LLM_HTTP_FORBIDDEN blocked non-local URL: {}", url)
}

/// Non-2xx responses are reported as `LLM_HTTP_STATUS <code> <body...>`
/// so the frontend can map them to its typed errors (auth / not-found / ...).
fn status_error(status: reqwest::StatusCode, body: &str) -> String {
    let snippet: String = body.chars().take(2000).collect();
    format!("LLM_HTTP_STATUS {} {}", status.as_u16(), snippet)
}

fn apply_auth(
    builder: reqwest::RequestBuilder,
    api_key: Option<String>,
) -> reqwest::RequestBuilder {
    match api_key {
        Some(k) if !k.trim().is_empty() => builder.bearer_auth(k.trim().to_string()),
        _ => builder,
    }
}

/// Simple GETers: `/v1/models`, Ollama `/api/tags`, `/api/ps`.
#[tauri::command]
pub async fn llm_http_get(url: String, api_key: Option<String>) -> Result<String, String> {
    if !is_llm_url_allowed(&url) {
        return Err(reject(&url));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("LLM_HTTP_TRANSPORT client build failed: {}", e))?;
    let res = apply_auth(client.get(&url), api_key)
        .send()
        .await
        .map_err(|e| format!("LLM_HTTP_TRANSPORT {}", e))?;
    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("LLM_HTTP_TRANSPORT read body failed: {}", e))?;
    if !status.is_success() {
        return Err(status_error(status, &text));
    }
    Ok(text)
}

/// Non-streaming POST with a JSON body: Ollama `/api/show`.
#[tauri::command]
pub async fn llm_http_post_text(
    url: String,
    api_key: Option<String>,
    body: String,
) -> Result<String, String> {
    if !is_llm_url_allowed(&url) {
        return Err(reject(&url));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("LLM_HTTP_TRANSPORT client build failed: {}", e))?;
    let res = apply_auth(client.post(&url), api_key)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("LLM_HTTP_TRANSPORT {}", e))?;
    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("LLM_HTTP_TRANSPORT read body failed: {}", e))?;
    if !status.is_success() {
        return Err(status_error(status, &text));
    }
    Ok(text)
}

/// Streaming POST: `/api/chat`, `/v1/chat/completions` (SSE / NDJSON).
/// Text chunks are forwarded through the channel; the frontend parses them
/// with the same SSE/NDJSON loop it uses for `fetch`.
#[tauri::command]
pub async fn llm_http_post_stream(
    url: String,
    api_key: Option<String>,
    body: String,
    onchunk: Channel<String>,
) -> Result<(), String> {
    if !is_llm_url_allowed(&url) {
        return Err(reject(&url));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("LLM_HTTP_TRANSPORT client build failed: {}", e))?;
    let mut res = apply_auth(client.post(&url), api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("LLM_HTTP_TRANSPORT {}", e))?;
    let status = res.status();
    if !status.is_success() {
        let text = res
            .text()
            .await
            .unwrap_or_else(|_| status.to_string());
        return Err(status_error(status, &text));
    }
    loop {
        match res
            .chunk()
            .await
            .map_err(|e| format!("LLM_HTTP_TRANSPORT stream read failed: {}", e))?
        {
            Some(bytes) => {
                onchunk
                    .send(String::from_utf8_lossy(&bytes).into_owned())
                    .map_err(|e| format!("LLM_HTTP_TRANSPORT channel send failed: {}", e))?;
            }
            None => break,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loopback_http_allowed() {
        assert!(is_llm_url_allowed("http://127.0.0.1:1234/v1/models"));
        assert!(is_llm_url_allowed("http://localhost:1234/v1/models"));
        assert!(is_llm_url_allowed("http://127.0.0.1:11434/api/tags"));
    }

    #[test]
    fn test_non_loopback_http_blocked() {
        assert!(!is_llm_url_allowed("http://192.168.0.5:8000/v1/models"));
        assert!(!is_llm_url_allowed("http://example.com/v1/models"));
    }

    #[test]
    fn test_https_allowed_any_host() {
        assert!(is_llm_url_allowed("https://api.openai.com/v1/models"));
    }

    #[test]
    fn test_other_schemes_and_garbage_blocked() {
        assert!(!is_llm_url_allowed("file:///etc/passwd"));
        assert!(!is_llm_url_allowed("not a url"));
    }
}
