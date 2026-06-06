// Glassbox BPE tokenizer (gpt2). Reproduces tiktoken gpt2 encoding byte for byte.
//
// Mirrors the tiktoken core algorithm:
//  1. Pretokenize with the gpt2 regex (fancy-regex, same engine tiktoken uses).
//  2. For each piece, byte_pair_encode over its UTF-8 bytes against the rank map.
//  3. Concatenate piece outputs in order. No special/BOS/EOS tokens.
//
// Capability gating powers the self improvement curve. With all caps on the
// output is exact. Each cap turned off intentionally degrades a subset of lines.

use std::collections::HashMap;
use std::path::Path;

use base64::Engine as _;
use fancy_regex::Regex;

/// Capability flags. When a flag is false the encoder degrades on purpose.
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    /// BPE merging. Off: emit one rank per single byte.
    pub merges: bool,
    /// gpt2 regex pretokenization. Off: simple ASCII whitespace split.
    pub regex: bool,
    /// byte level coverage. Off: drop bytes >= 128 from each piece.
    pub byte_level: bool,
    /// whitespace fidelity. Off: trim and collapse spaces in each piece.
    pub whitespace: bool,
    // The flags below are accepted for contract completeness but never change
    // the output (they are always structurally on).
    pub special: bool,
    pub encode: bool,
    pub decode: bool,
    pub harness: bool,
}

impl Caps {
    /// All capabilities on. This is the default and produces exact output.
    pub fn all_on() -> Self {
        Caps {
            merges: true,
            regex: true,
            byte_level: true,
            whitespace: true,
            special: true,
            encode: true,
            decode: true,
            harness: true,
        }
    }

    /// All capabilities off.
    pub fn all_off() -> Self {
        Caps {
            merges: false,
            regex: false,
            byte_level: false,
            whitespace: false,
            special: false,
            encode: false,
            decode: false,
            harness: false,
        }
    }

    /// Parse a comma separated capability list. The literal "all" means all on.
    /// Unknown tokens are ignored. An empty string yields all off.
    pub fn parse(spec: &str) -> Self {
        let spec = spec.trim();
        if spec.eq_ignore_ascii_case("all") {
            return Caps::all_on();
        }
        let mut caps = Caps::all_off();
        for raw in spec.split(',') {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            if name.eq_ignore_ascii_case("all") {
                return Caps::all_on();
            }
            match name.to_ascii_lowercase().as_str() {
                "merges" => caps.merges = true,
                "regex" => caps.regex = true,
                "byte_level" | "bytelevel" => caps.byte_level = true,
                "whitespace" => caps.whitespace = true,
                "special" => caps.special = true,
                "encode" => caps.encode = true,
                "decode" => caps.decode = true,
                "harness" => caps.harness = true,
                _ => {}
            }
        }
        caps
    }
}

/// A gpt2 byte pair encoder backed by the tiktoken rank map and regex.
pub struct Tokenizer {
    /// token bytes -> rank
    ranks: HashMap<Vec<u8>, u32>,
    /// rank -> token bytes (for decode)
    decoder: HashMap<u32, Vec<u8>>,
    /// gpt2 pretokenization regex
    pattern: Regex,
}

impl Tokenizer {
    /// Build a tokenizer from the in memory tiktoken file contents and the
    /// gpt2 regex pattern string. The pattern is used verbatim.
    pub fn new(tiktoken_text: &str, pattern: &str) -> Result<Self, String> {
        let mut ranks: HashMap<Vec<u8>, u32> = HashMap::new();
        let mut decoder: HashMap<u32, Vec<u8>> = HashMap::new();
        let b64 = base64::engine::general_purpose::STANDARD;
        for (lineno, line) in tiktoken_text.lines().enumerate() {
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                continue;
            }
            // Each line is "base64(token_bytes) <space> rank".
            let mut it = line.split_ascii_whitespace();
            let tok_b64 = it
                .next()
                .ok_or_else(|| format!("line {}: missing token", lineno + 1))?;
            let rank_str = it
                .next()
                .ok_or_else(|| format!("line {}: missing rank", lineno + 1))?;
            let bytes = b64
                .decode(tok_b64.as_bytes())
                .map_err(|e| format!("line {}: bad base64: {}", lineno + 1, e))?;
            let rank: u32 = rank_str
                .parse()
                .map_err(|e| format!("line {}: bad rank: {}", lineno + 1, e))?;
            ranks.insert(bytes.clone(), rank);
            decoder.insert(rank, bytes);
        }
        let pattern = Regex::new(pattern).map_err(|e| format!("bad pattern: {}", e))?;
        Ok(Tokenizer {
            ranks,
            decoder,
            pattern,
        })
    }

    /// Number of base ranks loaded (excludes special tokens).
    pub fn n_ranks(&self) -> usize {
        self.ranks.len()
    }

    /// Encode text into token ids (encode-ordinary, no special tokens).
    pub fn encode(&self, text: &str, caps: &Caps) -> Vec<u32> {
        let mut out: Vec<u32> = Vec::new();
        for piece in self.pretokenize(text, caps) {
            let piece_bytes = self.shape_piece(piece, caps);
            self.encode_piece(&piece_bytes, caps, &mut out);
        }
        out
    }

    /// Pretokenize the text into pieces (each a slice of the original string).
    fn pretokenize<'a>(&self, text: &'a str, caps: &Caps) -> Vec<&'a str> {
        if caps.regex {
            let mut pieces = Vec::new();
            for m in self.pattern.find_iter(text) {
                // fancy-regex returns Result; on the gpt2 pattern over valid
                // UTF-8 this does not error, but be defensive.
                if let Ok(m) = m {
                    pieces.push(m.as_str());
                }
            }
            pieces
        } else {
            // regex OFF: simple ASCII whitespace split. Splitting on runs of
            // ASCII whitespace drops the whitespace entirely, so spacing and
            // leading space markers are lost and lines mismatch.
            text.split_ascii_whitespace().collect()
        }
    }

    /// Apply whitespace and byte_level shaping to a piece, producing the byte
    /// sequence that will be fed to BPE. With all caps on this is just the
    /// piece's UTF-8 bytes unchanged.
    fn shape_piece(&self, piece: &str, caps: &Caps) -> Vec<u8> {
        // whitespace shaping operates on the string first.
        let shaped: std::borrow::Cow<str> = if caps.whitespace {
            std::borrow::Cow::Borrowed(piece)
        } else {
            // whitespace OFF: trim leading/trailing ASCII spaces and collapse
            // internal runs of spaces to a single space.
            let trimmed = piece.trim_matches(' ');
            let mut collapsed = String::with_capacity(trimmed.len());
            let mut prev_space = false;
            for ch in trimmed.chars() {
                if ch == ' ' {
                    if !prev_space {
                        collapsed.push(' ');
                    }
                    prev_space = true;
                } else {
                    collapsed.push(ch);
                    prev_space = false;
                }
            }
            std::borrow::Cow::Owned(collapsed)
        };

        let bytes = shaped.as_bytes();
        if caps.byte_level {
            bytes.to_vec()
        } else {
            // byte_level OFF: drop any byte >= 128 so unicode/emoji mismatch.
            bytes.iter().copied().filter(|&b| b < 128).collect()
        }
    }

    /// Encode a single piece's bytes, appending ids to `out`.
    fn encode_piece(&self, piece: &[u8], caps: &Caps, out: &mut Vec<u32>) {
        if piece.is_empty() {
            return;
        }
        if !caps.merges {
            // merges OFF: emit one rank per single byte (every byte 0..=255 has
            // a rank in gpt2). No byte pair merging happens.
            for &b in piece {
                if let Some(&r) = self.ranks.get(&[b][..]) {
                    out.push(r);
                }
            }
            return;
        }
        // Fast path: the whole piece is a known token.
        if let Some(&r) = self.ranks.get(piece) {
            out.push(r);
            return;
        }
        // byte_pair_encode (tiktoken core).
        let merged = self.byte_pair_merge(piece);
        out.extend(merged);
    }

    /// tiktoken byte_pair_merge: starting from single bytes, repeatedly merge
    /// the adjacent pair with the lowest rank until none is mergeable, then map
    /// each remaining part to its rank.
    fn byte_pair_merge(&self, piece: &[u8]) -> Vec<u32> {
        // parts holds the start index of each part plus a trailing sentinel.
        // rank of the pair starting at parts[i] is the rank of the token
        // piece[parts[i].0 .. parts[i+2].0].
        let mut parts: Vec<(usize, u32)> = Vec::with_capacity(piece.len() + 1);

        // helper closure cannot borrow self mutably while parts is borrowed, so
        // we inline rank lookups using a local function over self.ranks.
        let get_rank = |parts: &Vec<(usize, u32)>, i: usize| -> u32 {
            if i + 3 < parts.len() {
                let start = parts[i].0;
                let end = parts[i + 3].0;
                match self.ranks.get(&piece[start..end]) {
                    Some(&r) => r,
                    None => u32::MAX,
                }
            } else {
                u32::MAX
            }
        };

        // Initialize parts with the rank of the pair starting at each index.
        for i in 0..piece.len() {
            let rank = if i + 1 < piece.len() {
                match self.ranks.get(&piece[i..i + 2]) {
                    Some(&r) => r,
                    None => u32::MAX,
                }
            } else {
                u32::MAX
            };
            parts.push((i, rank));
        }
        // Two sentinels so that get_rank windows are valid at the boundary.
        parts.push((piece.len(), u32::MAX));
        parts.push((piece.len(), u32::MAX));

        // Repeatedly merge the minimum rank pair.
        loop {
            if parts.len() <= 3 {
                // Only one real part remains (plus two sentinels): nothing to do.
                break;
            }
            let mut min_rank: u32 = u32::MAX;
            let mut min_i: usize = usize::MAX;
            for i in 0..parts.len() - 3 {
                let r = parts[i].1;
                if r < min_rank {
                    min_rank = r;
                    min_i = i;
                }
            }
            if min_rank == u32::MAX {
                // No mergeable adjacent pair remains.
                break;
            }
            // Merge the pair at min_i: update its rank to the new pair rank, then
            // recompute the rank of the pair ending at min_i (the one before).
            parts[min_i].1 = get_rank(&parts, min_i);
            if min_i > 0 {
                parts[min_i - 1].1 = get_rank(&parts, min_i - 1);
            }
            parts.remove(min_i + 1);
        }

        // Map each remaining part (excluding the two sentinels) to its rank.
        let mut out = Vec::with_capacity(parts.len().saturating_sub(2));
        for w in 0..parts.len() - 2 {
            let start = parts[w].0;
            let end = parts[w + 1].0;
            let token = &piece[start..end];
            // Every produced token must be in the map (single bytes always are).
            if let Some(&r) = self.ranks.get(token) {
                out.push(r);
            }
        }
        out
    }

    /// Decode token ids back to a String. Concatenates the bytes for each id and
    /// UTF-8 decodes (lossy, matching tiktoken decode behavior on valid input).
    pub fn decode(&self, ids: &[u32]) -> String {
        let mut bytes: Vec<u8> = Vec::new();
        for &id in ids {
            if let Some(b) = self.decoder.get(&id) {
                bytes.extend_from_slice(b);
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// Resolve and load the tokenizer from data files, honoring env overrides.
///
/// ranks: GLASSBOX_RANKS, else ../harness/data/gpt2.tiktoken, else
///        harness/data/gpt2.tiktoken
/// meta:  GLASSBOX_META, else ../harness/data/meta.json, else
///        harness/data/meta.json
pub fn load_default() -> Result<Tokenizer, String> {
    let ranks_path = resolve_path(
        "GLASSBOX_RANKS",
        &["../harness/data/gpt2.tiktoken", "harness/data/gpt2.tiktoken"],
    )?;
    let meta_path = resolve_path(
        "GLASSBOX_META",
        &["../harness/data/meta.json", "harness/data/meta.json"],
    )?;

    let ranks_text = std::fs::read_to_string(&ranks_path)
        .map_err(|e| format!("reading ranks {}: {}", ranks_path, e))?;
    let meta_text = std::fs::read_to_string(&meta_path)
        .map_err(|e| format!("reading meta {}: {}", meta_path, e))?;

    let pattern = extract_pattern(&meta_text)?;
    Tokenizer::new(&ranks_text, &pattern)
}

/// Pick a path from an env var or the first existing fallback. Returns the env
/// value even if it does not exist (so the caller surfaces a clear read error),
/// otherwise the first fallback that exists, otherwise the last fallback.
fn resolve_path(env_key: &str, fallbacks: &[&str]) -> Result<String, String> {
    if let Ok(v) = std::env::var(env_key) {
        if !v.is_empty() {
            return Ok(v);
        }
    }
    for cand in fallbacks {
        if Path::new(cand).exists() {
            return Ok((*cand).to_string());
        }
    }
    fallbacks
        .last()
        .map(|s| (*s).to_string())
        .ok_or_else(|| format!("no path for {}", env_key))
}

/// Extract the "pattern" field from meta.json using serde_json.
fn extract_pattern(meta_text: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(meta_text).map_err(|e| format!("bad meta.json: {}", e))?;
    v.get("pattern")
        .and_then(|p| p.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "meta.json missing string field 'pattern'".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tk() -> Tokenizer {
        load_default().expect("load tokenizer")
    }

    #[test]
    fn hello_world() {
        let t = tk();
        let caps = Caps::all_on();
        assert_eq!(t.encode("Hello, world!", &caps), vec![15496, 11, 995, 0]);
    }

    #[test]
    fn roundtrip_decode() {
        let t = tk();
        let caps = Caps::all_on();
        let ids = t.encode("The quick brown fox.", &caps);
        assert_eq!(t.decode(&ids), "The quick brown fox.");
    }

    #[test]
    fn caps_parse_all() {
        let c = Caps::parse("all");
        assert!(c.merges && c.regex && c.byte_level && c.whitespace);
    }

    #[test]
    fn caps_parse_subset() {
        let c = Caps::parse("merges,regex");
        assert!(c.merges && c.regex);
        assert!(!c.byte_level && !c.whitespace);
    }
}
