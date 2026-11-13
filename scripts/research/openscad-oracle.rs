// SPDX-License-Identifier: BSD-3-Clause
use serde::Deserialize;
use std::io::{self, Read};
use std::time::Instant;
#[derive(Deserialize)]
struct Request {source: String, #[serde(default)] repeat: usize}
fn numeric_limit(s: &str) -> bool {
    let bytes = s.as_bytes(); let mut run = 0;
    for (i, &b) in bytes.iter().enumerate() {
        if b.is_ascii_digit() {run += 1;} else {run = 0;}
        if run > 512 {return true;}
        if (b == b'e' || b == b'E') && i > 0 && bytes[i-1].is_ascii_digit() {
            let mut j = i + 1; if j < bytes.len() && (bytes[j] == b'+' || bytes[j] == b'-') {j += 1;}
            let mut exponent = 0u32;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                exponent = exponent.saturating_mul(10).saturating_add(u32::from(bytes[j]-b'0'));
                if exponent > 4096 {return true;} j += 1;
            }
        }
    }
    false
}
fn main() {
    let mut input = String::new();
    if io::stdin().take(262_145).read_to_string(&mut input).is_err() || input.len() > 262_144 {
        println!("{}", serde_json::json!({"ok":false,"kind":"limit","error":"request exceeds 256 KiB"})); return;
    }
    let request: Request = match serde_json::from_str(&input) {Ok(r) => r,Err(e) => {println!("{}", serde_json::json!({"ok":false,"kind":"request","error":e.to_string()})); return;}};
    if request.source.len() > 131_072 || numeric_limit(&request.source) {
        println!("{}", serde_json::json!({"ok":false,"kind":"limit","error":"source/numeric preflight limit"})); return;
    }
    let started = Instant::now(); let parsed = openscad_rs::parse(&request.source); let cold_us = started.elapsed().as_secs_f64()*1e6;
    match parsed {
        Ok(file) => {
            let repeat = request.repeat.clamp(1,100); let start = Instant::now();
            for _ in 0..repeat {if openscad_rs::parse(&request.source).is_err() {println!("{}", serde_json::json!({"ok":false,"kind":"inconsistent"})); return;}}
            println!("{}",serde_json::json!({"ok":true,"oracle":"openscad-rs","parserRevision":env!("CAD_OPENSCAD_RS_REV"),"hyperrealRevision":env!("CAD_HYPERREAL_REV"),"sourceBytes":request.source.len(),"statements":file.statements.len(),"coldUs":cold_us,"warmUs":start.elapsed().as_secs_f64()*1e6/repeat as f64,"repeat":repeat}));
        }
        Err(error) => println!("{}",serde_json::json!({"ok":false,"kind":"parse","oracle":"openscad-rs","error":format!("{error:?}"),"coldUs":cold_us})),
    }
}
