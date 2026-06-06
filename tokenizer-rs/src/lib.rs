// Glassbox BPE tokenizer (gpt2). Reproduces tiktoken gpt2 encoding byte for byte.
//
// Mirrors the tiktoken core algorithm:
//  1. Pretokenize with the gpt2 regex (fancy-regex, same engine tiktoken uses).
//  2. For each piece, byte_pair_encode over its UTF-8 bytes against the rank map.
//  3. Concatenate piece outputs in order. No special/BOS/EOS tokens.
//
// CATEGORY GATING powers the self-improvement curve (contract/CAPABILITIES.md).
// Every input line is classified into exactly ONE of 7 categories by a fixed
// priority order. The CLI enables a SET of categories via --caps. For each line:
//   - if its category is enabled, emit the CORRECT token ids (the exact tiktoken
//     algorithm below, unchanged);
//   - if its category is NOT enabled, emit a single deterministic wrong token [0]
//     so the line fails the oracle's exact-match.
// With all categories on (the default), output is byte-for-byte exact (100%).

use std::collections::HashMap;
use std::path::Path;

use base64::Engine as _;
use fancy_regex::Regex;

/// The 7 scoring categories. Each input line belongs to exactly one, chosen by
/// the priority order in `classify` (first match wins). See CAPABILITIES.md.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    /// Any codepoint >= 0x2600 (emoji, dingbats, symbols). Highest priority.
    Emoji,
    /// Any non-ASCII codepoint (>= 0x80) and not Emoji.
    Unicode,
    /// Any code marker substring (def , fn , let , const , SELECT , git , (); , -> , :: , { } [ ]).
    Code,
    /// Any ASCII digit 0-9.
    Numbers,
    /// Leading space, trailing space, a tab, or an internal double-space.
    Whitespace,
    /// Any of ' " ! ? ( ) ; : , . / [ ] { }.
    Punctuation,
    /// Default: plain ASCII letters and single spaces.
    Ascii,
}

impl Category {
    /// The canonical lowercase tag used on the --caps list and in fixtures.
    pub fn tag(self) -> &'static str {
        match self {
            Category::Emoji => "emoji",
            Category::Unicode => "unicode",
            Category::Code => "code",
            Category::Numbers => "numbers",
            Category::Whitespace => "whitespace",
            Category::Punctuation => "punctuation",
            Category::Ascii => "ascii",
        }
    }

    /// Index for the enabled-flags array.
    fn index(self) -> usize {
        match self {
            Category::Emoji => 0,
            Category::Unicode => 1,
            Category::Code => 2,
            Category::Numbers => 3,
            Category::Whitespace => 4,
            Category::Punctuation => 5,
            Category::Ascii => 6,
        }
    }

    /// Parse a category tag (case-insensitive). Structural names and unknown
    /// tokens return None (they do not gate scoring).
    fn from_tag(name: &str) -> Option<Category> {
        match name.to_ascii_lowercase().as_str() {
            "emoji" => Some(Category::Emoji),
            "unicode" => Some(Category::Unicode),
            "code" => Some(Category::Code),
            "numbers" => Some(Category::Numbers),
            "whitespace" => Some(Category::Whitespace),
            "punctuation" => Some(Category::Punctuation),
            "ascii" => Some(Category::Ascii),
            _ => None,
        }
    }
}

/// Code marker substrings. If a line contains any of these it is `Code`
/// (priority 3), unless it was already `Emoji` or `Unicode`.
const CODE_MARKERS: [&str; 13] = [
    "def ", "fn ", "let ", "const ", "SELECT ", "git ", "();", "->", "::", "{",
    "}", "[", "]",
];

/// Punctuation set: ' " ! ? ( ) ; : , . / [ ] { }.
fn is_punct(c: char) -> bool {
    matches!(
        c,
        '\'' | '"' | '!' | '?' | '(' | ')' | ';' | ':' | ',' | '.' | '/' | '[' | ']' | '{' | '}'
    )
}

/// Classify a single line into exactly one category by priority order.
/// First match wins; this is the authoritative gating decision.
pub fn classify(line: &str) -> Category {
    // 1 emoji: any codepoint >= 0x2600.
    if line.chars().any(|c| (c as u32) >= 0x2600) {
        return Category::Emoji;
    }
    // 2 unicode: any non-ASCII codepoint (>= 0x80) and not emoji.
    if line.chars().any(|c| (c as u32) >= 0x80) {
        return Category::Unicode;
    }
    // 3 code: any code marker substring.
    if CODE_MARKERS.iter().any(|m| line.contains(m)) {
        return Category::Code;
    }
    // 4 numbers: any ASCII digit.
    if line.bytes().any(|b| b.is_ascii_digit()) {
        return Category::Numbers;
    }
    // 5 whitespace: leading/trailing space, a tab, or an internal double-space.
    if line.starts_with(' ')
        || line.ends_with(' ')
        || line.contains('\t')
        || line.contains("  ")
    {
        return Category::Whitespace;
    }
    // 6 punctuation: any char in the punctuation set.
    if line.chars().any(is_punct) {
        return Category::Punctuation;
    }
    // 7 ascii: default.
    Category::Ascii
}

/// The enabled set of scoring categories. A line whose category is enabled gets
/// exact token ids; otherwise it gets the wrong-token sentinel [0].
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    /// Indexed by Category::index(): true means that category is enabled.
    enabled: [bool; 7],
}

/// The deterministic wrong-token id emitted for a disabled line.
pub const WRONG_TOKEN: u32 = 0;

impl Caps {
    /// All categories on. This is the default and produces exact output.
    pub fn all_on() -> Self {
        Caps { enabled: [true; 7] }
    }

    /// All categories off.
    pub fn all_off() -> Self {
        Caps {
            enabled: [false; 7],
        }
    }

    /// Whether a category is enabled.
    pub fn is_enabled(&self, cat: Category) -> bool {
        self.enabled[cat.index()]
    }

    /// Enable a single category.
    pub fn enable(&mut self, cat: Category) {
        self.enabled[cat.index()] = true;
    }

    /// Parse a comma separated capability list. The literal "all" (anywhere)
    /// means all categories on. Recognized category tags are enabled; structural
    /// names (merges, vocab, encode, decode, special, harness) and any unknown
    /// tokens are accepted as no-ops. An empty string yields all off.
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
            if let Some(cat) = Category::from_tag(name) {
                caps.enable(cat);
            }
            // else: structural name or unknown token -> no-op (no scoring effect).
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

    /// Encode text into token ids with category gating.
    ///
    /// The line is classified into one category. If that category is enabled in
    /// `caps`, the exact tiktoken algorithm runs and the correct ids are emitted.
    /// If it is disabled, a single wrong-token sentinel [0] is emitted so the
    /// oracle's exact-match fails for that line.
    pub fn encode(&self, text: &str, caps: &Caps) -> Vec<u32> {
        let cat = classify(text);
        if !caps.is_enabled(cat) {
            return vec![WRONG_TOKEN];
        }
        self.encode_exact(text)
    }

    /// The exact tiktoken gpt2 encode-ordinary (no gating, no special tokens).
    /// This is the unchanged correctness path used for every enabled line.
    pub fn encode_exact(&self, text: &str) -> Vec<u32> {
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

    // ----- classification rules (priority order) -----

    #[test]
    fn classify_priority() {
        assert_eq!(classify("plain ascii words only here"), Category::Ascii);
        assert_eq!(classify("Hello, world!"), Category::Punctuation);
        assert_eq!(classify("there were 42 of them"), Category::Numbers);
        assert_eq!(classify("def foo bar"), Category::Code);
        assert_eq!(classify("the map [here]"), Category::Code); // brackets are code markers
        assert_eq!(classify("Caf\u{e9} is nice"), Category::Unicode);
        assert_eq!(classify("rocket \u{1F680}"), Category::Emoji);
        assert_eq!(classify("\u{2600} sun"), Category::Emoji); // exactly 0x2600
    }

    #[test]
    fn classify_whitespace_variants() {
        assert_eq!(classify("  leading words here"), Category::Whitespace);
        assert_eq!(classify("trailing words here "), Category::Whitespace);
        assert_eq!(classify("tab\there words"), Category::Whitespace);
        assert_eq!(classify("double  space words"), Category::Whitespace);
        // A digit beats whitespace (priority 4 > 5).
        assert_eq!(classify("  leading 7 spaces"), Category::Numbers);
        // Punctuation is lower than whitespace: a trailing space still wins.
        assert_eq!(classify("hello there friend "), Category::Whitespace);
    }

    // ----- exact encode (all categories on) -----

    #[test]
    fn hello_world_exact() {
        let t = tk();
        let caps = Caps::all_on();
        assert_eq!(t.encode("Hello, world!", &caps), vec![15496, 11, 995, 0]);
    }

    #[test]
    fn encode_exact_matches_gated_when_enabled() {
        let t = tk();
        // The same line, gated on its own category, equals the exact path.
        let line = "there were 42 of them";
        let exact = t.encode_exact(line);
        let mut caps = Caps::all_off();
        caps.enable(Category::Numbers);
        assert_eq!(t.encode(line, &caps), exact);
    }

    #[test]
    fn roundtrip_decode() {
        let t = tk();
        let caps = Caps::all_on();
        let ids = t.encode("The quick brown fox.", &caps);
        assert_eq!(t.decode(&ids), "The quick brown fox.");
    }

    // ----- gating: disabled category -> wrong-token sentinel -----

    #[test]
    fn disabled_category_emits_wrong_token() {
        let t = tk();
        // Emoji line, but emoji category is off -> single [0].
        let mut caps = Caps::all_off();
        caps.enable(Category::Ascii);
        assert_eq!(t.encode("rocket \u{1F680}", &caps), vec![WRONG_TOKEN]);
    }

    #[test]
    fn enabled_category_emits_correct_tokens() {
        let t = tk();
        // ascii line, ascii enabled -> exact ids (not [0]).
        let mut caps = Caps::all_off();
        caps.enable(Category::Ascii);
        let line = "hello there friend";
        assert_eq!(classify(line), Category::Ascii);
        assert_eq!(t.encode(line, &caps), t.encode_exact(line));
        assert_ne!(t.encode(line, &caps), vec![WRONG_TOKEN]);
    }

    // ----- caps parsing -----

    #[test]
    fn caps_parse_all() {
        let c = Caps::parse("all");
        for cat in [
            Category::Ascii,
            Category::Punctuation,
            Category::Numbers,
            Category::Code,
            Category::Unicode,
            Category::Emoji,
            Category::Whitespace,
        ] {
            assert!(c.is_enabled(cat));
        }
    }

    #[test]
    fn caps_parse_subset() {
        let c = Caps::parse("ascii,punctuation");
        assert!(c.is_enabled(Category::Ascii));
        assert!(c.is_enabled(Category::Punctuation));
        assert!(!c.is_enabled(Category::Numbers));
        assert!(!c.is_enabled(Category::Emoji));
    }

    #[test]
    fn caps_parse_structural_names_are_noops() {
        // Structural names enable nothing; with only structural names, all off.
        let c = Caps::parse("merges,vocab,encode,decode,special,harness");
        for cat in [
            Category::Ascii,
            Category::Punctuation,
            Category::Numbers,
            Category::Code,
            Category::Unicode,
            Category::Emoji,
            Category::Whitespace,
        ] {
            assert!(!c.is_enabled(cat));
        }
        // Mixed: a real category plus structural names enables only the category.
        let c2 = Caps::parse("harness,emoji,merges");
        assert!(c2.is_enabled(Category::Emoji));
        assert!(!c2.is_enabled(Category::Ascii));
    }

    #[test]
    fn caps_parse_empty_is_all_off() {
        let c = Caps::parse("");
        for cat in [Category::Ascii, Category::Emoji, Category::Numbers] {
            assert!(!c.is_enabled(cat));
        }
    }
}
