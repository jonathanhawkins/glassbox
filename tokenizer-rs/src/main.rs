// Glassbox tokenizer CLI (bin "tok").
//
// encode (default): read stdin line by line; for each line print a compact JSON
//   array of token ids, e.g. [15496,11,995,0].
// decode: first arg "decode"; read stdin line by line, each a JSON array of ids,
//   print the decoded text.
//
// Tokenization correctness is a function of the pretokenizer pattern in
// src/pretok.rs (the lever the swarm edits); the oracle grades the real binary.
// There is no gating: the binary always runs the exact tiktoken algorithm over
// whatever pattern the source currently defines.

use std::io::{self, BufRead, Write};
use std::process::exit;

use glassbox_tokenizer::{load_default, Tokenizer};

enum Mode {
    Encode,
    Decode,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut mode = Mode::Encode;
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "encode" => mode = Mode::Encode,
            "decode" => mode = Mode::Decode,
            "-h" | "--help" => {
                print_help();
                return;
            }
            other => {
                eprintln!("error: unknown argument: {}", other);
                exit(2);
            }
        }
        i += 1;
    }

    let tok = match load_default() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: failed to load tokenizer: {}", e);
            exit(1);
        }
    };

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());

    let result = match mode {
        Mode::Encode => run_encode(&tok, stdin.lock(), &mut out),
        Mode::Decode => run_decode(&tok, stdin.lock(), &mut out),
    };

    if let Err(e) = result {
        let _ = out.flush();
        eprintln!("error: {}", e);
        exit(1);
    }
    if let Err(e) = out.flush() {
        eprintln!("error: flushing stdout: {}", e);
        exit(1);
    }
}

/// Read stdin line by line and write one JSON id array per line.
fn run_encode<R: BufRead, W: Write>(tok: &Tokenizer, reader: R, out: &mut W) -> io::Result<()> {
    // We iterate raw bytes split on \n so that a missing trailing newline still
    // produces exactly one output line per input line, and so leading/trailing
    // spaces inside a line are preserved (BufRead::lines strips only the \n).
    let mut buf: Vec<u8> = Vec::new();
    let mut reader = reader;
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        // Strip a single trailing \n and an optional preceding \r.
        if buf.last() == Some(&b'\n') {
            buf.pop();
            if buf.last() == Some(&b'\r') {
                buf.pop();
            }
        }
        let line = String::from_utf8_lossy(&buf);
        let ids = tok.encode(&line);
        write_ids(out, &ids)?;
        out.write_all(b"\n")?;
    }
    Ok(())
}

/// Read stdin line by line, each a JSON array of ids, write decoded text.
fn run_decode<R: BufRead, W: Write>(tok: &Tokenizer, reader: R, out: &mut W) -> io::Result<()> {
    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.write_all(b"\n")?;
            continue;
        }
        let ids: Vec<u32> = match serde_json::from_str::<Vec<u32>>(trimmed) {
            Ok(v) => v,
            Err(e) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("invalid id array {:?}: {}", trimmed, e),
                ));
            }
        };
        let text = tok.decode(&ids);
        out.write_all(text.as_bytes())?;
        out.write_all(b"\n")?;
    }
    Ok(())
}

/// Write a compact JSON array of ids with no spaces, e.g. [15496,11,995,0].
fn write_ids<W: Write>(out: &mut W, ids: &[u32]) -> io::Result<()> {
    out.write_all(b"[")?;
    let mut first = true;
    let mut numbuf = itoa_buf();
    for &id in ids {
        if !first {
            out.write_all(b",")?;
        }
        first = false;
        let s = format_u32(id, &mut numbuf);
        out.write_all(s)?;
    }
    out.write_all(b"]")?;
    Ok(())
}

/// A small fixed buffer for formatting u32 without allocation.
fn itoa_buf() -> [u8; 10] {
    [0u8; 10]
}

/// Format a u32 into the buffer, returning the written slice.
fn format_u32(mut v: u32, buf: &mut [u8; 10]) -> &[u8] {
    if v == 0 {
        buf[0] = b'0';
        return &buf[..1];
    }
    let mut i = buf.len();
    while v > 0 {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    &buf[i..]
}

fn print_help() {
    println!("tok - Glassbox gpt2 BPE tokenizer");
    println!();
    println!("USAGE:");
    println!("  tok [encode]   encode stdin lines to JSON id arrays");
    println!("  tok decode     decode stdin JSON id arrays to text");
    println!();
    println!("Tokenization correctness comes from the pretokenizer pattern in");
    println!("src/pretok.rs (the lever the swarm edits). There is no gating.");
    println!();
    println!("DATA FILES (env override, else fallback):");
    println!("  GLASSBOX_RANKS  (default ../harness/data/gpt2.tiktoken or harness/data/...)");
}
