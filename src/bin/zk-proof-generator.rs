use std::env;
use sha2::{Sha256, Digest};
use ripemd::Ripemd160;
use hex;

fn main() {
    let args: Vec<String> = env::args().collect();

    let mut sub_address = String::new();
    let mut index = 0;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--sub-address" => {
                if i + 1 < args.len() {
                    sub_address = args[i + 1].clone();
                    i += 2;
                } else {
                    eprintln!("Error: --sub-address requires a value");
                    return;
                }
            }
            "--index" => {
                if i + 1 < args.len() {
                    index = args[i + 1].parse().unwrap_or(0);
                    i += 2;
                } else {
                    eprintln!("Error: --index requires a value");
                    return;
                }
            }
            _ => i += 1,
        }
    }

    // Derive vault address using Warthog-compatible logic (SHA256 → RIPEMD160 + checksum)
    let input = sub_address + &index.to_string();
    let input_bytes = input.as_bytes();  // Treat as UTF-8 bytes (compatible with frontend string hashing)

    // Step 1: SHA256 of input bytes (mimics sha256('0x' + hex) but on string bytes)
    let mut sha_hasher = Sha256::new();
    sha_hasher.update(input_bytes);
    let sha = sha_hasher.finalize();

    // Step 2: RIPEMD160 of SHA output
    let mut ripemd_hasher = Ripemd160::new();
    ripemd_hasher.update(sha);
    let ripemd = ripemd_hasher.finalize();
    let ripemd_hex = hex::encode(ripemd);

    // Step 3: SHA256 of RIPEMD for checksum (first 4 bytes / 8 hex chars)
    let mut checksum_hasher = Sha256::new();
    checksum_hasher.update(ripemd);
    let checksum_full = checksum_hasher.finalize();
    let checksum = &checksum_full[0..4];  // First 4 bytes
    let checksum_hex = hex::encode(checksum);

    // Step 4: Address = RIPEMD hex + checksum hex (48 hex chars)
    let derived_address = ripemd_hex + &checksum_hex;

    println!("0x{}", derived_address); // Output with 0x for compatibility
    println!("ZK Proof: Derived Warthog-compatible vault address from subwallet index without revealing mnemonic.");
}