use base64::Engine;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub title: String,
    pub link: String,
    pub snippet: String,
}

/// Extract clean destination URL from Bing click-tracking link if possible.
/// e.g. "https://www.bing.com/ck/a?...&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbQ&ntb=1" -> "https://example.com"
pub fn extract_bing_url(href: &str) -> String {
    if let Some(pos) = href.find("u=a1") {
        let rest = &href[pos + 4..];
        let encoded = match rest.find('&') {
            Some(end) => &rest[..end],
            None => rest,
        };
        let mut padded = encoded.replace('-', "+").replace('_', "/");
        while padded.len() % 4 != 0 {
            padded.push('=');
        }
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&padded) {
            if let Ok(decoded) = String::from_utf8(bytes) {
                if decoded.starts_with("http://") || decoded.starts_with("https://") {
                    return decoded;
                }
            }
        }
    }
    href.to_string()
}

/// Parse search results from Bing SERP HTML.
pub fn parse_bing_html(html: &str) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);
    let result_selector = match Selector::parse("li.b_algo") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let title_selector = match Selector::parse("h2 a, .b_algo h2 a") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let snippet_selector = match Selector::parse(".b_caption p, p.b_lineclamp2, .b_snippet, p") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();

    for element in document.select(&result_selector) {
        let title_elem = element.select(&title_selector).next();
        let snippet_elem = element.select(&snippet_selector).next();

        if let Some(t) = title_elem {
            let title = t.text().collect::<Vec<_>>().join(" ").trim().to_string();
            let raw_link = t.value().attr("href").unwrap_or("").to_string();
            let link = extract_bing_url(&raw_link);
            let snippet = snippet_elem
                .map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_default();

            if !title.is_empty() && !link.is_empty() {
                results.push(SearchResultItem {
                    title,
                    link,
                    snippet,
                });
            }
        }

        if results.len() >= 5 {
            break;
        }
    }

    results
}

/// Parse DuckDuckGo search results (fallback).
pub fn parse_duckduckgo_html(html: &str) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);
    let result_selector = match Selector::parse(".result, .web-result, tr") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let title_selector = match Selector::parse("a.result__a, .result__title a, a.result-link, a[href]") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let snippet_selector = match Selector::parse(".result__snippet, .snippet") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();

    for element in document.select(&result_selector) {
        let title_elem = element.select(&title_selector).next();
        let snippet_elem = element.select(&snippet_selector).next();

        if let Some(t) = title_elem {
            let title = t.text().collect::<Vec<_>>().join(" ").trim().to_string();
            let link = t.value().attr("href").unwrap_or("").to_string();
            let snippet = snippet_elem
                .map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_default();

            if !title.is_empty() && !link.is_empty() {
                results.push(SearchResultItem {
                    title,
                    link,
                    snippet,
                });
            }
        }

        if results.len() >= 5 {
            break;
        }
    }

    results
}

/// Parse search results from Naver mobile search HTML.
pub fn parse_naver_html(html: &str) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);
    let mut results = Vec::new();

    // 1. Direct answer/weather card (.cs_weather_new)
    if let Ok(weather_selector) = Selector::parse(".cs_weather_new") {
        if let Some(weather_elem) = document.select(&weather_selector).next() {
            let mut lines = Vec::new();
            for s in weather_elem.text() {
                let trimmed = s.trim();
                if trimmed.is_empty()
                    || trimmed == "관련도순"
                    || trimmed == "최신순"
                    || trimmed == "Keep에 저장"
                    || trimmed == "Keep에 바로가기"
                    || trimmed == "옵션 초기화"
                {
                    continue;
                }
                lines.push(trimmed);
            }
            if !lines.is_empty() {
                let snippet: String = lines.iter().take(25).cloned().collect::<Vec<_>>().join(" ");
                let mut link = "https://weather.naver.com".to_string();
                if let Ok(a_sel) = Selector::parse("a[href]") {
                    for a in weather_elem.select(&a_sel) {
                        if let Some(href) = a.value().attr("href") {
                            if href.starts_with("http")
                                && (href.contains("weather.naver.com") || href.contains("kma.go.kr"))
                            {
                                link = href.to_string();
                                break;
                            }
                        }
                    }
                }
                results.push(SearchResultItem {
                    title: "네이버 날씨 실시간 예보".to_string(),
                    link,
                    snippet: if snippet.chars().count() > 300 {
                        snippet.chars().take(300).collect()
                    } else {
                        snippet
                    },
                });
            }
        }
    }

    // 2. Generic result boxes (.api_subject_bx, .bx)
    if let Ok(bx_selector) = Selector::parse(".api_subject_bx, .bx") {
        if let Ok(a_selector) = Selector::parse("a[href]") {
            for bx in document.select(&bx_selector) {
                let mut candidates: Vec<(String, String)> = Vec::new();
                for a in bx.select(&a_selector) {
                    let href = a.value().attr("href").unwrap_or("").trim();
                    if !href.starts_with("http") || href.contains('#') {
                        continue;
                    }
                    if href.contains("m.keep.naver.com")
                        || href.contains("help.naver.com")
                        || href.contains("search.naver.com")
                        || href.contains("nid.naver.com")
                    {
                        continue;
                    }
                    let text = a.text().collect::<Vec<_>>().join(" ").trim().to_string();
                    if text.chars().count() < 3 {
                        continue;
                    }
                    candidates.push((text, href.to_string()));
                }

                if candidates.is_empty() {
                    continue;
                }

                let (title, link) = if candidates.len() > 1 && candidates[1].0.chars().count() > 4 {
                    candidates[1].clone()
                } else {
                    candidates[0].clone()
                };

                let mut snippet = String::new();
                for (txt, _) in &candidates {
                    if txt != &title && txt.chars().count() > 20 {
                        snippet = txt.clone();
                        break;
                    }
                }

                if snippet.is_empty() {
                    if let Ok(text_sel) =
                        Selector::parse(".dsc, .dsc_txt, .text, .api_txt_lines, p, span")
                    {
                        for elem in bx.select(&text_sel) {
                            let etxt = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                            if etxt != title && etxt.chars().count() > 25 && !etxt.contains("Keep에") {
                                snippet = etxt;
                                break;
                            }
                        }
                    }
                }

                if !link.is_empty() && !results.iter().any(|r| r.link == link) {
                    results.push(SearchResultItem {
                        title,
                        link,
                        snippet: if snippet.chars().count() > 300 {
                            snippet.chars().take(300).collect()
                        } else {
                            snippet
                        },
                    });
                }

                if results.len() >= 6 {
                    break;
                }
            }
        }
    }

    results
}

/// Check if a link domain is a known anti-bot / honeypot decoy domain.
pub fn is_honeypot_domain(link: &str) -> bool {
    let lower = link.to_lowercase();
    lower.contains("yahoo.co.jp")
        || lower.contains("facebook.com")
        || lower.contains("y8.com")
        || lower.contains("zhidao.baidu.com")
        || lower.contains("klingai.com")
        || lower.contains("portal.office.com")
        || lower.contains("outlook.office.com")
        || lower.contains("config.office.com")
        || lower.contains("to-do.office.com")
}

/// Universal HTML search parser (handles Naver, Bing and DuckDuckGo HTML).
pub fn parse_search_html(html: &str) -> Vec<SearchResultItem> {
    let naver = parse_naver_html(html);
    if !naver.is_empty() {
        return naver;
    }
    let bing = parse_bing_html(html);
    if !bing.is_empty() {
        return bing;
    }
    parse_duckduckgo_html(html)
}

#[tauri::command]
pub async fn web_search(query: String) -> Result<Vec<SearchResultItem>, String> {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let encoded_query = urlencoding::encode(&query);

    // 1. Primary: Naver Mobile Search (General search: no bot-block, highly reliable for all queries)
    let naver_url = format!("https://m.search.naver.com/search.naver?query={}", encoded_query);
    if let Ok(res) = client
        .get(&naver_url)
        .header("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        if let Ok(text) = res.text().await {
            let parsed = parse_naver_html(&text);
            if !parsed.is_empty() {
                return Ok(parsed);
            }
        }
    }

    // 2. Secondary fallback: Bing search with anti-honeypot filter
    let bing_url = format!("https://www.bing.com/search?q={}", encoded_query);
    if let Ok(res) = client
        .get(&bing_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        .header("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        if let Ok(text) = res.text().await {
            let parsed = parse_bing_html(&text);
            let filtered: Vec<SearchResultItem> = parsed
                .into_iter()
                .filter(|item| !is_honeypot_domain(&item.link))
                .collect();
            if !filtered.is_empty() {
                return Ok(filtered);
            }
        }
    }

    // 3. Tertiary fallback: DuckDuckGo HTML
    let ddg_url = format!("https://html.duckduckgo.com/html/?q={}", encoded_query);
    if let Ok(res) = client
        .get(&ddg_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        if let Ok(text) = res.text().await {
            let parsed = parse_duckduckgo_html(&text);
            if !parsed.is_empty() {
                return Ok(parsed);
            }
        }
    }

    Ok(Vec::new())
}

/// Extract clean readable text from HTML (removes script, style, nav, footer, etc.)
pub fn extract_readable_text(html: &str) -> String {
    let document = Html::parse_document(html);

    let container_selector = match Selector::parse("article, main, [role=\"main\"], body") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let container = document.select(&container_selector).next();

    let mut ignored_tags = std::collections::HashSet::new();
    ignored_tags.insert("script");
    ignored_tags.insert("style");
    ignored_tags.insert("noscript");
    ignored_tags.insert("svg");
    ignored_tags.insert("nav");
    ignored_tags.insert("footer");
    ignored_tags.insert("header");
    ignored_tags.insert("iframe");

    let mut text_lines = Vec::new();
    let block_selector = match Selector::parse("h1, h2, h3, h4, p, li, tr, td, th, div > span") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    if let Some(cont) = container {
        for elem in cont.select(&block_selector) {
            let is_ignored = elem.ancestors().any(|anc| {
                if let Some(el) = anc.value().as_element() {
                    ignored_tags.contains(el.name())
                } else {
                    false
                }
            });

            if is_ignored {
                continue;
            }

            let text = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
            if !text.is_empty() && text.chars().count() > 2 {
                text_lines.push(text);
            }
        }
    }

    let mut cleaned_lines = Vec::new();
    let mut prev_line = "";
    for line in &text_lines {
        if line.as_str() != prev_line {
            cleaned_lines.push(line.as_str());
            prev_line = line.as_str();
        }
    }

    let joined = cleaned_lines.join("\n\n");
    const MAX_CHARS: usize = 4000;
    if joined.chars().count() > MAX_CHARS {
        let truncated: String = joined.chars().take(MAX_CHARS).collect();
        format!("{}\n\n... [본문이 길어 4,000자로 절단되었습니다]", truncated)
    } else if joined.is_empty() {
        "페이지에서 본문 텍스트를 추출하지 못했습니다.".to_string()
    } else {
        joined
    }
}

/// Fetches a web page by URL and extracts its main readable text/markdown.
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<String, String> {
    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("HTTP 클라이언트 생성 실패: {}", e)),
    };

    let res = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        .header("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
        .map_err(|e| format!("웹페이지 연결 실패: {}", e))?;

    let text = res
        .text()
        .await
        .map_err(|e| format!("응답 본문 읽기 실패: {}", e))?;

    let readable = extract_readable_text(&text);
    Ok(readable)
}

/// Open a URL inside a dedicated in-app browser window (Tauri WebviewWindow).
#[tauri::command]
pub async fn open_in_browser(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri::Manager;

    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    if let Some(window) = app.get_webview_window("fortress-browser") {
        let _ = window.navigate(parsed_url);
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "fortress-browser",
            tauri::WebviewUrl::External(parsed_url),
        )
        .title("Fortress Browser")
        .inner_size(1100.0, 750.0)
        .build()
        .map_err(|e| format!("Failed to open browser window: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_search_html_sample() {
        let sample_html = r#"
        <html>
        <body>
            <div class="result">
                <h2 class="result__title">
                    <a class="result__a" href="https://example.com/rust">Rust Programming</a>
                </h2>
                <a class="result__snippet">A language empowering everyone to build reliable and efficient software.</a>
            </div>
            <div class="result">
                <h2 class="result__title">
                    <a class="result__a" href="https://example.com/tauri">Tauri Apps</a>
                </h2>
                <a class="result__snippet">Build smaller, faster, and more secure desktop applications.</a>
            </div>
        </body>
        </html>
        "#;

        let results = parse_search_html(sample_html);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Rust Programming");
        assert_eq!(results[0].link, "https://example.com/rust");
        assert!(results[0].snippet.contains("reliable and efficient"));
        assert_eq!(results[1].title, "Tauri Apps");
    }

    #[test]
    fn test_parse_bing_html_sample() {
        let sample_html = r#"
        <html>
        <body>
            <li class="b_algo">
                <h2><a href="https://www.bing.com/ck/a?!&&p=123&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS93ZWF0aGVy&ntb=1">Seoul Weather</a></h2>
                <div class="b_caption">
                    <p class="b_lineclamp2">Clear skies with mild temperatures throughout the week.</p>
                </div>
            </li>
        </body>
        </html>
        "#;

        let results = parse_bing_html(sample_html);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Seoul Weather");
        assert_eq!(results[0].link, "https://example.com/weather");
        assert!(results[0].snippet.contains("Clear skies"));
    }

    #[test]
    fn test_extract_bing_url() {
        let raw = "https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9wb2xpY3kyNi50aXN0b3J5LmNvbS8&ntb=1";
        let extracted = extract_bing_url(raw);
        assert_eq!(extracted, "https://policy26.tistory.com/");

        let direct = "https://example.com/test";
        assert_eq!(extract_bing_url(direct), direct);
    }

    #[test]
    fn test_extract_readable_text() {
        let sample = r#"
        <html>
        <head><title>Weather</title></head>
        <body>
            <header><nav>Navigation Link</nav></header>
            <script>var secret = 123;</script>
            <main>
                <h1>Seoul 7-Day Weather</h1>
                <p>Monday: 22C Sunny with light breeze.</p>
                <p>Tuesday: 20C Rainy afternoon.</p>
            </main>
            <footer>Copyright 2026</footer>
        </body>
        </html>
        "#;
        let text = extract_readable_text(sample);
        assert!(text.contains("Seoul 7-Day Weather"));
        assert!(text.contains("Monday: 22C Sunny"));
        assert!(!text.contains("Navigation Link"));
        assert!(!text.contains("var secret"));
        assert!(!text.contains("Copyright 2026"));
    }

    #[test]
    fn test_parse_naver_html_sample() {
        let sample_html = r#"
        <html>
        <body>
            <div class="api_subject_bx">
                <a href="https://example.com/rust">rust-lang.org</a>
                <a href="https://example.com/rust">Rust Programming Language - Official Site</a>
                <p class="dsc">A language empowering everyone to build reliable and efficient software.</p>
            </div>
            <div class="api_subject_bx">
                <a href="https://m.keep.naver.com/">Keep에 바로가기</a>
                <a href="https://example.com/tauri">Tauri Apps Desktop Framework</a>
                <span class="text">Build smaller, faster, and more secure desktop applications with web frontend.</span>
            </div>
        </body>
        </html>
        "#;

        let results = parse_naver_html(sample_html);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Rust Programming Language - Official Site");
        assert_eq!(results[0].link, "https://example.com/rust");
        assert!(results[0].snippet.contains("reliable and efficient"));
        assert_eq!(results[1].title, "Tauri Apps Desktop Framework");
        assert_eq!(results[1].link, "https://example.com/tauri");
    }

    #[test]
    fn test_is_honeypot_domain() {
        assert!(is_honeypot_domain("https://www.yahoo.co.jp/"));
        assert!(is_honeypot_domain("https://www.facebook.com/login"));
        assert!(is_honeypot_domain("https://zhidao.baidu.com/question/123"));
        assert!(is_honeypot_domain("https://www.y8.com/"));
        assert!(!is_honeypot_domain("https://weather.naver.com/"));
        assert!(!is_honeypot_domain("https://www.weather.go.kr/"));
        assert!(!is_honeypot_domain("https://rust-lang.org/"));
    }

    #[test]
    fn test_parse_search_html_empty_on_invalid() {
        let results = parse_search_html("<div>No search items here</div>");
        assert_eq!(results.len(), 0);
    }

    #[test]
    #[ignore]
    fn test_live_web_search() {
        tauri::async_runtime::block_on(async {
            let results = web_search("서울 날씨 예보".to_string()).await.unwrap();
            assert!(!results.is_empty(), "Live search should return results");
            println!("Live results count: {}", results.len());
            println!("First result: {:?}", results[0]);
        });
    }
}
