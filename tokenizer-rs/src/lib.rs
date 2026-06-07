// Glassbox BPE tokenizer (gpt2). Reproduces tiktoken gpt2 encoding byte for byte.
//
// Mirrors the tiktoken core algorithm:
//  1. Pretokenize with the gpt2 regex (fancy-regex, same engine tiktoken uses).
//  2. For each piece, byte_pair_encode over its UTF-8 bytes against the rank map.
//  3. Concatenate piece outputs in order. No special/BOS/EOS tokens.
//
// The pretokenization pattern lives in `pretok::gpt2_pattern` (src/pretok.rs),
// which is the editable lever the swarm grows: the byte-pair merge below is fixed,
// so a partial pattern carves the wrong pieces for some inputs and those lines
// fail the oracle's exact-match. With the full gpt2 pattern, output is
// byte-for-byte exact (100%).

use std::collections::HashMap;
use std::path::Path;

use base64::Engine as _;
use fancy_regex::Regex;

mod pretok;
pub use pretok::gpt2_pattern;

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

    /// Encode text into token ids with the exact tiktoken gpt2 algorithm.
    ///
    /// Pretokenizes with the configured pattern, then byte-pair-merges each piece.
    /// Correctness is a function of the pattern (see `pretok::gpt2_pattern`): a
    /// partial pattern carves the wrong pieces for some inputs and those lines fail
    /// the oracle's exact match.
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let mut out: Vec<u32> = Vec::new();
        for piece in self.pretokenize(text) {
            self.encode_piece(piece.as_bytes(), &mut out);
        }
        out
    }

    /// Pretokenize the text into pieces with the gpt2 regex (verbatim).
    fn pretokenize<'a>(&self, text: &'a str) -> Vec<&'a str> {
        let mut pieces = Vec::new();
        for m in self.pattern.find_iter(text) {
            // fancy-regex returns Result; on the gpt2 pattern over valid UTF-8
            // this does not error, but be defensive.
            if let Ok(m) = m {
                pieces.push(m.as_str());
            }
        }
        pieces
    }

    /// Encode a single piece's bytes, appending ids to `out`.
    fn encode_piece(&self, piece: &[u8], out: &mut Vec<u32>) {
        if piece.is_empty() {
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
///
/// The pretokenization pattern comes from `pretok::gpt2_pattern` (source code),
/// NOT a data file, so editing src/pretok.rs is what changes tokenization.
pub fn load_default() -> Result<Tokenizer, String> {
    let ranks_path = resolve_path(
        "GLASSBOX_RANKS",
        &["../harness/data/gpt2.tiktoken", "harness/data/gpt2.tiktoken"],
    )?;

    let ranks_text = std::fs::read_to_string(&ranks_path)
        .map_err(|e| format!("reading ranks {}: {}", ranks_path, e))?;

    Tokenizer::new(&ranks_text, &gpt2_pattern())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tk() -> Tokenizer {
        load_default().expect("load tokenizer")
    }

    #[test]
    fn hello_world_exact() {
        let t = tk();
        // Full committed pattern -> exact tiktoken ids (punctuation + space + word).
        assert_eq!(t.encode("Hello, world!"), vec![15496, 11, 995, 0]);
    }

    #[test]
    fn multiword_ascii_exact() {
        let t = tk();
        assert_eq!(t.encode("hello world"), vec![31373, 995]);
    }

    #[test]
    fn roundtrip_decode() {
        let t = tk();
        let ids = t.encode("The quick brown fox.");
        assert_eq!(t.decode(&ids), "The quick brown fox.");
    }

    #[test]
    fn unicode_roundtrip() {
        let t = tk();
        let ids = t.encode("Caf\u{e9} \u{65e5}\u{672c}\u{8a9e}");
        assert_eq!(t.decode(&ids), "Caf\u{e9} \u{65e5}\u{672c}\u{8a9e}");
    }

    #[test]
    fn pattern_is_full_gpt2() {
        // The committed pattern carries every gpt2 branch (the complete lever).
        let p = gpt2_pattern();
        assert!(p.contains(r"\p{L}"), "letters branch present");
        assert!(p.contains(r"\p{N}"), "numbers branch present");
        assert!(p.contains(r"[^\s\p{L}\p{N}]"), "symbols branch present");
        assert!(p.contains(r"'(?:[sdmt]|ll|ve|re)"), "contractions branch present");
    }
}
