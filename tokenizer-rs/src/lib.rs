// Glassbox BPE tokenizer (gpt2). Reproduces tiktoken gpt2 encoding byte for byte.
//
// Mirrors the tiktoken core algorithm:
//  1. Pretokenize with the gpt2 regex (fancy-regex, same engine tiktoken uses).
//  2. For each piece, byte_pair_encode over its UTF-8 bytes against the rank map.
//  3. Concatenate piece outputs in order.
//
// Special tokens (the PRD's special-token-handling component) are handled exactly
// like tiktoken: `encode` is the ORDINARY encoder and treats a special string such
// as "<|endoftext|>" as plain text (this is what the oracle corpus expects, since
// fixtures are generated with disallowed_special=()). `encode_with_special` opts a
// caller in: it splits the text on the allowed special strings, encodes each
// ordinary span with the BPE pipeline, and emits the special id (e.g. 50256 for
// <|endoftext|>) in between. So specials are a real, tested feature without
// perturbing the byte-for-byte oracle match.
//
// The pretokenization pattern lives in `pretok::gpt2_pattern` (src/pretok.rs),
// which is the editable lever the swarm grows: the byte-pair merge below is fixed,
// so a partial pattern carves the wrong pieces for some inputs and those lines
// fail the oracle's exact-match. With the full gpt2 pattern, output is
// byte-for-byte exact (100%).

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

use base64::Engine as _;
use fancy_regex::Regex;
use rustc_hash::FxHashMap;

mod pretok;
pub use pretok::gpt2_pattern;

/// Ranks pre-decoded at compile time by build.rs (empty when the data file was
/// not present at build time; the runtime then falls back to parsing the file).
mod embedded {
    pub static BLOB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ranks_blob.bin"));
    pub static OFFSETS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ranks_offsets.bin"));
    pub static RANKS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ranks_ranks.bin"));

    pub fn n_tokens() -> usize {
        RANKS.len() / 4
    }
}

/// A gpt2 byte pair encoder backed by the tiktoken rank map and regex.
pub struct Tokenizer {
    /// token bytes -> rank. Keys borrow the compile-time blob on the embedded
    /// path (zero per-token allocations) and own their bytes on the file path.
    ranks: FxHashMap<Cow<'static, [u8]>, u32>,
    /// rank -> token bytes (for decode); built lazily on first decode so the
    /// encode-only path (the oracle) never pays for it; also carries special ids
    decoder: OnceLock<FxHashMap<u32, Cow<'static, [u8]>>>,
    /// gpt2 pretokenization regex
    pattern: Regex,
    /// special token string -> id (e.g. "<|endoftext|>" -> 50256)
    special: HashMap<String, u32>,
}

impl Tokenizer {
    /// Build a tokenizer with no special tokens (the ordinary encoder).
    ///
    /// Equivalent to ``new_with_special(.., &[])``; kept as the simple constructor
    /// for callers (and tests) that do not need special-token handling.
    pub fn new(tiktoken_text: &str, pattern: &str) -> Result<Self, String> {
        Self::new_with_special(tiktoken_text, pattern, &[])
    }

    /// Build a tokenizer from the in memory tiktoken file contents, the gpt2 regex
    /// pattern string (used verbatim), and a special-token table (string -> id).
    ///
    /// Special ids are added to the decoder so `decode` round-trips them, but they
    /// never participate in ordinary `encode` (only `encode_with_special` emits
    /// them), matching tiktoken's encode_ordinary / encode split.
    pub fn new_with_special(
        tiktoken_text: &str,
        pattern: &str,
        special: &[(&str, u32)],
    ) -> Result<Self, String> {
        // gpt2 has ~50k ranks; preallocate so the build never rehashes.
        let mut ranks: FxHashMap<Cow<'static, [u8]>, u32> =
            FxHashMap::with_capacity_and_hasher(51_000, Default::default());
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
            ranks.insert(Cow::Owned(bytes), rank);
        }
        Self::finish(ranks, pattern, special)
    }

    /// Build a tokenizer from the ranks pre-decoded at compile time. Every key
    /// borrows the static blob: no file IO, no base64, no per-token allocation.
    pub fn new_embedded(pattern: &str, special: &[(&str, u32)]) -> Result<Self, String> {
        let n = embedded::n_tokens();
        if n == 0 {
            return Err("no embedded ranks (data file absent at build time)".to_string());
        }
        let mut ranks: FxHashMap<Cow<'static, [u8]>, u32> =
            FxHashMap::with_capacity_and_hasher(n, Default::default());
        let off = |i: usize| -> usize {
            u32::from_le_bytes(embedded::OFFSETS[i * 4..i * 4 + 4].try_into().unwrap()) as usize
        };
        for i in 0..n {
            let rank = u32::from_le_bytes(embedded::RANKS[i * 4..i * 4 + 4].try_into().unwrap());
            ranks.insert(Cow::Borrowed(&embedded::BLOB[off(i)..off(i + 1)]), rank);
        }
        Self::finish(ranks, pattern, special)
    }

    /// Shared tail of the constructors: special table + pattern compile.
    ///
    /// Special tokens: register the string -> id map. Their bytes are added to
    /// the (lazily built) decoder so decode round-trips them. They are NOT
    /// inserted into `ranks`, so ordinary BPE never produces them.
    fn finish(
        ranks: FxHashMap<Cow<'static, [u8]>, u32>,
        pattern: &str,
        special: &[(&str, u32)],
    ) -> Result<Self, String> {
        let mut special_map: HashMap<String, u32> = HashMap::new();
        for (s, id) in special {
            special_map.insert((*s).to_string(), *id);
        }
        let pattern = Regex::new(pattern).map_err(|e| format!("bad pattern: {}", e))?;
        Ok(Tokenizer {
            ranks,
            decoder: OnceLock::new(),
            pattern,
            special: special_map,
        })
    }

    /// Number of base ranks loaded (excludes special tokens).
    pub fn n_ranks(&self) -> usize {
        self.ranks.len()
    }

    /// Number of registered special tokens.
    pub fn n_special(&self) -> usize {
        self.special.len()
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

    /// Encode text, treating the `allowed` special strings as atomic tokens.
    ///
    /// This is the opt-in counterpart to `encode` (the ordinary encoder). It scans
    /// for the earliest occurrence of any allowed special, encodes the ordinary
    /// span before it with the normal BPE pipeline, emits the special's id, and
    /// continues. A special not present in the table is ignored. Mirrors tiktoken's
    /// `encode(text, allowed_special=...)`.
    pub fn encode_with_special(&self, text: &str, allowed: &HashSet<&str>) -> Vec<u32> {
        let mut out: Vec<u32> = Vec::new();
        let mut start = 0usize;
        loop {
            // Find the earliest allowed special at or after `start`.
            let mut best: Option<(usize, &str)> = None;
            for sp in allowed {
                let Some(&id) = self.special.get(*sp) else {
                    continue;
                };
                let _ = id;
                if let Some(pos) = text[start..].find(*sp) {
                    let abs = start + pos;
                    if best.map_or(true, |(b, _)| abs < b) {
                        best = Some((abs, *sp));
                    }
                }
            }
            match best {
                Some((idx, sp)) => {
                    for piece in self.pretokenize(&text[start..idx]) {
                        self.encode_piece(piece.as_bytes(), &mut out);
                    }
                    out.push(self.special[sp]);
                    start = idx + sp.len();
                }
                None => {
                    for piece in self.pretokenize(&text[start..]) {
                        self.encode_piece(piece.as_bytes(), &mut out);
                    }
                    break;
                }
            }
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

    /// The rank -> bytes map, inverted from `ranks` on first use. Encode never
    /// calls this, so the oracle's encode-only run skips the whole build.
    fn decoder(&self) -> &FxHashMap<u32, Cow<'static, [u8]>> {
        self.decoder.get_or_init(|| {
            let mut d: FxHashMap<u32, Cow<'static, [u8]>> = FxHashMap::with_capacity_and_hasher(
                self.ranks.len() + self.special.len(),
                Default::default(),
            );
            for (bytes, &rank) in &self.ranks {
                d.insert(rank, bytes.clone());
            }
            for (s, &id) in &self.special {
                d.entry(id).or_insert_with(|| Cow::Owned(s.as_bytes().to_vec()));
            }
            d
        })
    }

    /// Decode token ids back to a String. Concatenates the bytes for each id and
    /// UTF-8 decodes (lossy, matching tiktoken decode behavior on valid input).
    pub fn decode(&self, ids: &[u32]) -> String {
        let decoder = self.decoder();
        let mut bytes: Vec<u8> = Vec::new();
        for &id in ids {
            if let Some(b) = decoder.get(&id) {
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
    // gpt2 has exactly one special token, <|endoftext|> = 50256. It is opt-in:
    // ordinary `encode` (what the oracle calls) still treats it as plain text.
    let special: &[(&str, u32)] = &[("<|endoftext|>", 50256)];

    // Fast path: ranks pre-decoded at compile time, unless the env override asks
    // for a specific file (then parse that file exactly as before).
    let overridden = std::env::var("GLASSBOX_RANKS").map_or(false, |v| !v.is_empty());
    if !overridden {
        if let Ok(t) = Tokenizer::new_embedded(&gpt2_pattern(), special) {
            return Ok(t);
        }
    }

    let ranks_path = resolve_path(
        "GLASSBOX_RANKS",
        &["../harness/data/gpt2.tiktoken", "harness/data/gpt2.tiktoken"],
    )?;

    let ranks_text = std::fs::read_to_string(&ranks_path)
        .map_err(|e| format!("reading ranks {}: {}", ranks_path, e))?;

    Tokenizer::new_with_special(&ranks_text, &gpt2_pattern(), special)
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
    fn endoftext_is_registered() {
        let t = tk();
        assert_eq!(t.n_special(), 1, "gpt2 has one special token");
    }

    #[test]
    fn special_token_ignored_by_default() {
        let t = tk();
        // Ordinary encode treats the special string as plain text (oracle behavior).
        let ids = t.encode("hello<|endoftext|>");
        assert!(!ids.contains(&50256), "default encode must not emit the special id");
    }

    #[test]
    fn special_token_opt_in() {
        let t = tk();
        let allowed: HashSet<&str> = ["<|endoftext|>"].into_iter().collect();
        let ids = t.encode_with_special("hello world<|endoftext|>", &allowed);
        let mut expected = t.encode("hello world");
        expected.push(50256);
        assert_eq!(ids, expected, "special id emitted between ordinary spans");
    }

    #[test]
    fn special_token_decode_roundtrip() {
        let t = tk();
        let allowed: HashSet<&str> = ["<|endoftext|>"].into_iter().collect();
        let ids = t.encode_with_special("a<|endoftext|>b", &allowed);
        assert_eq!(t.decode(&ids), "a<|endoftext|>b");
    }

    #[test]
    fn embedded_matches_file_parse() {
        // The compile-time blob and the runtime file parse must define the exact
        // same encoder.
        let emb = Tokenizer::new_embedded(&gpt2_pattern(), &[("<|endoftext|>", 50256)])
            .expect("embedded ranks present in this repo");
        let text = std::fs::read_to_string("../harness/data/gpt2.tiktoken").expect("ranks file");
        let file = Tokenizer::new_with_special(&text, &gpt2_pattern(), &[("<|endoftext|>", 50256)])
            .expect("parse ranks file");
        assert_eq!(emb.n_ranks(), file.n_ranks());
        let sample = "Hello, world! cafe\u{301} 12345 \u{65e5}\u{672c}\u{8a9e}  code(); \t\n end ";
        assert_eq!(emb.encode(sample), file.encode(sample));
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
