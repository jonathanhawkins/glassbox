// Pre-decode the gpt2 tiktoken ranks at compile time so the runtime pays no
// file IO, no base64, and no per-token allocation. Emits three binary blobs to
// OUT_DIR that lib.rs includes with include_bytes!:
//   ranks_blob.bin    every token's bytes, concatenated in file order
//   ranks_offsets.bin n+1 little-endian u32 offsets into the blob
//   ranks_ranks.bin   n little-endian u32 ranks, one per token
//
// If the data file is missing (building the crate outside this repo), the blobs
// are written empty and the runtime falls back to parsing the file as before.

use std::env;
use std::fs;
use std::path::PathBuf;

use base64::Engine as _;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let src = manifest.join("../harness/data/gpt2.tiktoken");
    println!("cargo:rerun-if-changed={}", src.display());
    println!("cargo:rerun-if-changed=build.rs");

    let mut blob: Vec<u8> = Vec::new();
    let mut offsets: Vec<u8> = Vec::new();
    let mut ranks: Vec<u8> = Vec::new();

    if let Ok(text) = fs::read_to_string(&src) {
        let b64 = base64::engine::general_purpose::STANDARD;
        offsets.extend_from_slice(&0u32.to_le_bytes());
        for line in text.lines() {
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                continue;
            }
            let mut it = line.split_ascii_whitespace();
            let (Some(tok_b64), Some(rank_str)) = (it.next(), it.next()) else {
                emit_empty(&out);
                return;
            };
            let (Ok(bytes), Ok(rank)) = (b64.decode(tok_b64.as_bytes()), rank_str.parse::<u32>())
            else {
                emit_empty(&out);
                return;
            };
            blob.extend_from_slice(&bytes);
            offsets.extend_from_slice(&(blob.len() as u32).to_le_bytes());
            ranks.extend_from_slice(&rank.to_le_bytes());
        }
    }

    if ranks.is_empty() {
        emit_empty(&out);
        return;
    }
    fs::write(out.join("ranks_blob.bin"), &blob).unwrap();
    fs::write(out.join("ranks_offsets.bin"), &offsets).unwrap();
    fs::write(out.join("ranks_ranks.bin"), &ranks).unwrap();
}

/// Write empty blobs so include_bytes! always resolves; runtime falls back to
/// parsing the ranks file.
fn emit_empty(out: &PathBuf) {
    for name in ["ranks_blob.bin", "ranks_offsets.bin", "ranks_ranks.bin"] {
        fs::write(out.join(name), []).unwrap();
    }
}
